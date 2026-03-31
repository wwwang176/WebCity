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
 * Find the distance to the nearest red light along the edge path.
 * Returns Infinity if no red light is found within LOOKAHEAD_DISTANCE.
 */
export function findRedLightDistance(
  v: LookaheadVehicle,
  edgePath: readonly LaneEdge[],
  canAdvance: (current: string, next: string) => boolean,
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
      if (!alreadyCrossing && !canAdvance(edge.from.cellKey, edge.to.cellKey)) {
        const stopDist = distAhead - (ei === v.edgeIndex ? 0 : startDist);
        return Math.max(0, stopDist - v.length / 2 - STOP_LINE_OFFSET);
      }
    }

    distAhead += edgeRemain;
    if (distAhead > LOOKAHEAD_DISTANCE) break;
  }

  return Infinity;
}
