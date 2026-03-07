import { Grid } from '../grid/Grid';
import { ZoneType } from '../grid/types';
import { RoadType } from '../road/types';
import { getMaxDensity } from '../zone/DensityRules';
import { getBuildingsForZone } from './types';

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

function zoneToRCI(zone: ZoneType): 'residential' | 'commercial' | 'industrial' | null {
  switch (zone) {
    case ZoneType.RESIDENTIAL_LOW:
    case ZoneType.RESIDENTIAL_HIGH:
      return 'residential';
    case ZoneType.COMMERCIAL_LOW:
    case ZoneType.COMMERCIAL_HIGH:
      return 'commercial';
    case ZoneType.INDUSTRIAL:
    case ZoneType.OFFICE:
      return 'industrial';
    default:
      return null;
  }
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
    if (!this.isAdjacentToRoad(x, y)) return false;

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

    const building = buildings[Math.floor(Math.random() * buildings.length)]!;
    this.grid.setCell(x, y, { buildingId: building.id });
    return true;
  }

  private isAdjacentToRoad(x: number, y: number): boolean {
    const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
    for (const d of dirs) {
      const cell = this.grid.getCell(x + d.dx, y + d.dy);
      if (cell && cell.roadType !== RoadType.NONE) return true;
    }
    return false;
  }
}
