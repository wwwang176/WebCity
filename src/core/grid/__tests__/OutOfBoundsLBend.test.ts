import { describe, it, expect } from 'vitest';
import { extractOutOfBoundsEdge } from '../EdgeUtils';
import { getLShapedPath } from '../GridHelpers';

/**
 * extractOutOfBoundsEdge assumed exactly one trailing cell lies outside the map
 * and returned `path.length - 1` unconditionally.
 *
 * GridCursor clamps the cursor to a one-cell border ring, so a drag to x = -1 is
 * legal and reachable. But getLShapedPath walks one axis first: dragging
 * diagonally to (-1, 3) produces a horizontal leg out to x = -1 and then a whole
 * VERTICAL leg that stays at x = -1. Trimming a single cell still left
 * out-of-bounds cells in the path, validateRoadPath returned OUT_OF_BOUNDS, and
 * the entire build was rejected — so any non-axis-aligned drag to the border
 * ring failed. The outward flag was computed from the last two cells of that
 * vertical leg too, giving NORTH/SOUTH where the exit is WEST (BUG-098).
 */
describe('extractOutOfBoundsEdge trims the whole out-of-bounds tail', () => {
  const W = 20, H = 20;

  it('should trim a single trailing cell as before', () => {
    const path = getLShapedPath({ x: 5, y: 5 }, { x: -1, y: 5 });
    const edge = extractOutOfBoundsEdge(path, W, H)!;

    expect(edge.truncatedLength).toBe(path.length - 1);
    expect(path.slice(0, edge.truncatedLength).every(p => p.x >= 0 && p.x < W)).toBe(true);
  });

  it('should leave no out-of-bounds cell after a diagonal drag to the border ring', () => {
    const path = getLShapedPath({ x: 5, y: 5 }, { x: -1, y: 3 });
    const edge = extractOutOfBoundsEdge(path, W, H)!;

    const kept = path.slice(0, edge.truncatedLength);
    expect(kept.length).toBeGreaterThan(0);
    for (const p of kept) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(H);
    }
  });

  it('should report the direction the path actually leaves the map', () => {
    const WEST = 0b0100;
    const path = getLShapedPath({ x: 5, y: 5 }, { x: -1, y: 3 });
    const edge = extractOutOfBoundsEdge(path, W, H)!;

    expect(edge.outwardFlag).toBe(WEST);
  });

  it('should return null for a path entirely inside the map', () => {
    const path = getLShapedPath({ x: 5, y: 5 }, { x: 9, y: 9 });
    expect(extractOutOfBoundsEdge(path, W, H)).toBeNull();
  });

  it('should handle leaving via the south edge', () => {
    const SOUTH = 0b0010;
    const path = getLShapedPath({ x: 5, y: 5 }, { x: 7, y: H });
    const edge = extractOutOfBoundsEdge(path, W, H)!;

    expect(edge.outwardFlag).toBe(SOUTH);
    expect(path.slice(0, edge.truncatedLength).every(p => p.y >= 0 && p.y < H)).toBe(true);
  });
});
