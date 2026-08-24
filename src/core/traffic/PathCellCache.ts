import type { LaneEdge } from './LaneGraph';
import { collectEdgeCells } from './CommuteCacheHelpers';

/**
 * Which cells a path passes through.
 *
 * The congestion flow field is recomputed every 60 ticks by walking every cached route and
 * accumulating riders per cell. Measured on a 12,351-citizen save, one recompute walked
 * 4,505,318 edges to produce a flow field with 314 keys — the whole city has 284 road cells —
 * taking 292ms in a single tick (BUG-327).
 *
 * The answer depends only on the **path**: roads do not move, and today's congestion does not
 * change which cells a route crosses. Commute routes are shared (`CommuteCache`'s route pool
 * hands the same array to every citizen taking that trip), so thousands of citizens on one
 * route share a single entry. Measured 217ms to 57ms with identical per-cell values.
 *
 * Same pattern as `PathLengthCache`: a `WeakMap` keyed by the path array itself, so an evicted
 * route takes its entry with it and nobody has to remember to clear it. The precondition is
 * that a path array is never mutated after construction, which holds — every site that
 * produces a path produces a new array.
 */
export class PathCellCache {
  private readonly cells = new WeakMap<readonly LaneEdge[], readonly string[]>();
  private derived = 0;

  /**
   * How many paths have actually been walked so far.
   *
   * `WeakMap` has no size, and whether the cache is shared is the only reason this class
   * exists: constructing a fresh one each time produces identical output, so no
   * result-checking assertion would turn red. This number makes that testable.
   */
  get derivations(): number { return this.derived; }

  /** The distinct cells this path passes through. The returned array is shared and must not be
   *  mutated by callers. */
  cellsOf(path: readonly LaneEdge[]): readonly string[] {
    let cached = this.cells.get(path);
    if (cached === undefined) {
      cached = Array.from(collectEdgeCells(path));
      this.cells.set(path, cached);
      this.derived++;
    }
    return cached;
  }
}
