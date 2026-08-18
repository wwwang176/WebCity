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
 * @param siblings — 終點連接點跟 `me` 相同的那些車（含 `me` 自己）。
 *
 * 傳進來的是**已經照終點分好的一組**，不是附近所有的車。這段程式唯一在意的關係
 * 就是「會不會匯進同一個點」，而那是查得出來的分組;原本用逐格的空間雜湊撈半徑
 * 2.0 內的所有車再一台一台丟掉，12 365 人的存檔實測每個 tick 68.6ms —— 撈回來的
 * 有九成以上第一個條件就被刷掉。
 *
 * 半徑仍然要判，只是改成在迴圈裡算距離:一台同終點但還在兩格外的車不算擋路。
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
    // 分組本身就是照終點分的，但直接餵進來的呼叫者不一定守這件事。
    if (other.toId !== me.toId) continue;
    // 太遠的不算擋路。原本是空間雜湊的查詢半徑，語意一樣。
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
