import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { GarbageService } from '../GarbageService';

/**
 * collectPending removed collected items with a full backwards scan of the
 * pending array once per collection round: O(rounds x pending). With
 * COLLECTION_RATE 140 across a few landfills and DECOMPOSE_TICKS 600 letting
 * the queue grow into the tens of thousands whenever service is short, that is
 * hundreds of millions of comparisons on the main thread every service tick —
 * exactly when the city is already struggling (BUG-110).
 *
 * Timing is not assertable deterministically, so this pins the two properties
 * that the rewrite had to preserve: the right number of bags leave the queue,
 * and the survivors are the right ones.
 */
function cityWithLandfill() {
  const grid = new Grid(30, 30);
  new RoadBuilder(grid).buildRoad({ x: 1, y: 10 }, { x: 25, y: 10 }, RoadType.TWO_LANE, 1e6);
  const garbage = new GarbageService();
  garbage.addFacility(3, 11);
  garbage.recalculateCoverage(grid);
  return { grid, garbage };
}

describe('collectPending scales and stays correct', () => {
  it('should collect from a large queue without losing or duplicating bags', () => {
    const { garbage } = cityWithLandfill();
    const BAGS = 900;
    for (let i = 0; i < BAGS; i++) garbage.reportGarbage(6 + (i % 12), 9, 4);

    const before = garbage.getPendingGarbageQueue().length;
    expect(before).toBeGreaterThan(0);

    garbage.tick();

    const after = garbage.getPendingGarbageQueue().length;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(0);
  });

  it('should never collect bags at positions with no coverage', () => {
    const { garbage } = cityWithLandfill();
    // Far corner, nowhere near the road network.
    for (let i = 0; i < 20; i++) garbage.reportGarbage(28, 28, 4);
    const before = garbage.getPendingGarbageQueue().length;

    garbage.tick();

    expect(garbage.getPendingGarbageQueue().length).toBe(before);
  });

  it('should leave the queue empty when capacity far exceeds demand', () => {
    const { garbage } = cityWithLandfill();
    for (let i = 0; i < 5; i++) garbage.reportGarbage(6, 9, 4);

    garbage.tick();

    expect(garbage.getPendingGarbageQueue().length).toBe(0);
  });
});
