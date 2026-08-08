import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { ZoneManager } from '../ZoneManager';
import { planRezone } from '../RezonePlan';
import { ElevationManager } from '../../elevation/ElevationManager';

/**
 * The plan and setZoneRect must agree cell for cell. Anything the plan lists
 * but setZone refuses becomes a zombie building: evicted and un-rendered by
 * Game.applyZone, still present on the grid with its buildingId.
 */
function cityWithHouses(): Grid {
  const grid = new Grid(12, 12);
  for (let x = 1; x <= 6; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  for (let x = 1; x <= 6; x++) {
    grid.setCell(x, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  return grid;
}

const RECT = { minX: 1, minY: 2, maxX: 6, maxY: 2 };

describe('a rezone plan lists exactly the cells the rezone will clear', () => {
  it('should list every built cell when the rezone can go ahead', () => {
    const grid = cityWithHouses();
    const zones = new ZoneManager(grid);

    const planned = planRezone(grid, zones, RECT, ZoneType.COMMERCIAL_LOW);

    expect(planned).toHaveLength(6);
  });

  it('should list nothing once the road is gone', () => {
    // The exact scenario: pull up the road, then rezone the block. setZone
    // refuses on NOT_ADJACENT_TO_ROAD, so nothing may be torn down.
    const grid = cityWithHouses();
    for (let x = 1; x <= 6; x++) grid.setCell(x, 1, { roadType: RoadType.NONE, roadFlags: 0 });
    const zones = new ZoneManager(grid);

    expect(planRezone(grid, zones, RECT, ZoneType.COMMERCIAL_LOW)).toEqual([]);
  });

  it('should skip cells a viaduct passes over', () => {
    const grid = cityWithHouses();
    const em = new ElevationManager();
    em.set(3, 2, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: 3, railType: 0, railFlags: 0,
      isRamp: false, rampAscendDirection: 0,
    });
    const zones = new ZoneManager(grid);
    zones.setElevationManager(em);

    const planned = planRezone(grid, zones, RECT, ZoneType.COMMERCIAL_LOW);

    expect(planned).not.toContain('3,2');
    expect(planned).toHaveLength(5);
  });

  it('should list nothing when the zone type is unchanged', () => {
    const grid = cityWithHouses();
    const zones = new ZoneManager(grid);
    expect(planRezone(grid, zones, RECT, ZoneType.RESIDENTIAL_LOW)).toEqual([]);
  });

  it('should agree with what setZoneRect actually clears', () => {
    // The invariant, stated directly: planned cells lose their building, and
    // unplanned ones keep it.
    const grid = cityWithHouses();
    const em = new ElevationManager();
    em.set(3, 2, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: 3, railType: 0, railFlags: 0,
      isRamp: false, rampAscendDirection: 0,
    });
    const zones = new ZoneManager(grid);
    zones.setElevationManager(em);

    const planned = new Set(planRezone(grid, zones, RECT, ZoneType.COMMERCIAL_LOW));
    zones.setZoneRect({ x: RECT.minX, y: RECT.minY }, { x: RECT.maxX, y: RECT.maxY }, ZoneType.COMMERCIAL_LOW);

    for (let x = RECT.minX; x <= RECT.maxX; x++) {
      const cleared = grid.getCell(x, 2)!.buildingId === 0;
      expect(cleared, `(${x},2) cleared=${cleared} planned=${planned.has(`${x},2`)}`)
        .toBe(planned.has(`${x},2`));
    }
  });
});
