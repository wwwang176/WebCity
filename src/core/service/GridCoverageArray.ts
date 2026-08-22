/**
 * GridCoverageArray — dense coverage cache using Uint8Array.
 * Replaces Map<string, number> for O(1) coverage queries with zero GC pressure.
 *
 * Value semantics:
 *   0       = uncovered
 *   1~255   = quantized cost (1 = nearest/cost=0, 255 = farthest/cost=budget)
 *
 * ## 除了「多遠」，還記「是誰」
 *
 * 光有成本，圓點與圖層就只答得出距離 —— 而玩家真正要知道的是「服務我的那間現在
 * 多滿」。所以每一格另外記下**用最低成本涵蓋它的那一座設施**的索引:成本改寫時
 * 擁有者跟著改寫，兩者永遠指同一座（BUG-362）。
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
 * 擁有者存的是**索引 + 1**，因為 0 要留給「沒有人涵蓋」。
 *
 * 所以能表示的最大索引是 65534。超過就丟例外 —— 靜靜地環回去會讓某一格指向錯的
 * 設施，那比不知道更糟。
 */
const MAX_OWNER_INDEX = 65534;

export class GridCoverageArray {
  private data: Uint8Array;
  private counts: Uint8Array;
  /** 用最低成本涵蓋這一格的設施索引 + 1。0 = 沒有人。 */
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
   * `ownerIndex` 是這一趟洪水的來源設施。成本被改寫的那幾格，擁有者跟著改寫 ——
   * 兩者一起動，才不會出現「成本是 A 的、擁有者是 B」。
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
   * 用最低成本涵蓋這一格的那一座設施的索引。`-1` = 沒有人涵蓋。
   *
   * 索引是**重算當下那一份設施清單**的索引，不是設施 id —— 呼叫端要自己拿著
   * 同一份清單去換。`RoadCoverageService` 就是這樣做的。
   */
  getOwner(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    // 存的是索引 + 1，所以「沒有人」的 0 減回去正好就是 -1。不必再判一次。
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

/** 擁有者索引存得下嗎。存不下要吵，不要環回去指到別的設施。 */
function assertOwnerIndex(ownerIndex: number): void {
  if (ownerIndex < 0 || ownerIndex > MAX_OWNER_INDEX) {
    throw new RangeError(`owner index ${ownerIndex} out of range (0-${MAX_OWNER_INDEX})`);
  }
}
