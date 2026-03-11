import { TerrainType } from './types';
import { getInfraConfigById } from '../building/InfraConfig';

interface Position {
  x: number;
  y: number;
}

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
 */
export function validatePathTerrain(grid: GridLike, cells: Position[]): string | null {
  for (const pos of cells) {
    const cell = grid.getCell(pos.x, pos.y);
    if (!cell) return 'OUT_OF_BOUNDS';
    if (cell.terrainType === TerrainType.WATER) return 'WATER_TILE';
    if (cell.terrainType === TerrainType.MOUNTAIN) return 'MOUNTAIN_TILE';
    if (getInfraConfigById(cell.buildingId)) return 'INFRASTRUCTURE_EXISTS';
  }
  return null;
}
