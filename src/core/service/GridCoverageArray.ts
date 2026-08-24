/**
 * GridCoverageArray — dense coverage cache using Uint8Array.
 * Replaces Map<string, number> for O(1) coverage queries with zero GC pressure.
 *
 * Value semantics:
 *   0       = uncovered
 *   1~255   = quantized cost (1 = nearest/cost=0, 255 = farthest/cost=budget)
 *
 * ## As well as how far, it records who
 *
 * Cost alone lets the dots and the overlay answer only distance, while what the player needs is
 * how full the facility serving them is. So each cell also records the index of **the facility
 * covering it most cheaply**, rewritten whenever the cost is, so the two always name the same
 * facility (BUG-362).
 */

import { parsePosKeyUnsafe } from '../grid/GridHelpers';

/** Encode a float cost into a uint8 value (1–255). 0 = uncovered. */
export function encodeCost(cost: number, budget: number): number {
  return Math.max(1, Math.min(255, Math.round((cost / budget) * 254) + 1));
}

/** Decode a uint8 value back to a 0.0–1.0 cost ratio. */
export function decodeCostRatio(value: number): number {
  if (value <= 1) return 0;
  return (value - 1) / 254;
}

/**
 * The owner is stored as **index + 1**, because 0 is reserved for uncovered.
 *
 * So the largest representable index is 65534. Anything above throws: wrapping silently would
 * point a cell at the wrong facility, which is worse than not knowing.
 */
const MAX_OWNER_INDEX = 65534;

export class GridCoverageArray {
  private data: Uint8Array;
  private counts: Uint8Array;
  /** The index, plus 1, of the facility covering this cell most cheaply. 0 means none. */
  private owners: Uint16Array;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const size = width * height;
    this.data = new Uint8Array(size);
    this.counts = new Uint8Array(size);
    this.owners = new Uint16Array(size);
  }

  /**
   * Write a Dijkstra flood result. Keeps min cost per cell. Increments coverage count.
   *
   * `ownerIndex` is the facility this flood came from. Cells whose cost is rewritten have their
   * owner rewritten with it, so no cell ends up with A's cost and B's owner.
   */
  applyFlood(coverageMap: Map<string, number>, budget: number, ownerIndex = 0): void {
    assertOwnerIndex(ownerIndex);
    for (const [key, cost] of coverageMap) {
      const { x, y } = parsePosKeyUnsafe(key);
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      const idx = y * this.width + x;
      const encoded = encodeCost(cost, budget);
      const existing = this.data[idx]!;
      // Keep min cost (lower encoded = closer)
      if (existing === 0 || encoded < existing) {
        this.data[idx] = encoded;
        this.owners[idx] = ownerIndex + 1;
      }
      // Increment coverage count (clamp at 255)
      if (this.counts[idx]! < 255) {
        this.counts[idx]!++;
      }
    }
  }

  /** Merge new flood with an existing GridCoverageArray, taking min cost per cell. */
  applyMerged(
    newFlood: Map<string, number>,
    existing: GridCoverageArray,
    budget: number,
    ownerIndex = 0,
  ): void {
    assertOwnerIndex(ownerIndex);
    // Copy existing coverage
    this.data.set(existing.data);
    this.counts.set(existing.counts);
    this.owners.set(existing.owners);

    // Apply new flood on top (min cost)
    for (const [key, cost] of newFlood) {
      const { x, y } = parsePosKeyUnsafe(key);
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      const idx = y * this.width + x;
      const encoded = encodeCost(cost, budget);
      const ex = this.data[idx]!;
      if (ex === 0 || encoded < ex) {
        this.data[idx] = encoded;
        this.owners[idx] = ownerIndex + 1;
      }
      if (this.counts[idx]! < 255) {
        this.counts[idx]!++;
      }
    }
  }

  /** O(1) coverage check. */
  hasCoverage(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.data[y * this.width + x]! !== 0;
  }

  /** Raw uint8 value (0 = uncovered, 1–255 = quantized cost). */
  getRaw(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x]!;
  }

  /** Cost ratio: 0.0 (nearest) to 1.0 (farthest). Returns 0 if uncovered. */
  getCostRatio(x: number, y: number): number {
    return decodeCostRatio(this.getRaw(x, y));
  }

  /**
   * The index of the facility covering this cell most cheaply. `-1` means uncovered.
   *
   * The index is into **the facility list as it stood at the recompute**, not a facility id, so
   * the caller has to hold that same list to resolve it. `RoadCoverageService` does.
   */
  getOwner(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    // Stored as index + 1, so the 0 meaning "none" subtracts back to exactly -1 with no extra
    // check.
    return this.owners[y * this.width + x]! - 1;
  }

  /** Number of facilities covering this cell. */
  getCoverageCount(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.counts[y * this.width + x]!;
  }

  /** Reset all data and counts to 0. */
  clear(): void {
    this.data.fill(0);
    this.counts.fill(0);
    this.owners.fill(0);
  }

  /** Iterate all covered cells with their cost ratio. */
  forEachCovered(callback: (x: number, y: number, costRatio: number) => void): void {
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== 0) {
        const x = i % this.width;
        const y = (i - x) / this.width;
        callback(x, y, decodeCostRatio(this.data[i]!));
      }
    }
  }
}

/** Whether the owner index fits. It complains rather than wrapping onto another facility. */
function assertOwnerIndex(ownerIndex: number): void {
  if (ownerIndex < 0 || ownerIndex > MAX_OWNER_INDEX) {
    throw new RangeError(`owner index ${ownerIndex} out of range (0-${MAX_OWNER_INDEX})`);
  }
}
