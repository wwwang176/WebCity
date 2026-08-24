import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * Vehicles are processed front to back each frame, and each one writes its new position and
 * whether it is braking back into the per-edge index at the end of its turn (the tail of the
 * `advanceEdgeVehicles` loop). A follower therefore reads the leader's state **as computed this
 * frame**, not last frame's.
 *
 * Reversing the sort order turns no test red, yet one frame on the same save moves 547 of 842
 * vehicles to different positions and speeds.
 *
 * The difference is clearest on the first frame: every vehicle's `braking` is still false then,
 * and a leader's only becomes true when it is processed. With the right order the follower sees
 * that true and does not push into the junction behind it.
 */

const JUNCTION_AT = 3;

/** A straight lane of unit-length segments, with segment `JUNCTION_AT` inside a junction. */
function path(n: number): LaneEdge[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    from: {
      id: `e${i}_f`, cellKey: `${i},0`, position: { x: i, y: 0 },
      lane: 0, direction: 'east' as const, type: 'exit' as const, tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: `e${i}_t`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
      lane: 0, direction: 'east' as const, type: 'entry' as const, tangent: { tx: 1, ty: 0 },
    },
    length: 1.0, type: 'straight' as const,
    ...(i === JUNCTION_AT ? { insideJunction: true } : {}),
  }));
}

describe('由前往後處理', () => {
  it('should let a follower see the leader braking in the same frame', () => {
    const sim = new TrafficSimulation();
    const route = path(10);

    // The follower is created first and the leader second, so an unsorted array runs back to
    // front and creation order cannot stand in for the sort.
    const follower = sim.addVehicleOnEdges(route);
    follower.length = 0.22;

    // The leader waits just past the junction exit, held by a red light, and computes "I am
    // braking" for the first time this frame.
    const leader = sim.addVehicleOnEdges(route);
    leader.length = 0.22;
    leader.edgeIndex = JUNCTION_AT + 1;
    leader.edgeProgress = 0;      // not yet in, so the red light can hold it
    leader.speedMultiplier = 1;
    leader.stallTime = -1e6;

    // The follower is still short of the junction. Whether it enters depends on the leader
    // queueing.
    follower.edgeIndex = JUNCTION_AT - 1;
    follower.edgeProgress = 0.7;  // the stop line is 0.3 cells ahead
    follower.currentSpeed = 3;
    follower.speedMultiplier = 1;
    follower.stallTime = -1e6;

    // Both still have braking false: the leader's becomes true only when it is processed.
    expect(leader.braking, '前置條件:前車還沒被判定在減速').toBe(false);

    const red = (_from: string, next: string) => next !== `${JUNCTION_AT + 2},0`;
    sim.advanceEdgeVehicles(0.2, red);

    expect(leader.braking, '前車這一幀沒有被判定在減速 —— 這個案例失去意義').toBe(true);
    // The leader is queueing and cannot clear, so the follower must stop before the stop line
    // rather than leave its body inside the junction.
    const centre = follower.edgeIndex + follower.edgeProgress;
    expect(centre, '後車讀到的是前車上一幀的狀態，跟著擠進了路口')
      .toBeLessThan(JUNCTION_AT);
  });
});
