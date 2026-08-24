import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { roadDistanceToTargets } from '../RoadCoverageFlood';
import { toPosKey } from '../../grid/GridHelpers';

/**
 * Targets are folded into cell indices (`y * width + x`) before matching. **Without a bounds
 * check before the fold, an out-of-bounds coordinate aliases onto another cell**: on a 10-wide
 * map `"10,0"` gives index 10, which is `(0,1)`. The query then treats `(0,1)` as a target,
 * possibly exits early, and returns that cell's key — a position nobody asked about.
 *
 * Today's callers, workplace candidates and citizens' workplaceIds, are scanned out of the grid
 * and are never out of bounds; this group guards corrupted saves and future callers.
 */
const W = 10, H = 10;
const EW = RoadDirection.EAST | RoadDirection.WEST;

function city(): { grid: Grid; lookup: UnifiedRoadLookup } {
  const grid = new Grid(W, H);
  for (let x = 0; x < W; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  return { grid, lookup: UnifiedRoadLookup.fromGrid(grid) };
}

describe('界外的目標不會別名到別的格子', () => {
  it('should reach a normal in-bounds target', () => {
    // The control: without it, every test below could pass by finding nothing at all.
    const { grid, lookup } = city();
    const target = toPosKey(8, 0);

    const got = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set([target]), 100_000, lookup);

    expect(got.get(target)).toBeGreaterThanOrEqual(0);
  });

  it('should not fold a target past the right edge onto the next row', () => {
    // `(W, 0)`'s linear index is W, which is `(0, 1)`, and `(0,1)` has a road and is certain to
    // be settled.
    const { grid, lookup } = city();

    const got = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set([`${W},0`]), 100_000, lookup);

    expect(got.has(`${W},0`), '界外的目標被說成到得了').toBe(false);
    expect(got.has(toPosKey(0, 1)), '回報了一個沒有人問的格子').toBe(false);
    expect(got.size).toBe(0);
  });

  it('should ignore a negative target instead of indexing before the array', () => {
    const { grid, lookup } = city();

    const got = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set(['-1,3']), 100_000, lookup);

    expect(got.size).toBe(0);
  });

  it('should ignore a target below the grid', () => {
    const { grid, lookup } = city();

    const got = roadDistanceToTargets(grid, { x: 0, y: 0 }, new Set([`3,${H}`]), 100_000, lookup);

    expect(got.size).toBe(0);
  });

  it('should still find the good targets when a bad one is mixed in', () => {
    // Dropping the out-of-bounds target has to lower the early-exit threshold with it, or the
    // query waits for a hit that never comes and runs the full budget, or stops early and misses
    // a real target.
    const { grid, lookup } = city();
    const good = toPosKey(8, 0);

    const got = roadDistanceToTargets(
      grid, { x: 0, y: 0 }, new Set([good, `${W},0`, '-5,-5']), 100_000, lookup);

    expect([...got.keys()]).toEqual([good]);
  });
});
