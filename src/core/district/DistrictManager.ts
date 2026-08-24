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
 * A policy as stored in a save. Older saves have `active` and no `level`.
 *
 * Both fields are optional so `fromJSON` can accept either shape: the save-reading code is the
 * only place that should know what the old format looked like.
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
 * How many of this district's cells are roads.
 *
 * The congestion charge's gantry upkeep is charged on this figure, because gantries stand on
 * roads rather than on land. Pricing by total district cells makes enclosing a park cost the
 * same as enclosing a dense road network, and the park has nowhere to put a gantry.
 *
 * Out-of-bounds cells do not count: a save is a file the user can edit, `getCell` returns null
 * out of bounds, and treating that as a road lets a hand-edited district conjure gantry fees.
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
 * Adds the two quantities billing needs to a district list: road cell count and paying drivers.
 *
 * The billing layer knows only a minimal interface — cell count, road cell count, paying
 * drivers, policies — and not `District`. This is the only adapter between them, so "gantries
 * are charged on roads" and "tolls are charged per district" each have exactly one place to go
 * wrong.
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
   * The least-used swatch, or an unused one.
   *
   * A district gets a colour when it is created. Without one it falls back to a hue hashed from
   * its id, which is not in the palette and which the player cannot choose again.
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

  /** Changes the swatch. A broken index counts as never chosen, since saves are editable. */
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
   * Deletes a district along with its policies.
   *
   * Erasing a district's last cell with the brush leaves the district behind: its policy settings
   * should not vanish because of one erase (see `DistrictPaint`'s tests). But that lets the list
   * fill with unreachable, cell-less names, so there has to be an explicit delete.
   *
   * The per-cell index is cleared with it. Nothing tests that: `getDistrictAt` has a `?? null`
   * and `addCellToDistrict` uses `?.` on the previous owner, so both tolerate an index pointing
   * at a deleted district and the only difference is that those keys stay around. It is done to
   * keep the invariant that the per-cell index is purely derived state — `fromJSON` rebuilds it
   * wholesale on that assumption — not because anything downstream relies on it.
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
      // A split produces a new district too, and the player has to tell it from the original on
      // the map.
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
        // A city ordinance has no place in a district's policy list. `setPolicyLevel` stops the
        // normal path, but a save is another way in: one inserted there applies its revenue
        // effect twice, once city-wide and once per district, and charges its fee twice.
        policies: (sd.policies ?? []).filter((p) => isDistrictScoped(p.type)).map((p) => ({
          id: p.id, name: p.name, type: p.type,
          // Older saves have only `active`. Falling back to 0 turns every policy off on load
          // with nothing on screen explaining why, and converting everything to 1 silently
          // weakens policies whose old value was not the first step, so this goes through
          // `levelForLegacyActive`.
          //
          // The new format's `level` is authoritative — a file saved once must not be overwritten
          // by the older field — but is still clamped, because saves are editable.
          level: clampLevel(
            p.level ?? levelForLegacyActive(p.type, p.active),
            maxLevel(p.type),
          ),
        })),
        specialization: sd.specialization ?? Specialization.NONE,
      };
      // One entry per PolicyType. Two entries are not in each other's exclusive group, so the
      // check below lets them through, while `PolicyManager.effect` multiplies entry by entry and
      // the setter and the UI only touch the first one `find()` returns: switched off on screen,
      // still in effect.
      const byType = new Map<PolicyType, Policy>();
      for (const p of district.policies) {
        const prev = byType.get(p.type);
        if (!prev || p.level > prev.level) byType.set(p.type, p);
      }
      district.policies = [...byType.values()];

      // Exclusive groups are re-applied on the save path too. `setPolicyLevel` stops normal
      // operation, but one hand edit to a save has a casino and a curfew both in effect, a
      // combination the effect table cannot evaluate.
      //
      // Which one survives is decided by `exclusiveGroupRank`, the declaration order within the
      // group, not by the save's ordering: one file reordered reading differently would leave the
      // player no way to know what happened.
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
