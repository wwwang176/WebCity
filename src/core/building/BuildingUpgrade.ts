import { Grid } from '../grid/Grid';
import { getBuildingType, getBuildingsForZone } from './types';

export interface UpgradeConditions {
  serviceCoverageCount: number;
  landValue: number;
  crimeRate: number;
  pollution: number;
}

/** Thresholds for building level upgrades and downgrades */
export const UPGRADE_THRESHOLDS = {
  /** Level 1 → 2 requirements */
  LEVEL_2: {
    minServiceCoverage: 3,
    minLandValue: 50,
  },
  /** Level 2 → 3 requirements */
  LEVEL_3: {
    minServiceCoverage: 5,
    minLandValue: 80,
    maxCrimeRate: 20,
    maxPollution: 30,
  },
  /** Downgrade from level 2 if below these */
  DOWNGRADE_2: {
    minServiceCoverage: 3,
    minLandValue: 40,
  },
  /** Downgrade from level 3 if below these */
  DOWNGRADE_3: {
    minServiceCoverage: 5,
    minLandValue: 70,
  },
} as const;

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
    if (building.level >= 3) return false;

    if (building.level === 1) {
      return conditions.serviceCoverageCount >= UPGRADE_THRESHOLDS.LEVEL_2.minServiceCoverage
        && conditions.landValue >= UPGRADE_THRESHOLDS.LEVEL_2.minLandValue;
    }
    if (building.level === 2) {
      return (
        conditions.serviceCoverageCount >= UPGRADE_THRESHOLDS.LEVEL_3.minServiceCoverage &&
        conditions.landValue >= UPGRADE_THRESHOLDS.LEVEL_3.minLandValue &&
        conditions.crimeRate < UPGRADE_THRESHOLDS.LEVEL_3.maxCrimeRate &&
        conditions.pollution < UPGRADE_THRESHOLDS.LEVEL_3.maxPollution
      );
    }
    return false;
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

    if (building.level === 2) {
      return conditions.serviceCoverageCount < UPGRADE_THRESHOLDS.DOWNGRADE_2.minServiceCoverage
        || conditions.landValue < UPGRADE_THRESHOLDS.DOWNGRADE_2.minLandValue;
    }
    if (building.level === 3) {
      return conditions.serviceCoverageCount < UPGRADE_THRESHOLDS.DOWNGRADE_3.minServiceCoverage
        || conditions.landValue < UPGRADE_THRESHOLDS.DOWNGRADE_3.minLandValue;
    }
    return false;
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
