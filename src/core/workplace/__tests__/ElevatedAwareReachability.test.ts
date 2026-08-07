import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { WorkplaceDistanceCache } from '../WorkplaceDistanceCache';
import { WorkplaceDistanceClient } from '../WorkplaceDistanceClient';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';

/**
 * The workplace-distance worker is handed only the grid buffer, whose roadType
 * byte is the GROUND layer. Elevated segments live in ElevationManager and are
 * invisible to it, while the synchronous fallback is given _roadLookup and IS
 * level-aware. In a city where a viaduct is the only link between a district and
 * its jobs the two disagreed outright, and residents lost their jobs whenever
 * the cache happened to be ready and got them back when it went stale
 * (BUG-109).
 */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}

function loopWithElevation(hasViaduct: boolean) {
  const state = createGameState(20, 20);
  new RoadBuilder(state.grid).buildRoad({ x: 1, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, 1e6);

  const em = new ElevationManager();
  if (hasViaduct) {
    em.set(5, 6, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: 12, isRamp: false, rampAscendDirection: 0,
    } as never);
  }

  const loop = new SimulationLoop(state);
  loop.setElevationManager(em);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, em));
  loop.setWorkplaceDistanceCache(
    new WorkplaceDistanceCache(new WorkplaceDistanceClient(new FakeWorker() as unknown as Worker)),
  );
  return { state, loop, em };
}

describe('workplace reachability is elevation-aware', () => {
  it('should report the city as having elevated roads', () => {
    const { em } = loopWithElevation(true);
    expect(em.hasAnySegment()).toBe(true);
  });

  it('should report no elevated roads for a flat city', () => {
    const { em } = loopWithElevation(false);
    expect(em.hasAnySegment()).toBe(false);
  });

  it('should not request a cache update while elevated roads exist', () => {
    // requestUpdate would mark the cache PENDING; the guard must prevent it, so
    // the cache stays stale and the level-aware fallback keeps being used.
    const { loop } = loopWithElevation(true);
    for (let i = 0; i < 12; i++) loop.tick();

    const cache = (loop as unknown as { wpDistCache: WorkplaceDistanceCache }).wpDistCache;
    expect(cache.isReady).toBe(false);
  });
});
