export enum ResourceType {
  NONE = 0,
  ORE = 1,
  OIL = 2,
  FERTILE = 3,
  FOREST = 4,
}

interface ResourceCell {
  type: ResourceType;
  remaining: number;
}

// Simple seeded pseudo-random number generator for deterministic resource placement
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export class NaturalResourceManager {
  private resources: Map<string, ResourceCell> = new Map();
  private width = 0;
  private height = 0;

  private cellKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  initResources(width: number, height: number, seed: number = 42): void {
    this.width = width;
    this.height = height;
    this.resources.clear();

    const rng = seededRandom(seed);
    const resourceTypes = [ResourceType.ORE, ResourceType.OIL, ResourceType.FERTILE, ResourceType.FOREST];

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const roll = rng();
        if (roll < 0.3) {
          // 30% chance of having a resource
          const typeIndex = Math.floor(rng() * resourceTypes.length);
          const type = resourceTypes[typeIndex]!;
          const amount = Math.floor(rng() * 500) + 100;
          this.resources.set(this.cellKey(x, y), { type, remaining: amount });
        } else {
          this.resources.set(this.cellKey(x, y), { type: ResourceType.NONE, remaining: 0 });
        }
      }
    }
  }

  setResource(x: number, y: number, type: ResourceType, amount: number): void {
    this.resources.set(this.cellKey(x, y), { type, remaining: amount });
  }

  getResourceAt(x: number, y: number): { type: ResourceType; remaining: number } {
    const key = this.cellKey(x, y);
    const cell = this.resources.get(key);
    if (!cell) {
      return { type: ResourceType.NONE, remaining: 0 };
    }
    return { type: cell.type, remaining: cell.remaining };
  }

  extract(x: number, y: number, amount: number): number {
    const key = this.cellKey(x, y);
    const cell = this.resources.get(key);
    if (!cell || cell.type === ResourceType.NONE || cell.remaining <= 0) {
      return 0;
    }

    const extracted = Math.min(amount, cell.remaining);
    cell.remaining -= extracted;
    return extracted;
  }

  isExhausted(x: number, y: number): boolean {
    const key = this.cellKey(x, y);
    const cell = this.resources.get(key);
    if (!cell) return true;
    return cell.remaining <= 0;
  }
}
