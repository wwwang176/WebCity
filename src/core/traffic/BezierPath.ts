type Point = { x: number; y: number };

/** Evaluate quadratic Bezier at parameter t ∈ [0,1] */
export function quadraticBezierPoint(p0: Point, cp: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * cp.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * cp.y + t * t * p2.y,
  };
}

/** Evaluate quadratic Bezier first derivative (tangent) at parameter t */
export function quadraticBezierTangent(p0: Point, cp: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: 2 * u * (cp.x - p0.x) + 2 * t * (p2.x - cp.x),
    y: 2 * u * (cp.y - p0.y) + 2 * t * (p2.y - cp.y),
  };
}

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
 * Compute the single quadratic Bezier control point for a turn,
 * placed at the intersection of the entry tangent line and exit tangent line.
 * This produces a quarter-circle-like arc for 90° turns.
 */
export function computeTurnControlPoint(
  entry: Point,
  entryDir: Point,
  exit: Point,
  exitDir: Point,
): Point {
  // Solve: entry + t * entryDir = exit - s * exitDir
  // t * entryDir.x + s * exitDir.x = exit.x - entry.x
  // t * entryDir.y + s * exitDir.y = exit.y - entry.y
  const det = entryDir.x * exitDir.y - entryDir.y * exitDir.x;
  if (Math.abs(det) < 1e-6) {
    // Parallel (straight-through): use midpoint
    return { x: (entry.x + exit.x) / 2, y: (entry.y + exit.y) / 2 };
  }
  const dx = exit.x - entry.x;
  const dy = exit.y - entry.y;
  const t = (dx * exitDir.y - dy * exitDir.x) / det;
  return { x: entry.x + t * entryDir.x, y: entry.y + t * entryDir.y };
}
