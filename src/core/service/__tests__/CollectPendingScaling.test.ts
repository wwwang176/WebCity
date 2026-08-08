import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { GarbageService, GARBAGE } from '../GarbageService';

/**
 * collectPending removed collected items with a full backwards scan of the
 * pending array once per collection round: O(rounds x pending). With
 * COLLECTION_RATE 140 across a few landfills and DECOMPOSE_TICKS 600 letting
 * the queue grow into the tens of thousands whenever service is short, that is
 * on the order of a million comparisons on the main thread every service tick —
 * exactly when the city is already struggling (BUG-110).
 *
 * Measured on an 80x80 city with 4 landfills and 35k pending bags: 23.2ms
 * before, 9.0ms after. Real, and about 2.6x rather than the two-orders-of-
 * magnitude the original commit message claimed. In the pathological
 * one-bag-per-cell case there is no win at all, because the index buckets cost
 * an O(pending) allocation the old code did not make.
 *
 * Timing is not assertable deterministically, so this pins what the rewrite had
 * to preserve: bags are conserved, and the survivors are the right ones.
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
    // CONSERVATION, which is what the name promised and the first version did
    // not check. It asserted only `after < before` (satisfied by removing one
    // bag) and `after >= 0` (a tautology for an array length), so it passed
    // verbatim against the pre-rewrite algorithm — the reviewer demonstrated
    // that by running it. Double-marking an index removes fewer bags than it
    // credits to the landfill; a missed index removes more. Only the equality
    // catches either.
    const { garbage } = cityWithLandfill();
    for (let i = 0; i < 900; i++) garbage.reportGarbage(6 + (i % 12), 9, 4);

    const before = garbage.getPendingGarbageQueue().length;
    expect(before).toBe(900 * 4);

    garbage.tick();

    const after = garbage.getPendingGarbageQueue().length;
    const received = garbage.getFacilities().reduce((s, f) => s + f.todayReceived, 0);

    expect(before - after).toBe(received);
    expect(received).toBe(GARBAGE.COLLECTION_RATE);
  });

  it('should keep conserving across repeated ticks', () => {
    // One tick only exercises the first few rounds. Draining the queue walks
    // the bucket bookkeeping through every boundary — a facility filling up,
    // positions emptying out, the last partial round.
    const { garbage } = cityWithLandfill();
    for (let i = 0; i < 200; i++) garbage.reportGarbage(6 + (i % 12), 9, 4);
    let queue = garbage.getPendingGarbageQueue().length;

    for (let t = 0; t < 8; t++) {
      const receivedBefore = garbage.getFacilities().reduce((s, f) => s + f.todayReceived, 0);
      garbage.tick();
      const now = garbage.getPendingGarbageQueue().length;
      const receivedAfter = garbage.getFacilities().reduce((s, f) => s + f.todayReceived, 0);
      expect(queue - now, `tick ${t}`).toBe(receivedAfter - receivedBefore);
      queue = now;
    }
  });

  it('should collect each surviving bag at most once', () => {
    // Identity, not just count: a bucketing slip can remove the right NUMBER
    // of bags while removing the wrong ones.
    const { garbage } = cityWithLandfill();
    for (let x = 6; x < 18; x++) garbage.reportGarbage(x, 9, 1);
    const before = garbage.getPendingGarbageQueue().map(b => `${b.x},${b.y}`);

    garbage.tick();

    const after = garbage.getPendingGarbageQueue().map(b => `${b.x},${b.y}`);
    expect(new Set(after).size).toBe(after.length);
    for (const key of after) expect(before).toContain(key);
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
