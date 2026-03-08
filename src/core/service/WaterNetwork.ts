import { Grid } from '../grid/Grid';
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
      this.bfsWater(grid, plant.x, plant.y, infrastructurePositions);
    }
    return this.supplied;
  }

  isSupplied(x: number, y: number): boolean {
    return this.supplied.has(`${x},${y}`);
  }

  getTotalOutput(): number {
    return this.plants.reduce((sum, p) => sum + p.output, 0);
  }

  getPlants(): readonly WaterPlant[] {
    return this.plants;
  }

  /**
   * BFS with range-based coverage:
   * - Plant: covers radius PLANT_RANGE (no road needed)
   * - Road/building: relays coverage RELAY_RANGE further
   * - Empty land: consumes range, cannot relay
   */
  private bfsWater(grid: Grid, startX: number, startY: number, infra?: Set<string>): void {
    const rangeMap = new Map<string, number>();
    const startKey = `${startX},${startY}`;
    rangeMap.set(startKey, PLANT_RANGE);
    this.supplied.add(startKey);

    const queue: [number, number, number][] = [[startX, startY, PLANT_RANGE]];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (queue.length > 0) {
      const [x, y, range] = queue.shift()!;
      for (const [dx, dy] of dirs) {
        const nx = x + dx!;
        const ny = y + dy!;
        const key = `${nx},${ny}`;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;

        const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key);
        const newRange = Math.max(isRelay ? RELAY_RANGE : 0, range - 1);

        if (newRange <= 0) continue;
        const prev = rangeMap.get(key) ?? 0;
        if (newRange <= prev) continue;

        rangeMap.set(key, newRange);
        this.supplied.add(key);
        queue.push([nx, ny, newRange]);
      }
    }
  }
}
