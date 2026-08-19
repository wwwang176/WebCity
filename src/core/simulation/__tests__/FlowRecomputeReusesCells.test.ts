import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import type { PathCellCache } from '../../traffic/PathCellCache';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';

/**
 * 壅塞流量圖每 60 tick 重算一次。「這條路徑經過哪些格子」在重算之間不會變 ——
 * 路不會自己動 —— 所以那份答案必須跨重算共用。
 *
 * 玩家存檔實測（人口 12 351）:一次重算走過 4 505 318 條邊，292ms 全部落在單一個
 * tick 上，玩家感覺到的就是每 15 秒卡半秒（BUG-327）。
 *
 * 這件事**看輸出看不出來** —— 每次重新建一份快取，算出來的流量圖一模一樣。
 * 所以這裡看的是「總共真的走過幾條路徑」。
 */

type Inner = {
  flowCellCache: PathCellCache;
  computeCongestionFlow(): void;
};

describe('流量重算共用同一份格子清單', () => {
  it('should not walk the same route again on the next recompute', () => {
    const state = createGameState(20, 20);
    for (let x = 0; x < 6; x++) {
      state.grid.setCell(x, 0, {
        roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
      });
    }
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as Inner;

    const path = [makeCellEdge('0,0', '1,0', 0, { length: 1 }), makeCellEdge('1,0', '2,0', 0, { length: 1 })];
    loop.commuteCache.setRouteVariants('0,0->2,0', [path]);
    loop.commuteCache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '2,0',
      morningPath: path, eveningPath: null, status: 'ready', generation: 0,
    });

    inner.computeCongestionFlow();
    const afterFirst = inner.flowCellCache.derivations;
    expect(afterFirst, '前置條件:第一次重算要真的走過這條路線').toBeGreaterThan(0);

    inner.computeCongestionFlow();
    inner.computeCongestionFlow();
    expect(inner.flowCellCache.derivations, '同一條路線在後續重算又被走了一次')
      .toBe(afterFirst);
  });
});
