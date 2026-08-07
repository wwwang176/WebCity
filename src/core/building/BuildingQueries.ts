import type { ZoneType } from '../grid/types';
import { isResidentialZone, isWorkplaceZone } from '../grid/types';
import { getBuildingType, type BuildingType } from './types';
import { MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from './InfraPlacement';
import { isZoneBuilding } from './InfraConfig';

interface GridLike {
  forEachCell(callback: (cell: { buildingId: number; zoneType: number; reserved?: number }, x: number, y: number) => void): void;
}

/**
 * A cell that genuinely contributes zone supply: a real zone building (not
 * infrastructure) in a working state (not a ruin, not a multi-cell secondary).
 * Shared by countZoneBuildings and sumBuildingCapacity so the two can no longer
 * disagree about what counts.
 */
export function isActiveZoneCell(cell: { buildingId: number; reserved?: number }): boolean {
  if (!isZoneBuilding(cell.buildingId)) return false;
  const r = cell.reserved ?? 0;
  return r !== BURNED && r !== ABANDONED && r !== MULTI_CELL_OCCUPIED;
}

interface CapacityGridLike {
  width: number;
  height: number;
  getCell(x: number, y: number): { buildingId: number; zoneType: number; reserved?: number } | null;
}

/**
 * Count buildings on the grid whose zoneType matches the given predicate (OCP-friendly).
 *
 * The result feeds RCI supply (`base - supply` in RCIDemand), the office and
 * industrial job ratios, and residentialBuildingCount. It used to test only
 * `buildingId > 0`, so ruins and infrastructure footprints counted as supply:
 * a burnt-out block suppressed the very demand that should have driven its
 * reconstruction, and a 2x2 power plant on zoned land added +4 residential
 * supply out of thin air (BUG-073).
 */
export function countZoneBuildings(grid: GridLike, predicate: (zoneType: ZoneType) => boolean): number {
  let count = 0;
  grid.forEachCell((cell) => {
    if (isActiveZoneCell(cell) && predicate(cell.zoneType as ZoneType)) count++;
  });
  return count;
}

/**
 * Sum a building property across all grid cells matching a zone predicate.
 * Excludes burned and multi-cell secondary cells.
 * DRY generic for countResidentialCapacity / countWorkplaceJobs.
 */
export function sumBuildingCapacity(
  grid: CapacityGridLike,
  zonePredicate: (zoneType: ZoneType) => boolean,
  getCapacity: (bt: BuildingType) => number,
): number {
  let total = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.getCell(x, y);
      if (cell && isActiveZoneCell(cell) && zonePredicate(cell.zoneType as ZoneType)) {
        const bt = getBuildingType(cell.buildingId);
        if (bt) total += getCapacity(bt);
      }
    }
  }
  return total;
}

/** Count total residential capacity (sum of building.residents) excluding burned/secondary cells. */
export function countResidentialCapacity(grid: CapacityGridLike): number {
  return sumBuildingCapacity(grid, isResidentialZone, bt => bt.residents);
}

/** Count total workplace jobs (sum of building.workers) excluding burned/secondary cells. */
export function countWorkplaceJobs(grid: CapacityGridLike): number {
  return sumBuildingCapacity(grid, isWorkplaceZone, bt => bt.workers);
}
