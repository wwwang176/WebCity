/**
 * GridCoverageArray — dense coverage cache using Uint8Array.
 * Replaces Map<string, number> for O(1) coverage queries with zero GC pressure.
 *
 * Value semantics:
 *   0       = uncovered
 *   1~255   = quantized cost (1 = nearest/cost=0, 255 = farthest/cost=budget)
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

export class GridCoverageArray {
  private data: Uint8Array;
  private counts: Uint8Array;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const size = width * height;
    this.data = new Uint8Array(size);
    this.counts = new Uint8Array(size);
  }

  /** Write a Dijkstra flood result. Keeps min cost per cell. Increments coverage count. */
  applyFlood(coverageMap: Map<string, number>, budget: number): void {
    for (const [key, cost] of coverageMap) {
      const { x, y } = parsePosKeyUnsafe(key);
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      const idx = y * this.width + x;
      const encoded = encodeCost(cost, budget);
      const existing = this.data[idx]!;
      // Keep min cost (lower encoded = closer)
      if (existing === 0 || encoded < existing) {
        this.data[idx] = encoded;
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
  ): void {
    // Copy existing coverage
    this.data.set(existing.data);
    this.counts.set(existing.counts);

    // Apply new flood on top (min cost)
    for (const [key, cost] of newFlood) {
      const { x, y } = parsePosKeyUnsafe(key);
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      const idx = y * this.width + x;
      const encoded = encodeCost(cost, budget);
      const ex = this.data[idx]!;
      if (ex === 0 || encoded < ex) {
        this.data[idx] = encoded;
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

  /** Number of facilities covering this cell. */
  getCoverageCount(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.counts[y * this.width + x]!;
  }

  /** Reset all data and counts to 0. */
  clear(): void {
    this.data.fill(0);
    this.counts.fill(0);
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
