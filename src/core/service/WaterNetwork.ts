import { Grid } from '../grid/Grid';
import { ZoneType } from '../grid/types';
import { getBuildingType } from '../building/types';
import { getInfraBuildingId } from '../building/InfraConfig';
import { bfsRoadNetworkFlood, bfsBudgetDrainFlood } from './NetworkCoverage';
import { CoverageBits } from './CoverageBits';
import { UtilityFloodScratch } from './UtilityFloodScratch';
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
  // See INFRA_POWER_CONSUMPTION: the transport family drew nothing at all.
  // Water tracks passenger throughput rather than footprint — an airport
  // terminal has restrooms and catering, a bus shelter has neither.
  bus_stop: 0.1,
  ferry_dock: 0.75,
  train_station: 2,
  metro_station: 2,
  airport_s: 5,
  airport_m: 10,
  airport_l: 20,
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
  // No `power` entry: power plants consume no water. This used to map to
  // 'police', with a comment claiming power plants were "excluded above" — but
  // excludedBuildingId is the WATER plant (253), not the power plant (254), so
  // every power plant silently drew the police station's water rate (BUG-071).
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

/** Shared demand config for calculateUtilityCellDemand (DRY). */
const WATER_DEMAND_CONFIG: UtilityCellDemandConfig = {
  zoneConsumption: WATER_CONSUMPTION,
  infraConsumption: INFRA_WATER_CONSUMPTION,
  infraTypeToKey: INFRA_TYPE_TO_KEY,
  excludedBuildingId: WATER_PLANT_ID,
};

export class WaterNetwork {
  private plants: WaterPlant[] = [];
  private supplied = new CoverageBits();
  private fullCoverage = new CoverageBits();
  /**
   * flood 的走訪狀態與這一輪共用的記錄。跨呼叫重複使用 —— 每 6 個 tick 重配
   * 一組跟地圖一樣大的 typed array 是白花的。
   */
  private readonly floodScratch = new UtilityFloodScratch();
  private totalDemand = 0;
  /** 節水法規的逐格乘數。1 = 沒有條例。 */
  private demandMultiplier = 1;
  /** Injected road lookup for level-aware BFS (DIP). */
  private roadLookup: import('../road/UnifiedRoadLookup').UnifiedRoadLookup | null = null;

  setRoadLookup(lookup: import('../road/UnifiedRoadLookup').UnifiedRoadLookup): void {
    this.roadLookup = lookup;
  }

  addPlant(plant: WaterPlant): void {
    this.plants.push(plant);
  }

  removePlant(x: number, y: number): boolean {
    const idx = this.plants.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) { this.plants.splice(idx, 1); return true; }
    return false;
  }

  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): CoverageBits {
    // Phase 1: compute fullCoverage (no budget limit)
    this.floodScratch.beginPass(grid, infrastructurePositions);
    this.fullCoverage.reset(grid.width, grid.height);
    for (const plant of this.plants) {
      bfsRoadNetworkFlood(grid, plant.x, plant.y, this.fullCoverage, this.floodScratch, this.roadLookup);
    }

    // Phase 2: BFS budget-drain per plant
    this.supplied.reset(grid.width, grid.height);
    const getDemand = (x: number, y: number) => this.getCellDemandAt(grid, x, y);
    for (const plant of this.plants) {
      bfsBudgetDrainFlood(grid, plant, this.supplied, getDemand, this.floodScratch, this.roadLookup);
    }
    return this.supplied;
  }

  /**
   * 重算總需求，並記下這一輪的節水乘數。
   *
   * 乘數存在物件上而不是只乘在 `totalDemand` 上，是因為決定哪一格有水的是
   * `calculateCoverage` 的預算式 BFS，而它問的是 `getCellDemandAt`。只降帳面數字的
   * 話 `getSupplyRatio()` 會變好看，缺水的建築卻一棟也不會恢復供水 —— 而玩家買的
   * 正是那個。
   *
   * 兩個呼叫端都是「先 calculateDemand 再 calculateCoverage」，順序反過來的話
   * BFS 會用到上一輪的乘數。
   */
  calculateDemand(grid: Grid, demandMultiplier = 1): void {
    this.demandMultiplier = demandMultiplier;
    let demand = 0;
    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId <= 0) return;
      demand += this.getCellDemandAt(grid, x, y);
    });
    this.totalDemand = demand;
  }

  isSupplied(x: number, y: number): boolean {
    return this.supplied.has(x, y);
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
      bt?.residents ?? 0, bt?.workers ?? 0, cell.reserved,
    ) * this.demandMultiplier;
  }

  // BFS methods extracted to NetworkCoverage.ts (bfsRoadNetworkFlood / bfsBudgetDrainFlood)
}
