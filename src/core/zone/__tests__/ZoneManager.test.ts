import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType, ZoneType } from '../../grid/types';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneManager } from '../ZoneManager';
import { RailType } from '../../rail/types';

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

  it('should fail to zone a cell not within road reach', () => {
    const { zone } = setupGridWithRoad();
    const result = zone.setZone(0, 0, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('NOT_ADJACENT_TO_ROAD');
  });

  it('should allow zoning a cell one tile away from a road (Chebyshev reach=2)', () => {
    // Road along y=5 from x=5..15. Cell at (5, 3) sits one empty tile (y=4) from the road.
    const { grid, zone } = setupGridWithRoad();
    const result = zone.setZone(5, 3, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(true);
    expect(grid.getCell(5, 3)!.zoneType).toBe(ZoneType.RESIDENTIAL_LOW);
  });

  it('should reject zoning a cell two tiles away from road (beyond reach)', () => {
    // Road along y=5. Cell at (5, 2) is two empty tiles (y=3, y=4) from the road — Chebyshev 3.
    const { zone } = setupGridWithRoad();
    const result = zone.setZone(5, 2, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('NOT_ADJACENT_TO_ROAD');
  });

  it('should batch zone a rectangular area', () => {
    const { grid, zone } = setupGridWithRoad();
    zone.setZoneRect(
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

  it('should allow zoning a cell with a regular building', () => {
    const { grid, zone } = setupGridWithRoad();
    grid.setCell(5, 4, { buildingId: 1 });
    const result = zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(true);
  });

  it('should clear building when rezoning to a different zone type', () => {
    const { grid, zone } = setupGridWithRoad();
    // Zone as residential and place a house
    zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    grid.setCell(5, 4, { buildingId: 1 }); // Small House (RESIDENTIAL_LOW)
    // Rezone to commercial
    const result = zone.setZone(5, 4, ZoneType.COMMERCIAL_LOW);
    expect(result.success).toBe(true);
    expect(grid.getCell(5, 4)!.zoneType).toBe(ZoneType.COMMERCIAL_LOW);
    expect(grid.getCell(5, 4)!.buildingId).toBe(0); // building should be demolished
  });

  it('should keep building when rezoning to the same zone type', () => {
    const { grid, zone } = setupGridWithRoad();
    zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    grid.setCell(5, 4, { buildingId: 1 }); // Small House
    // Re-apply the same zone type
    const result = zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(true);
    expect(grid.getCell(5, 4)!.buildingId).toBe(1); // building should remain
  });

  it('should fail to zone a cell with infrastructure', () => {
    const { grid, zone } = setupGridWithRoad();
    grid.setCell(5, 4, { buildingId: 254 }); // power plant
    const result = zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('CELL_NOT_BUILDABLE');
  });

  it('should fail to zone a water tile', () => {
    const { grid, zone } = setupGridWithRoad();
    grid.setCell(5, 4, { terrainType: TerrainType.WATER });
    const result = zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('CELL_NOT_BUILDABLE');
  });

  it('should fail to zone a mountain tile', () => {
    const { grid, zone } = setupGridWithRoad();
    grid.setCell(5, 4, { terrainType: TerrainType.MOUNTAIN });
    const result = zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('CELL_NOT_BUILDABLE');
  });

  it('should allow zoning a forest tile adjacent to road', () => {
    const { grid, zone } = setupGridWithRoad();
    grid.setCell(5, 4, { terrainType: TerrainType.FOREST });
    const result = zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(true);
  });

  it('should skip water tiles in batch zoning', () => {
    const { grid, zone } = setupGridWithRoad();
    grid.setCell(6, 4, { terrainType: TerrainType.WATER });
    const results = zone.setZoneRect({ x: 5, y: 4 }, { x: 7, y: 4 }, ZoneType.RESIDENTIAL_LOW);
    const successes = results.filter(r => r.success).length;
    const blocked = results.filter(r => r.reason === 'CELL_NOT_BUILDABLE').length;
    expect(successes).toBe(2); // 5,4 and 7,4
    expect(blocked).toBe(1); // 6,4 (water)
  });

  it('should fail to zone a cell with rail track', () => {
    const { grid, zone } = setupGridWithRoad();
    grid.setCell(5, 4, { railType: RailType.STANDARD, railFlags: 3 });
    const result = zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('CELL_NOT_BUILDABLE');
  });

  it('should skip rail track cells in batch zone', () => {
    const { grid, zone } = setupGridWithRoad();
    grid.setCell(6, 4, { railType: RailType.STANDARD, railFlags: 3 });
    const results = zone.setZoneRect({ x: 5, y: 4 }, { x: 7, y: 4 }, ZoneType.COMMERCIAL_LOW);
    const successes = results.filter(r => r.success).length;
    const blocked = results.filter(r => r.reason === 'CELL_NOT_BUILDABLE').length;
    expect(successes).toBe(2);
    expect(blocked).toBe(1);
  });
});
