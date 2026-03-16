import { Grid } from '../grid/Grid';
import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { RoadType } from '../road/types';
import { getBuildingType } from '../building/types';
import { getInfraConfigById, getInfraBuildingId } from '../building/InfraConfig';

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

export class PowerGrid {
  private plants: PowerPlant[] = [];
  private powered = new Set<string>();
  private fullCoverage = new Set<string>();
  private totalDemand = 0;

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
    this.fullCoverage = new Set<string>();
    for (const plant of this.plants) {
      this.bfsRoadNetwork(grid, plant.x, plant.y, this.fullCoverage, infrastructurePositions);
    }

    // Phase 2: BFS budget-drain per plant to determine actual powered cells
    this.powered = new Set<string>();
    for (const plant of this.plants) {
      this.bfsBudgetDrain(grid, plant, infrastructurePositions);
    }
    return this.powered;
  }

  calculateDemand(grid: Grid): void {
    let demand = 0;
    grid.forEachCell((cell) => {
      if (cell.buildingId <= 0) return;

      // Check if it's a zone building
      const bt = getBuildingType(cell.buildingId);
      if (bt) {
        demand += this.getZoneDemand(cell.zoneType, bt.residents, bt.workers);
        return;
      }

      // Check if it's an infrastructure building (not power plant)
      if (cell.buildingId === POWER_PLANT_ID) return;
      const infraCfg = getInfraConfigById(cell.buildingId);
      if (infraCfg) {
        const key = INFRA_TYPE_TO_CONSUMPTION_KEY[infraCfg.type];
        if (key && INFRA_POWER_CONSUMPTION[key] !== undefined) {
          demand += INFRA_POWER_CONSUMPTION[key];
        }
      }
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
    if (bt) return this.getZoneDemand(cell.zoneType, bt.residents, bt.workers);
    if (cell.buildingId === POWER_PLANT_ID) return 0;
    const infraCfg = getInfraConfigById(cell.buildingId);
    if (infraCfg) {
      const key = INFRA_TYPE_TO_CONSUMPTION_KEY[infraCfg.type];
      if (key && INFRA_POWER_CONSUMPTION[key] !== undefined) {
        return INFRA_POWER_CONSUMPTION[key];
      }
    }
    return 0;
  }

  private getZoneDemand(zoneType: ZoneType, residents: number, workers: number): number {
    if (isResidentialZone(zoneType)) {
      return POWER_CONSUMPTION.RESIDENTIAL.base + POWER_CONSUMPTION.RESIDENTIAL.perCapita * residents;
    }
    if (isCommercialZone(zoneType)) {
      return POWER_CONSUMPTION.COMMERCIAL.base + POWER_CONSUMPTION.COMMERCIAL.perCapita * workers;
    }
    if (zoneType === ZoneType.INDUSTRIAL) {
      return POWER_CONSUMPTION.INDUSTRIAL.base + POWER_CONSUMPTION.INDUSTRIAL.perCapita * workers;
    }
    if (zoneType === ZoneType.OFFICE) {
      return POWER_CONSUMPTION.OFFICE.base + POWER_CONSUMPTION.OFFICE.perCapita * workers;
    }
    return 0;
  }

  /**
   * Pure BFS through roads/buildings from a starting position.
   * Adds all reachable cells to the given set. No budget limit.
   */
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

  /**
   * BFS from a single plant through roads/buildings, draining budget per building.
   * Cells already powered by another plant are skipped (no double-drain).
   */
  private bfsBudgetDrain(grid: Grid, plant: PowerPlant, infra?: Set<string>): void {
    let budget = plant.output;
    const startKey = toPosKey(plant.x, plant.y);
    const visited = new Set<string>();
    visited.add(startKey);
    this.powered.add(startKey);
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

        // Drain budget for building cells not already powered by another plant
        if (!this.powered.has(key)) {
          const demand = this.getCellDemand(grid, nx, ny);
          if (demand > 0) {
            if (budget < demand) continue; // not enough budget for this building
            budget -= demand;
          }
          this.powered.add(key);
        }

        queue.push([nx, ny]);
      }
    }
  }
}
