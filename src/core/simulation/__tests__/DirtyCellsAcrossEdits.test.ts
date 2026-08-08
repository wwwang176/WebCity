import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState } from '../GameState';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';

/**
 * `dirtyRoadCells` accumulates across edits within a tick, and the retirement
 * question used to be answered from it: "is any cell on this vehicle's route
 * dirty?". Demolishing a road and then relaying it in a different orientation
 * in the SAME tick left the set describing both edits, and a vehicle whose
 * route crossed only the relaid part looked untouched.
 *
 * BUG-116's rework replaced the approximation with the exact question — "does
 * the graph still own every edge on this vehicle's remaining path?" — which is
 * asked of the rebuilt graph and does not consult the dirty set at all. This
 * file is that claim, checked rather than assumed: the outstanding TODO said
 * "solved by the edge-identity change, to be confirmed".
 */
function street(state: ReturnType<typeof createGameState>, y: number, x0: number, x1: number) {
  new RoadBuilder(state.grid).buildRoad({ x: x0, y }, { x: x1, y }, RoadType.TWO_LANE, 1e6);
}

function laneGraphOf(loop: SimulationLoop) {
  return (loop as unknown as { laneGraph: { getAllEdges(): Array<{ id: string }> } }).laneGraph;
}

describe('a road removed and relaid in one tick leaves no stale edges', () => {
  it('should own no edge id that its cells no longer justify', () => {
    const state = createGameState(24, 24);
    street(state, 5, 2, 18);
    const loop = new SimulationLoop(state);
    loop.markLaneGraphDirty(
      Array.from({ length: 17 }, (_, i) => `${i + 2},5`), true,
    );
    loop.tick();

    const before = new Set(laneGraphOf(loop).getAllEdges().map(e => e.id));
    expect(before.size, 'the fixture built no lane graph at all').toBeGreaterThan(0);

    // Demolish the middle and relay it running the other way, both before the
    // next tick — the exact "two edits, one sweep" shape.
    const removed: string[] = [];
    for (let x = 8; x <= 12; x++) {
      state.grid.setCell(x, 5, { roadType: RoadType.NONE, roadFlags: 0 });
      removed.push(`${x},5`);
    }
    new RoadBuilder(state.grid).buildRoad({ x: 10, y: 2 }, { x: 10, y: 12 }, RoadType.TWO_LANE, 1e6);
    const relaid = Array.from({ length: 11 }, (_, i) => `10,${i + 2}`);

    loop.markLaneGraphDirty([...removed, ...relaid], true);
    loop.tick();

    // Every surviving edge must belong to a cell that still carries a road.
    const stale: string[] = [];
    for (const edge of laneGraphOf(loop).getAllEdges()) {
      for (const key of edge.id.matchAll(/(\d+),(\d+)/g)) {
        const cell = state.grid.getCell(Number(key[1]), Number(key[2]));
        if (!cell || cell.roadType === RoadType.NONE) stale.push(edge.id);
      }
    }
    expect([...new Set(stale)]).toEqual([]);
  });

  it('should still have edges on the parts that were left alone', () => {
    // The control: "no stale edges" is satisfiable by an empty graph.
    const state = createGameState(24, 24);
    street(state, 5, 2, 18);
    const loop = new SimulationLoop(state);
    loop.markLaneGraphDirty(Array.from({ length: 17 }, (_, i) => `${i + 2},5`), true);
    loop.tick();

    for (let x = 8; x <= 12; x++) state.grid.setCell(x, 5, { roadType: RoadType.NONE, roadFlags: 0 });
    loop.markLaneGraphDirty(Array.from({ length: 5 }, (_, i) => `${i + 8},5`), true);
    loop.tick();

    const remaining = laneGraphOf(loop).getAllEdges();
    expect(remaining.length, 'the whole graph was thrown away').toBeGreaterThan(0);
    expect(remaining.some(e => e.id.includes('3,5') || e.id.includes('16,5'))).toBe(true);
  });

  it('should clear the dirty set after a rebuild', () => {
    // The accumulation itself: if the set survives the sweep, the next tick
    // rebuilds cells that were already handled and, more importantly, the set
    // grows without bound across a long editing session.
    const state = createGameState(24, 24);
    street(state, 5, 2, 18);
    const loop = new SimulationLoop(state);

    loop.markLaneGraphDirty(['4,5', '5,5'], true);
    loop.tick();

    const dirty = (loop as unknown as { dirtyRoadCells: Set<string> | null }).dirtyRoadCells;
    expect(dirty === null || dirty.size === 0,
      `dirty cells survived the rebuild: ${dirty ? [...dirty].join(',') : 'null'}`).toBe(true);
  });
});
