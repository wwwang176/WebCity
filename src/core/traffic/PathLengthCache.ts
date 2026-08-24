import type { LaneEdge } from './LaneGraph';

/**
 * How far a vehicle has travelled in total along its path.
 *
 * Vehicles are processed front to back each frame (a follower reads the state the leader just
 * computed), and this distance is the sort key. Summing the lengths of all preceding edges
 * from the start of the path per vehicle per frame costs, on paths tens of edges long,
 * 14,438 edges walked per frame just for the sort (measured on a 12,288-citizen save).
 *
 * The prefix sums depend only on the **path**, not on the vehicle. Commute routes are shared:
 * `CommuteCache`'s route pool hands the same array to every citizen taking that trip, so
 * hundreds of vehicles on one route share a single entry.
 *
 * A `WeakMap` keyed by the path array itself means an evicted route takes its entry with it
 * and nobody has to remember to clear it. The precondition is that a path array is never
 * mutated after construction, which holds — every site that produces a path produces a new
 * array.
 */
export class PathLengthCache {
  private readonly prefixes = new WeakMap<readonly LaneEdge[], Float64Array>();

  /**
   * Total distance travelled at `edgeProgress` along `edgePath[edgeIndex]`.
   *
   * When `edgeIndex` is past the end of the path, the prefix is the whole path length and
   * `edgeProgress` is **still added**: a vehicle reaching the end stops at
   * `edgeIndex = length - 1` with `edgeProgress` equal to the last segment's length, and that
   * case should count as having travelled the whole way. This matches the incremental
   * summation it replaces, whose loop bound was also `min(edgeIndex, length)`.
   */
  totalProgress(edgePath: readonly LaneEdge[], edgeIndex: number, edgeProgress: number): number {
    if (edgePath.length === 0) return edgeProgress;
    let prefix = this.prefixes.get(edgePath);
    if (!prefix) {
      prefix = new Float64Array(edgePath.length + 1);
      for (let i = 0; i < edgePath.length; i++) {
        prefix[i + 1] = prefix[i]! + edgePath[i]!.length;
      }
      this.prefixes.set(edgePath, prefix);
    }
    const i = edgeIndex < 0 ? 0 : Math.min(edgeIndex, edgePath.length);
    return prefix[i]! + edgeProgress;
  }
}
