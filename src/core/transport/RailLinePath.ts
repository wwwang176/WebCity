/**
 * RailLinePath — 根據實際軌道座標建構鐵路路線的連續路徑，供渲染端動畫使用。
 *
 * 與 MetroLinePath 類似，但使用 RailNetwork.findPath 回傳的逐格路徑
 * 而非站對站直線。
 *
 * 純邏輯模組，禁止 import Three.js。
 */

export interface RailPathPoint {
  x: number;
  y: number;
}

export interface RailPathSegment {
  /** Grid cell coordinates along this segment */
  points: RailPathPoint[];
  /** Total length of this segment */
  length: number;
  /** Cumulative distance from route start */
  cumulativeStart: number;
}

export interface RailLinePath {
  segments: RailPathSegment[];
  stationDistances: number[];
  totalLength: number;
}

function dist(a: RailPathPoint, b: RailPathPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Parse "x,y" node IDs from RailNetwork.findPath into coordinates.
 */
function parseNodeId(id: string): RailPathPoint {
  const [xs, ys] = id.split(',');
  return { x: Number(xs), y: Number(ys) };
}

/**
 * Compute the total length of a sequence of grid points.
 */
function pathLength(points: RailPathPoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += dist(points[i - 1]!, points[i]!);
  }
  return len;
}

/**
 * Build a RailLinePath from track path segments between consecutive stations.
 *
 * @param stationPaths - Array of paths, each from RailNetwork.findPath (node ID strings).
 *   For a round-trip route (2 stations): [pathAtoB, pathBtoA]
 *   For a loop route (3+ stations): [pathAtoB, pathBtoC, ..., pathLastToA]
 */
export function buildRailLinePath(stationPaths: string[][]): RailLinePath {
  if (stationPaths.length === 0) {
    return { segments: [], stationDistances: [], totalLength: 0 };
  }

  const segments: RailPathSegment[] = [];
  const stationDistances: number[] = [];
  let cumulative = 0;

  for (let i = 0; i < stationPaths.length; i++) {
    const nodeIds = stationPaths[i]!;
    const points = nodeIds.map(parseNodeId);
    const len = pathLength(points);

    stationDistances.push(cumulative);

    segments.push({
      points,
      length: len,
      cumulativeStart: cumulative,
    });

    cumulative += len;
  }

  return { segments, stationDistances, totalLength: cumulative };
}

/**
 * Interpolate a position along the RailLinePath at a given distance.
 * Returns the interpolated (x, y) and heading angle.
 */
export function interpolateRailPath(
  linePath: RailLinePath,
  distance: number,
): { x: number; y: number; heading: number } {
  if (linePath.segments.length === 0 || linePath.totalLength === 0) {
    return { x: 0, y: 0, heading: 0 };
  }

  // Wrap distance into [0, totalLength)
  let d = distance % linePath.totalLength;
  if (d < 0) d += linePath.totalLength;

  // Find the segment
  let seg = linePath.segments[0]!;
  for (let i = 0; i < linePath.segments.length; i++) {
    const s = linePath.segments[i]!;
    const segEnd = s.cumulativeStart + s.length;
    if (d <= segEnd || i === linePath.segments.length - 1) {
      seg = s;
      break;
    }
  }

  // Local distance within segment
  const localDist = d - seg.cumulativeStart;

  // Walk the segment's point list to find the exact sub-edge
  let remaining = localDist;
  for (let j = 1; j < seg.points.length; j++) {
    const a = seg.points[j - 1]!;
    const b = seg.points[j]!;
    const edgeLen = dist(a, b);

    if (remaining <= edgeLen || j === seg.points.length - 1) {
      const t = edgeLen > 0 ? Math.min(1, Math.max(0, remaining / edgeLen)) : 0;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const heading = Math.atan2(-(b.y - a.y), b.x - a.x);
      return { x, y, heading };
    }

    remaining -= edgeLen;
  }

  // Fallback: end of segment
  const last = seg.points[seg.points.length - 1]!;
  return { x: last.x, y: last.y, heading: 0 };
}
