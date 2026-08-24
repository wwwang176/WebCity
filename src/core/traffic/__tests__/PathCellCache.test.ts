import { describe, it, expect } from 'vitest';
import { PathCellCache } from '../PathCellCache';
import { collectEdgeCells } from '../CommuteCacheHelpers';
import type { LaneEdge } from '../LaneGraph';

/**
 * "Which cells this path passes through" is recomputed for every route on each congestion flow
 * pass.
 *
 * Measured on a player save (population 12,351): 4,505,318 edges walked every 60 ticks to fill
 * a flow map with 314 keys, in a city with only 284 road cells. 292ms in a single tick
 * (BUG-327).
 *
 * The answer depends only on the **path**: roads do not move, and today's congestion does not
 * change which cells a path crosses. Commute routes are shared (the route pool hands the same
 * array to every citizen on that trip), so computing it once is enough.
 */

/** cellKeys run `0,0` `1,0` `2,0` …; `vias[i]` gives edge i a viaCellKey. */
function path(count: number, vias: Record<number, string> = {}): LaneEdge[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    from: {
      id: `p${i}`, cellKey: `${i},0`, position: { x: i, y: 0 },
      lane: 0, direction: 'east' as const, type: 'exit' as const, tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: `p${i + 1}`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
      lane: 0, direction: 'east' as const, type: 'entry' as const, tangent: { tx: 1, ty: 0 },
    },
    length: 1, type: 'straight' as const,
    ...(vias[i] !== undefined ? { viaCellKey: vias[i] } : {}),
  })) as LaneEdge[];
}

describe('這條路徑經過哪些格子', () => {
  it('should agree with walking the edges every time', () => {
    // The cache exists to save time, not to give a different answer. Compared against
    // collectEdgeCells directly.
    const cache = new PathCellCache();
    for (const p of [path(1), path(4), path(12, { 2: '99,9' })]) {
      const got = [...cache.cellsOf(p)].sort();
      const want = [...collectEdgeCells(p)].sort();
      expect(got, `${p.length} 條邊的路徑算出來的格子不一樣`).toEqual(want);
    }
  });

  it('should include the via cell of a turn edge', () => {
    // A junction's turn edge goes from cell A into cell C across cell B. Dropping the via cell
    // removes every turning citizen from that cell's flow, and junctions are exactly where
    // congestion forms.
    const cache = new PathCellCache();
    expect(cache.cellsOf(path(2, { 0: 'via,7' })), 'via 格子沒有被算進去')
      .toContain('via,7');
  });

  it('should count a cell once no matter how often the path touches it', () => {
    // Adjacent edges share an endpoint cell. Adding per edge counts every interior cell twice,
    // once from each side, doubling the flow along the middle of the route.
    const cache = new PathCellCache();
    const cells = cache.cellsOf(path(3));
    expect(new Set(cells).size, '同一格出現了不只一次').toBe(cells.length);
    expect(cells.length).toBe(4);
  });

  it('should hand back the very same array for a path it has seen', () => {
    // The point of the whole class. Returning an equal but freshly built array each time is no
    // cache at all, and every "same answer" assertion still passes.
    const cache = new PathCellCache();
    const p = path(6);
    expect(cache.cellsOf(p), '第二次呼叫又重算了一遍').toBe(cache.cellsOf(p));
  });

  it('should keep different paths apart even when they look alike', () => {
    // Two equal but distinct arrays are two routes. Sharing one entry makes an in-place edit to
    // either one corrupt the other.
    const cache = new PathCellCache();
    const a = path(3);
    const b = path(3);
    expect(cache.cellsOf(a)).not.toBe(cache.cellsOf(b));
    expect([...cache.cellsOf(a)]).toEqual([...cache.cellsOf(b)]);
  });

  it('should say nothing about an empty path', () => {
    expect(new PathCellCache().cellsOf([])).toEqual([]);
  });

  it('should walk each path exactly once however often it is asked', () => {
    // This number is the saving. The output is always identical, so this is the only place the
    // cache's work is visible.
    const cache = new PathCellCache();
    const a = path(5);
    const b = path(3);
    for (let i = 0; i < 10; i++) { cache.cellsOf(a); cache.cellsOf(b); }
    expect(cache.derivations, '同一條路徑被重新走了不只一次').toBe(2);
  });
});
