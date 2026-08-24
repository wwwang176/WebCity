import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import type { PathCellCache } from '../../traffic/PathCellCache';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';

/**
 * The congestion flow field is recomputed every 60 ticks. Which cells a path passes through
 * cannot change between recomputes — roads do not move on their own — so that answer is shared
 * across them.
 *
 * Measured on a 12,351-citizen save: one recompute walked 4,505,318 edges, 292ms in a single
 * tick, felt by the player as half a second of stutter every 15 seconds (BUG-327).
 *
 * **The output cannot show this**: rebuilding the cache each time produces an identical flow
 * field. What is measured here is how many paths were actually walked.
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
