import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneManager } from '../ZoneManager';
import { BuildingGrowth, type GrowthConditions } from '../../building/BuildingGrowth';
import { ABANDONED, BURNED } from '../../building/InfraPlacement';

/**
 * `reserved` is a multi-purpose field: it carries ABANDONED/BURNED status as
 * well as multi-cell occupancy. setCell is a partial patch, so any call site
 * that clears buildingId without also clearing reserved strands a ruin marker
 * on the cell. The BURNED/ABANDONED guards in BuildingGrowthTick all require
 * isZoneBuilding(cell.buildingId), which is false for 0, so the cell falls
 * straight through to regrowth and the new building is permanently a ruin —
 * untaxed, zero capacity, nobody can live or work there — while the renderer
 * draws it as a normal lit building.
 */
function setup(): { grid: Grid; zone: ZoneManager; growth: BuildingGrowth } {
  const grid = new Grid(20, 20);
  new RoadBuilder(grid).buildRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.TWO_LANE, 100000);
  return { grid, zone: new ZoneManager(grid), growth: new BuildingGrowth(grid) };
}

const fullConditions: GrowthConditions = {
  hasPower: true,
  hasWater: true,
  rciDemand: { residential: 50, commercial: 50, industrial: 50 },
};

describe('rezoning clears the reserved ruin marker', () => {
  it('should clear reserved when rezoning demolishes a BURNED building', () => {
    const { grid, zone } = setup();
    zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    grid.setCell(5, 4, { buildingId: 1, reserved: BURNED });

    zone.setZone(5, 4, ZoneType.COMMERCIAL_LOW);

    const cell = grid.getCell(5, 4)!;
    expect(cell.buildingId).toBe(0);
    expect(cell.reserved).toBe(0);
  });

  it('should clear reserved when rezoning demolishes an ABANDONED building', () => {
    const { grid, zone } = setup();
    zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    grid.setCell(5, 4, { buildingId: 1, reserved: ABANDONED });

    zone.setZone(5, 4, ZoneType.INDUSTRIAL);

    expect(grid.getCell(5, 4)!.reserved).toBe(0);
  });

  it('should grow a clean building even if a stale reserved marker survives', () => {
    // Defence in depth: a newly grown building must never inherit a ruin marker,
    // whatever left it behind.
    const { grid, zone, growth } = setup();
    zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    grid.setCell(5, 4, { buildingId: 0, reserved: BURNED });

    expect(growth.tryGrow(5, 4, fullConditions)).toBe(true);

    const cell = grid.getCell(5, 4)!;
    expect(cell.buildingId).toBeGreaterThan(0);
    expect(cell.reserved).toBe(0);
  });

  it('should keep the building when rezoning to the same type', () => {
    const { grid, zone } = setup();
    zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    grid.setCell(5, 4, { buildingId: 1, reserved: BURNED });

    zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);

    const cell = grid.getCell(5, 4)!;
    expect(cell.buildingId).toBe(1);
    expect(cell.reserved).toBe(BURNED);
  });
});
