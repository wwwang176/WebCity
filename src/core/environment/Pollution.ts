export type PollutionType = 'ground' | 'water' | 'noise';

export interface PollutionSource {
  x: number;
  y: number;
  amount: number;
  type: PollutionType;
  /** When set, overrides the default spread range and adapts decay so pollution reaches 0 at this distance. */
  radius?: number;
}

interface PollutionLevel {
  ground: number;
  water: number;
  noise: number;
}

export const POLLUTION = {
  DECAY_PER_CELL: 30,
  PARK_REDUCTION: 20,
} as const;

export class PollutionManager {
  private width: number;
  private height: number;
  private sources: PollutionSource[] = [];
  private ground: Float64Array;
  private water: Float64Array;
  private noise: Float64Array;

  /** Reusable return object for getPollutionAt — callers must not store the reference. */
  private readonly _reusableLevel: PollutionLevel = { ground: 0, water: 0, noise: 0 };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ground = new Float64Array(width * height);
    this.water = new Float64Array(width * height);
    this.noise = new Float64Array(width * height);
  }

  private getGrid(type: PollutionType): Float64Array {
    if (type === 'ground') return this.ground;
    if (type === 'water') return this.water;
    return this.noise;
  }

  addSource(x: number, y: number, amount: number, type: PollutionType, radius?: number): void {
    this.sources.push({ x, y, amount, type, radius });
  }

  addPollutionSource(source: PollutionSource): void {
    this.sources.push(source);
  }

  calculateSpread(): void {
    // Zero grids in-place (no allocation)
    this.ground.fill(0);
    this.water.fill(0);
    this.noise.fill(0);

    for (const source of this.sources) {
      this.spreadFromSource(source);
    }
  }

  private spreadFromSource(source: PollutionSource): void {
    const grid = this.getGrid(source.type);
    const w = this.width;
    const hasRadius = source.radius !== undefined && source.radius > 0;
    const maxRange = hasRadius ? source.radius : Math.ceil(source.amount / POLLUTION.DECAY_PER_CELL);
    const decayPerCell = hasRadius ? source.amount / source.radius : POLLUTION.DECAY_PER_CELL;

    for (let dx = -maxRange; dx <= maxRange; dx++) {
      for (let dy = -maxRange; dy <= maxRange; dy++) {
        const nx = source.x + dx;
        const ny = source.y + dy;

        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;

        const distance = Math.abs(dx) + Math.abs(dy); // Manhattan distance
        const value = Math.max(0, source.amount - distance * decayPerCell);

        if (value > 0) {
          grid[ny * w + nx] += value;
        }
      }
    }
  }

  getPollutionAt(x: number, y: number): PollutionLevel {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      this._reusableLevel.ground = 0;
      this._reusableLevel.water = 0;
      this._reusableLevel.noise = 0;
      return this._reusableLevel;
    }
    const idx = y * this.width + x;
    this._reusableLevel.ground = this.ground[idx]!;
    this._reusableLevel.water = this.water[idx]!;
    this._reusableLevel.noise = this.noise[idx]!;
    return this._reusableLevel;
  }

  addParkEffect(x: number, y: number, radius: number): void {
    const w = this.width;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;

        const distance = Math.abs(dx) + Math.abs(dy);
        if (distance <= radius) {
          const idx = ny * w + nx;
          this.ground[idx] = Math.max(0, this.ground[idx]! - POLLUTION.PARK_REDUCTION);
          this.noise[idx] = Math.max(0, this.noise[idx]! - POLLUTION.PARK_REDUCTION);
        }
      }
    }
  }

  clearSources(): void {
    this.sources.length = 0;
  }
}
