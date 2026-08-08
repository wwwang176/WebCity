import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType, RoadDirection } from '../../road/types';
import { RailType } from '../../rail/types';
import { ElevationManager } from '../ElevationManager';
import { ElevatedRoadBuilder } from '../ElevatedRoadBuilder';

/**
 * Three defects that ElevatedRoadKeepsTheRailway could not reach, because every
 * one of its cases is about the FIRST cell of the run.
 *
 * The `existingAtStart` guard is `i === 0 && ...` by construction, so from the
 * second cell onward the placement loop writes `railType: 0, railFlags: 0`
 * unconditionally. BUG-117 and BUG-163 both happened to be start-cell cases, so
 * the rule they established — never rewrite an existing segment's paid state —
 * was only ever enforced there.
 */
function railViaduct(em: ElevationManager, x: number, y: number, level: number): void {
  em.set(x, y, level, {
    roadType: RoadType.NONE, roadFlags: 0,
    railType: RailType.STANDARD, railFlags: TrackNS,
    isRamp: false, rampAscendDirection: 0,
  });
}

/** North|South, the flags a north-south railway carries. */
const TrackNS = 0b0011;

/** A ground road west of the corridor, so a ramp has somewhere clear to start. */
function approachRoad(grid: Grid, y: number): void {
  for (let x = 2; x <= 6; x++) grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
}

describe('an elevated road crossing an elevated railway leaves it standing', () => {
  it('should not delete the railway under a mid-run crossing', () => {
    // The road runs west to east at level 1; the railway runs north to south at
    // level 1 and they meet at (12,5), which is the middle of the road's path,
    // not its start.
    const grid = new Grid(24, 24);
    approachRoad(grid, 5);
    const em = new ElevationManager();
    railViaduct(em, 12, 5, 1);

    const result = new ElevatedRoadBuilder(grid, em)
      .buildElevatedRoad({ x: 6, y: 5 }, { x: 18, y: 5 }, RoadType.TWO_LANE, 1e6, 1);

    // A build that never happened cannot delete anything.
    expect(result.success, `build failed: ${JSON.stringify(result)}`).toBe(true);

    const seg = em.get(12, 5, 1);
    expect(seg, 'the crossing cell must still exist').not.toBeNull();
    expect(seg!.railType, 'the railway was deleted by a road crossing it').toBe(RailType.STANDARD);
    expect(seg!.railFlags).toBe(TrackNS);
  });

  it('should still put the road on that cell', () => {
    // The railway surviving must not mean the road failed to arrive: both share
    // the deck.
    const grid = new Grid(24, 24);
    approachRoad(grid, 5);
    const em = new ElevationManager();
    railViaduct(em, 12, 5, 1);

    new ElevatedRoadBuilder(grid, em)
      .buildElevatedRoad({ x: 6, y: 5 }, { x: 18, y: 5 }, RoadType.TWO_LANE, 1e6, 1);

    const seg = em.get(12, 5, 1)!;
    expect(seg.roadType).toBe(RoadType.TWO_LANE);
    expect(seg.roadFlags & RoadDirection.EAST).toBeTruthy();
    expect(seg.roadFlags & RoadDirection.WEST).toBeTruthy();
  });

  it('should survive a railway crossed at several cells at once', () => {
    // Two parallel rail decks, both mid-run.
    const grid = new Grid(30, 30);
    approachRoad(grid, 5);
    const em = new ElevationManager();
    railViaduct(em, 11, 5, 1);
    railViaduct(em, 15, 5, 1);

    const result = new ElevatedRoadBuilder(grid, em)
      .buildElevatedRoad({ x: 6, y: 5 }, { x: 20, y: 5 }, RoadType.FOUR_LANE, 1e6, 1);
    expect(result.success, `build failed: ${JSON.stringify(result)}`).toBe(true);

    for (const x of [11, 15]) {
      expect(em.get(x, 5, 1)!.railType, `rail at ${x} was deleted`).toBe(RailType.STANDARD);
    }
  });
});

