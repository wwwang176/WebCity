import { Grid } from '../grid/Grid';
import { getBuildingType, getBuildingsForZone, type BuildingType } from './types';

export interface UpgradeConditions {
  serviceCoverageCount: number;
  landValue: number;
  crimeRate: number;
  pollution: number;
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
    if (building.level >= 3) return false;

    if (building.level === 1) {
      return conditions.serviceCoverageCount >= 3 && conditions.landValue >= 50;
    }
    if (building.level === 2) {
      return (
        conditions.serviceCoverageCount >= 5 &&
        conditions.landValue >= 80 &&
        conditions.crimeRate < 20 &&
        conditions.pollution < 30
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
      return conditions.serviceCoverageCount < 3 || conditions.landValue < 40;
    }
    if (building.level === 3) {
      return conditions.serviceCoverageCount < 5 || conditions.landValue < 70;
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
