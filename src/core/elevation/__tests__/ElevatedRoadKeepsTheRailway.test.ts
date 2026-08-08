import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { ElevationManager } from '../ElevationManager';
import { ElevatedRoadBuilder } from '../ElevatedRoadBuilder';

/**
 * BUG-096/BUG-117 established the rule: an elevated run must never rewrite an
 * existing segment's paid state — no free downgrade of a paid HIGHWAY, no
 * silent deletion of a span of elevated railway.
 *
 * The guard that enforces it is gated on `!segAtTargetLevel`. When the segment
 * sitting at the TARGET level is a rail-only deck, that gate is open:
 * `existingAtStart` stays null and the placement loop writes
 * `railType: 0, railFlags: 0` outright. One span of the railway bridge is
 * deleted, unpaid and unannounced — the precise outcome the comment three lines
 * above says it prevents (BUG-163).
 */
function railViaductAt(level: number): { grid: Grid; em: ElevationManager } {
  const grid = new Grid(24, 24);
  // Ground road only WEST of the viaduct: a ramp cannot be built over a road,
  // so the corridor the elevated run needs has to be clear.
  for (let x = 2; x <= 6; x++) grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  const em = new ElevationManager();
  // A rail-only viaduct crossing over (8,5).
  em.set(8, 5, level, {
    roadType: 0, roadFlags: 0, railType: 1, railFlags: 3,
    isRamp: false, rampAscendDirection: 0,
  });
  return { grid, em };
}

describe('an elevated road does not eat the railway it starts on', () => {
  for (const level of [1, 2, 3]) {
    it(`should keep a rail-only deck at level ${level} when building at that level`, () => {
      const { grid, em } = railViaductAt(level);
      const builder = new ElevatedRoadBuilder(grid, em);

      const result = builder.buildElevatedRoad(
        { x: 8, y: 5 }, { x: 16, y: 5 }, RoadType.TWO_LANE, 1e6, level,
      );
      // Without this the whole case is vacuous: a build that never happened
      // cannot delete anything.
      expect(result.success, `build failed: ${JSON.stringify(result)}`).toBe(true);

      const seg = em.get(8, 5, level);
      expect(seg, `level ${level} segment must survive`).not.toBeNull();
      expect(seg!.railType, `railway at level ${level} was deleted`).toBe(1);
      expect(seg!.railFlags).toBe(3);
    });
  }

  it('should still let a legitimate same-level road upgrade through', () => {
    // The exception the guard is deliberately narrow for: redrawing a wider
    // road along an existing viaduct at the same level is a paid upgrade and
    // must still apply to the first cell.
    const grid = new Grid(24, 24);
    for (let x = 2; x <= 6; x++) grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    const em = new ElevationManager();
    em.set(8, 5, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: 12, railType: 0, railFlags: 0,
      isRamp: false, rampAscendDirection: 0,
    });

    const result = new ElevatedRoadBuilder(grid, em).buildElevatedRoad(
      { x: 8, y: 5 }, { x: 16, y: 5 }, RoadType.SIX_LANE, 1e6, 1,
    );

    expect(result.success, `build failed: ${JSON.stringify(result)}`).toBe(true);
    expect(em.get(8, 5, 1)!.roadType).toBe(RoadType.SIX_LANE);
  });

  it('should not silently downgrade a paid road at a cross-level start', () => {
    // BUG-117's own case, kept as a control: the guard that BUG-163 widens must
    // not have loosened this one.
    const grid = new Grid(24, 24);
    for (let x = 2; x <= 6; x++) grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    const em = new ElevationManager();
    em.set(8, 5, 3, {
      roadType: RoadType.HIGHWAY, roadFlags: 12, railType: 0, railFlags: 0,
      isRamp: false, rampAscendDirection: 0,
    });

    const result = new ElevatedRoadBuilder(grid, em).buildElevatedRoad(
      { x: 8, y: 5 }, { x: 16, y: 5 }, RoadType.TWO_LANE, 1e6, 2,
    );

    expect(result.success, `build failed: ${JSON.stringify(result)}`).toBe(true);
    expect(em.get(8, 5, 3)!.roadType).toBe(RoadType.HIGHWAY);
  });
});
