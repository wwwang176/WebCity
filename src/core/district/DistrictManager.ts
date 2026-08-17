import { toPosKey } from '../grid/GridHelpers';
import { recoverNextId } from '../utils/recoverNextId';
import { District, Policy, PolicyType, Specialization } from './types';
import { clampLevel, levelForLegacyActive, maxLevel } from './PolicyManager';
import { isDistrictScoped } from './PolicyScope';
import { isValidSwatchIndex } from './DistrictPalette';
import { exclusiveGroupRank, EXCLUSIVE_GROUP_OF } from './PolicyExclusion';
import type { TaxRates } from '../economy/Tax';

/**
 * 存檔裡的政策。舊存檔沒有 `level`，只有 `active`。
 *
 * 兩個欄位都宣告成可選是為了讓 `fromJSON` 能同時吃兩種形狀 —— 讀存檔的程式碼
 * 是唯一該知道舊格式長什麼樣的地方。
 */
export type SerializedPolicy =
  Omit<Policy, 'level'> & { level?: number; active?: boolean };

/** Wire format for a single district. `cells` is a Set at runtime. */
export interface SerializedDistrict {
  id: string;
  name: string;
  colorIndex?: number;
  cells: string[];
  taxRateOverride?: TaxRates;
  policies: SerializedPolicy[];
  specialization: Specialization;
}

export interface SerializedDistrictManager {
  nextId: number;
  districts: SerializedDistrict[];
}

export class DistrictManager {
  private districts: Map<string, District> = new Map();
  /** Reverse index: cellKey → districtId for O(1) lookup. */
  private cellToDistrict: Map<string, string> = new Map();
  private nextId = 1;

  createDistrict(name: string): District {
    const district: District = {
      id: `district_${this.nextId++}`,
      name,
      cells: new Set<string>(),
      policies: [],
      specialization: Specialization.NONE,
    };
    this.districts.set(district.id, district);
    return district;
  }

  getDistrict(id: string): District | undefined {
    return this.districts.get(id);
  }

  getAllDistricts(): District[] {
    return Array.from(this.districts.values());
  }

  addCellToDistrict(districtId: string, x: number, y: number): void {
    const district = this.districts.get(districtId);
    if (!district) return;
    const key = toPosKey(x, y);
    // Remove from previous district via reverse index (O(1) instead of O(D))
    const prevId = this.cellToDistrict.get(key);
    if (prevId && prevId !== districtId) {
      this.districts.get(prevId)?.cells.delete(key);
    }
    district.cells.add(key);
    this.cellToDistrict.set(key, districtId);
  }

  removeCellFromDistrict(districtId: string, x: number, y: number): void {
    const district = this.districts.get(districtId);
    if (!district) return;
    const key = toPosKey(x, y);
    district.cells.delete(key);
    if (this.cellToDistrict.get(key) === districtId) {
      this.cellToDistrict.delete(key);
    }
  }

  getDistrictAt(x: number, y: number): District | null {
    const key = toPosKey(x, y);
    const id = this.cellToDistrict.get(key);
    if (!id) return null;
    return this.districts.get(id) ?? null;
  }

  /** 換色票。索引壞掉就當成沒選過 —— 存檔是可以編輯的。 */
  setDistrictColor(id: string, colorIndex: number | undefined): void {
    const district = this.districts.get(id);
    if (!district) return;
    district.colorIndex = isValidSwatchIndex(colorIndex) ? colorIndex : undefined;
  }

  renameDistrict(id: string, name: string): void {
    const district = this.districts.get(id);
    if (!district) return;
    district.name = name;
  }

  mergeDistricts(id1: string, id2: string): District {
    const d1 = this.districts.get(id1);
    const d2 = this.districts.get(id2);
    if (!d1 || !d2) {
      throw new Error('District not found');
    }
    for (const cell of d2.cells) {
      d1.cells.add(cell);
      this.cellToDistrict.set(cell, id1);
    }
    this.districts.delete(id2);
    return d1;
  }

  splitDistrict(id: string, cells: Set<string>): District {
    const original = this.districts.get(id);
    if (!original) {
      throw new Error('District not found');
    }
    const newDistrict: District = {
      id: `district_${this.nextId++}`,
      name: `${original.name} (Split)`,
      cells: new Set<string>(),
      policies: [],
      specialization: Specialization.NONE,
    };

    for (const cell of cells) {
      if (original.cells.has(cell)) {
        original.cells.delete(cell);
        newDistrict.cells.add(cell);
        this.cellToDistrict.set(cell, newDistrict.id);
      }
    }

    this.districts.set(newDistrict.id, newDistrict);
    return newDistrict;
  }

