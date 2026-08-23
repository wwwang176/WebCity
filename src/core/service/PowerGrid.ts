import { Grid } from '../grid/Grid';
import { ZoneType } from '../grid/types';
import { getBuildingType } from '../building/types';
import { getInfraBuildingId } from '../building/InfraConfig';
import { bfsRoadNetworkFlood, bfsBudgetDrainFlood } from './NetworkCoverage';
import { CoverageBits } from './CoverageBits';
import { UtilityFloodScratch } from './UtilityFloodScratch';
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
  // Transport. The whole family was missing: a Large Airport costing 40000 drew
  // exactly 0 power, and every transit stop drew 0 while BaseTransportSystem
  // already refused to run one that had none — so a stop could stop working for
  // a reason the player had no way to see coming, and never appeared in the
  // demand that sizes the power plant.
  //
  // Scaled against the existing table (university 8 at cost 3000, water plant
  // 10) and against footprint: a shelter is near-free, a station is comparable
  // to a school, an airport is the largest single draw in the game.
  bus_stop: 0.5,
  ferry_dock: 2,
  train_station: 5,
  metro_station: 6,
  airport_s: 12,
  airport_m: 24,
  airport_l: 45,
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
  bus_stop: 'bus_stop',
  metro_station: 'metro_station',
  train_station: 'train_station',
  ferry_dock: 'ferry_dock',
  airport_s: 'airport_s',
  airport_m: 'airport_m',
  airport_l: 'airport_l',
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
  private powered = new CoverageBits();
  private fullCoverage = new CoverageBits();
  /**
   * flood 的走訪狀態與這一輪共用的記錄。跨呼叫重複使用 —— 每 6 個 tick 重配
   * 一組跟地圖一樣大的 typed array 是白花的。
   */
  private readonly floodScratch = new UtilityFloodScratch();
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
  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): CoverageBits {
    // Phase 1: compute fullCoverage (no budget limit) — shows where the network reaches
    this.floodScratch.beginPass(grid, infrastructurePositions);
    this.fullCoverage.reset(grid.width, grid.height);
    for (const plant of this.plants) {
      bfsRoadNetworkFlood(grid, plant.x, plant.y, this.fullCoverage, this.floodScratch, this.roadLookup);
    }

    // Phase 2: BFS budget-drain per plant to determine actual powered cells
    this.powered.reset(grid.width, grid.height);
    const getDemand = (x: number, y: number) => this.getCellDemand(grid, x, y);
    for (const plant of this.plants) {
      bfsBudgetDrainFlood(grid, plant, this.powered, getDemand, this.floodScratch, this.roadLookup);
    }
    return this.powered;
  }

  /**
   * 重算全城電力總需求。
   *
   * `demandMultiplier` 是全城條例（節能法規）的省電幅度。預設 1，所以沒有帶條例
   * 的呼叫端不必改。
   */
  calculateDemand(grid: Grid, demandMultiplier = 1): void {
    let demand = 0;
    grid.forEachCell((cell) => {
      if (cell.buildingId <= 0) return;
      const bt = getBuildingType(cell.buildingId);
      demand += calculateUtilityCellDemand(
        POWER_DEMAND_CONFIG, cell.buildingId, cell.zoneType as ZoneType,
        bt?.residents ?? 0, bt?.workers ?? 0, cell.reserved,
      );
    });
    this.totalDemand = demand * demandMultiplier;
  }

  isPowered(x: number, y: number): boolean {
    return this.powered.has(x, y);
  }

  isInCoverage(x: number, y: number): boolean {
    return this.fullCoverage.has(x, y);
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
      bt?.residents ?? 0, bt?.workers ?? 0, cell.reserved,
    );
  }

  // BFS methods extracted to NetworkCoverage.ts (bfsRoadNetworkFlood / bfsBudgetDrainFlood)
}
