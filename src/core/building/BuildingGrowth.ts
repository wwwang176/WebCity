import { Grid } from '../grid/Grid';
import { ZoneType, zoneToRCI } from '../grid/types';
import { RailType } from '../rail/types';
import { isNearRoad } from '../grid/GridHelpers';
import { ZONE_ROAD_REACH } from '../grid/constants';
import { getGrowthDensity, getMaxDensity } from '../zone/DensityRules';
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
    if (cell.railType !== RailType.NONE) return false;

    // Must have road connection (Chebyshev reach matches ZoneManager)
    if (!isNearRoad(this.grid, x, y, ZONE_ROAD_REACH)) return false;

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

    // The zone picks its own tier; the road only has to be big enough to carry
    // it. Feeding the road's tier in directly used to ask BUILDING_TYPES for
    // pairs it does not contain — (RESIDENTIAL_LOW, 'HIGH') beside a four-lane
    // road, (RESIDENTIAL_HIGH, 'LOW') beside a street — and four zone/road
    // combinations were silently unbuildable forever as a result.
    const lookupDensity = getGrowthDensity(cell.zoneType, getMaxDensity(this.grid, x, y));
    if (!lookupDensity) return false;

    const buildings = getBuildingsForZone(cell.zoneType, lookupDensity, 1);
    if (buildings.length === 0) return false;

    const building = randomElement(buildings);
    // Defence in depth: a freshly grown building is always in a clean state.
    // Writing reserved: 0 here makes that an invariant, so no future call site
    // that clears buildingId without clearing reserved can resurrect a ruin
    // marker onto a brand-new building (BUG-072).
    this.grid.setCell(x, y, { buildingId: building.id, reserved: 0 });
    return true;
  }

}
