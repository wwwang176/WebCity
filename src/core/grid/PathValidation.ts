import { TerrainType, type Position } from './types';
import { getInfraConfigById } from '../building/InfraConfig';
import { type ElevationManager } from '../elevation/ElevationManager';

interface CellLike {
  terrainType: number;
  buildingId: number;
}

interface GridLike {
  getCell(x: number, y: number): CellLike | null;
}

/**
 * Validate that a path of grid cells is buildable (terrain + infrastructure checks).
 * Shared by RoadBuilder and RailBuilder — DRY extraction of duplicated validation.
 * Returns null if valid, or a reason string if invalid.
 *
 * If elevationManager is provided, also blocks building under ramps
 * (ramp low side at level 0 occupies ground space).
 */
export function validatePathTerrain(grid: GridLike, cells: Position[], elevationManager?: ElevationManager): string | null {
  const blocked = firstBlockedIndex(grid, cells, elevationManager);
  return blocked === null ? null : blocked.reason;
}

/**
 * The first cell of `cells` that cannot be built on, and why.
 *
 * Separated from validatePathTerrain so a caller can stop AT the obstacle
 * instead of throwing the whole drag away: dragging a road into the sea used to
 * cancel everything and report "Cannot build on water", leaving the player to
 * find the shoreline by shortening the drag and trying again.
 */
export function firstBlockedIndex(
  grid: GridLike, cells: Position[], elevationManager?: ElevationManager,
): { index: number; reason: string } | null {
  for (let i = 0; i < cells.length; i++) {
    const pos = cells[i]!;
    const cell = grid.getCell(pos.x, pos.y);
    if (!cell) return { index: i, reason: 'OUT_OF_BOUNDS' };
    if (cell.terrainType === TerrainType.WATER) return { index: i, reason: 'WATER_TILE' };
    if (cell.terrainType === TerrainType.MOUNTAIN) return { index: i, reason: 'MOUNTAIN_TILE' };
    if (getInfraConfigById(cell.buildingId)) return { index: i, reason: 'INFRASTRUCTURE_EXISTS' };
    if (elevationManager?.hasRampAtLevel(pos.x, pos.y, 0)) return { index: i, reason: 'RAMP_ABOVE' };
  }
  return null;
}
