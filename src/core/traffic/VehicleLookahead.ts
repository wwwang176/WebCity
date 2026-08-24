import type { LaneEdge } from './LaneGraph';
import { NO_ENTRY, type EdgeVehicleIndex } from './EdgeVehicleIndex';

/** Distance (grid units) to stop behind the intersection edge, matching the rendered stop line position. */
export const STOP_LINE_OFFSET = 0.25;

/** Maximum lookahead distance (grid units) for gap/red-light checks. */
const LOOKAHEAD_DISTANCE = 5;


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
 *
 * @param maxHalfLen half the length of the longest vehicle on the road. Supplying it enables
 * an early exit: once a vehicle is found, no edge further ahead can hold a nearer one.
 *
 * It has to be the longest vehicle rather than the one in front: a gap subtracts both
 * vehicles' half-lengths, and a bus is more than twice a car's length, so a bus further back
 * can leave a smaller gap. A smaller threshold skips it and the vehicle drives into the bus's
 * rear.
 *
 * Without it there is no early exit and the whole path is scanned. A 5-tile lookahead walks
 * 10.3 edges on average (measured on a 12,288-citizen save), while in dense traffic a vehicle
 * is usually found on the first or second edge.
 */
export function findGapAhead(
  v: LookaheadVehicle,
  edgePath: readonly LaneEdge[],
  edgeIndex: EdgeVehicleIndex,
  maxHalfLen = Infinity,
): number {
  let gap = Infinity;
  const myHalfLen = v.length / 2;
  let distAhead = 0;

  for (let ei = v.edgeIndex; ei < edgePath.length; ei++) {
    const edge = edgePath[ei]!;
    const myProgress = ei === v.edgeIndex ? v.edgeProgress : 0;
    const edgeRemain = edge.length - myProgress;

    for (let i = edgeIndex.firstOf(edge.id); i !== NO_ENTRY; i = edgeIndex.nextOf(i)) {
      const eVid = edgeIndex.vidAt(i);
      if (eVid === v.id) continue;
      const eProgress = edgeIndex.progressAt(i);
      const eHalfLen = edgeIndex.halfLenAt(i);
      if (ei === v.edgeIndex) {
        if (eProgress < v.edgeProgress) continue;
        if (eProgress === v.edgeProgress && eVid > v.id) continue;
        const dist = (eProgress - v.edgeProgress) - myHalfLen - eHalfLen;
        if (dist < gap) gap = dist;
      } else {
        const dist = distAhead + eProgress - myHalfLen - eHalfLen;
        if (dist < gap) gap = dist;
      }
    }

    distAhead += edgeRemain;
    if (distAhead > LOOKAHEAD_DISTANCE) break;
    // Even the most optimistic vehicle on the next edge cannot beat the one already found.
    if (gap <= distAhead - myHalfLen - maxHalfLen) break;
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
 * Entering is allowed when the CENTRE can clear the box: `room >= exit`.
 * Otherwise stop at the same stop line a red light would use.
 *
 * Deliberately not `room >= exit + halfLen`, which would keep the box wholly
 * clear. Real drivers nose into the box, and holding out for the whole body
 * makes the traffic look stiff. What it costs is bounded and small: at most
 * half a body stays inside — 0.11 grid units, a tenth of the junction's width.
 * The stricter form measured identically (0.314 vs 0.313 ms/frame), so this is
 * a choice about how the traffic looks, not about what it costs.
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
  edgeIndex: EdgeVehicleIndex,
  gap: number,
  minGap: number,
): number {
  if (gap >= LOOKAHEAD_DISTANCE) return Infinity;

  const halfLen = v.length / 2;

  // 1. Where the first junction ahead is. Pure traversal, no lookups.
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

  if (enter <= 0) return Infinity;  // no junction ahead, or already inside one and can only drive out

  // The centre must reach here to have cleared the junction.
  const needed = exit;
  // If even the nearest vehicle in traffic cannot block it, there is no need to find out who.
  if (gap - minGap >= needed) return Infinity;

  // 2. Only vehicles **currently queueing** count as occupying the box.
  //
  // Judging by `findGapAhead`'s distance, which does not distinguish moving from stopped,
  // makes a normal two-tile following distance brake every vehicle at every junction —
  // measured as a tenth of the corridor's throughput lost while no congestion existed at all.
  //
  // Checking whether a vehicle has already stopped is too late: queues grow backwards, and by
  // the time the leader really stops the follower is inside the junction and trapped. What is
  // read is therefore that it is decelerating for something ahead.
  let d = 0;
  for (let ei = v.edgeIndex; ei < edgePath.length; ei++) {
    const edge = edgePath[ei]!;
    for (let i = edgeIndex.firstOf(edge.id); i !== NO_ENTRY; i = edgeIndex.nextOf(i)) {
      const eVid = edgeIndex.vidAt(i);
      if (eVid === v.id || !edgeIndex.queueingAt(i)) continue;
      const eProgress = edgeIndex.progressAt(i);
      let at: number;
      if (ei === v.edgeIndex) {
        if (eProgress < v.edgeProgress) continue;
        if (eProgress === v.edgeProgress && eVid > v.id) continue;
        at = eProgress - v.edgeProgress;
      } else {
        at = d + eProgress;
      }
      // This queueing vehicle limits how far this centre may advance.
      if (at - halfLen - edgeIndex.halfLenAt(i) - minGap < needed) {
        return Math.max(0, enter - halfLen - STOP_LINE_OFFSET);
      }
    }
    d += edge.length - (ei === v.edgeIndex ? v.edgeProgress : 0);
    // Every vehicle beyond this has `at` no smaller than d, and e.halfLen >= 0, so nothing
    // further can block.
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
