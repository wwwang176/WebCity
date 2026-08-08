import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { isResidentialZone } from '../../grid/types';
import { countZoneBuildings } from '../BuildingQueries';
import { placeInfraOnGrid } from '../InfraPlacement';
import { BURNED, ABANDONED, MULTI_CELL_OCCUPIED } from '../InfraPlacement';

/**
 * countZoneBuildings feeds RCI supply (RCIDemand computes `base - supply`), the
 * office/industrial job ratios and residentialBuildingCount. Counting ruins and
 * infrastructure footprints as supply suppresses the demand that should be
 * driving reconstruction — the player sees demand indicators but nothing grows.
 *
 * sumBuildingCapacity in the same file already filters exactly these cases; the
 * asymmetry between the two is the bug.
 */
describe('countZoneBuildings excludes non-supply cells', () => {
  it('should not count a BURNED building as residential supply', () => {
    const grid = new Grid(10, 10);
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 0 });
    grid.setCell(2, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED });

    expect(countZoneBuildings(grid, isResidentialZone)).toBe(1);
  });

  it('should not count an ABANDONED building as residential supply', () => {
    const grid = new Grid(10, 10);
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 0 });
    grid.setCell(2, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: ABANDONED });

    expect(countZoneBuildings(grid, isResidentialZone)).toBe(1);
  });

  it('should not count multi-cell secondary cells twice', () => {
    const grid = new Grid(10, 10);
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 0 });
    grid.setCell(2, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: MULTI_CELL_OCCUPIED });

    expect(countZoneBuildings(grid, isResidentialZone)).toBe(1);
  });

  it('should not count an infrastructure footprint as zone supply', () => {
    // A 2x2 police station dropped onto already-zoned but empty residential land.
    const grid = new Grid(10, 10);
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 2; x++) grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW });
    }
    placeInfraOnGrid(grid, 1, 1, 'police', 0);

    expect(countZoneBuildings(grid, isResidentialZone)).toBe(0);
  });

  it('should still count ordinary buildings', () => {
    const grid = new Grid(10, 10);
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 0 });
    grid.setCell(2, 1, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 5, reserved: 0 });

    expect(countZoneBuildings(grid, isResidentialZone)).toBe(2);
  });
});

describe('placing infrastructure clears the underlying zone', () => {
  it('should clear zoneType across the whole footprint', () => {
    // removeInfraFromGrid already clears zoneType; placing did not, so a facility
    // dropped on empty industrial land kept zoneType === INDUSTRIAL and every one
    // of its footprint cells emitted factory-grade ground pollution and noise.
    const grid = new Grid(10, 10);
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 2; x++) grid.setCell(x, y, { zoneType: ZoneType.INDUSTRIAL });
    }

    placeInfraOnGrid(grid, 1, 1, 'fire', 0);

    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 2; x++) {
        expect(grid.getCell(x, y)!.zoneType).toBe(ZoneType.NONE);
      }
    }
  });
});
