import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';

/**
 * The flow recomputation is swept over several ticks (BUG-327). Starting a sweep and
 * advancing it are separate things: a sweep starts every 60 ticks, and advancing must happen
 * **every tick**.
 *
 * Advancing only on the starting tick never completes a sweep, so the flow field never
 * updates again after a load — and every existing test calls `computeCongestionFlow()`
 * directly (the compute-it-all-at-once path), so none of them turns red.
 */

function setup() {
  const state = createGameState(20, 20);
  for (let x = 0; x < 12; x++) {
    state.grid.setCell(x, 0, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  return { state, loop: new SimulationLoop(state) };
}

/** A route with riders on it. CommuteCache maintains refCount itself, so no real citizens are
 *  needed. */
function seedRoute(loop: SimulationLoop, cells: string[], riders: number, idBase: number): void {
  const path = cells.slice(0, -1).map((from, i) => makeCellEdge(from, cells[i + 1]!, 0, { length: 1 }));
  loop.commuteCache.setRouteVariants(`${cells[0]}->${cells[cells.length - 1]}`, [path]);
  for (let i = 0; i < riders; i++) {
    loop.commuteCache.set(idBase + i, {
      citizenId: idBase + i, homeId: cells[0]!, workplaceId: cells[cells.length - 1]!,
      morningPath: path, eveningPath: null, status: 'ready', generation: 0,
    });
  }
}

describe('流量重算會自己掃完', () => {
  it('should finish a sweep started 60 ticks in, without anyone calling it directly', () => {
    const { state, loop } = setup();

    loop.tick();   // tick 1 computes everything at once, and no routes exist yet
    expect(state.traffic.getPredictedFlow()?.size ?? 0, '前置條件:一開始沒有車流').toBe(0);

    // Seeded before the sweep starts. The next sweep begins at tick 62 and is spread over the
    // following 40 ticks.
    seedRoute(loop, ['3,0', '4,0', '5,0'], 9, 500);

    const deadline = 2 + SIMULATION.MEDIUM_TICK_INTERVAL + SIMULATION.CONGESTION_FLOW_SPREAD_TICKS + 2;
    while (state.clock.tick < deadline) loop.tick();

    const flow = state.traffic.getPredictedFlow();
    expect(flow?.has('4,0'), `跑到 tick ${deadline} 了，這一輪還沒掃完`).toBe(true);
  });

  it('should not publish a half-swept map along the way', () => {
    // A half-built table claims only those roads carry anyone. Read mid-sweep, mode choice
    // would decide against a false map.
    const { state, loop } = setup();
    loop.tick();
    seedRoute(loop, ['1,0', '2,0'], 4, 600);
    seedRoute(loop, ['8,0', '9,0'], 4, 700);

    const seen: number[] = [];
    while (state.clock.tick < 2 + SIMULATION.MEDIUM_TICK_INTERVAL + SIMULATION.CONGESTION_FLOW_SPREAD_TICKS + 2) {
      loop.tick();
      const f = state.traffic.getPredictedFlow();
      if (f) seen.push(f.size);
    }
    // Only empty and complete are ever observed; no intermediate state.
    expect([...new Set(seen)].sort((a, b) => a - b), '出現了大小介於中間的表')
      .toEqual([0, 4]);
  });
});
