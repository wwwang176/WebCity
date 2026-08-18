import { toPosKey, parsePosKey } from '../grid/GridHelpers';
import { RoadType } from '../road/types';
import { recoverNextId } from '../utils/recoverNextId';
import { District, Policy, PolicyType, Specialization } from './types';
import { clampLevel, levelForLegacyActive, maxLevel } from './PolicyManager';
import { isDistrictScoped } from './PolicyScope';
import { isValidSwatchIndex, nextSwatchIndex } from './DistrictPalette';
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

/**
 * 這個分區裡有幾格是道路。
 *
 * 壅塞費的門架維運費照這個數字收 —— 門架是架在路上的，不是架在地上。用分區的
 * 總格數計價的話，圈一片公園綠地跟圈一片密集路網要付一樣多，而前者根本沒有地方
 * 可以架門架。
 *
 * 越界的格子不算:存檔是使用者能編輯的檔案，`getCell` 對越界回 null，當成有路的話
 * 一個手改過的分區就能憑空生出門架費。
 */
export function countRoadCellsInDistrict(
  grid: { getCell(x: number, y: number): { roadType: number } | null },
  district: { cells: ReadonlySet<string> },
): number {
  let roads = 0;
  for (const key of district.cells) {
    const pos = parsePosKey(key);
    if (!pos) continue;
    const cell = grid.getCell(pos.x, pos.y);
    if (cell && cell.roadType !== RoadType.NONE) roads++;
  }
  return roads;
}

/**
 * 把分區清單補上計費要用的兩個量:道路格數與付費的駕駛人數。
 *
 * 計費那一層只認得一個最小介面（格數、道路格數、付費人數、政策），不認得
 * `District` —— 這裡是兩者之間唯一的轉接點，所以「門架照道路算」「過路費逐區算」
 * 這兩件事各只有一個地方會寫錯。
 */
export function billableDistricts<T extends { id: string; cells: ReadonlySet<string> }>(
  grid: { getCell(x: number, y: number): { roadType: number } | null },
  districts: readonly T[],
  stats?: { chargedDriversByDistrict: ReadonlyMap<string, number> },
): (T & { roadCells: number; chargedDrivers: number })[] {
  return districts.map(d => ({
    ...d,
    roadCells: countRoadCellsInDistrict(grid, d),
    chargedDrivers: stats?.chargedDriversByDistrict.get(d.id) ?? 0,
  }));
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
      colorIndex: this.freeSwatch(),
      policies: [],
      specialization: Specialization.NONE,
    };
    this.districts.set(district.id, district);
    return district;
  }

  /**
   * 目前沒人用（或用得最少）的色票。
   *
   * 分區一建立就配好顏色 —— 不配的話它會落在 id 雜湊出來的色相上，那個色相不在
   * 色票裡，玩家也沒得「改回原本那個」。
   */
  private freeSwatch(): number {
    return nextSwatchIndex(this.getAllDistricts().map(d => d.colorIndex));
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

  /**
   * 整個分區刪掉，連同它身上的條例。
   *
   * 筆刷把一區的格子扣光時分區會留下來 —— 它身上的條例設定不該因為擦掉一次就消失
   * （見 `DistrictPaint` 的測試）。但那代表清單上會慢慢積滿沒有格子、也碰不到的
   * 名字，所以要有一條明確的刪除路徑。
   *
   * 逐格索引跟著清。這件事**沒有測試守得到** —— `getDistrictAt` 有 `?? null`、
   * `addCellToDistrict` 對舊主人用 `?.`，兩邊都吃得下指向已刪分區的索引，所以清不清
   * 在行為上看不出差別，只差在那些鍵會一直留著。留著它是為了維持「逐格索引是純衍生
   * 狀態」這個不變式（`fromJSON` 就是照這個前提整個重建的），而不是下游靠著它。
   */
  deleteDistrict(id: string): void {
    const district = this.districts.get(id);
    if (!district) return;
    for (const key of district.cells) {
      if (this.cellToDistrict.get(key) === id) this.cellToDistrict.delete(key);
    }
    this.districts.delete(id);
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
      // 切出來的也是一個新分區，玩家一樣要在地圖上分得出它跟原本那一區。
      colorIndex: this.freeSwatch(),
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
