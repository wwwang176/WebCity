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
  for (const pos of cells) {
    const cell = grid.getCell(pos.x, pos.y);
    if (!cell) return 'OUT_OF_BOUNDS';
    if (cell.terrainType === TerrainType.WATER) return 'WATER_TILE';
    if (cell.terrainType === TerrainType.MOUNTAIN) return 'MOUNTAIN_TILE';
    if (getInfraConfigById(cell.buildingId)) return 'INFRASTRUCTURE_EXISTS';
    if (elevationManager?.hasRampAtLevel(pos.x, pos.y, 0)) return 'RAMP_ABOVE';
  }
  return null;
}
