import { findAdjacentRoad } from '../grid/GridHelpers';
import { gridAStarPath } from './Pathfinding';
import { findElevatedPath } from '../elevation/ElevatedPathfinding';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';
import { type LaneGraph } from './LaneGraph';

interface PathfindGrid {
  getCell(x: number, y: number): { roadType: number } | null;
  width: number;
  height: number;
}

/**
 * Find a road path between two building positions.
 * Uses LaneGraph connectivity as source of truth for A* neighbor discovery.
 * Falls back to ground-only A* if no lookup/laneGraph provided.
 */
export function findRoadPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  grid: PathfindGrid,
  roadLookup?: UnifiedRoadLookup,
  laneGraph?: LaneGraph,
): string[] | null {
  const startRoad = findAdjacentRoad(grid, from.x, from.y);
  const endRoad = findAdjacentRoad(grid, to.x, to.y);
  if (!startRoad || !endRoad) return null;
  if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) return null;

  if (roadLookup) {
    const elevatedResult = findElevatedPath(grid, roadLookup, startRoad, endRoad, 5000, laneGraph);
    if (elevatedResult) return elevatedResult;
  }

  return gridAStarPath(startRoad, endRoad, grid);
}
