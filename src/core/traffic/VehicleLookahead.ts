import type { LaneEdge } from './LaneGraph';

/** Distance (grid units) to stop behind the intersection edge, matching the rendered stop line position. */
export const STOP_LINE_OFFSET = 0.25;

/** Maximum lookahead distance (grid units) for gap/red-light checks. */
const LOOKAHEAD_DISTANCE = 5;

/** Compact representation of a vehicle on an edge, for O(1) lookup. */
export interface EdgeEntry {
  vid: number;
  progress: number;
  halfLen: number;
  /**
   * Held back by something ahead — following, a red light, or a junction.
   *
   * Only queueing traffic can block a junction. A car that is merely close but
   * running free will be long gone by the time anyone reaches it.
   */
  queueing: boolean;
}

/** Minimal vehicle state needed for lookahead calculations. */
export interface LookaheadVehicle {
  id: number;
  length: number;
  edgeIndex: number;
  edgeProgress: number;
}

/**
 * Find the gap distance to the nearest vehicle ahead on the same edge path.
 * Returns Infinity if no vehicle is found within LOOKAHEAD_DISTANCE.
 */
export function findGapAhead(
  v: LookaheadVehicle,
  edgePath: readonly LaneEdge[],
  edgeIndex: ReadonlyMap<string, readonly EdgeEntry[]>,
): number {
  let gap = Infinity;
  const myHalfLen = v.length / 2;
  let distAhead = 0;

  for (let ei = v.edgeIndex; ei < edgePath.length; ei++) {
    const edge = edgePath[ei]!;
    const myProgress = ei === v.edgeIndex ? v.edgeProgress : 0;
    const edgeRemain = edge.length - myProgress;

    const entries = edgeIndex.get(edge.id);
    if (entries) {
      for (const e of entries) {
        if (e.vid === v.id) continue;
        if (ei === v.edgeIndex) {
          if (e.progress < v.edgeProgress) continue;
          if (e.progress === v.edgeProgress && e.vid > v.id) continue;
          const dist = (e.progress - v.edgeProgress) - myHalfLen - e.halfLen;
          if (dist < gap) gap = dist;
        } else {
          const dist = distAhead + e.progress - myHalfLen - e.halfLen;
          if (dist < gap) gap = dist;
        }
      }
    }

    distAhead += edgeRemain;
    if (distAhead > LOOKAHEAD_DISTANCE) break;
  }

  return gap;
}

/**
 * How far a vehicle may advance without parking itself inside an intersection.
 * Returns Infinity when the box ahead can be cleared (or there is none).
 *
 * Car-following alone only asks where the vehicle ahead stopped, so when that
 * vehicle stops just past an intersection its follower creeps right up and
 * stops in the middle of the box. The next green then hands the cross direction
 * a junction with a stationary car in it, and the whole crossroads locks up.
 *
 * The question to ask before entering is whether the vehicle can come out the
 * other side. Distances here are measured from the vehicle's CENTRE along the
 * path, matching `edgeProgress`:
 *
 *   room          how far the centre may advance before touching the car ahead
 *   [enter, exit] the run of edges marked `insideJunction`
 *
 * The tail clears the box when `centre - halfLen >= exit`, so entering is safe
 * exactly when `room >= exit + halfLen`. Otherwise stop at the same stop line
 * a red light would use.
 *
 * `gap` is the caller's already-computed following distance and is used ONLY to
 * skip work: free-flowing traffic returns after one comparison. It is a lower
 * bound on how far the nearest vehicle of any kind is, so passing too small a
 * number only forfeits the shortcut — the verdict comes from the scan below,
 * which reads the queueing flag and cannot be reached by a shortcut that fires.
 */
