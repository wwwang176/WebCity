import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType, isResidentialZone, isCommercialZone, isWorkplaceZone } from '../../grid/types';
import { countZoneBuildings, sumBuildingCapacity, countResidentialCapacity, countWorkplaceJobs } from '../BuildingQueries';

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

describe('sumBuildingCapacity', () => {
  it('sums a property across matching zone buildings', () => {
    const grid = new Grid(5, 5);
    // buildingId=1 → Small House (residents=4), buildingId=4 → Small Apartment (residents=80)
    grid.setCell(0, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    grid.setCell(2, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    const result = sumBuildingCapacity(grid, isResidentialZone, bt => bt.residents);
    expect(result).toBe(4 + 80);
  });

  it('skips burned and secondary cells', () => {
    const grid = new Grid(5, 5);
    grid.setCell(0, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 3 }); // BURNED
    grid.setCell(2, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 4 }); // MULTI_CELL_OCCUPIED

    const result = sumBuildingCapacity(grid, isResidentialZone, bt => bt.residents);
    expect(result).toBe(4); // only first cell
  });

  it('returns 0 for empty grid', () => {
    const grid = new Grid(3, 3);
    expect(sumBuildingCapacity(grid, isResidentialZone, bt => bt.residents)).toBe(0);
  });

  it('works for workplace zones', () => {
    const grid = new Grid(5, 5);
    // buildingId=7 → Small Shop (workers=4), buildingId=13 → Small Factory (workers=10)
    grid.setCell(0, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(1, 0, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });

    const result = sumBuildingCapacity(grid, isWorkplaceZone, bt => bt.workers);
    expect(result).toBe(4 + 10);
  });

  it('countResidentialCapacity delegates to sumBuildingCapacity', () => {
    const grid = new Grid(5, 5);
    grid.setCell(0, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    expect(countResidentialCapacity(grid)).toBe(4);
  });

  it('countWorkplaceJobs delegates to sumBuildingCapacity', () => {
    const grid = new Grid(5, 5);
    grid.setCell(0, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    expect(countWorkplaceJobs(grid)).toBe(4);
  });
});
