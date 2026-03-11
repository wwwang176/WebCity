import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType, isResidentialZone, isCommercialZone } from '../../grid/types';
import { countZoneBuildings } from '../BuildingQueries';

describe('countZoneBuildings', () => {
  it('counts cells matching a predicate', () => {
    const grid = new Grid(5, 5);
    grid.setCell(0, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 2 });
    grid.setCell(2, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 3 });

    expect(countZoneBuildings(grid, isResidentialZone)).toBe(2);
    expect(countZoneBuildings(grid, isCommercialZone)).toBe(1);
    expect(countZoneBuildings(grid, (z) => z === ZoneType.INDUSTRIAL)).toBe(0);
  });

  it('skips cells with buildingId 0', () => {
    const grid = new Grid(5, 5);
    grid.setCell(0, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 0 });

    expect(countZoneBuildings(grid, isResidentialZone)).toBe(0);
  });

  it('returns 0 for empty grid', () => {
    const grid = new Grid(3, 3);
    expect(countZoneBuildings(grid, isResidentialZone)).toBe(0);
  });

  it('counts industrial zones', () => {
    const grid = new Grid(5, 5);
    grid.setCell(0, 0, { zoneType: ZoneType.INDUSTRIAL, buildingId: 10 });
    grid.setCell(1, 0, { zoneType: ZoneType.INDUSTRIAL, buildingId: 11 });
    grid.setCell(2, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 12 });

    expect(countZoneBuildings(grid, (z) => z === ZoneType.INDUSTRIAL)).toBe(2);
  });
});
