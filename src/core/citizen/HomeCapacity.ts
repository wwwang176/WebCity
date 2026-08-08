import { getBuildingType } from '../building/types';
import { isActiveZoneCell } from '../building/BuildingQueries';
import { isResidentialZone, type ZoneType } from '../grid/types';

interface CapacityGrid {
  getCell(x: number, y: number): {
    buildingId: number; zoneType: number; reserved: number;
  } | null;
}

/**
 * How many people the building at this homeId can house. Zero if there is no
 * such building.
 *
 * BUG-140 removed createCitizen's aggregate capacity gate from the birth path,
 * on the sound argument that birthTick has already checked the destination
 * building's own occupancy. But that gate was also the backstop that made a
 * missed eviction path harmless, and what replaced it as the only bound on
 * birth-driven growth was a lookup that answered
 * `FALLBACK_RESIDENTS` — eight — for an address with no building at all, and
 * asked nothing about ruins or zone type. countResidentialCapacity, the
 * city-wide figure it has to agree with, contributes 0 for exactly those cells.
 * So any homeId outliving its building granted that phantom address eight
 * uncounted rooms, refilled every month, forever (BUG-164).
 *
 * Every eviction path in the game clears homeId today, so this is a backstop
 * rather than a live overfill — which is precisely the role the gate it
 * replaced was playing.
 */
export function residentsAtHome(grid: CapacityGrid, homeId: string): number {
  const comma = homeId.indexOf(',');
  if (comma < 0) return 0;
  const x = Number(homeId.slice(0, comma));
  const y = Number(homeId.slice(comma + 1));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;

  const cell = grid.getCell(x, y);
  if (!cell || !isActiveZoneCell(cell)) return 0;
  if (!isResidentialZone(cell.zoneType as ZoneType)) return 0;
  return getBuildingType(cell.buildingId)?.residents ?? 0;
}
