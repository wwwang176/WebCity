import { Grid } from '../grid/Grid';
import { RoadType } from '../road/types';

export interface PowerPlant {
  x: number;
  y: number;
  output: number;
  pollution: number;
  type: 'wind' | 'solar' | 'coal' | 'gas' | 'nuclear';
}

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
    // Extend coverage to zoned cells adjacent to powered road cells
    const toAdd: string[] = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const key of this.powered) {
      const [px, py] = key.split(',').map(Number);
      const cell = grid.getCell(px!, py!);
      if (cell && cell.roadType !== RoadType.NONE) {
        for (const [dx, dy] of dirs) {
          const nx = px! + dx!;
          const ny = py! + dy!;
          const nkey = `${nx},${ny}`;
          if (!this.powered.has(nkey)) {
            const ncell = grid.getCell(nx, ny);
            if (ncell && ncell.zoneType !== 0) {
              toAdd.push(nkey);
            }
          }
        }
      }
    }
    for (const k of toAdd) this.powered.add(k);
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

  private bfsPower(grid: Grid, startX: number, startY: number, infra?: Set<string>): void {
    const queue: [number, number][] = [[startX, startY]];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);
    this.powered.add(`${startX},${startY}`);

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
        // Power travels through roads, buildings, and infrastructure (plants)
        if (cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key)) {
          visited.add(key);
          this.powered.add(key);
          queue.push([nx, ny]);
        }
      }
    }
  }
}
