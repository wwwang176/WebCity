import { toPosKey } from '../grid/GridHelpers';
import { recoverNextId } from '../utils/recoverNextId';
import { District, Policy, Specialization } from './types';
import { clampLevel, maxLevel } from './PolicyManager';
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
        policies: (sd.policies ?? []).map((p) => ({
          id: p.id, name: p.name, type: p.type, cost: p.cost,
          // 舊存檔只有 `active`。掉成 0 的話玩家讀檔會發現政策全被關掉了，而畫面上
          // 沒有任何東西說明為什麼。新格式的 `level` 是權威（存過一次的檔案不該被
          // 舊欄位蓋回去），但一樣要夾 —— 存檔是能被編輯的。
          level: clampLevel(p.level ?? (p.active ? 1 : 0), maxLevel(p.type)),
        })),
        specialization: sd.specialization ?? Specialization.NONE,
      };
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
