import { Grid } from '../grid/Grid';
import { RoadType } from '../road/types';

export interface PowerPlant {
  x: number;
  y: number;
  output: number;
  pollution: number;
  type: 'wind' | 'solar' | 'coal' | 'gas' | 'nuclear';
}

const PLANT_RANGE = 10;
const RELAY_RANGE = 2;

export class PowerGrid {
  private plants: PowerPlant[] = [];
  private powered = new Set<string>();

  addPlant(plant: PowerPlant): void {
    this.plants.push(plant);
  }

  removePlant(x: number, y: number): boolean {
    const idx = this.plants.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) { this.plants.splice(idx, 1); return true; }
    return false;
  }

  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): Set<string> {
    this.powered.clear();
    for (const plant of this.plants) {
      this.bfsPower(grid, plant.x, plant.y, infrastructurePositions);
    }
    return this.powered;
  }

  isPowered(x: number, y: number): boolean {
    return this.powered.has(`${x},${y}`);
  }

  getTotalOutput(): number {
    return this.plants.reduce((sum, p) => sum + p.output, 0);
  }

  getPlants(): readonly PowerPlant[] {
    return this.plants;
  }

  /**
   * BFS with range-based coverage:
   * - Plant: covers radius PLANT_RANGE (no road needed)
   * - Road/building: relays coverage RELAY_RANGE further
   * - Empty land: consumes range, cannot relay
   * Each cell's effective range = max(cell_relay_range, incoming_range - 1)
   */
  private bfsPower(grid: Grid, startX: number, startY: number, infra?: Set<string>): void {
    const rangeMap = new Map<string, number>(); // key -> best range seen
    const startKey = `${startX},${startY}`;
    rangeMap.set(startKey, PLANT_RANGE);
    this.powered.add(startKey);

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

        // Determine this cell's own relay capability
        const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key);
        const newRange = Math.max(isRelay ? RELAY_RANGE : 0, range - 1);

        if (newRange <= 0) continue;
        const prev = rangeMap.get(key) ?? 0;
        if (newRange <= prev) continue; // already has equal or better coverage

        rangeMap.set(key, newRange);
        this.powered.add(key);
        queue.push([nx, ny, newRange]);
      }
    }
  }
}