export function findBlockedJunctionDistance(
  v: LookaheadVehicle,
  edgePath: readonly LaneEdge[],
  edgeIndex: ReadonlyMap<string, readonly EdgeEntry[]>,
  gap: number,
  minGap: number,
): number {
  if (gap >= LOOKAHEAD_DISTANCE) return Infinity;

  const halfLen = v.length / 2;

  // 1. 前方第一個路口在哪裡。純走訪，不查表。
  let dist = 0;
  let enter = -1;
  let exit = 0;

  for (let ei = v.edgeIndex; ei < edgePath.length && dist <= LOOKAHEAD_DISTANCE; ei++) {
    const edge = edgePath[ei]!;
    const start = dist;
    dist += edge.length - (ei === v.edgeIndex ? v.edgeProgress : 0);
    if (edge.insideJunction) {
      if (enter < 0) enter = start;
      exit = dist;
    } else if (enter >= 0) {
      break;
    }
  }

  if (enter <= 0) return Infinity;  // 前方沒有路口，或者車已經在路口裡了 —— 只能開出去

  // 車身中心要走到這裡，車尾才算離開路口。
  const needed = exit + halfLen;
  // 連車流裡最近的那台都擋不到，就不必再查是誰了。
  if (gap - minGap >= needed) return Infinity;

  // 2. 只有**正在排隊**的車算佔用。
  //
  // 用 findGapAhead 的距離（不分動靜）判斷的話，兩格的正常車距就會讓每一台車
  // 在每一個路口前煞一次 —— 實測整條路的通過量掉一成，而那時候路上根本沒有
  // 塞車。
  //
  // 而「它現在停了沒」又太晚:車隊是往後長的，等前車真的停住，後車已經進了
  // 路口，然後就困在裡面。所以看的是**它正在為前方的東西減速**。
  let d = 0;
  for (let ei = v.edgeIndex; ei < edgePath.length; ei++) {
    const edge = edgePath[ei]!;
    const entries = edgeIndex.get(edge.id);
    if (entries) {
      for (const e of entries) {
        if (e.vid === v.id || !e.queueing) continue;
        let at: number;
        if (ei === v.edgeIndex) {
          if (e.progress < v.edgeProgress) continue;
          if (e.progress === v.edgeProgress && e.vid > v.id) continue;
          at = e.progress - v.edgeProgress;
        } else {
          at = d + e.progress;
        }
        // 這台排隊中的車讓我的中心最多只能走到這裡。
        if (at - halfLen - e.halfLen - minGap < needed) {
          return Math.max(0, enter - halfLen - STOP_LINE_OFFSET);
        }
      }
    }
    d += edge.length - (ei === v.edgeIndex ? v.edgeProgress : 0);
    // 後面每一台的 `at` 都不小於 d，而 e.halfLen >= 0 —— 再遠就擋不到了。
    if (d - halfLen - minGap >= needed) break;
  }

  return Infinity;
}

/**
 * Find the distance to the nearest red light along the edge path.
 * Returns Infinity if no red light is found within LOOKAHEAD_DISTANCE.
 */
export function findRedLightDistance(
  v: LookaheadVehicle,
  edgePath: readonly LaneEdge[],
  canAdvance: (current: string, next: string, via?: string) => boolean,
): number {
  let distAhead = 0;

  for (let ei = v.edgeIndex; ei < edgePath.length; ei++) {
    const edge = edgePath[ei]!;
    const startDist = ei === v.edgeIndex ? v.edgeProgress : 0;
    const edgeRemain = edge.length - startDist;

    if (edge.from.cellKey !== edge.to.cellKey) {
      // If vehicle is already partway through this crossing, let it complete
      // (it entered the intersection when the light was green)
      const alreadyCrossing = ei === v.edgeIndex && v.edgeProgress > 0;
      // Forward viaCellKey so a turn edge is judged on the intersection it
      // skips over, not on the plain road tile it lands in (BUG-058).
      if (!alreadyCrossing && !canAdvance(edge.from.cellKey, edge.to.cellKey, edge.viaCellKey)) {
        const stopDist = distAhead - (ei === v.edgeIndex ? 0 : startDist);
        return Math.max(0, stopDist - v.length / 2 - STOP_LINE_OFFSET);
      }
    }

    distAhead += edgeRemain;
    if (distAhead > LOOKAHEAD_DISTANCE) break;
  }

  return Infinity;
}
