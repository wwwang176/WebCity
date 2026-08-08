import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { countResidentialCapacity } from '../../building/BuildingQueries';
import { residentsAtHome } from '../HomeCapacity';
import { ABANDONED, BURNED } from '../../building/InfraPlacement';
import { getInfraBuildingId } from '../../building/InfraConfig';

/**
 * BUG-140 removed createCitizen's aggregate capacity gate from the birth path,
 * on the argument that birthTick has already checked the destination building's
 * own occupancy — which it has. But that gate was also the backstop that made a
 * missed eviction harmless, and what replaced it as the only bound on
 * birth-driven growth was SimulationLoop's per-home lookup:
 *
 *     if (!cell || !cell.buildingId) return SIMULATION.FALLBACK_RESIDENTS;  // 8
 *
 * No isActiveZoneCell check, no zoneType check, and a POSITIVE fallback of 8
 * for an address with no building at all — while countResidentialCapacity, the
 * city-wide figure it has to agree with, contributes 0 for exactly those cells.
 * Any homeId that outlives its building grants that phantom address eight rooms,
 * refilled every month, forever (BUG-164).
 */
function city(): Grid {
  const grid = new Grid(16, 16);
  for (let x = 1; x <= 10; x++) grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  return grid;
}

describe('one home, one capacity', () => {
  it('should report a live house at its building type capacity', () => {
    const grid = city();
    grid.setCell(3, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    expect(residentsAtHome(grid, '3,5')).toBe(4);
  });

  it('should report nothing for an address with no building', () => {
    // The phantom address. Eight uncounted rooms, every month, forever.
    expect(residentsAtHome(city(), '7,7')).toBe(0);
  });

  it('should report nothing for a ruin', () => {
    for (const reserved of [BURNED, ABANDONED]) {
      const grid = city();
      grid.setCell(3, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved });
      expect(residentsAtHome(grid, '3,5'), `reserved=${reserved}`).toBe(0);
    }
  });

  it('should report nothing for a building that is not housing', () => {
    const grid = city();
    grid.setCell(3, 5, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
    expect(residentsAtHome(grid, '3,5')).toBe(0);

    grid.setCell(6, 5, { buildingId: getInfraBuildingId('police') });
    expect(residentsAtHome(grid, '6,5')).toBe(0);
  });

  it('should report nothing for a malformed or out-of-bounds address', () => {
    const grid = city();
    expect(residentsAtHome(grid, '')).toBe(0);
    expect(residentsAtHome(grid, 'nowhere')).toBe(0);
    expect(residentsAtHome(grid, '999,999')).toBe(0);
  });

  it('should sum to exactly the city-wide capacity', () => {
    // The binding assertion. Per-home is now the only bound on birth-driven
    // growth, so it has to agree with the figure the city reports about itself
    // — cell for cell, not on average.
    const grid = city();
    grid.setCell(1, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    grid.setCell(2, 5, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    grid.setCell(3, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 3 });
    grid.setCell(4, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED });
    grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(6, 5, { zoneType: ZoneType.RESIDENTIAL_LOW });

    let perHome = 0;
    grid.forEachCell((_cell, x, y) => { perHome += residentsAtHome(grid, `${x},${y}`); });

    expect(perHome).toBe(countResidentialCapacity(grid));
    expect(perHome).toBeGreaterThan(0);
  });
});
