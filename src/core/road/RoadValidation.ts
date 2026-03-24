import { type Position } from '../grid/types';
import { validatePathTerrain } from '../grid/PathValidation';
import { hasVerticalFlag, hasHorizontalFlag, getDirectionFlag } from '../grid/GridHelpers';
import { RoadType, ROAD_CONFIGS } from './types';
import { RailType } from '../rail/types';
import { type ElevationManager } from '../elevation/ElevationManager';

interface CellLike {
  terrainType: number;
  buildingId: number;
  roadType: number;
  roadFlags: number;
  railType?: number;
  railFlags: number;
}

interface GridLike {
  getCell(x: number, y: number): CellLike | null;
}

/**
 * Validate a road path for terrain, infrastructure, and rail conflicts.
 * Returns null if valid, or a reason string if invalid.
 * Uses shared validatePathTerrain (DRY) + road-specific parallel rail check.
 */
export function validateRoadPath(grid: GridLike, cells: Position[], elevationManager?: ElevationManager): string | null {
  // Shared terrain + infrastructure check (DRY)
  const terrainError = validatePathTerrain(grid, cells, elevationManager);
  if (terrainError) return terrainError;

  // Road-specific: parallel rail conflict check
  for (let i = 0; i < cells.length; i++) {
    const pos = cells[i]!;
    const cell = grid.getCell(pos.x, pos.y)!;
    if (cell.railType !== undefined && cell.railType !== RailType.NONE) {
      let roadFlags = 0;
      if (i > 0) roadFlags |= getDirectionFlag(pos, cells[i - 1]!);
      if (i < cells.length - 1) roadFlags |= getDirectionFlag(pos, cells[i + 1]!);
      const roadVert = hasVerticalFlag(roadFlags);
      const roadHorz = hasHorizontalFlag(roadFlags);
      const railVert = hasVerticalFlag(cell.railFlags);
      const railHorz = hasHorizontalFlag(cell.railFlags);
      if ((roadVert && railVert) || (roadHorz && railHorz)) {
        return 'PARALLEL_RAIL';
      }
    }
  }

  return null;
}

/**
 * Calculate the total cost for building a road along a path.
 * Charges differential pricing when upgrading existing roads.
 */
export function calculateRoadCost(grid: GridLike, cells: Position[], roadType: RoadType): number {
  const config = ROAD_CONFIGS[roadType];
  let totalCost = 0;

  for (const pos of cells) {
    const cell = grid.getCell(pos.x, pos.y)!;
    if (cell.roadType !== RoadType.NONE) {
      const existingCost = ROAD_CONFIGS[cell.roadType as RoadType].cost;
      totalCost += Math.max(0, config.cost - existingCost);
    } else {
      totalCost += config.cost;
    }
  }

  return totalCost;
}
