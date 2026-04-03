import { Grid } from '../grid/Grid';
import { toPosKey } from '../grid/GridHelpers';
import { ZoneType } from '../grid/types';
import { getBuildingType } from '../building/types';
import { getInfraBuildingId } from '../building/InfraConfig';
import { bfsRoadNetworkFlood, bfsBudgetDrainFlood } from './NetworkCoverage';
import { calculateUtilityCellDemand, type UtilityCellDemandConfig } from './UtilityCellDemand';

export interface PowerPlant {
  x: number;
  y: number;
  output: number;
  pollution: number;
  type: 'wind' | 'solar' | 'coal' | 'gas' | 'nuclear';
}

export const POWER = {
  PLANT_RANGE: 10,
  RELAY_RANGE: 2,
  MAINTENANCE_PER_PLANT: 5,
} as const;

export const POWER_CONSUMPTION = {
  RESIDENTIAL: { base: 0.25, perCapita: 0.025 },
  COMMERCIAL:  { base: 0.5,  perCapita: 0.04 },
  INDUSTRIAL:  { base: 1,    perCapita: 0.06 },
  OFFICE:      { base: 0.5,  perCapita: 0.025 },
} as const;

export const INFRA_POWER_CONSUMPTION: Record<string, number> = {
  police: 5,
  fire: 5,
  health: 9,
  elementary: 4,
  highschool: 6,
  university: 8,
  garbage: 8,
  water: 10,
  sewage: 8,
  park: 1.5,
  cemetery: 1.5,
};

const INFRA_TYPE_TO_CONSUMPTION_KEY: Record<string, string> = {
  police: 'police',
  fire: 'fire',
  hospital: 'health',
  school: 'elementary',
  school_high: 'highschool',
  school_univ: 'university',
  garbage: 'garbage',
  water: 'water',
  sewage: 'sewage',
  park: 'park',
  cemetery: 'cemetery',
};

// Power plant buildingId — excluded from demand
const POWER_PLANT_ID = getInfraBuildingId('power');

/** Shared demand config for calculateUtilityCellDemand (DRY). */
const POWER_DEMAND_CONFIG: UtilityCellDemandConfig = {
  zoneConsumption: POWER_CONSUMPTION,
  infraConsumption: INFRA_POWER_CONSUMPTION,
  infraTypeToKey: INFRA_TYPE_TO_CONSUMPTION_KEY,
  excludedBuildingId: POWER_PLANT_ID,
};

export class PowerGrid {
  private plants: PowerPlant[] = [];
  private powered = new Set<string>();
  private fullCoverage = new Set<string>();
  private totalDemand = 0;
  /** Injected road lookup for level-aware BFS (DIP). */
  private roadLookup: import('../road/UnifiedRoadLookup').UnifiedRoadLookup | null = null;

  setRoadLookup(lookup: import('../road/UnifiedRoadLookup').UnifiedRoadLookup): void {
    this.roadLookup = lookup;
  }

  addPlant(plant: PowerPlant): void {
    this.plants.push(plant);
  }

  removePlant(x: number, y: number): boolean {
    const idx = this.plants.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) { this.plants.splice(idx, 1); return true; }
    return false;
  }

  /**
   * Calculate power coverage using pure BFS through roads/buildings.
   * Power only spreads through adjacent road or building cells (no free Euclidean radius).
   * fullCoverage = all reachable cells via road/building BFS (no budget limit).
   * powered = same BFS but each plant drains its output budget per building reached.
   */
  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): Set<string> {
    // Phase 1: compute fullCoverage (no budget limit) — shows where the network reaches
    this.fullCoverage.clear();
    for (const plant of this.plants) {
      bfsRoadNetworkFlood(grid, plant.x, plant.y, this.fullCoverage, infrastructurePositions, this.roadLookup);
    }

    // Phase 2: BFS budget-drain per plant to determine actual powered cells
    this.powered.clear();
    const getDemand = (x: number, y: number) => this.getCellDemand(grid, x, y);
    for (const plant of this.plants) {
      bfsBudgetDrainFlood(grid, plant, this.powered, getDemand, infrastructurePositions, this.roadLookup);
    }
    return this.powered;
  }

  calculateDemand(grid: Grid): void {
    let demand = 0;
    grid.forEachCell((cell) => {
      if (cell.buildingId <= 0) return;
      const bt = getBuildingType(cell.buildingId);
      demand += calculateUtilityCellDemand(
        POWER_DEMAND_CONFIG, cell.buildingId, cell.zoneType as ZoneType,
        bt?.residents ?? 0, bt?.workers ?? 0,
      );
    });
    this.totalDemand = demand;
  }

  isPowered(x: number, y: number): boolean {
    return this.powered.has(toPosKey(x, y));
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
    return this.plants.length * POWER.MAINTENANCE_PER_PLANT;
  }

  getPlants(): readonly PowerPlant[] {
    return this.plants;
  }

  getCellDemand(grid: Grid, x: number, y: number): number {
    const cell = grid.getCell(x, y);
    if (!cell || cell.buildingId <= 0) return 0;
    const bt = getBuildingType(cell.buildingId);
    return calculateUtilityCellDemand(
      POWER_DEMAND_CONFIG, cell.buildingId, cell.zoneType as ZoneType,
      bt?.residents ?? 0, bt?.workers ?? 0,
    );
  }

  // BFS methods extracted to NetworkCoverage.ts (bfsRoadNetworkFlood / bfsBudgetDrainFlood)
}
