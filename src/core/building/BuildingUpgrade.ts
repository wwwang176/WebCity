import { Grid } from '../grid/Grid';
import { getBuildingType, getBuildingsForZone } from './types';

export interface UpgradeConditions {
  serviceCoverageCount: number;
  landValue: number;
  crimeRate: number;
  pollution: number;
}

/** Data-driven upgrade requirements per target level (OCP-friendly). */
export interface LevelRequirement {
  minServiceCoverage: number;
  minLandValue: number;
  maxCrimeRate?: number;
  maxPollution?: number;
}

/** Requirements to REACH each level (keyed by target level). */
export const UPGRADE_REQUIREMENTS: Record<number, LevelRequirement> = {
  2: { minServiceCoverage: 3, minLandValue: 50 },
  3: { minServiceCoverage: 5, minLandValue: 80, maxCrimeRate: 20, maxPollution: 30 },
};

/** Requirements to KEEP each level (downgrade if not met). */
export const KEEP_REQUIREMENTS: Record<number, { minServiceCoverage: number; minLandValue: number }> = {
  2: { minServiceCoverage: 3, minLandValue: 40 },
  3: { minServiceCoverage: 5, minLandValue: 70 },
};

/** Check if conditions meet a level requirement (pure function, OCP-friendly). */
export function meetsUpgradeRequirements(conditions: UpgradeConditions, req: LevelRequirement): boolean {
  if (conditions.serviceCoverageCount < req.minServiceCoverage) return false;
  if (conditions.landValue < req.minLandValue) return false;
  if (req.maxCrimeRate !== undefined && conditions.crimeRate >= req.maxCrimeRate) return false;
  if (req.maxPollution !== undefined && conditions.pollution >= req.maxPollution) return false;
  return true;
}

export class BuildingUpgrade {
  private grid: Grid;

  constructor(grid: Grid) {
    this.grid = grid;
  }

  canUpgrade(x: number, y: number, conditions: UpgradeConditions): boolean {
    const cell = this.grid.getCell(x, y);
    if (!cell || cell.buildingId === 0) return false;

    const building = getBuildingType(cell.buildingId);
    if (!building) return false;

    const req = UPGRADE_REQUIREMENTS[building.level + 1];
    if (!req) return false;
    return meetsUpgradeRequirements(conditions, req);
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

    const building = getBuildingType(cell.buildingId);
    if (!building || building.level <= 1) return false;

    const req = KEEP_REQUIREMENTS[building.level];
    if (!req) return false;
    return conditions.serviceCoverageCount < req.minServiceCoverage
      || conditions.landValue < req.minLandValue;
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
