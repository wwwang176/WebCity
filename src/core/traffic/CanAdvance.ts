import { parsePosKeyUnsafe } from '../grid/GridHelpers';

/** Minimal traffic-light interface (DIP — keeps this module free of Game/Three.js). */
export interface SignalLookup {
  canPass(cx: number, cy: number, nx: number, ny: number): boolean;
}

/** Minimal level-crossing interface. */
export interface CrossingLookup {
  isCrossingBlocked(x: number, y: number): boolean;
}

/**
 * Decide whether a vehicle may move from `cur` to `next` along one lane edge.
 *
 * `via` is the intersection a cross-intersection turn edge skips over. Such an
 * edge jumps straight from the approach cell to the departure cell, so the
 * signalled cell appears in neither `cur` nor `next` — checking only those two
 * asks about plain road tiles and lets turning traffic run red lights and
 * closed rail barriers (BUG-058).
 *
 * This used to live in Game.ts, which imports Three.js and is therefore
 * untestable; it reconstructed the skipped cell from the midpoint of cur/next
 * and guarded on `Number.isInteger`. Every generated turn is perpendicular
 * (the generator rejects same-direction and opposite-direction pairs), so the
 * midpoint is always X.5 and that guard was false for 100% of the edges it
 * targeted.
 */
export function canAdvanceThrough(
  lights: SignalLookup,
  crossings: CrossingLookup,
  cur: string,
  next: string,
  via?: string,
): boolean {
  const c = parsePosKeyUnsafe(cur);
  const n = parsePosKeyUnsafe(next);

  if (via !== undefined) {
    const v = parsePosKeyUnsafe(via);
    if (!lights.canPass(c.x, c.y, v.x, v.y)) return false;
    if (crossings.isCrossingBlocked(v.x, v.y)) return false;
  }

  if (!lights.canPass(c.x, c.y, n.x, n.y)) return false;
  if (crossings.isCrossingBlocked(n.x, n.y)) return false;
  return true;
}
