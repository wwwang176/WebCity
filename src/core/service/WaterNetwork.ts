import { Grid } from '../grid/Grid';
import { RoadType } from '../road/types';

export interface WaterPlant {
  x: number;
  y: number;
  output: number;
}

export class WaterNetwork {
  private plants: WaterPlant[] = [];
  private supplied = new Set<string>();

  addPlant(plant: WaterPlant): void {
    this.plants.push(plant);
  }

  calculateCoverage(grid: Grid): Set<string> {
    this.supplied.clear();
    for (const plant of this.plants) {
      this.bfsWater(grid, plant.x, plant.y);
    }
    // Extend coverage to zoned cells adjacent to supplied road cells
    const toAdd: string[] = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const key of this.supplied) {
      const [px, py] = key.split(',').map(Number);
      const cell = grid.getCell(px!, py!);
      if (cell && cell.roadType !== RoadType.NONE) {
        for (const [dx, dy] of dirs) {
          const nx = px! + dx!;
          const ny = py! + dy!;
          const nkey = `${nx},${ny}`;
          if (!this.supplied.has(nkey)) {
            const ncell = grid.getCell(nx, ny);
            if (ncell && ncell.zoneType !== 0) {
              toAdd.push(nkey);
            }
          }
        }
      }
    }
    for (const k of toAdd) this.supplied.add(k);
    return this.supplied;
  }

  isSupplied(x: number, y: number): boolean {
    return this.supplied.has(`${x},${y}`);
  }

  getTotalOutput(): number {
    return this.plants.reduce((sum, p) => sum + p.output, 0);
  }

  private bfsWater(grid: Grid, startX: number, startY: number): void {
    const queue: [number, number][] = [[startX, startY]];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);
    this.supplied.add(`${startX},${startY}`);

    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx!;
        const ny = y + dy!;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        if (cell.roadType !== RoadType.NONE || cell.buildingId !== 0) {
          visited.add(key);
          this.supplied.add(key);
          queue.push([nx, ny]);
        }
      }
    }
  }
}
