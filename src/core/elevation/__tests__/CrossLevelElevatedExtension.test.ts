import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ElevationManager } from '../ElevationManager';
import { ElevatedRoadBuilder } from '../ElevatedRoadBuilder';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';

/**
 * startOnElevated used hasElevatedSegment, which is true for a segment at ANY
 * level, but the start level was then taken as the user's currently selected
 * targetLevel. Extending a level-1 viaduct while level 2 is selected therefore
 * produced a completely flat level-2 run with no ramp anywhere: getElevatedPath
 * computes startRampCount from the level difference, and told they are equal it
 * generates none.
 *
 * UnifiedRoadLookup requires one side of a one-level difference to be a ramp, so
 * the new run had zero lane edges to the old one — a paid, maintained, rendered
 * road that no vehicle could ever reach. Validation did not object either: it
 * only checks same-level occupancy. It also made 1 -> 2 ramps impossible to
 * build from an existing viaduct at all (BUG-097).
 */
function viaductAtLevel1() {
  const grid = new Grid(30, 30);
  new RoadBuilder(grid).buildRoad({ x: 0, y: 5 }, { x: 0, y: 5 }, RoadType.TWO_LANE, 1e6);
  const em = new ElevationManager();
  const builder = new ElevatedRoadBuilder(grid, em);
  builder.buildElevatedRoad({ x: 0, y: 5 }, { x: 8, y: 5 }, RoadType.TWO_LANE, 1e6, 1);
  return { em, builder };
}

/** A level difference of 1 is traversable only if one side is a ramp. */
function hasRampBetweenLevels(em: ElevationManager, xs: number[], y: number): boolean {
  for (const x of xs) {
    for (let lv = 1; lv <= 3; lv++) {
      if (em.get(x, y, lv)?.isRamp) return true;
    }
  }
  return false;
}

describe('extending an existing viaduct to a different level', () => {
  it('should build a ramp rather than a disconnected flat run', () => {
    const { em, builder } = viaductAtLevel1();

    const result = builder.buildElevatedRoad({ x: 8, y: 5 }, { x: 16, y: 5 }, RoadType.TWO_LANE, 1e6, 2);

    // Asserted unconditionally: an if/else here would let the whole feature be
    // disabled again without any test going red.
    expect(result.success).toBe(true);
    expect(hasRampBetweenLevels(em, [8, 9, 10, 11, 12], 5)).toBe(true);
  });

  it('should not rewrite the tier of the segment it starts from', () => {
    // Starting the path on the existing structure (the BUG-097 fix) put path[0]
    // on a cell that was already paid for. The placement loop then stamped it
    // with the new roadType — a free downgrade of a HIGHWAY viaduct, breaking
    // the very rule BUG-096 established (BUG-117).
    const grid = new Grid(30, 30);
    new RoadBuilder(grid).buildRoad({ x: 0, y: 5 }, { x: 0, y: 5 }, RoadType.TWO_LANE, 1e6);
    const em = new ElevationManager();
    const builder = new ElevatedRoadBuilder(grid, em);
    builder.buildElevatedRoad({ x: 0, y: 5 }, { x: 8, y: 5 }, RoadType.HIGHWAY, 1e6, 1);
    const before = em.get(8, 5, 1)!.roadType;
    expect(before).toBe(RoadType.HIGHWAY);

    builder.buildElevatedRoad({ x: 8, y: 5 }, { x: 16, y: 5 }, RoadType.TWO_LANE, 1e6, 2);

    expect(em.get(8, 5, 1)!.roadType).toBe(RoadType.HIGHWAY);
  });

  it('should not erase rail data on the segment it starts from', () => {
    // Same cell, other field: the placement loop hard-wrote railType/railFlags
    // to 0, deleting one span of an elevated railway bridge outright.
    const grid = new Grid(30, 30);
    new RoadBuilder(grid).buildRoad({ x: 0, y: 5 }, { x: 0, y: 5 }, RoadType.TWO_LANE, 1e6);
    const em = new ElevationManager();
    em.set(8, 5, 1, {
      roadType: 0, roadFlags: 4, railType: 1, railFlags: 4,
      isRamp: false, rampAscendDirection: 0,
    });
    const builder = new ElevatedRoadBuilder(grid, em);

    builder.buildElevatedRoad({ x: 8, y: 5 }, { x: 16, y: 5 }, RoadType.TWO_LANE, 1e6, 2);

    const seg = em.get(8, 5, 1)!;
    expect(seg.railType).toBe(1);
    expect(seg.railFlags).toBe(4);
  });

  it('should still apply a same-level upgrade to the first cell', () => {
    // The cross-level guard must not block a legitimate paid upgrade drawn along
    // an existing viaduct at the same level.
    const grid = new Grid(30, 30);
    new RoadBuilder(grid).buildRoad({ x: 0, y: 5 }, { x: 0, y: 5 }, RoadType.TWO_LANE, 1e6);
    const em = new ElevationManager();
    const builder = new ElevatedRoadBuilder(grid, em);
    builder.buildElevatedRoad({ x: 0, y: 5 }, { x: 8, y: 5 }, RoadType.TWO_LANE, 1e6, 1);

    builder.buildElevatedRoad({ x: 5, y: 5 }, { x: 8, y: 5 }, RoadType.FOUR_LANE, 1e6, 1);

    expect(em.get(5, 5, 1)!.roadType).toBe(RoadType.FOUR_LANE);
  });

  it('should still extend at the same level without inventing a ramp', () => {
    const { em, builder } = viaductAtLevel1();

    const result = builder.buildElevatedRoad({ x: 8, y: 5 }, { x: 14, y: 5 }, RoadType.TWO_LANE, 1e6, 1);

    expect(result.success).toBe(true);
    expect(em.get(12, 5, 1)).not.toBeNull();
    expect(em.get(12, 5, 1)!.isRamp).toBe(false);
  });
});
