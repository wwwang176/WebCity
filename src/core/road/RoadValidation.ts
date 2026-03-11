import { TerrainType } from '../grid/types';
import { getInfraConfigById } from '../building/InfraConfig';
import { hasVerticalFlag, hasHorizontalFlag, getDirectionFlag } from '../grid/GridHelpers';
import { RoadType, ROAD_CONFIGS } from './types';
import { RailType } from '../rail/types';

interface Position {
  x: number;
  y: number;
}

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
 * Extracted from RoadBuilder for SRP — validation is independent of construction.
 */
export function validateRoadPath(grid: GridLike, cells: Position[]): string | null {
  // Terrain + infrastructure check
  for (const pos of cells) {
    const cell = grid.getCell(pos.x, pos.y);
    if (!cell) return 'OUT_OF_BOUNDS';
    if (cell.terrainType === TerrainType.WATER) return 'WATER_TILE';
    if (cell.terrainType === TerrainType.MOUNTAIN) return 'MOUNTAIN_TILE';
    if (getInfraConfigById(cell.buildingId)) return 'INFRASTRUCTURE_EXISTS';
  }

  // Parallel rail conflict check
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
 * Extracted from RoadBuilder for SRP — cost calculation is independent of construction.
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
