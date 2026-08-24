import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState } from '../GameState';
import { WorkplaceDistanceCache } from '../../workplace/WorkplaceDistanceCache';
import { WorkplaceDistanceTableBuilder } from '../../workplace/WorkplaceDistanceTable';

/**
 * `markLaneGraphDirty` receives more than road changes: demolishing a building, rezoning over
 * existing buildings, and rail construction clearing buildings all arrive here.
 *
 * The workplace distance table must react differently to the two classes:
 *
 * - **Roads may have been removed** — a stale table calls unreachable workplaces reachable.
 *   Discard it.
 * - **Roads only added, or untouched** — a stale table can at worst understate (new roads are
 *   not in it yet), which is the safe direction. Keep it, otherwise every demolished factory
 *   costs the player a city-wide synchronous Dijkstra.
 *
 * The criterion is the existing `skipUnreachableCheck`, which says exactly the same thing:
 * new roads only add connectivity and never break it.
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
    // Callers that omit the argument get the conservative behaviour: a new call site that
    // never considers this pays in speed rather than correctness.
    const { loop, cache } = loopWithTable();

    loop.markLaneGraphDirty(['3,3']);

    expect(cache.hasTable).toBe(false);
  });
});
