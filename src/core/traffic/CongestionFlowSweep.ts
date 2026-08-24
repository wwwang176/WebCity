import type { CommuteCache } from './CommuteCache';
import type { PathCellCache } from './PathCellCache';

/**
 * Spreads the congestion flow field's recomputation over several ticks.
 *
 * The flow field is only replaced every 60 ticks but is computed in one go. Measured on a
 * 12,351-citizen save, even with "which cells a path passes through" cached it takes 60ms in a
 * single tick, against 250ms available per tick at speed 1, with rendering competing for the
 * same thread (BUG-327).
 *
 * Since the result already lags 60 ticks, spreading it does not make it any staler — but
 * **nobody may read a half-built table**. A half-built table claims only those roads carry
 * anyone and everything else is empty, which is worse than the previous sweep's data.
 * Accumulation therefore happens on its own sheet and the whole thing is published only once
 * the sweep completes.
 *
 * The key list is taken at the start of a sweep. Routes added or removed mid-sweep do not
 * affect it: `forRouteKey` skips the ones that vanished, and new ones wait for the next sweep.
 * A full road-network change (`roadGeneration` bumps and `routeIndex` is cleared) abandons the
 * sweep: a table stitched from old and new data is false, and keeping the previous sweep's
 * table another 60 ticks is preferable.
 */
export class CongestionFlowSweep {
  private keys: string[] = [];
  private cursor = 0;
  private active = false;
  private generation = -1;
  private acc = new Map<string, number>();
  private refTotal = 0;

  /** Whether a sweep is in progress. */
  get inProgress(): boolean { return this.active; }

  /** How many routes this sweep covers. Callers use it to size a tick's batch. */
  get size(): number { return this.keys.length; }

  /** Starts a new sweep, discarding any unfinished one. */
  begin(cache: CommuteCache): void {
    cache.routeKeysWithRiders(this.keys);
    this.cursor = 0;
    this.active = true;
    this.generation = cache.roadGeneration;
    this.acc = new Map();
    this.refTotal = 0;
  }

  /**
   * Processes the next batch. Returns `null` while the sweep is unfinished, or when none is
   * running.
   *
   * @param keysPerTick the most routes this tick may process
   * @param getLaneCount lane division happens once, at publication. Dividing per batch would
   *   divide a cell twice when one route's cells span two batches
   */
  step(
    cache: CommuteCache,
    cellCache: PathCellCache,
    keysPerTick: number,
    getLaneCount: (cellKey: string) => number,
  ): { flowMap: Map<string, number>; totalRefCount: number } | null {
    if (!this.active) return null;
    if (cache.roadGeneration !== this.generation) {
      this.abandon();
      return null;
    }

    const end = Math.min(this.keys.length, this.cursor + Math.max(1, keysPerTick));
    for (; this.cursor < end; this.cursor++) {
      cache.forRouteKey(this.keys[this.cursor]!, (path, refCount) => {
        this.refTotal += refCount;
        const cells = cellCache.cellsOf(path);
        for (let i = 0; i < cells.length; i++) {
          const cellKey = cells[i]!;
          this.acc.set(cellKey, (this.acc.get(cellKey) ?? 0) + refCount);
        }
      });
    }
    if (this.cursor < this.keys.length) return null;

    const flowMap = this.acc;
    const totalRefCount = this.refTotal;
    this.abandon();

    for (const [cellKey, rawFlow] of flowMap) {
      const lanes = getLaneCount(cellKey);
      if (lanes > 1) flowMap.set(cellKey, rawFlow / lanes);
    }
    return { flowMap, totalRefCount };
  }

  private abandon(): void {
    this.active = false;
    this.keys.length = 0;
    this.cursor = 0;
    this.acc = new Map();
    this.refTotal = 0;
  }
}
