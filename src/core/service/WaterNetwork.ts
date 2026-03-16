import { Grid } from '../grid/Grid';
import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { RoadType } from '../road/types';
import { getBuildingType } from '../building/types';
import { getInfraConfigById, getInfraBuildingId } from '../building/InfraConfig';
import { POWER_CONSUMPTION, INFRA_POWER_CONSUMPTION } from './PowerGrid';

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

/** Per-zone water consumption scale relative to power formula */
export const WATER_CONSUMPTION_SCALE = {
  RESIDENTIAL: 1.5,  // high: bathing, toilet, laundry
  COMMERCIAL:  0.4,  // low: restrooms, cleaning
  INDUSTRIAL:  0.8,  // moderate: process water
  OFFICE:      0.3,  // minimal: restrooms, drinking
  INFRA:       0.5,  // moderate for civic facilities
} as const;

const WATER_PLANT_ID = getInfraBuildingId('water');

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
    this.fullCoverage = new Set<string>();
    for (const plant of this.plants) {
      this.bfsRoadNetwork(grid, plant.x, plant.y, this.fullCoverage, infrastructurePositions);
    }

    // Phase 2: BFS budget-drain per plant
    this.supplied = new Set<string>();
    for (const plant of this.plants) {
      this.bfsBudgetDrain(grid, plant, infrastructurePositions);
    }
    return this.supplied;
  }

  calculateDemand(grid: Grid): void {
    let demand = 0;
    grid.forEachCell((cell) => {
      if (cell.buildingId <= 0) return;
      demand += this.getCellDemand(grid, cell, cell.buildingId);
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
    return this.getCellDemand(grid, cell, cell.buildingId);
  }

  private getCellDemand(_grid: Grid, cell: { zoneType: number; buildingId: number }, buildingId: number): number {
    const bt = getBuildingType(buildingId);
    if (bt) {
      return this.getZoneDemand(cell.zoneType as ZoneType, bt.residents, bt.workers);
    }
    if (buildingId === WATER_PLANT_ID) return 0;
    const infraCfg = getInfraConfigById(buildingId);
    if (infraCfg) {
      const key = INFRA_TYPE_TO_KEY[infraCfg.type];
      if (key && INFRA_POWER_CONSUMPTION[key] !== undefined) {
        return INFRA_POWER_CONSUMPTION[key] * WATER_CONSUMPTION_SCALE.INFRA;
      }
    }
    return 0;
  }

  private getZoneDemand(zoneType: ZoneType, residents: number, workers: number): number {
    if (isResidentialZone(zoneType)) {
      return (POWER_CONSUMPTION.RESIDENTIAL.base + POWER_CONSUMPTION.RESIDENTIAL.perCapita * residents) * WATER_CONSUMPTION_SCALE.RESIDENTIAL;
    }
    if (isCommercialZone(zoneType)) {
      return (POWER_CONSUMPTION.COMMERCIAL.base + POWER_CONSUMPTION.COMMERCIAL.perCapita * workers) * WATER_CONSUMPTION_SCALE.COMMERCIAL;
    }
    if (zoneType === ZoneType.INDUSTRIAL) {
      return (POWER_CONSUMPTION.INDUSTRIAL.base + POWER_CONSUMPTION.INDUSTRIAL.perCapita * workers) * WATER_CONSUMPTION_SCALE.INDUSTRIAL;
    }
    if (zoneType === ZoneType.OFFICE) {
      return (POWER_CONSUMPTION.OFFICE.base + POWER_CONSUMPTION.OFFICE.perCapita * workers) * WATER_CONSUMPTION_SCALE.OFFICE;
    }
    return 0;
  }

  private bfsRoadNetwork(grid: Grid, startX: number, startY: number, coverage: Set<string>, infra?: Set<string>): void {
    const startKey = toPosKey(startX, startY);
    if (coverage.has(startKey)) return;
    coverage.add(startKey);
    const queue: [number, number][] = [[startX, startY]];
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of FOUR_NEIGHBORS) {
        const nx = x + dx!;
        const ny = y + dy!;
        const key = toPosKey(nx, ny);
        if (coverage.has(key)) continue;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        const canRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key);
        if (!canRelay) continue;
        coverage.add(key);
        queue.push([nx, ny]);
      }
    }
  }

  private bfsBudgetDrain(grid: Grid, plant: WaterPlant, infra?: Set<string>): void {
    let budget = plant.output;
    const startKey = toPosKey(plant.x, plant.y);
    const visited = new Set<string>();
    visited.add(startKey);
    this.supplied.add(startKey);
    const queue: [number, number][] = [[plant.x, plant.y]];
    while (queue.length > 0) {
      if (budget <= 0) break;
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of FOUR_NEIGHBORS) {
        const nx = x + dx!;
        const ny = y + dy!;
        const key = toPosKey(nx, ny);
        if (visited.has(key)) continue;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        const canRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key);
        if (!canRelay) continue;
        visited.add(key);

        if (!this.supplied.has(key)) {
          const demand = this.getCellDemandAt(grid, nx, ny);
          if (demand > 0) {
            if (budget < demand) continue;
            budget -= demand;
          }
          this.supplied.add(key);
        }

        queue.push([nx, ny]);
      }
    }
  }
}

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
