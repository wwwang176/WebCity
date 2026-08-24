import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import type { LaneEdge } from '../../traffic/LaneGraph';

/**
 * `RouteCongestion` is a pure function with thorough tests of its own; whether the simulation
 * actually asks it is a separate question. With the wiring broken (falling back to the city
 * average, or passing a constant), none of those pure-function tests turns red.
 *
 * These feed in a per-cell flow field and two routes directly: one through a saturated
 * corridor, one down an empty lane. The two must report different congestion.
 */

/** A path along +x passing through `cells`. */
function pathThrough(cells: string[]): LaneEdge[] {
  return cells.slice(0, -1).map((from, i) => {
    const to = cells[i + 1]!;
    return {
      id: `${from}->${to}`,
      from: {
        id: `${from}_x`, cellKey: from, position: { x: i, y: 0 },
        lane: 0, direction: 'east' as const, type: 'exit' as const, tangent: { tx: 1, ty: 0 },
      },
      to: {
        id: `${to}_n`, cellKey: to, position: { x: i + 1, y: 0 },
        lane: 0, direction: 'east' as const, type: 'entry' as const, tangent: { tx: 1, ty: 0 },
      },
      length: 1.0, type: 'straight' as const,
    };
  });
}

type Inner = {
  cityCongestionLevel: number;
  congestionFor(a: { x: number; y: number }, b: { x: number; y: number }): number;
};

function setup() {
  const state = createGameState(20, 20);
  for (let x = 0; x < 10; x++) {
    state.grid.setCell(x, 0, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  const loop = new SimulationLoop(state);
  const inner = loop as unknown as Inner;
  return { state, loop, inner };
}

describe('模擬真的去問逐路線的壅塞', () => {
  it('should give a busy corridor a higher number than a quiet lane', () => {
    const { state, loop, inner } = setup();

    // A saturated corridor against an empty lane. The unit is how many citizens' commute
    // routes pass through the cell.
    state.traffic.updatePredictedFlow(new Map([
      ['1,0', 12000], ['2,0', 12000], ['3,0', 12000],
      ['7,0', 0], ['8,0', 0], ['9,0', 0],
    ]));
    loop.commuteCache.setRouteVariants('1,0->3,0', [pathThrough(['1,0', '2,0', '3,0'])]);
    loop.commuteCache.setRouteVariants('7,0->9,0', [pathThrough(['7,0', '8,0', '9,0'])]);

    const busy = inner.congestionFor({ x: 1, y: 0 }, { x: 3, y: 0 });
    const quiet = inner.congestionFor({ x: 7, y: 0 }, { x: 9, y: 0 });

    expect(busy, '走在爆量走廊上卻不算塞').toBe(1);
    expect(quiet, '走在沒人的巷子卻算塞').toBe(0);
  });

  it('should fall back to the network average when the route is unknown', () => {
    // Answering "clear" for a route never computed would tell new citizens driving is fast,
    // which is a guess rather than data.
    const { state, loop, inner } = setup();
    state.traffic.updatePredictedFlow(new Map([['1,0', 12000]]));
    inner.cityCongestionLevel = 0.4;

    expect(loop.commuteCache.getRouteVariants('5,0->6,0'), '前置條件:這條路線沒有快取')
      .toBeUndefined();
    expect(inner.congestionFor({ x: 5, y: 0 }, { x: 6, y: 0 }), '沒算過的路線被當成暢通')
      .toBe(0.4);
  });

  it('should forget the cached numbers when the flow map changes', () => {
    // Per-route answers are cached. Returning the old answer after a road is built and the
    // traffic disperses gives the player no feedback on what they did.
    const { state, loop, inner } = setup();
    const route = pathThrough(['1,0', '2,0', '3,0']);
    loop.commuteCache.setRouteVariants('1,0->3,0', [route]);

    state.traffic.updatePredictedFlow(new Map([['1,0', 12000], ['2,0', 12000], ['3,0', 12000]]));
    expect(inner.congestionFor({ x: 1, y: 0 }, { x: 3, y: 0 })).toBe(1);

    // Replacing the flow field directly does not clear the cache; computeCongestionFlow does.
    // This checks the cache exists at all, and the assertion below checks it is cleared.
    state.traffic.updatePredictedFlow(new Map());
    expect(inner.congestionFor({ x: 1, y: 0 }, { x: 3, y: 0 }), '沒有快取，每次都重算')
      .toBe(1);

    (loop as unknown as { computeCongestionFlow(): void }).computeCongestionFlow();
    expect(inner.congestionFor({ x: 1, y: 0 }, { x: 3, y: 0 }), '流量重算了，舊答案還留著')
      .not.toBe(1);
  });
});
