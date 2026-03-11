import { Grid } from '../grid/Grid';
import { toPosKey } from '../grid/GridHelpers';
import { RoadType } from '../road/types';

export interface WaterPlant {
  x: number;
  y: number;
  output: number;
}

const PLANT_RANGE = 10;
const RELAY_RANGE = 2;

export class WaterNetwork {
  private plants: WaterPlant[] = [];
  private supplied = new Set<string>();

  addPlant(plant: WaterPlant): void {
    this.plants.push(plant);
  }

  removePlant(x: number, y: number): boolean {
    const idx = this.plants.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) { this.plants.splice(idx, 1); return true; }
    return false;
  }

  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): Set<string> {
    this.supplied.clear();
    for (const plant of this.plants) {
      this.coverPlant(grid, plant.x, plant.y, infrastructurePositions);
    }
    return this.supplied;
  }

  isSupplied(x: number, y: number): boolean {
    return this.supplied.has(toPosKey(x, y));
  }

  getTotalOutput(): number {
    return this.plants.reduce((sum, p) => sum + p.output, 0);
  }

  getMaintenanceCost(): number {
    return this.plants.length * 3;
  }

  getPlants(): readonly WaterPlant[] {
    return this.plants;
  }

  /**
   * Euclidean radius coverage + road/building relay.
   * 1. All cells within Euclidean distance ≤ PLANT_RANGE are supplied (circular).
   * 2. Roads/buildings on the circle edge relay water RELAY_RANGE further via BFS.
   */
  private coverPlant(grid: Grid, px: number, py: number, infra?: Set<string>): void {
    const r = PLANT_RANGE;
    const r2 = r * r;
    const relaySeeds: [number, number][] = [];

    // Phase 1: Euclidean circle coverage
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const nx = px + dx;
        const ny = py + dy;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        this.supplied.add(toPosKey(nx, ny));

        // Collect relay-capable cells on the circle edge (distance > r-1)
        if (dx * dx + dy * dy > (r - 1) * (r - 1)) {
          const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(toPosKey(nx, ny));
          if (isRelay) relaySeeds.push([nx, ny]);
        }
      }
    }

    // Phase 2: BFS relay from edge relay cells
    // Roads/buildings maintain range at RELAY_RANGE (infinite relay through road network)
    if (relaySeeds.length === 0) return;
    const relayMap = new Map<string, number>();
    const queue: [number, number, number][] = [];
    for (const [sx, sy] of relaySeeds) {
      const key = toPosKey(sx, sy);
      relayMap.set(key, RELAY_RANGE);
      queue.push([sx, sy, RELAY_RANGE]);
    }
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length > 0) {
      const [x, y, range] = queue.shift()!;
      for (const [ddx, ddy] of dirs) {
        const nx = x + ddx!;
        const ny = y + ddy!;
        const key = toPosKey(nx, ny);
        if (this.supplied.has(key)) continue;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key);
        // Roads/buildings keep range at RELAY_RANGE (never decreases below it)
        const newRange = Math.max(isRelay ? RELAY_RANGE : 0, range - 1);
        if (newRange <= 0) continue;
        const prev = relayMap.get(key) ?? 0;
        if (newRange <= prev) continue;
        relayMap.set(key, newRange);
        this.supplied.add(key);
        queue.push([nx, ny, newRange]);
      }
    }
  }
}
