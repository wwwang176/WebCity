/**
 * PoliceFireLoadCalculator — Extracted from SimulationLoop (SRP).
 *
 * Calculates weighted demand arrays for police and fire services
 * based on citizen demographics, education, and building occupancy.
 * Pure computation: no state mutation, no GC-heavy allocations.
 */

import { EducationLevel } from '../citizen/types';
import type { CitizenLocationIndex } from '../citizen/CitizenLocationIndex';
import { ZoneType } from '../grid/types';
import { parsePosKey } from '../grid/GridHelpers';

// ── Constants ──

const BASE_DEMAND = 0.3;

/** Police demand weight by education level (avg = 1.0). */
const POLICE_EDUCATION_MULT: Record<string, number> = {
  [EducationLevel.NONE]: 2.0,
  [EducationLevel.ELEMENTARY]: 1.1,
  [EducationLevel.HIGH_SCHOOL]: 0.6,
  [EducationLevel.UNIVERSITY]: 0.3,
};

/** Police demand weight by workplace zone type. */
const POLICE_ZONE_MULT: Partial<Record<ZoneType, number>> = {
  [ZoneType.INDUSTRIAL]: 1.5,
  [ZoneType.COMMERCIAL_LOW]: 1.0,
  [ZoneType.COMMERCIAL_HIGH]: 1.0,
  [ZoneType.OFFICE]: 0.5,
};

/** Fire demand weight by workplace zone type. */
const FIRE_ZONE_MULT: Partial<Record<ZoneType, number>> = {
  [ZoneType.INDUSTRIAL]: 2.0,
  [ZoneType.COMMERCIAL_LOW]: 1.2,
  [ZoneType.COMMERCIAL_HIGH]: 1.2,
  [ZoneType.OFFICE]: 0.8,
};

// ── Minimal interfaces (DIP: depend on abstractions, not GameState) ──

interface CoverageQuery {
  getCoverage(x: number, y: number): boolean;
}

interface GridCellQuery {
  getCell(x: number, y: number): { zoneType: number; buildingId?: number } | null;
}

interface DemandEntry {
  x: number;
  y: number;
  weight: number;
}

// ── Public API ──

/**
 * 每一格的警力需求權重。住宅看學歷，工作地看分區。
 *
 * 吃的是**位置索引**不是市民名單:同一棟樓的住戶算出來的座標與覆蓋完全一樣，
 * 逐市民做的話 12 萬人要付 24 萬次 `parsePosKey` + `getCoverage`，而不重複的位置
 * 只有幾千個。下游 `distributeLoadToNearest` 對同一格只做加總，先加起來再送進去
 * 結果一樣 —— 這是去重，不是近似。
 */
export function calculatePoliceLoads(
  index: CitizenLocationIndex,
  police: CoverageQuery,
  grid: GridCellQuery,
): DemandEntry[] {
  const demands: DemandEntry[] = [];

  for (const [home, byEducation] of index.homeEducation) {
    const pos = parsePosKey(home);
    if (!pos || !police.getCoverage(pos.x, pos.y)) continue;
    let mult = 0;
    for (const [education, count] of byEducation) {
      mult += (POLICE_EDUCATION_MULT[education] ?? 1.0) * count;
    }
    demands.push({ x: pos.x, y: pos.y, weight: BASE_DEMAND * mult });
  }

  for (const [workplace, count] of index.workCounts) {
    const wpos = parsePosKey(workplace);
    if (!wpos || !police.getCoverage(wpos.x, wpos.y)) continue;
    const wcell = grid.getCell(wpos.x, wpos.y);
    const zt = (wcell?.zoneType ?? ZoneType.NONE) as ZoneType;
    const zMult = POLICE_ZONE_MULT[zt] ?? 1.0;
    demands.push({ x: wpos.x, y: wpos.y, weight: BASE_DEMAND * zMult * count });
  }

  return demands;
}

/**
 * 每一格的消防需求權重。住宅看擠迫程度，工作地看分區。
 *
 * 與警力同一個道理:吃位置索引。住宅那一項的權重原本是逐住戶 `BASE * (1 + 擠迫)`，
 * 同一棟樓每個人都一樣 —— 乘上人數即可。擠迫的定義沒有變（分母仍是建築容量，
 * 分子仍是「所有把這裡當家的人」，不受消防覆蓋範圍影響）。
 *
 * 數學上等值，但**不是逐位元相同**:實數的 `H × w` 與 `w` 加 H 次在 IEEE-754 下
 * 最後幾個 bit 可能不同。測試因此用 `toBeCloseTo`。
 *
 * @param getBuildingResidents Optional lookup for building capacity (default: 1).
 */
export function calculateFireLoads(
  index: CitizenLocationIndex,
  fire: CoverageQuery,
  grid: GridCellQuery,
  getBuildingResidents?: (buildingId: number) => number,
): DemandEntry[] {
  const demands: DemandEntry[] = [];

  for (const [home, count] of index.homeCounts) {
    const pos = parsePosKey(home);
    if (!pos || !fire.getCoverage(pos.x, pos.y)) continue;
    const cell = grid.getCell(pos.x, pos.y);
    const cap = Math.max(1, getBuildingResidents?.(cell?.buildingId ?? 0) ?? 1);
    const occ = count / cap;
    demands.push({ x: pos.x, y: pos.y, weight: BASE_DEMAND * (1 + occ) * count });
  }

  for (const [workplace, count] of index.workCounts) {
    const wpos = parsePosKey(workplace);
    if (!wpos || !fire.getCoverage(wpos.x, wpos.y)) continue;
    const wcell = grid.getCell(wpos.x, wpos.y);
    const zt = (wcell?.zoneType ?? ZoneType.NONE) as ZoneType;
    const zMult = FIRE_ZONE_MULT[zt] ?? 1.0;
    demands.push({ x: wpos.x, y: wpos.y, weight: BASE_DEMAND * zMult * count });
  }

  return demands;
}
