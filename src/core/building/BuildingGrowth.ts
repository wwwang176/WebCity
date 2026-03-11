import { Grid } from '../grid/Grid';
import { ZoneType, zoneToRCI } from '../grid/types';
import { isAdjacentToRoad } from '../grid/GridHelpers';
import { getMaxDensity } from '../zone/DensityRules';
import { getBuildingsForZone } from './types';
import { randomElement } from '../utils/random';

export interface RCIDemand {
  residential: number;
  commercial: number;
  industrial: number;
}

export interface GrowthConditions {
  hasPower: boolean;
  hasWater: boolean;
  rciDemand: RCIDemand;
}

export class BuildingGrowth {
  private grid: Grid;

  constructor(grid: Grid) {
    this.grid = grid;
  }

  canGrow(x: number, y: number, conditions: GrowthConditions): boolean {
    const cell = this.grid.getCell(x, y);
    if (!cell) return false;
    if (cell.zoneType === ZoneType.NONE) return false;
    if (cell.buildingId !== 0) return false;

    // Must have road connection
    if (!isAdjacentToRoad(this.grid, x, y)) return false;

    // Must have power and water
    if (!conditions.hasPower) return false;
    if (!conditions.hasWater) return false;

    // Must have RCI demand
    const rciType = zoneToRCI(cell.zoneType);
    if (!rciType) return false;
    if (conditions.rciDemand[rciType] <= 0) return false;

    return true;
  }

  tryGrow(x: number, y: number, conditions: GrowthConditions): boolean {
    if (!this.canGrow(x, y, conditions)) return false;

    const cell = this.grid.getCell(x, y);
    if (!cell) return false;

    const density = getMaxDensity(this.grid, x, y);
    if (density === 'NONE') return false;

    const buildings = getBuildingsForZone(cell.zoneType, density, 1);
    if (buildings.length === 0) return false;

    const building = randomElement(buildings);
    this.grid.setCell(x, y, { buildingId: building.id });
    return true;
  }

}
