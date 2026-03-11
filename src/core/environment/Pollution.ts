export type PollutionType = 'ground' | 'water' | 'noise';

export interface PollutionSource {
  x: number;
  y: number;
  amount: number;
  type: PollutionType;
}

interface PollutionLevel {
  ground: number;
  water: number;
  noise: number;
}

/** Pollution amount decay per Manhattan distance cell */
export const POLLUTION_DECAY_PER_CELL = 30;
/** Pollution/noise reduction per park cell */
export const POLLUTION_PARK_REDUCTION = 20;

export class PollutionManager {
  private width: number;
  private height: number;
  private sources: PollutionSource[] = [];
  private ground: number[][];
  private water: number[][];
  private noise: number[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ground = this.createGrid();
    this.water = this.createGrid();
    this.noise = this.createGrid();
  }

  private createGrid(): number[][] {
    return Array.from({ length: this.height }, () => new Array<number>(this.width).fill(0));
  }

  private getGrid(type: PollutionType): number[][] {
    switch (type) {
      case 'ground':
        return this.ground;
      case 'water':
        return this.water;
      case 'noise':
        return this.noise;
    }
  }

  addSource(x: number, y: number, amount: number, type: PollutionType): void {
    this.sources.push({ x, y, amount, type });
  }

  calculateSpread(): void {
    // Reset grids
    this.ground = this.createGrid();
    this.water = this.createGrid();
    this.noise = this.createGrid();

    for (const source of this.sources) {
      this.spreadFromSource(source);
    }
  }

  private spreadFromSource(source: PollutionSource): void {
    const grid = this.getGrid(source.type);
    const maxRange = Math.ceil(source.amount / POLLUTION_DECAY_PER_CELL);

    for (let dx = -maxRange; dx <= maxRange; dx++) {
      for (let dy = -maxRange; dy <= maxRange; dy++) {
        const nx = source.x + dx;
        const ny = source.y + dy;

        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;

        const distance = Math.abs(dx) + Math.abs(dy); // Manhattan distance
        const value = Math.max(0, source.amount - distance * POLLUTION_DECAY_PER_CELL);

        if (value > 0) {
          grid[ny]![nx]! += value;
        }
      }
    }
  }

  getPollutionAt(x: number, y: number): PollutionLevel {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return { ground: 0, water: 0, noise: 0 };
    }
    return {
      ground: this.ground[y]![x]!,
      water: this.water[y]![x]!,
      noise: this.noise[y]![x]!,
    };
  }

  addParkEffect(x: number, y: number, radius: number): void {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;

        const distance = Math.abs(dx) + Math.abs(dy);
        if (distance <= radius) {
          this.ground[ny]![nx] = Math.max(0, this.ground[ny]![nx]! - POLLUTION_PARK_REDUCTION);
          this.noise[ny]![nx] = Math.max(0, this.noise[ny]![nx]! - POLLUTION_PARK_REDUCTION);
        }
      }
    }
  }

  clearSources(): void {
    this.sources = [];
  }
}
