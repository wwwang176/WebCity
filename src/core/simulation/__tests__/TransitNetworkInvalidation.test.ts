import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';

/**
 * transferGraphDirty had exactly one setter, inside markLaneGraphDirty — which
 * only fires for road, rail, demolish and rezone edits. Creating, deleting or
 * re-vehicling a transit route, and placing a transit stop, set nothing.
 *
 * So a newly created line did not enter the transfer graph until the player
 * next happened to touch a road (no multi-leg trip would ever route through
 * it), and a deleted line stayed in flatRoutes, where the rider accounting kept
 * crediting dailyRiders to stops of a route that no longer exists.
 *
 * docs/transfer-system.md already documents the intended behaviour: "rebuild
 * when transit routes change" (BUG-090).
 */
describe('transit network edits invalidate the transfer graph', () => {
  it('should mark the transfer graph dirty when a route is created', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    loop.clearTransferGraphDirty();
    expect(loop.isTransferGraphDirty()).toBe(false);

    const a = state.bus.addStop(2, 2);
    const b = state.bus.addStop(8, 2);
    state.bus.createRoute([a, b], 1);
    loop.markTransitNetworkDirty();

    expect(loop.isTransferGraphDirty()).toBe(true);
  });

  it('should not clear the lane graph when only transit changed', () => {
    // Transit edits must not drag the whole lane graph, commute cache and
    // workplace-distance cache with them — that is a far more expensive
    // invalidation than the transfer graph needs.
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    loop.clearTransferGraphDirty();
    const generationBefore = loop.commuteCache.roadGeneration;

    loop.markTransitNetworkDirty();

    expect(loop.commuteCache.roadGeneration).toBe(generationBefore);
  });

  it('should still mark it dirty for road edits', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    loop.clearTransferGraphDirty();

    loop.markLaneGraphDirty();

    expect(loop.isTransferGraphDirty()).toBe(true);
  });
});
