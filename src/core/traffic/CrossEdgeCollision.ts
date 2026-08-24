import type { SpatialEntry } from './SpatialHash';

/** Tuning constants for cross-edge spatial collision. */
export const CROSS_EDGE = {
  /** Max distance to search for nearby vehicles. */
  CHECK_RADIUS: 2.0,
  /** AABB scale factor (1.1 = 10% safety margin around vehicle body). */
  AABB_SCALE: 1.1,
} as const;

/**
 * Find the gap to the nearest vehicle ahead that is on a DIFFERENT edge
 * but physically close enough to block this vehicle's path.
 *
 * Uses vehicle body dimensions (length × width) scaled by AABB_SCALE
 * to detect cross-edge merge conflicts at intersections.
 *
 * @param siblings vehicles whose end connection point matches `me`'s, including `me` itself.
 *
 * What is passed in is **a group already partitioned by end point**, not every nearby vehicle.
 * The only relationship this code cares about is whether two vehicles merge into the same
 * point, and that is a lookupable grouping. Pulling every vehicle within radius 2.0 from a
 * per-cell spatial hash and discarding them one by one measured 68.6ms per tick on a
 * 12,365-citizen save, with over nine tenths failing the first condition.
 *
 * The radius still applies, as a distance computed inside the loop: a vehicle sharing an end
 * point but still two cells away is not blocking.
 *
 * Returns Infinity if no cross-edge blocker is found.
 */
export function findCrossEdgeGap(
  me: SpatialEntry,
  siblings: readonly SpatialEntry[],
): number {
  let minGap = Infinity;
  const r2 = CROSS_EDGE.CHECK_RADIUS * CROSS_EDGE.CHECK_RADIUS;

  for (let i = 0; i < siblings.length; i++) {
    const other = siblings[i]!;
    // Skip self
    if (other.vid === me.vid) continue;
    // Skip vehicles on the same edge (already handled by findGapAhead)
    if (other.edgeId === me.edgeId) continue;
    // The grouping is by end point already, but a caller feeding entries in directly need not
    // honour that.
    if (other.toId !== me.toId) continue;
    // Too far away to block. Same meaning as the spatial hash's query radius.
    {
      const ddx = other.x - me.x;
      const ddy = other.y - me.y;
      if (ddx * ddx + ddy * ddy > r2) continue;
    }
    // Higher progress ratio = closer to merge point = priority to go first.
    // Tiebreaker: lower ID goes first.
    if (me.progressRatio > other.progressRatio) continue;
    if (me.progressRatio === other.progressRatio && me.vid < other.vid) continue;

    // Relative position of other vehicle from me
    const dx = other.x - me.x;
    const dy = other.y - me.y;

    // Project onto my heading direction (forward distance)
    const forward = dx * me.hx + dy * me.hy;
    // Only care about vehicles ahead
    if (forward <= 0) continue;

    // Project onto my perpendicular (lateral distance)
    // Perpendicular = (-hy, hx)
    const lateral = Math.abs(-me.hy * dx + me.hx * dy);
    // Skip if combined half-widths (scaled) don't overlap laterally
    const lateralThreshold = (me.halfWidth + other.halfWidth) * CROSS_EDGE.AABB_SCALE;
    if (lateral > lateralThreshold) continue;

    // Gap = forward distance minus combined half-lengths (scaled)
    const gap = forward - (me.halfLen + other.halfLen) * CROSS_EDGE.AABB_SCALE;
    if (gap < minGap) minGap = gap;
  }

  return minGap;
}
