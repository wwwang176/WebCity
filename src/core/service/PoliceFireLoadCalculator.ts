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
 * The police demand weight per cell. Housing follows education, workplaces follow zone.
 *
 * Takes a **location index** rather than a citizen list: residents of one building produce
 * identical coordinates and coverage, so working per citizen costs 240,000 `parsePosKey` +
 * `getCoverage` calls for 120,000 people across a few thousand distinct positions. Downstream,
 * `distributeLoadToNearest` only sums per cell, so pre-summing gives the same result. This is
 * deduplication, not approximation.
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
 * The fire demand weight per cell. Housing follows crowding, workplaces follow zone.
 *
 * The same reasoning as police: it takes a location index. The housing weight is
 * `BASE * (1 + crowding)` per resident and identical for everyone in one building, so it is
 * multiplied by the count instead. Crowding's definition is unchanged: the denominator is still
 * building capacity and the numerator still everyone who calls it home, independent of fire
 * coverage.
 *
 * Mathematically equivalent but **not bit-identical**: under IEEE-754 the last few bits of
 * `H * w` and of `w` added H times can differ, which is why the tests use `toBeCloseTo`.
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
