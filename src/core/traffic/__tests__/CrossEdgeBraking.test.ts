import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * When two lanes merge into one point, the later arrival yields.
 *
 * `findCrossEdgeGap` has its own unit tests, but they feed it point objects directly and none
 * goes through `advanceEdgeVehicles`. If the layer in between — turning each vehicle's position
 * and destination into a queryable shape — breaks, merge detection silently answers "nothing
 * ahead" every time and the two vehicles pass through each other, with no existing test failing.
 */

/** A lane edge from (fx,fy) to (1,0). A shared `toId` means the edges merge into one point. */
function edgeInto(id: string, fx: number, fy: number, toId: string): LaneEdge {
  return {
    id,
    from: {
      id: `${id}_f`, cellKey: '0,0', position: { x: fx, y: fy },
      lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: toId, cellKey: '1,0', position: { x: 1, y: 0 },
      lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
    },
    length: 1.0, type: 'straight',
  };
}

/**
 * Advances one vehicle east from (0,0) for a frame and returns how far it got.
 * With `withSibling`, a vehicle on another edge merging into the same point sits 0.5 ahead.
 */
function advanceOnce(withSibling: boolean): number {
  const sim = new TrafficSimulation();
  const mine = sim.addVehicleOnEdges([edgeInto('eA', 0, 0, 'MERGE')]);
  if (withSibling) {
    const other = sim.addVehicleOnEdges([edgeInto('eB', 0, 0, 'MERGE')]);
    other.edgeProgress = 0.5;   // nearer the merge point, so it goes first and we yield
  }
  const before = mine.edgeProgress;
  sim.advanceEdgeVehicles(1);
  return mine.edgeProgress - before;
}

describe('匯進同一個點的兩台車', () => {
  it('should stop short of a merge sibling on another edge', () => {
    const alone = advanceOnce(false);
    const yielding = advanceOnce(true);

    expect(alone, '前面沒車卻也不走').toBeGreaterThan(0);
    expect(yielding, '前面有車要匯進同一個點，卻照原速穿過去').toBeLessThan(alone);
  });

  it('should not brake for a sibling heading somewhere else', () => {
    // The control: equally close but a different destination, so the lanes are unrelated and
    // neither yields.
    const sim = new TrafficSimulation();
    const mine = sim.addVehicleOnEdges([edgeInto('eA', 0, 0, 'MERGE')]);
    const other = sim.addVehicleOnEdges([edgeInto('eB', 0, 0, 'SOMEWHERE_ELSE')]);
    other.edgeProgress = 0.5;
    sim.advanceEdgeVehicles(1);

    expect(mine.edgeProgress, '為了一台根本不會匯過來的車煞停')
      .toBeCloseTo(advanceOnce(false), 5);
  });
});
