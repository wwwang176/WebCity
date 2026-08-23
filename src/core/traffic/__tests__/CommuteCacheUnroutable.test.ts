import { describe, it, expect } from 'vitest';
import { CommuteCache } from '../CommuteCache';
import type { LaneEdge } from '../LaneGraph';

/**
 * 「這條通勤路線沒有路」也是一個答案，而且跟「還沒算出來」不一樣。
 *
 * 舊版沒有地方記它:worker 回傳空陣列時 `onResult` 直接 return，於是重試計數
 * 一路長上去，超過額度之後每一輪都在主執行緒重算一次同一條算不出來的路。
 * 41k 存檔實測 3 362 條這樣的路線、白算 9 838 次同步 A*，成功 0 次（BUG-369）。
 *
 * 它跟 `routeIndex` 同一個生命週期 —— 路網一動，兩份都不算數了。
 */

/** 一條假的車道邊，只要能被 `collectEdgeCells` 走過就好。 */
function edge(cellKey: string): LaneEdge {
  const pt = (id: string) => ({
    id, position: { x: 0, y: 0 }, tangent: { tx: 1, ty: 0 },
    cellKey, lane: 0, direction: 'east' as const, type: 'exit' as const,
  });
  return { id: `e-${cellKey}`, from: pt(`${cellKey}:x`), to: pt(`${cellKey}:y`), length: 1, type: 'straight' };
}

describe('走不通的通勤路線', () => {
  it('should not claim a route is unroutable before anyone said so', () => {
    expect(new CommuteCache().isUnroutable('1,1->9,9')).toBe(false);
  });

  it('should remember that a route has no path', () => {
    const cc = new CommuteCache();
    cc.markUnroutable('1,1->9,9');

    expect(cc.isUnroutable('1,1->9,9')).toBe(true);
    expect(cc.isUnroutable('9,9->1,1'), '兩個方向被當成同一條').toBe(false);
  });

  it('should forget it when the road network changes', () => {
    // 蓋一條新路就可能接通。忘不掉的話，那條通勤永遠不會再被算一次。
    const cc = new CommuteCache();
    cc.markUnroutable('1,1->9,9');

    cc.bumpGeneration();

    expect(cc.isUnroutable('1,1->9,9'), '路網變了還記著舊答案').toBe(false);
  });

  it('should forget it when the route turns out to have a path after all', () => {
    // 兩份記錄講相反的話是最難查的一種壞法。存進路線就代表那條路存在。
    const cc = new CommuteCache();
    cc.markUnroutable('1,1->9,9');

    cc.setRouteVariants('1,1->9,9', [[edge('5,5')]]);

    expect(cc.isUnroutable('1,1->9,9'), '路線池裡有路，卻同時說它走不通').toBe(false);
    expect(cc.getRouteVariants('1,1->9,9')).toHaveLength(1);
  });

  it('should keep the mark when an empty variant list is stored', () => {
    // 空的變體清單不是「有路」。它是同一件事換個講法。
    const cc = new CommuteCache();
    cc.markUnroutable('1,1->9,9');

    cc.setRouteVariants('1,1->9,9', []);

    expect(cc.isUnroutable('1,1->9,9')).toBe(true);
  });
});
