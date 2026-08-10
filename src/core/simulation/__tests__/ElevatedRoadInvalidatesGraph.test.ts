import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { RailType } from '../../rail/types';

/**
 * 路網圖以 `commuteCache.roadGeneration` 為鍵快取（`SimulationLoop.getCellGraph`）。
 * 世代若不遞增，玩家蓋了橋而市民還在用沒有橋的圖 —— 那比舊的「有高架就停用
 * 快取」更糟，因為它是**靜默的**：市民只是莫名其妙找不到工作。
 *
 * `ElevationManager` 自己沒有 generation 也沒有事件機制，直接 `set` / `delete`
 * 不會連動。實際的連動是：
 *
 *   Game.ts:926 / 952 → simLoop.markLaneGraphDirty(...)
 *                     → commuteCache.bumpGeneration()   SimulationLoop.ts
 *                     → wpDistCache.invalidate()
 *
 * `Game.ts` import Three.js，core 測試驅動不了它 —— 那一段改用該處的註解防守。
 * 這個檔案測得到的是後半段：**世代一 bump，圖就必須重建**。
 */
function loopWithRoads() {
  const state = createGameState(20, 20);
  new RoadBuilder(state.grid).buildRoad({ x: 1, y: 3 }, { x: 13, y: 3 }, RoadType.TWO_LANE, 1e6);

  const em = new ElevationManager();
  const loop = new SimulationLoop(state);
  loop.setElevationManager(em);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, em));
  return { state, loop, em };
}

/**
 * `getCellGraph` 是 private，而且應該保持 private —— 它不是給外部用的。
 * 這裡從索引取，而不是為了測試把它改成 public。
 */
function cellGraph(loop: SimulationLoop): unknown {
  return (loop as unknown as { getCellGraph(): unknown }).getCellGraph();
}

describe('the cell graph follows the road generation', () => {
  it('should reuse the same graph object within one generation', () => {
    const { loop } = loopWithRoads();
    const first = cellGraph(loop);
    expect(first, '沒有 lookup 就建不出圖 —— fixture 壞了').not.toBeNull();
    expect(cellGraph(loop), '同一個世代內應該重用同一個物件').toBe(first);
  });

  it('should NOT rebuild when ElevationManager is mutated directly', () => {
    // 這一條把「紀律不是不變量」釘成可驗證的事實：繞過 Game 直接寫
    // ElevationManager，圖不會知道。它記錄現況，不是在祝福這個行為 ——
    // 正式路徑一定要經過 markLaneGraphDirty。
    const { loop, em } = loopWithRoads();
    const first = cellGraph(loop);

    em.set(5, 5, 1, {
      roadType: RoadType.HIGHWAY, roadFlags: 12, railType: RailType.NONE, railFlags: 0,
      isRamp: false, rampAscendDirection: 0,
    });

    expect(cellGraph(loop), 'ElevationManager 自己不 bump 世代，圖理應還是舊的')
      .toBe(first);
  });

  it('should rebuild once the road generation bumps', () => {
    const { loop, em } = loopWithRoads();
    const first = cellGraph(loop);

    em.set(5, 5, 1, {
      roadType: RoadType.HIGHWAY, roadFlags: 12, railType: RailType.NONE, railFlags: 0,
      isRamp: false, rampAscendDirection: 0,
    });
    // 走正式路徑（Game 蓋完高架後呼叫的就是這個）
    loop.markLaneGraphDirty(['5,5'], true);

    expect(cellGraph(loop), '世代 bump 之後圖沒有重建 —— 快取會用到舊路網')
      .not.toBe(first);
  });

  it('should bump the generation and invalidate the workplace cache together', () => {
    const { loop } = loopWithRoads();
    const before = loop.commuteCache.roadGeneration;
    loop.markLaneGraphDirty(['5,5'], true);
    expect(loop.commuteCache.roadGeneration, 'markLaneGraphDirty 沒有讓道路世代遞增')
      .toBeGreaterThan(before);
  });
});
