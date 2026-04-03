import { Grid } from '../grid/Grid';
import { toPosKey } from '../grid/GridHelpers';
import { ZoneType } from '../grid/types';
import { getBuildingType } from '../building/types';
import { getInfraBuildingId } from '../building/InfraConfig';
import { bfsRoadNetworkFlood, bfsBudgetDrainFlood } from './NetworkCoverage';
import { calculateUtilityCellDemand, type UtilityCellDemandConfig } from './UtilityCellDemand';
export interface WaterPlant {
  x: number;
  y: number;
  output: number;
}

export const WATER_NETWORK = {
  PLANT_RANGE: 10,
  RELAY_RANGE: 2,
  MAINTENANCE_PER_PLANT: 3,
} as const;

export const WATER_CONSUMPTION = {
  RESIDENTIAL: { base: 0.375, perCapita: 0.0375 },  // high: bathing, toilet, laundry
  COMMERCIAL:  { base: 0.2,   perCapita: 0.016 },   // low: restrooms, cleaning
  INDUSTRIAL:  { base: 0.8,   perCapita: 0.048 },   // moderate: process water
  OFFICE:      { base: 0.15,  perCapita: 0.0075 },  // minimal: restrooms, drinking
} as const;

export const INFRA_WATER_CONSUMPTION: Record<string, number> = {
  police: 2.5,
  fire: 2.5,
  health: 4.5,
  elementary: 2,
  highschool: 3,
  university: 4,
  garbage: 4,
  sewage: 4,
  park: 0.75,
  cemetery: 0.75,
};

const WATER_PLANT_ID = getInfraBuildingId('water');

const INFRA_TYPE_TO_KEY: Record<string, string> = {
  police: 'police',
  fire: 'fire',
  hospital: 'health',
  school: 'elementary',
  school_high: 'highschool',
  school_univ: 'university',
  garbage: 'garbage',
  power: 'police', // power plants don't consume water, excluded above
  sewage: 'sewage',
  park: 'park',
  cemetery: 'cemetery',
};

/** Shared demand config for calculateUtilityCellDemand (DRY). */
const WATER_DEMAND_CONFIG: UtilityCellDemandConfig = {
  zoneConsumption: WATER_CONSUMPTION,
  infraConsumption: INFRA_WATER_CONSUMPTION,
  infraTypeToKey: INFRA_TYPE_TO_KEY,
  excludedBuildingId: WATER_PLANT_ID,
};

export class WaterNetwork {
  private plants: WaterPlant[] = [];
  private supplied = new Set<string>();
  private fullCoverage = new Set<string>();
  private totalDemand = 0;

  addPlant(plant: WaterPlant): void {
    this.plants.push(plant);
  }

  removePlant(x: number, y: number): boolean {
    const idx = this.plants.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) { this.plants.splice(idx, 1); return true; }
    return false;
  }

  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): Set<string> {
    // Phase 1: compute fullCoverage (no budget limit)
    this.fullCoverage.clear();
    for (const plant of this.plants) {
      bfsRoadNetworkFlood(grid, plant.x, plant.y, this.fullCoverage, infrastructurePositions);
    }

    // Phase 2: BFS budget-drain per plant
    this.supplied.clear();
    const getDemand = (x: number, y: number) => this.getCellDemandAt(grid, x, y);
    for (const plant of this.plants) {
      bfsBudgetDrainFlood(grid, plant, this.supplied, getDemand, infrastructurePositions);
    }
    return this.supplied;
  }

  calculateDemand(grid: Grid): void {
    let demand = 0;
    grid.forEachCell((cell) => {
      if (cell.buildingId <= 0) return;
      const bt = getBuildingType(cell.buildingId);
      demand += calculateUtilityCellDemand(
        WATER_DEMAND_CONFIG, cell.buildingId, cell.zoneType as ZoneType,
        bt?.residents ?? 0, bt?.workers ?? 0,
      );
    });
    this.totalDemand = demand;
  }

  isSupplied(x: number, y: number): boolean {
    return this.supplied.has(toPosKey(x, y));
  }

  isInCoverage(x: number, y: number): boolean {
    return this.fullCoverage.has(toPosKey(x, y));
  }

  getTotalOutput(): number {
    return this.plants.reduce((sum, p) => sum + p.output, 0);
  }

  getSupply(): number {
    return this.getTotalOutput();
  }

  getDemand(): number {
    return this.totalDemand;
  }

  getSupplyRatio(): number {
    if (this.totalDemand === 0) return 1.0;
    const supply = this.getTotalOutput();
    if (supply === 0) return 0;
    return supply / this.totalDemand;
  }

  getMaintenanceCost(): number {
    return this.plants.length * WATER_NETWORK.MAINTENANCE_PER_PLANT;
  }

  getPlants(): readonly WaterPlant[] {
    return this.plants;
  }

  getCellDemandAt(grid: Grid, x: number, y: number): number {
    const cell = grid.getCell(x, y);
    if (!cell || cell.buildingId <= 0) return 0;
    const bt = getBuildingType(cell.buildingId);
    return calculateUtilityCellDemand(
      WATER_DEMAND_CONFIG, cell.buildingId, cell.zoneType as ZoneType,
      bt?.residents ?? 0, bt?.workers ?? 0,
    );
  }

  // BFS methods extracted to NetworkCoverage.ts (bfsRoadNetworkFlood / bfsBudgetDrainFlood)
}