  /**
   * Serialize districts including their cell membership. The grid carries no
   * districtId, so this is the only place the membership can be recovered from
   * — without it a save silently loses every district (BUG-053).
   */
  toJSON(): SerializedDistrictManager {
    return {
      nextId: this.nextId,
      districts: this.getAllDistricts().map((d) => ({
        id: d.id,
        name: d.name,
        colorIndex: d.colorIndex,
        cells: [...d.cells],
        taxRateOverride: d.taxRateOverride,
        policies: d.policies.map((p) => ({ ...p })),
        specialization: d.specialization,
      })),
    };
  }

  static fromJSON(data: SerializedDistrictManager | undefined): DistrictManager {
    const mgr = new DistrictManager();
    if (!data) return mgr;

    for (const sd of data.districts ?? []) {
      const district: District = {
        id: sd.id,
        name: sd.name,
        cells: new Set(sd.cells ?? []),
        taxRateOverride: sd.taxRateOverride,
        colorIndex: isValidSwatchIndex(sd.colorIndex) ? sd.colorIndex : undefined,
        // 全城條例不該出現在分區的政策清單裡。`setPolicyLevel` 擋得住正常路徑，
        // 但存檔是另一條進得來的門 —— 從那裡塞一條進來，收入效果會被套兩次
        // （全城一次、分區一次），費用也會被收兩次。
        policies: (sd.policies ?? []).filter((p) => isDistrictScoped(p.type)).map((p) => ({
          id: p.id, name: p.name, type: p.type,
          // 舊存檔只有 `active`。掉成 0 的話玩家讀檔會發現政策全被關掉了，而畫面上
          // 沒有任何東西說明為什麼；一律轉成 1 則會讓舊數字不在第一格的政策靜靜地
          // 變弱，所以走 `levelForLegacyActive`。
          //
          // 新格式的 `level` 是權威（存過一次的檔案不該被舊欄位蓋回去），但一樣要
          // 夾 —— 存檔是能被編輯的。
          level: clampLevel(
            p.level ?? levelForLegacyActive(p.type, p.active),
            maxLevel(p.type),
          ),
        })),
        specialization: sd.specialization ?? Specialization.NONE,
      };
      // 同一個 PolicyType 只能有一筆。兩筆不在彼此的互斥組裡，所以下面的檢查會
      // 放行 —— 而 `PolicyManager.effect` 是逐筆疊乘的，setter 與 UI 卻只操作
      // `find()` 找到的第一筆:畫面上關掉了，效果還在。
      const byType = new Map<PolicyType, Policy>();
      for (const p of district.policies) {
        const prev = byType.get(p.type);
        if (!prev || p.level > prev.level) byType.set(p.type, p);
      }
      district.policies = [...byType.values()];

      // 互斥組在存檔這條路上也要重跑。`setPolicyLevel` 擋得住正常操作，但手改一次
      // 存檔就能讓賭場與宵禁同時生效 —— 那是效果表算不出來的組合。
      //
      // 留哪一條由 `exclusiveGroupRank`（組內的宣告順序）決定，不是存檔的排列順序:
      // 同一個檔案換個排列就讀出不同結果的話，玩家沒有辦法知道發生了什麼事。
      const winners = new Map<number, Policy>();
      for (const p of district.policies) {
        if (p.level === 0) continue;
        const rank = exclusiveGroupRank(p.type);
        if (rank < 0) continue;
        const groupKey = EXCLUSIVE_GROUP_OF.get(p.type)!;
        const held = winners.get(groupKey);
        if (!held) { winners.set(groupKey, p); continue; }
        const loser = exclusiveGroupRank(held.type) <= rank ? p : held;
        if (loser === held) winners.set(groupKey, p);
        loser.level = 0;
      }
      mgr.districts.set(district.id, district);
      // Rebuild the reverse index rather than persisting it — it is pure derived state.
      for (const cell of district.cells) {
        mgr.cellToDistrict.set(cell, district.id);
      }
    }

    mgr.nextId = data.nextId ?? recoverNextId(mgr.getAllDistricts(), 'district_');
    return mgr;
  }
}
