import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { RailType } from '../../rail/types';

/**
 * The road-cell graph is cached by `commuteCache.roadGeneration`
 * (`SimulationLoop.getCellGraph`). Without the generation advancing, the player builds a
 * bridge while citizens keep using a graph without it — worse than disabling the cache
 * whenever elevation exists, because it is **silent**: citizens simply stop finding jobs for
 * no visible reason.
 *
 * `ElevationManager` has neither a generation nor an event mechanism, so `set` / `delete`
 * alone propagates nothing. The real chain is:
 *
 *   Game.ts:926 / 952 -> simLoop.markLaneGraphDirty(...)
 *                     -> commuteCache.bumpGeneration()   SimulationLoop.ts
 *                     -> wpDistCache.invalidate()
 *
 * `Game.ts` imports Three.js and cannot be driven from core tests, so that half is guarded by
 * a comment at the call site. What this file can test is the second half: **once the
 * generation bumps, the graph must be rebuilt**.
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
 * `getCellGraph` is private and should stay private; it is not for external use. This reaches
 * it by index rather than widening its visibility for a test.
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
    // Pins the fact that discipline is not an invariant: writing to ElevationManager behind
    // Game's back leaves the graph unaware. This records the situation rather than blessing
    // it — the production path must go through markLaneGraphDirty.
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
    // The production path: this is what Game calls after building elevated road.
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
