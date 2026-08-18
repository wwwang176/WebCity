import type { SpatialEntry } from './SpatialHash';
import type { SpatialHash } from './SpatialHash';

/** Tuning constants for cross-edge spatial collision. */
export const CROSS_EDGE = {
  /** Spatial hash cell size (world units). */
  CELL_SIZE: 1.0,
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
 * @param scratch — reusable array for queryNearbyInto (avoids per-call allocation)
 * Returns Infinity if no cross-edge blocker is found.
 */
export function findCrossEdgeGap(
  me: SpatialEntry,
  spatialHash: SpatialHash<SpatialEntry>,
  scratch: SpatialEntry[],
): number {
  spatialHash.queryNearbyInto(me.x, me.y, CROSS_EDGE.CHECK_RADIUS, scratch);
  let minGap = Infinity;

  for (let i = 0; i < scratch.length; i++) {
    const other = scratch[i]!;
    // Skip self
    if (other.vid === me.vid) continue;
    // Skip vehicles on the same edge (already handled by findGapAhead)
    if (other.edgeId === me.edgeId) continue;
    // Only check vehicles on merge-sibling edges (same destination ConnectionPoint)
    if (other.toId !== me.toId) continue;
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
