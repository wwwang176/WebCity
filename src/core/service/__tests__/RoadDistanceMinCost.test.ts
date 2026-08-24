import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { roadDistanceToTargets, roadTileCost } from '../RoadCoverageFlood';
import { toPosKey } from '../../grid/GridHelpers';

/**
 * roadDistanceToTargets recorded a target's cost the moment any road cell
 * touched it, and locked it in with `!result.has(nk)`. Those writes happened at
 * relax time, on tentative costs, so whichever cell reached the target first —
 * which depends on FOUR_NEIGHBORS iteration order, not on cost — won
 * permanently. Road tiers differ by up to 6.7x, so a rural lane at the door beat
 * a motorway two cells away and JobRelocation scored the commute on the wrong
 * figure (BUG-102).
 */
describe('roadDistanceToTargets reports the cheapest route', () => {
  /**
   *   (1,5)…(12,5)  highway spine, home at (1,5)
   *   (6,6)         rural stub, relaxed first, expensive to stand on
   *   (10,6)        optional highway stub, relaxed later, cheap
   *   (8,8)         target, ZONE_ROAD_REACH (2) from both stubs, 3 from the spine
   */
  function gridWith(highwayStub: boolean): Grid {
    const grid = new Grid(20, 20);
    for (let x = 1; x <= 12; x++) grid.setCell(x, 5, { roadType: RoadType.HIGHWAY, roadFlags: 12 });
    grid.setCell(6, 6, { roadType: RoadType.RURAL, roadFlags: 3 });
    if (highwayStub) grid.setCell(10, 6, { roadType: RoadType.HIGHWAY, roadFlags: 3 });
    return grid;
  }

  const TARGET = toPosKey(8, 8);
  const costTo = (grid: Grid) =>
    roadDistanceToTargets(grid, { x: 1, y: 5 }, new Set([TARGET]), 1000, null).get(TARGET);

  it('should report the exact cheapest cost, not merely a smaller one', () => {
    // Adding a second, cheaper way to reach the same target must lower its cost.
    // Because the target was recorded at RELAX time and locked with
    // `!result.has(...)`, the expensive rural stub — relaxed first, since pops
    // follow cost order and its predecessor is nearer — won permanently, and the
    // extra highway made no difference at all.
    //
    // Asserting only "smaller" would pass for any implementation that shaved a
    // fraction off the wrong route. roadTileCost is deterministic AND integral,
    // so both figures are exact and comparable with .toBe: highway costs 9 per
    // cell, rural 60 — the 6.7x tier spread that made the relax-time bug
    // visible in the first place.
    const HIGHWAY_TILE = roadTileCost(RoadType.HIGHWAY);
    const RURAL_TILE = roadTileCost(RoadType.RURAL);
    expect(HIGHWAY_TILE).toBe(9);
    expect(RURAL_TILE / HIGHWAY_TILE).toBeCloseTo(20 / 3, 9);

    const withoutStub = costTo(gridWith(false));
    const withStub = costTo(gridWith(true));

    // Forced through the rural stub: 87 (= 29/6 on the old scale, x18).
    // Free to use the highway stub: 72 (= 4 x 18).
    expect(withoutStub).toBe(87);
    expect(withStub).toBe(72);
  });

  it('should still find targets reachable only by an expensive road', () => {
    const grid = new Grid(20, 20);
    for (let x = 1; x <= 8; x++) grid.setCell(x, 5, { roadType: RoadType.RURAL, roadFlags: 12 });

    const target = toPosKey(7, 6);
    const result = roadDistanceToTargets(grid, { x: 1, y: 5 }, new Set([target]), 1000, null);

    expect(result.has(target)).toBe(true);
  });

  it('should respect the budget', () => {
    const grid = new Grid(20, 20);
    for (let x = 1; x <= 18; x++) grid.setCell(x, 5, { roadType: RoadType.RURAL, roadFlags: 12 });

    const far = toPosKey(18, 6);
    const result = roadDistanceToTargets(grid, { x: 1, y: 5 }, new Set([far]), 2, null);

    expect(result.has(far)).toBe(false);
  });
});
