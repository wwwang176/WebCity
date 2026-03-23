import { findAdjacentRoad } from '../grid/GridHelpers';
import { gridAStarPath } from './Pathfinding';
import { findElevatedPath } from '../elevation/ElevatedPathfinding';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';

interface PathfindGrid {
  getCell(x: number, y: number): { roadType: number } | null;
  width: number;
  height: number;
}

/**
 * Find a road path between two building positions.
 * Tries elevation-aware pathfinding first (if UnifiedRoadLookup provided),
 * falls back to ground-only A*.
 * Returns the cell-key path or null if no route exists.
 */
export function findRoadPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  grid: PathfindGrid,
  roadLookup?: UnifiedRoadLookup,
): string[] | null {
  const startRoad = findAdjacentRoad(grid, from.x, from.y);
  const endRoad = findAdjacentRoad(grid, to.x, to.y);
  if (!startRoad || !endRoad) return null;
  if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) return null;

  // Try elevated path first (can traverse bridges/viaducts)
  if (roadLookup) {
    const elevatedResult = findElevatedPath(grid, roadLookup, startRoad, endRoad);
    if (elevatedResult) return elevatedResult;
  }

  // Fallback to ground-only
  return gridAStarPath(startRoad, endRoad, grid);
}
