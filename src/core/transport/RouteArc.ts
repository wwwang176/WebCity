/**
 * Geometry of the connecting lines drawn between route stops.
 *
 * Pure logic: must not import Three.js.
 *
 * Each hop arcs into a parabola. Straight connectors smear together on a dense network —
 * two routes sharing a stretch overlap exactly, so it is impossible to tell which one
 * serves which stop. Arcing gives every hop its own curve and makes hop length readable.
 */

/** A point in world space. `z` corresponds to the grid's `y`, the top-down axis. */
export interface ArcPoint {
  x: number;
  y: number;
  z: number;
}

/** A stop in grid coordinates. */
export interface StopPos {
  x: number;
  y: number;
}

export const ARC = {
  /**
   * Arc height as a fraction of hop length. Purely cosmetic: too small and the curve is
   * not visible, too large and it hides the city beneath.
   */
  RISE_RATIO: 0.48,
  /**
   * Upper bound on arc height, in tiles. A hop spanning the city would otherwise arc out
   * of frame, and what the player needs to read is which stops the line serves.
   */
  RISE_MAX: 6.0,
  /** Samples per tile. Too few and the arc looks like a polyline. */
  SEGMENTS_PER_CELL: 2,
  /** Segment bounds per hop: close stops still need to look round, city-wide hops do not
   *  need unlimited subdivision. */
  SEGMENTS_MIN: 8,
  SEGMENTS_MAX: 32,
} as const;

/** Arc height for this hop. */
function riseFor(distance: number): number {
  return Math.min(ARC.RISE_MAX, distance * ARC.RISE_RATIO);
}

/** Segment count for this hop. */
function segmentsFor(distance: number): number {
  const wanted = Math.round(distance * ARC.SEGMENTS_PER_CELL);
  return Math.max(ARC.SEGMENTS_MIN, Math.min(ARC.SEGMENTS_MAX, wanted));
}

/**
 * Sample points of one hop, both endpoints included.
 *
 * The arc rises **vertically only**: the horizontal projection stays the straight
 * from->to line, otherwise the line would bend around unrelated blocks. Height uses
 * `4h*t*(1-t)`, the parabola that is 0 at both ends and h at the midpoint.
 */
export function sampleRouteArc(from: StopPos, to: StopPos, baseY: number): ArcPoint[] {
  const dx = to.x - from.x;
  const dz = to.y - from.y;
  const distance = Math.hypot(dx, dz);
  const rise = riseFor(distance);
  const segments = segmentsFor(distance);

  const points: ArcPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({
      x: from.x + dx * t,
      y: baseY + rise * 4 * t * (1 - t),
      z: from.y + dz * t,
    });
  }
  return points;
}

/**
 * Polyline for a whole route: every hop sampled, closing back on the first stop.
 *
 * Joins keep a single copy of each shared point. Every hop samples its own start, so
 * concatenating directly would repeat the intermediate stop and break the dash cadence at
 * every stop.
 */
export function buildRoutePolyline(stops: readonly StopPos[], baseY: number): ArcPoint[] {
  if (stops.length < 2) return [];

  const points: ArcPoint[] = [];
  for (let i = 0; i < stops.length; i++) {
    const from = stops[i]!;
    const to = stops[(i + 1) % stops.length]!;
    const hop = sampleRouteArc(from, to, baseY);
    // The last point belongs to the next hop's start; the closing hop keeps it so the loop
    // actually closes.
    const end = i === stops.length - 1 ? hop.length : hop.length - 1;
    for (let j = 0; j < end; j++) points.push(hop[j]!);
  }
  return points;
}
