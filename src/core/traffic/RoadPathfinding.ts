import { findAdjacentRoad } from '../grid/GridHelpers';
import { gridAStarPath } from './Pathfinding';

interface PathfindGrid {
  getCell(x: number, y: number): { roadType: number } | null;
  width: number;
  height: number;
}

/**
 * Find a road path between two building positions.
 * Locates adjacent road cells for each position, then runs A* pathfinding.
 * Returns the cell-key path or null if no route exists.
 */
export function findRoadPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  grid: PathfindGrid,
): string[] | null {
  const startRoad = findAdjacentRoad(grid, from.x, from.y);
  const endRoad = findAdjacentRoad(grid, to.x, to.y);
  if (!startRoad || !endRoad) return null;
  if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) return null;
  return gridAStarPath(startRoad, endRoad, grid);
}
