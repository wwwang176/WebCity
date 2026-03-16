import { Grid } from '../grid/Grid';
import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { calculateNetworkCoverage } from './NetworkCoverage';
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
  RESIDENTIAL: { base: 0.5, perCapita: 0.05 },
  COMMERCIAL:  { base: 1,   perCapita: 0.08 },
  INDUSTRIAL:  { base: 2,   perCapita: 0.12 },
  OFFICE:      { base: 1,   perCapita: 0.05 },
} as const;

export const INFRA_POWER_CONSUMPTION: Record<string, number> = {
  police: 10,
  fire: 10,
  health: 18,
  elementary: 8,
  highschool: 12,
  university: 16,
  garbage: 15,
  water: 20,
  sewage: 15,
  park: 3,
  cemetery: 3,
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
   * Calculate power coverage using BFS budget-drain per plant.
   * Each plant starts BFS from its position with its own output as budget.
   * When a building cell is reached, its demand is subtracted from the budget.
   * If budget runs out, BFS stops — remaining cells in range have no power.
   * fullCoverage is computed separately (no budget) for overlay display.
   */
  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): Set<string> {
    // Phase 1: compute fullCoverage (no budget limit) for overlay "in range" display
    this.fullCoverage = new Set<string>();
    for (const plant of this.plants) {
      calculateNetworkCoverage(grid, plant.x, plant.y, POWER.PLANT_RANGE, POWER.RELAY_RANGE, this.fullCoverage, infrastructurePositions);
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
   * BFS from a single plant, draining its budget as buildings are reached.
   * Uses same 2-phase approach as NetworkCoverage: Euclidean circle + BFS relay.
   * Cells already in this.powered (from earlier plants) are skipped — no double-drain.
   */
  private bfsBudgetDrain(grid: Grid, plant: PowerPlant, infra?: Set<string>): void {
    let budget = plant.output;
    const r = POWER.PLANT_RANGE;
    const r2 = r * r;
    const visited = new Set<string>();
    const relayRange = POWER.RELAY_RANGE;

    // BFS queue: [x, y, phase] — phase 1 = euclidean circle sorted by distance, phase 2 = relay
    // We do a combined BFS: first circle cells by distance, then relay cells
    const circleCells: { x: number; y: number; dist2: number }[] = [];

    // Collect all cells in Euclidean circle
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const nx = plant.x + dx;
        const ny = plant.y + dy;
        if (!grid.getCell(nx, ny)) continue;
        circleCells.push({ x: nx, y: ny, dist2: d2 });
      }
    }
    // Sort by distance from plant (nearest first = BFS order)
    circleCells.sort((a, b) => a.dist2 - b.dist2);

    const relaySeeds: [number, number][] = [];

    // Phase 1: process circle cells in distance order, drain budget
    for (const { x, y, dist2 } of circleCells) {
      const key = toPosKey(x, y);
      if (visited.has(key)) continue;
      visited.add(key);

      // Drain budget for building cells not already powered by another plant
      if (!this.powered.has(key)) {
        const demand = this.getCellDemand(grid, x, y);
        if (demand > 0) {
          if (budget < demand) continue; // skip this building, try others at same distance
          budget -= demand;
        }
        this.powered.add(key);
      }

      // Collect relay seeds from circle edge
      if (dist2 > (r - 1) * (r - 1)) {
        const cell = grid.getCell(x, y)!;
        const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key);
        if (isRelay) relaySeeds.push([x, y]);
      }
    }

    // Phase 2: BFS relay from edge, with budget drain
    if (relaySeeds.length === 0 || budget <= 0) return;
    const relayMap = new Map<string, number>();
    const queue: [number, number, number][] = [];
    for (const [sx, sy] of relaySeeds) {
      const key = toPosKey(sx, sy);
      if (!relayMap.has(key)) {
        relayMap.set(key, relayRange);
        queue.push([sx, sy, relayRange]);
      }
    }
    while (queue.length > 0) {
      if (budget <= 0) break;
      const [x, y, remaining] = queue.shift()!;
      for (const [ddx, ddy] of FOUR_NEIGHBORS) {
        const nx = x + ddx!;
        const ny = y + ddy!;
        const key = toPosKey(nx, ny);
        if (visited.has(key)) continue;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key);
        const newRange = Math.max(isRelay ? relayRange : 0, remaining - 1);
        if (newRange <= 0) continue;
        const prev = relayMap.get(key) ?? 0;
        if (newRange <= prev) continue;
        relayMap.set(key, newRange);
        visited.add(key);

        // Drain budget
        if (!this.powered.has(key)) {
          const demand = this.getCellDemand(grid, nx, ny);
          if (demand > 0) {
            if (budget < demand) continue;
            budget -= demand;
          }
          this.powered.add(key);
        }

        queue.push([nx, ny, newRange]);
      }
    }
  }
}
