/**
 * PoliceFireLoadCalculator — Extracted from SimulationLoop (SRP).
 *
 * Calculates weighted demand arrays for police and fire services
 * based on citizen demographics, education, and building occupancy.
 * Pure computation: no state mutation, no GC-heavy allocations.
 */

import { EducationLevel } from '../citizen/types';
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

interface CitizenLike {
  homeId: string | null;
  workplaceId: string | null;
  education: EducationLevel;
}

// ── Public API ──

/**
 * Calculate police demand weights for each citizen location within coverage.
 * Residential demand weighted by education, workplace demand weighted by zone type.
 */
export function calculatePoliceLoads(
  citizens: readonly CitizenLike[],
  police: CoverageQuery,
  grid: GridCellQuery,
): DemandEntry[] {
  const demands: DemandEntry[] = [];

  for (const c of citizens) {
    if (c.homeId) {
      const pos = parsePosKey(c.homeId);
      if (pos && police.getCoverage(pos.x, pos.y)) {
        const eMult = POLICE_EDUCATION_MULT[c.education] ?? 1.0;
        demands.push({ x: pos.x, y: pos.y, weight: BASE_DEMAND * eMult });
      }
    }

    if (c.workplaceId) {
      const wpos = parsePosKey(c.workplaceId);
      if (wpos && police.getCoverage(wpos.x, wpos.y)) {
        const wcell = grid.getCell(wpos.x, wpos.y);
        const zt = (wcell?.zoneType ?? ZoneType.NONE) as ZoneType;
        const zMult = POLICE_ZONE_MULT[zt] ?? 1.0;
        demands.push({ x: wpos.x, y: wpos.y, weight: BASE_DEMAND * zMult });
      }
    }
  }

  return demands;
}

/**
 * Calculate fire demand weights for each citizen location within coverage.
 * Residential demand weighted by building occupancy, workplace demand weighted by zone type.
 * @param getBuildingResidents Optional lookup for building capacity (default: 1).
 */
export function calculateFireLoads(
  citizens: readonly CitizenLike[],
  fire: CoverageQuery,
  grid: GridCellQuery,
  getBuildingResidents?: (buildingId: number) => number,
): DemandEntry[] {
  const demands: DemandEntry[] = [];

  // Pre-compute occupancy count per home for fire demand
  const homePop = new Map<string, number>();
  for (const c of citizens) {
    if (c.homeId) homePop.set(c.homeId, (homePop.get(c.homeId) ?? 0) + 1);
  }

  for (const c of citizens) {
    if (c.homeId) {
      const pos = parsePosKey(c.homeId);
      if (pos && fire.getCoverage(pos.x, pos.y)) {
        const cell = grid.getCell(pos.x, pos.y);
        const cap = Math.max(1, getBuildingResidents?.(cell?.buildingId ?? 0) ?? 1);
        const occ = (homePop.get(c.homeId) ?? 0) / cap;
        demands.push({ x: pos.x, y: pos.y, weight: BASE_DEMAND * (1 + occ) });
      }
    }

    if (c.workplaceId) {
      const wpos = parsePosKey(c.workplaceId);
      if (wpos && fire.getCoverage(wpos.x, wpos.y)) {
        const wcell = grid.getCell(wpos.x, wpos.y);
        const zt = (wcell?.zoneType ?? ZoneType.NONE) as ZoneType;
        const zMult = FIRE_ZONE_MULT[zt] ?? 1.0;
        demands.push({ x: wpos.x, y: wpos.y, weight: BASE_DEMAND * zMult });
      }
    }
  }

  return demands;
}
