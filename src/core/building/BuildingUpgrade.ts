import { Grid } from '../grid/Grid';
import { isResidentialZone, isCommercialZone } from '../grid/types';
import { getBuildingType, getBuildingsForZone } from './types';
import { EducationLevel } from '../citizen/types';
import { ABANDONED, BURNED } from './InfraPlacement';

/** Education score mapping (NONE=0, ELEMENTARY=1, HIGH_SCHOOL=2, UNIVERSITY=3). */
export const EDUCATION_SCORE: Record<EducationLevel, number> = {
  [EducationLevel.NONE]: 0,
  [EducationLevel.ELEMENTARY]: 1,
  [EducationLevel.HIGH_SCHOOL]: 2,
  [EducationLevel.UNIVERSITY]: 3,
};

/** Compute average education score from a list of citizens. Returns 0 if empty. */
export function avgEducationScore(workers: Iterable<{ education: EducationLevel }>): number {
  let sum = 0;
  let count = 0;
  for (const w of workers) {
    sum += EDUCATION_SCORE[w.education] ?? 0;
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

/** Zone-aware upgrade conditions.
 *  - Residential/Commercial: landValue drives leveling (services affect it indirectly).
 *  - Industrial/Office: average worker education drives leveling (matches C:S). */
export interface UpgradeConditions {
  landValue: number;
  avgEducation: number;
}

// ── Requirements tables ──────────────────────────────────────────────

export interface LevelRequirement {
  minLandValue: number;       // for residential/commercial
  minAvgEducation: number;    // for industrial/office
}

/** Requirements to REACH each level (keyed by target level).
 *  Residential/Commercial use minLandValue; Industrial/Office use minAvgEducation.
 *  Services, crime, pollution affect residential/commercial indirectly via landValue. */
export const UPGRADE_REQUIREMENTS: Record<number, LevelRequirement> = {
  2: { minLandValue: 50, minAvgEducation: 1.0 },
  3: { minLandValue: 80, minAvgEducation: 2.0 },
};

/** Requirements to KEEP each level (downgrade if not met).
 *  Thresholds are lower than upgrade to create hysteresis and avoid oscillation. */
export const KEEP_REQUIREMENTS: Record<number, LevelRequirement> = {
  2: { minLandValue: 35, minAvgEducation: 0.5 },
  3: { minLandValue: 60, minAvgEducation: 1.5 },
};

// ── Pure check functions ─────────────────────────────────────────────

/** Check if conditions meet a level requirement for the given zone type. */
export function meetsRequirement(
  zoneType: number,
  conditions: UpgradeConditions,
  req: LevelRequirement,
): boolean {
  if (isResidentialZone(zoneType) || isCommercialZone(zoneType)) {
    return conditions.landValue >= req.minLandValue;
  }
  // Industrial / Office
  return conditions.avgEducation >= req.minAvgEducation;
}

// ── BuildingUpgrade class ────────────────────────────────────────────

export class BuildingUpgrade {
  private grid: Grid;

  constructor(grid: Grid) {
    this.grid = grid;
  }

  canUpgrade(x: number, y: number, conditions: UpgradeConditions): boolean {
    const cell = this.grid.getCell(x, y);
    if (!cell || cell.buildingId === 0) return false;
    // Ruins are not buildings that can move up or down a level. Beyond the
    // wasted sampling budget, letting one through is the only way SimulationLoop
    // reaches its onBuildingUpdated callback for an abandoned building — and
    // that callback omits the `abandoned` argument, so the renderer re-lights it
    // and the player sees a normal house that pays no tax and houses nobody
    // (BUG-086).
    if (cell.reserved === ABANDONED || cell.reserved === BURNED) return false;

    const building = getBuildingType(cell.buildingId);
    if (!building) return false;

    const req = UPGRADE_REQUIREMENTS[building.level + 1];
    if (!req) return false;
    return meetsRequirement(building.zoneType, conditions, req);
  }

  tryUpgrade(x: number, y: number, conditions: UpgradeConditions): boolean {
    if (!this.canUpgrade(x, y, conditions)) return false;

    const cell = this.grid.getCell(x, y);
    if (!cell) return false;

    const building = getBuildingType(cell.buildingId);
    if (!building) return false;

    const nextLevel = (building.level + 1) as 1 | 2 | 3;
    const candidates = getBuildingsForZone(building.zoneType, building.density, nextLevel);
    if (candidates.length === 0) return false;

    const next = candidates[0]!;
    this.grid.setCell(x, y, { buildingId: next.id });
    return true;
  }

  shouldDowngrade(x: number, y: number, conditions: UpgradeConditions): boolean {
    const cell = this.grid.getCell(x, y);
    if (!cell || cell.buildingId === 0) return false;
    // Same exclusion as canUpgrade — see the comment there.
    if (cell.reserved === ABANDONED || cell.reserved === BURNED) return false;

    const building = getBuildingType(cell.buildingId);
    if (!building || building.level <= 1) return false;

    const req = KEEP_REQUIREMENTS[building.level];
    if (!req) return false;
    return !meetsRequirement(building.zoneType, conditions, req);
  }

  tryDowngrade(x: number, y: number, conditions: UpgradeConditions): boolean {
    if (!this.shouldDowngrade(x, y, conditions)) return false;

    const cell = this.grid.getCell(x, y);
    if (!cell) return false;

    const building = getBuildingType(cell.buildingId);
    if (!building) return false;

    const prevLevel = (building.level - 1) as 1 | 2 | 3;
    const candidates = getBuildingsForZone(building.zoneType, building.density, prevLevel);
    if (candidates.length === 0) return false;

    const prev = candidates[0]!;
    this.grid.setCell(x, y, { buildingId: prev.id });
    return true;
  }
}
