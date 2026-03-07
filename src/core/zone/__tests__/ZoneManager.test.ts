import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneManager } from '../ZoneManager';

describe('ZoneManager', () => {
  function setupGridWithRoad(): { grid: Grid; zone: ZoneManager } {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.TWO_LANE, 100000);
    return { grid, zone: new ZoneManager(grid) };
  }

  it('should zone a cell adjacent to a road as RESIDENTIAL_LOW', () => {
    const { grid, zone } = setupGridWithRoad();
    const result = zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(true);
    expect(grid.getCell(5, 4)!.zoneType).toBe(ZoneType.RESIDENTIAL_LOW);
  });

  it('should fail to zone a cell not adjacent to a road', () => {
    const { zone } = setupGridWithRoad();
    const result = zone.setZone(0, 0, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('NOT_ADJACENT_TO_ROAD');
  });

  it('should batch zone a rectangular area', () => {
    const { grid, zone } = setupGridWithRoad();
    const results = zone.setZoneRect(
      { x: 5, y: 4 },
      { x: 10, y: 4 },
      ZoneType.COMMERCIAL_LOW,
    );
    // Only cells adjacent to road should be zoned
    let zonedCount = 0;
    for (let x = 5; x <= 10; x++) {
      const cell = grid.getCell(x, 4);
      if (cell && cell.zoneType === ZoneType.COMMERCIAL_LOW) zonedCount++;
    }
    expect(zonedCount).toBeGreaterThan(0);
  });

  it('should clear a zone', () => {
    const { grid, zone } = setupGridWithRoad();
    zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    zone.clearZone(5, 4);
    expect(grid.getCell(5, 4)!.zoneType).toBe(ZoneType.NONE);
  });

  it('should fail to zone a cell with an existing building', () => {
    const { grid, zone } = setupGridWithRoad();
    grid.setCell(5, 4, { buildingId: 1 });
    const result = zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('BUILDING_EXISTS');
  });
});
