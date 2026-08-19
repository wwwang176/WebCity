import { describe, it, expect } from 'vitest';
import { PathCellCache } from '../PathCellCache';
import { collectEdgeCells } from '../CommuteCacheHelpers';
import type { LaneEdge } from '../LaneGraph';

/**
 * 「這條路徑經過哪些格子」在壅塞流量重算時，每條路線都要算一次。
 *
 * 玩家存檔實測（人口 12 351）:每 60 tick 走過 4 505 318 條邊，去填一張只有 314 個
 * 鍵的流量圖 —— 整座城市只有 284 格路。292ms 落在單一個 tick 上（BUG-327）。
 *
 * 這個答案只跟**路徑**有關:路不會自己動，今天塞不塞也不影響它經過哪些格子。
 * 而通勤路線是共用的（路線池把同一個陣列交給每個走這條路的人），所以算一次就夠。
 */

/** cellKey 依序為 `0,0` `1,0` `2,0` …，`vias[i]` 給第 i 條邊一個 viaCellKey。 */
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
    // 快取存在的意義是省時間，不是給不一樣的答案。這裡直接對 collectEdgeCells。
    const cache = new PathCellCache();
    for (const p of [path(1), path(4), path(12, { 2: '99,9' })]) {
      const got = [...cache.cellsOf(p)].sort();
      const want = [...collectEdgeCells(p)].sort();
      expect(got, `${p.length} 條邊的路徑算出來的格子不一樣`).toEqual(want);
    }
  });

  it('should include the via cell of a turn edge', () => {
    // 路口的轉向邊從 A 格轉進 C 格，中間壓過 B 格。漏掉 via 的話，路口那一格
    // 的流量會憑空少掉所有轉彎的人 —— 而路口正是最容易塞的地方。
    const cache = new PathCellCache();
    expect(cache.cellsOf(path(2, { 0: 'via,7' })), 'via 格子沒有被算進去')
      .toContain('via,7');
  });

  it('should count a cell once no matter how often the path touches it', () => {
    // 相鄰兩條邊共用一個端點格。逐邊硬加的話，中間每一格都會被算兩次，
    // 兩端各一次 —— 路線中段的流量會整整多一倍。
    const cache = new PathCellCache();
    const cells = cache.cellsOf(path(3));
    expect(new Set(cells).size, '同一格出現了不只一次').toBe(cells.length);
    expect(cells.length).toBe(4);
  });

  it('should hand back the very same array for a path it has seen', () => {
    // 這是整件事的重點。回傳內容相同但每次新建的陣列，等於沒有快取 ——
    // 而所有「答案一樣」的斷言都還是會綠。
    const cache = new PathCellCache();
    const p = path(6);
    expect(cache.cellsOf(p), '第二次呼叫又重算了一遍').toBe(cache.cellsOf(p));
  });

  it('should keep different paths apart even when they look alike', () => {
    // 兩個內容相同但不同實例的陣列是兩條路線。共用一份的話，其中一條被就地
    // 改動時另一條會跟著錯。
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
    // 省下來的時間就是這個數字。輸出永遠一樣，所以只有這裡看得到快取有沒有在工作。
    const cache = new PathCellCache();
    const a = path(5);
    const b = path(3);
    for (let i = 0; i < 10; i++) { cache.cellsOf(a); cache.cellsOf(b); }
    expect(cache.derivations, '同一條路徑被重新走了不只一次').toBe(2);
  });
});
