type Point = { x: number; y: number };

/** Evaluate cubic Bezier at parameter t ∈ [0,1] */
export function cubicBezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

/** Evaluate cubic Bezier first derivative (tangent) at parameter t */
export function cubicBezierTangent(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

/**
 * Build an arc-length lookup table for a cubic Bezier.
 * Returns array of cumulative arc lengths at N+1 uniformly-spaced t values.
 * lut[i] = arc length from t=0 to t=i/N.
 */
export function buildArcLengthLUT(p0: Point, p1: Point, p2: Point, p3: Point, N: number): number[] {
  const lut = new Array<number>(N + 1);
  lut[0] = 0;
  let prev = p0;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const cur = cubicBezierPoint(p0, p1, p2, p3, t);
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    lut[i] = lut[i - 1]! + Math.sqrt(dx * dx + dy * dy);
    prev = cur;
  }
  return lut;
}

/**
 * Sample position and tangent at a given arc-length distance along the curve.
 * Uses binary search on the LUT for O(log N) lookup.
 */
export function sampleAtDistance(
  p0: Point, p1: Point, p2: Point, p3: Point,
  lut: number[],
  distance: number,
): { position: Point; tangent: Point } {
  const totalLength = lut[lut.length - 1]!;
  const d = Math.max(0, Math.min(distance, totalLength));
  const N = lut.length - 1;

  // Binary search for the segment containing d
  let lo = 0, hi = N;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lut[mid]! < d) lo = mid + 1;
    else hi = mid;
  }

  // lo is the first index where lut[lo] >= d
  if (lo === 0) {
    return {
      position: cubicBezierPoint(p0, p1, p2, p3, 0),
      tangent: cubicBezierTangent(p0, p1, p2, p3, 0),
    };
  }

  const segLen = lut[lo]! - lut[lo - 1]!;
  const frac = segLen > 0 ? (d - lut[lo - 1]!) / segLen : 0;
  const t = (lo - 1 + frac) / N;

  return {
    position: cubicBezierPoint(p0, p1, p2, p3, t),
    tangent: cubicBezierTangent(p0, p1, p2, p3, t),
  };
}

/**
 * Generate Bezier control points for a turn path through an intersection.
 * @param entry Entry position on the cell edge
 * @param entryDir Tangent direction at entry (inward)
 * @param exit Exit position on the cell edge
 * @param exitDir Tangent direction at exit (outward)
 * @returns [cp1, cp2] — the two inner control points
 */
export function generateTurnControlPoints(
  entry: Point,
  entryDir: Point,
  exit: Point,
  exitDir: Point,
  strength = 0.35,
): [Point, Point] {
  const cp1: Point = {
    x: entry.x + entryDir.x * strength,
    y: entry.y + entryDir.y * strength,
  };
  const cp2: Point = {
    x: exit.x - exitDir.x * strength,
    y: exit.y - exitDir.y * strength,
  };
  return [cp1, cp2];
}
