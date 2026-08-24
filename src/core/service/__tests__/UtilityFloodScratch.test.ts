import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { UtilityFloodScratch } from '../UtilityFloodScratch';

const W = 8, H = 6;

function scratchOn(infra?: Set<string>): { grid: Grid; scratch: UtilityFloodScratch } {
  const grid = new Grid(W, H);
  const scratch = new UtilityFloodScratch();
  scratch.beginPass(grid, infra);
  return { grid, scratch };
}

/**
 * The flood scratch is reused across calls, so whether the previous pass was cleared properly is
 * the only thing it can get wrong, and every failure mode is **silent**: paying twice, paying
 * once too few, or recording an out-of-bounds facility on a real cell.
 */
describe('水電 flood 的暫存', () => {
  it('should forget which footprints were paid for when a new pass starts', () => {
    // Uncleared, a multi-cell building paid for last pass becomes free this pass: the plant's
    // budget gains capacity out of nowhere while the coverage map looks entirely normal.
    const { grid, scratch } = scratchOn();
    scratch.markPaid(3);
    expect(scratch.isPaid(3), '前置條件:要先付過').toBe(true);

    scratch.beginPass(grid);

    expect(scratch.isPaid(3), '換一輪還記得上一輪付過的錢').toBe(false);
  });

  it('should forget which cells belong to which building when a new pass starts', () => {
    // Demolishing and rebuilding can give one cell a different footprint. A stale grouping
    // charges the wrong building.
    const { grid, scratch } = scratchOn();
    const idx = 2 * W + 3;
    const before = scratch.chargeOf(grid, idx, 3, 2, () => 7);
    expect(before, '前置條件:空地要自己結算').toBe(-1);
    expect(scratch.demandAt(idx)).toBe(7);

    scratch.beginPass(grid);
    scratch.chargeOf(grid, idx, 3, 2, () => 99);

    expect(scratch.demandAt(idx), '換一輪還用著上一輪的金額').toBe(99);
  });

  it('should not let an out-of-grid facility mark a real cell', () => {
    // `"-1,2"` folds onto exactly `(W - 1, 1)`. Unchecked, something off the map turns that cell
    // into a relay point, possibly half a city away from the real network.
    const victim = 1 * W + (W - 1);
    const { scratch } = scratchOn(new Set(['-1,2']));

    expect(scratch.isInfra(victim), '界外的基礎設施折回地圖裡了').toBe(false);
  });

  it('should record facilities that are inside the grid', () => {
    // The converse of the test above, which would also pass if infra were discarded entirely.
    const { scratch } = scratchOn(new Set(['3,2']));

    expect(scratch.isInfra(2 * W + 3)).toBe(true);
  });

  it('should clear the visited marks for each plant', () => {
    const { scratch } = scratchOn();
    scratch.beginFlood();
    expect(scratch.markVisited(5)).toBe(true);
    expect(scratch.markVisited(5), '同一座廠裡同一個節點走了兩次').toBe(false);

    scratch.beginFlood();

    expect(scratch.markVisited(5), '換一座廠還記著上一座走過哪裡').toBe(true);
  });
});
