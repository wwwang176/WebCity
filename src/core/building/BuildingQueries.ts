import type { ZoneType } from '../grid/types';
import { isResidentialZone, isWorkplaceZone } from '../grid/types';
import { getBuildingType, type BuildingType } from './types';
import { MULTI_CELL_OCCUPIED, BURNED } from './InfraPlacement';

interface GridLike {
  forEachCell(callback: (cell: { buildingId: number; zoneType: number }, x: number, y: number) => void): void;
}

interface CapacityGridLike {
  width: number;
  height: number;
  getCell(x: number, y: number): { buildingId: number; zoneType: number; reserved?: number } | null;
}

/** Count buildings on the grid whose zoneType matches the given predicate (OCP-friendly). */
export function countZoneBuildings(grid: GridLike, predicate: (zoneType: ZoneType) => boolean): number {
  let count = 0;
  grid.forEachCell((cell) => {
    if (cell.buildingId > 0 && predicate(cell.zoneType as ZoneType)) count++;
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
      if (cell && cell.buildingId > 0 && zonePredicate(cell.zoneType as ZoneType) && cell.reserved !== BURNED && cell.reserved !== MULTI_CELL_OCCUPIED) {
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
