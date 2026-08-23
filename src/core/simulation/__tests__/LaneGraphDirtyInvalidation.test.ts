import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState } from '../GameState';
import { WorkplaceDistanceCache } from '../../workplace/WorkplaceDistanceCache';
import { WorkplaceDistanceTableBuilder } from '../../workplace/WorkplaceDistanceTable';

/**
 * `markLaneGraphDirty` 收的不只是道路變更 —— 純拆建築、在已有建築的地上重劃分區、
 * 鐵軌施工順手清掉建築，都會走進來。
 *
 * 工作距離表對這兩類的反應必須不同:
 *
 * - **可能拿掉路** → 舊表會把已經到不了的工作地說成到得了。丟掉。
 * - **只加路，或根本沒動路** → 舊表最多只是少報（新路還沒進表），那是安全的方向。
 *   續用，不然玩家每鏟掉一棟工廠就換來一次全城同步 Dijkstra。
 *
 * 判準用的是既有的 `skipUnreachableCheck` —— 它講的正好是同一件事
 * （「新蓋的路只會增加連通性，不會弄斷」）。
 */
const W = 12, H = 12;

function loopWithTable(): { loop: SimulationLoop; cache: WorkplaceDistanceCache } {
  const state = createGameState(W, H);
  const loop = new SimulationLoop(state);
  const cache = new WorkplaceDistanceCache();
  const b = new WorkplaceDistanceTableBuilder(W, H);
  const dense = new Int32Array(W * H).fill(-1);
  dense[3 * W + 3] = 36;
  b.addWorkplace('5,5', dense);
  cache.populateSync(b.build());
  loop.setWorkplaceDistanceCache(cache);
  return { loop, cache };
}

describe('路網變更與建築變更對距離表的影響不同', () => {
  it('should keep the table when nothing could have been unlinked', () => {
    const { loop, cache } = loopWithTable();

    loop.markLaneGraphDirty(['3,3'], true);

    expect(cache.hasTable, '只拆了建築卻把距離表丟了').toBe(true);
    expect(cache.getDistance('3,3', '5,5')).toBe(36);
    expect(cache.isReady, '表還在，但不該再算「當前」').toBe(false);
  });

  it('should drop the table when roads may have been removed', () => {
    const { loop, cache } = loopWithTable();

    loop.markLaneGraphDirty(['3,3'], false);

    expect(cache.hasTable, '路可能被拆了還在拿舊的可達性指派工作').toBe(false);
    expect(cache.getDistance('3,3', '5,5')).toBeUndefined();
  });

  it('should default to dropping the table', () => {
    // 省略參數的呼叫端拿到的是保守的那一種 —— 新的呼叫路徑若忘了想這件事，
    // 代價是慢一點，不是錯。
    const { loop, cache } = loopWithTable();

    loop.markLaneGraphDirty(['3,3']);

    expect(cache.hasTable).toBe(false);
  });
});