describe('an elevated run never lands its foot on nothing', () => {
  it('should refuse a start that is a railway rather than a road', () => {
    // The start gate used `hasElevatedSegment`, which is true for an elevated
    // RAILWAY too. chooseStartLevel then correctly refused to hand back a
    // rail-only level and answered 0, so the run set off from a ground cell
    // with no road on it and the ramp's foot pointed west into an empty cell —
    // BUG-097's dangling flag, reached through a different door.
    const grid = new Grid(24, 24);
    approachRoad(grid, 5);
    const em = new ElevationManager();
    railViaduct(em, 8, 5, 2);

    const result = new ElevatedRoadBuilder(grid, em)
      .buildElevatedRoad({ x: 8, y: 5 }, { x: 16, y: 5 }, RoadType.TWO_LANE, 1e6, 2);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('START_NOT_ON_ROAD');
    // Nothing was built, so nothing may have been written anywhere.
    expect(em.get(9, 5, 1)).toBeNull();
    expect(em.get(8, 5, 2)!.roadType).toBe(RoadType.NONE);
  });

  it('should still accept a start on an elevated ROAD', () => {
    // The control. Without it, "reject a rail start" is satisfiable by
    // rejecting every elevated start, which would make viaducts unextendable.
    const grid = new Grid(24, 24);
    const em = new ElevationManager();
    em.set(8, 5, 2, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
      railType: RailType.NONE, railFlags: 0, isRamp: false, rampAscendDirection: 0,
    });

    const result = new ElevatedRoadBuilder(grid, em)
      .buildElevatedRoad({ x: 8, y: 5 }, { x: 16, y: 5 }, RoadType.TWO_LANE, 1e6, 2);
    expect(result.success, `build failed: ${JSON.stringify(result)}`).toBe(true);
  });

  it('should leave no segment carrying flags with no road under them', () => {
    // The invariant, stated over a structure that does get built.
    const grid = new Grid(24, 24);
    approachRoad(grid, 5);
    const em = new ElevationManager();
    railViaduct(em, 12, 5, 1);

    new ElevatedRoadBuilder(grid, em)
      .buildElevatedRoad({ x: 6, y: 5 }, { x: 18, y: 5 }, RoadType.TWO_LANE, 1e6, 1);

    const islands: string[] = [];
    for (let x = 0; x < 24; x++) {
      for (let level = 1; level <= 3; level++) {
        const seg = em.get(x, 5, level);
        if (seg && seg.roadFlags !== 0 && seg.roadType === RoadType.NONE) {
          islands.push(`${x},5,${level}`);
        }
      }
    }
    expect(islands).toEqual([]);
  });
});

describe('removing one deck of a stack leaves the other connected', () => {
  it('should not cut the level below when the level above is removed', () => {
    // removeElevated scans `highest` and `highest - 1` because a ramp joins two
    // levels and its neighbours can sit either side (BUG-118). But it clears the
    // lower neighbours' flags without checking whether anything is still there
    // at that level — and when two viaducts are stacked, the lower one is
    // untouched and still needs its connection.
    const grid = new Grid(24, 24);
    const em = new ElevationManager();

    const span = (level: number) => {
      for (let x = 8; x <= 12; x++) {
        em.set(x, 5, level, {
          roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
          railType: RailType.NONE, railFlags: 0, isRamp: false, rampAscendDirection: 0,
        });
      }
    };
    span(1);
    span(2);

    new ElevatedRoadBuilder(grid, em).removeElevated(10, 5);

    expect(em.get(10, 5, 2), 'the top deck cell must be gone').toBeNull();
    expect(em.get(10, 5, 1), 'the lower deck cell must NOT be').not.toBeNull();

    // The lower deck is intact, so its neighbours must still point at it.
    expect(em.get(9, 5, 1)!.roadFlags & RoadDirection.EAST,
      'west neighbour on the lower deck lost its connection').toBeTruthy();
    expect(em.get(11, 5, 1)!.roadFlags & RoadDirection.WEST,
      'east neighbour on the lower deck lost its connection').toBeTruthy();
  });

  it('should still clear the neighbours on the level it removed', () => {
    // The control: without it, "do not clear the level below" is satisfiable by
    // never clearing anything, which is the dangling-flag bug BUG-118 fixed.
    const grid = new Grid(24, 24);
    const em = new ElevationManager();
    for (let x = 8; x <= 12; x++) {
      em.set(x, 5, 1, {
        roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
        railType: RailType.NONE, railFlags: 0, isRamp: false, rampAscendDirection: 0,
      });
    }

    new ElevatedRoadBuilder(grid, em).removeElevated(10, 5);

    expect(em.get(10, 5, 1)).toBeNull();
    expect(em.get(9, 5, 1)!.roadFlags & RoadDirection.EAST,
      'a flag pointing into empty air').toBe(0);
    expect(em.get(11, 5, 1)!.roadFlags & RoadDirection.WEST).toBe(0);
  });

  it('should clear the level below when that level really is empty there', () => {
    // The ramp case BUG-118 was about: nothing at (10,5,1), so the level-1
    // neighbour's flag really is dangling and must go.
    const grid = new Grid(24, 24);
    const em = new ElevationManager();
    em.set(10, 5, 2, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
      railType: RailType.NONE, railFlags: 0, isRamp: true, rampAscendDirection: RoadDirection.EAST,
    });
    em.set(9, 5, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
      railType: RailType.NONE, railFlags: 0, isRamp: false, rampAscendDirection: 0,
    });

    new ElevatedRoadBuilder(grid, em).removeElevated(10, 5);

    expect(em.get(9, 5, 1)!.roadFlags & RoadDirection.EAST).toBe(0);
  });
});
