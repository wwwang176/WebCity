import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { placeInfraOnGrid } from '../InfraPlacement';
import { placeTransportStopOnGrid } from '../../transport/TransportPlacement';
import { getInfraBuildingId } from '../InfraConfig';
import { isCellBuildable } from '../../grid/GridHelpers';

/**
 * BUG-074 fixed infrastructure placement leaving `zoneType` behind on the cells
 * it occupies, and a v7 save migration (BUG-135) cleaned up the saves that
 * already had it. Transport stops were never routed through either: Game.ts set
 * `buildingId` and `reserved` with a bare setCell and left `zoneType` intact,
 * quietly manufacturing the exact state the migration exists to remove.
 *
 * canPlaceTransportStop only rejects `roadType !== 0 || buildingId !== 0`, so a
 * bus stop on zoned-but-empty land is a single click away.
 */
function zonedGrid(): Grid {
  const grid = new Grid(20, 20);
  for (let x = 1; x <= 12; x++) grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  for (let x = 1; x <= 12; x++) grid.setCell(x, 5, { zoneType: ZoneType.COMMERCIAL_LOW });
  return grid;
}

describe('a cell that becomes infrastructure stops being a zone cell', () => {
  it('should clear the zone under a transport stop', () => {
    const grid = zonedGrid();
    expect(grid.getCell(6, 5)!.zoneType).toBe(ZoneType.COMMERCIAL_LOW);

    placeTransportStopOnGrid(grid, 6, 5, getInfraBuildingId('bus_stop'), 0);

    const cell = grid.getCell(6, 5)!;
    expect(cell.buildingId).toBe(getInfraBuildingId('bus_stop'));
    expect(cell.zoneType).toBe(ZoneType.NONE);
  });

  it('should leave the same state as placing any other single-cell facility', () => {
    // The whole point of the fix: one definition of "this cell is now
    // infrastructure", so a fifth placement path cannot drift from it again.
    const viaStop = zonedGrid();
    placeTransportStopOnGrid(viaStop, 6, 5, getInfraBuildingId('park'), 0);

    const viaInfra = zonedGrid();
    placeInfraOnGrid(viaInfra, 6, 5, 'park', 0);

    const a = viaStop.getCell(6, 5)!;
    const b = viaInfra.getCell(6, 5)!;
    expect({ buildingId: a.buildingId, zoneType: a.zoneType, reserved: a.reserved })
      .toEqual({ buildingId: b.buildingId, zoneType: b.zoneType, reserved: b.reserved });
  });

  it('should keep the rotation the caller asked for', () => {
    const grid = zonedGrid();
    placeTransportStopOnGrid(grid, 6, 5, getInfraBuildingId('metro_station'), 6);
    expect(grid.getCell(6, 5)!.reserved).toBe(6);
  });

  it('should not disturb the neighbours', () => {
    const grid = zonedGrid();
    placeTransportStopOnGrid(grid, 6, 5, getInfraBuildingId('bus_stop'), 0);
    expect(grid.getCell(5, 5)!.zoneType).toBe(ZoneType.COMMERCIAL_LOW);
    expect(grid.getCell(7, 5)!.zoneType).toBe(ZoneType.COMMERCIAL_LOW);
  });

  it('should make the cell unzonable afterwards', () => {
    // isCellBuildable is what ZoneManager.canZone consults. A cell still
    // carrying a zoneType while holding a building is the contradiction.
    const grid = zonedGrid();
    placeTransportStopOnGrid(grid, 6, 5, getInfraBuildingId('bus_stop'), 0);
    expect(isCellBuildable(grid.getCell(6, 5)!)).toBe(false);
  });

  it('should clear the zone under every cell of an airport footprint', () => {
    // placeInfraOnGrid already does this; the gap was that Game.placeAirport
    // never told the renderer, so the overlay quads stayed drawn under it.
    const grid = new Grid(20, 20);
    for (let x = 1; x <= 14; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    for (let y = 2; y <= 6; y++) {
      for (let x = 2; x <= 10; x++) grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW });
    }

    placeInfraOnGrid(grid, 2, 2, 'airport_s', 0);

    let zoned = 0;
    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId !== 0 && cell.zoneType !== ZoneType.NONE) zoned++;
      if (x >= 2 && x <= 6 && y >= 2 && y <= 5) {
        expect(cell.zoneType, `${x},${y}`).toBe(ZoneType.NONE);
      }
    });
    expect(zoned).toBe(0);
  });
});
