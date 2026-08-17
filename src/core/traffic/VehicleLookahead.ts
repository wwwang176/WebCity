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
 * `room` is the caller's already-computed following distance, so the common
 * free-flowing case costs one comparison — there is no walk at all unless a
 * vehicle is close enough ahead to matter.
 */
export function findBlockedJunctionDistance(
  v: LookaheadVehicle,
  edgePath: readonly LaneEdge[],
  room: number,
): number {
  if (room >= LOOKAHEAD_DISTANCE) return Infinity;

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
  if (room >= exit + v.length / 2) return Infinity;
  return Math.max(0, enter - v.length / 2 - STOP_LINE_OFFSET);
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
