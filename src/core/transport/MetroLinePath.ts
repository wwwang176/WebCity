/**
 * Builds the continuous path of a metro line for renderer animation.
 *
 * Pure logic: must not import Three.js.
 */

import type { Point2D } from './MetroTunnelPath';
import { euclideanDistance } from '../grid/GridHelpers';

export interface LinePathSegment {
  controlPoints: Point2D[];
  length: number;           // estimated segment length (Euclidean)
  cumulativeStart: number;  // distance from line start
}

export interface LinePath {
  segments: LinePathSegment[];
  stationDistances: number[]; // cumulative distance to each station
  totalLength: number;
}

function euclidean(a: Point2D, b: Point2D): number {
  return euclideanDistance(a.x, a.y, b.x, b.y);
}

/**
 * Build a continuous line path from station positions.
 *
 * - 2 stations: A→B + B→A (round trip, treated as loop)
 * - 3+ stations: N segments forming complete loop (A→B→C→...→A)
 */
export function buildLinePath(stations: readonly Point2D[]): LinePath {
  if (stations.length < 2) {
    return { segments: [], stationDistances: [], totalLength: 0 };
  }

  const segments: LinePathSegment[] = [];
  const stationDistances: number[] = [];
  let cumulative = 0;

  if (stations.length === 2) {
    // Round trip: A→B, B→A
    const a = stations[0]!;
    const b = stations[1]!;
    const dist = euclidean(a, b);

    stationDistances.push(0);       // Station A at distance 0
    stationDistances.push(dist);    // Station B at distance dist

    const midAB = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    segments.push({
      controlPoints: [a, midAB, b],
      length: dist,
      cumulativeStart: 0,
    });
    segments.push({
      controlPoints: [b, midAB, a],
      length: dist,
      cumulativeStart: dist,
    });

    return { segments, stationDistances, totalLength: dist * 2 };
  }

  // 3+ stations: full loop
  for (let i = 0; i < stations.length; i++) {
    const from = stations[i]!;
    const to = stations[(i + 1) % stations.length]!;
    const dist = euclidean(from, to);
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };

    stationDistances.push(cumulative);

    segments.push({
      controlPoints: [from, mid, to],
      length: dist,
      cumulativeStart: cumulative,
    });

    cumulative += dist;
  }

  return { segments, stationDistances, totalLength: cumulative };
}

/**
 * Map a global distance along the LinePath to a specific segment + local parametric t.
 * Wraps around for loop routes.
 */
export function distanceToSegmentParam(
  linePath: LinePath,
  distance: number,
): { segmentIndex: number; localT: number } {
  if (linePath.segments.length === 0) {
    return { segmentIndex: 0, localT: 0 };
  }

  // Wrap distance into [0, totalLength)
  let d = distance % linePath.totalLength;
  if (d < 0) d += linePath.totalLength;

  for (let i = 0; i < linePath.segments.length; i++) {
    const seg = linePath.segments[i]!;
    const segEnd = seg.cumulativeStart + seg.length;
    if (d <= segEnd || i === linePath.segments.length - 1) {
      const localDist = d - seg.cumulativeStart;
      const localT = seg.length > 0 ? Math.min(1, Math.max(0, localDist / seg.length)) : 0;
      return { segmentIndex: i, localT };
    }
  }

  return { segmentIndex: 0, localT: 0 };
}

// ── Train animation state ────────────────────────────────────────────────

export interface TrainAnimState {
  distance: number;        // world-space distance along LinePath
  atStation: boolean;
  waitTimer: number;       // seconds remaining at station
  nextStationIndex: number;
}

/**
 * Advance a train's animation state by dt seconds.
 * Pure logic — no Three.js dependency.
 */
export function advanceTrain(
  state: TrainAnimState,
  dt: number,
  totalLength: number,
  stationDistances: number[],
  speed: number,
  waitTime: number,
): void {
  if (dt <= 0) return;

  if (state.atStation) {
    state.waitTimer -= dt;
    if (state.waitTimer <= 0) {
      state.atStation = false;
    }
    return;
  }

  const prevDist = state.distance;
  state.distance += speed * dt;

  // Target distance for next station
  const targetDist = state.nextStationIndex === 0
    ? totalLength
    : stationDistances[state.nextStationIndex]!;

  // Check if we crossed the target station
  if (prevDist < targetDist && state.distance >= targetDist) {
    // Snap to station
    state.distance = state.nextStationIndex === 0 ? 0 : targetDist;
    state.atStation = true;
    state.waitTimer = waitTime;
    state.nextStationIndex = (state.nextStationIndex + 1) % stationDistances.length;
  }

  // Wrap around (safety)
  if (state.distance >= totalLength) {
    state.distance -= totalLength;
  }
}
