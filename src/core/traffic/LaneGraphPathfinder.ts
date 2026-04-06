/**
 * Single-phase lane-level A* pathfinder on LaneGraph.
 *
 * Replaces the two-phase system (cell-level A* + refineLanePathVariants).
 * Uses LaneGraph edges as the sole source of truth — no cell-level
 * heuristics, no intersection transparency issues.
 *
 * Returns LaneEdge[] directly usable by TrafficSimulation.
 */

import { type LaneGraph, type LaneEdge, type ConnectionPoint } from './LaneGraph';
import { ROAD_CONFIGS, RoadType } from '../road/types';
import { parsePosKeyUnsafe, parseLevelFromKey, toPosKey } from '../grid/GridHelpers';
import { ZONE_ROAD_REACH } from '../grid/constants';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';
import { getLaneSpeedMultiplier } from './Pathfinding';

/** Cost multiplier applied per cell+lane used in previous variants (penalty method). */
const VARIANT_PENALTY = 3;

/** Reference speed limit (km/h) used as the baseline for A* cost normalization. */
const REFERENCE_SPEED_LIMIT = 50;

/** Number of lane path variants to generate per route. */
const VARIANT_COUNT = 3;

/**
 * Collect LaneGraph connection points of a specific type (entry/exit) for any
 * road cell within Chebyshev `ZONE_ROAD_REACH` of the building position (bx, by).
 *
 * Buildings may sit one empty tile back from a road (the inner ring — see
 * `src/core/grid/constants.ts`), so scanning only 4 orthogonal neighbours would
 * miss inner-ring homes/workplaces and make their commute path generation fail.
 * We instead scan a (2·reach+1)² box around the building cell.
 */
function collectNearbyConnectionPoints(
  graph: LaneGraph,
  bx: number, by: number,
  lookup: UnifiedRoadLookup,
  pointType: 'entry' | 'exit',
): ConnectionPoint[] {
  const results: ConnectionPoint[] = [];
  for (let dy = -ZONE_ROAD_REACH; dy <= ZONE_ROAD_REACH; dy++) {
    for (let dx = -ZONE_ROAD_REACH; dx <= ZONE_ROAD_REACH; dx++) {
      // Check every level at this position (ground + elevated roads).
      const keys = lookup.getAllKeysAtPosition(bx + dx, by + dy);
      for (const key of keys) {
        const pts = graph.getConnectionPoints(key);
        for (const pt of pts) {
          if (pt.type === pointType) results.push(pt);
        }
      }
    }
  }
  return results;
}

/** Find LaneGraph exit points near a building (scans Chebyshev ZONE_ROAD_REACH). */
function findNearbyExitPoints(
  graph: LaneGraph,
  bx: number, by: number,
  lookup: UnifiedRoadLookup,
): ConnectionPoint[] {
  return collectNearbyConnectionPoints(graph, bx, by, lookup, 'exit');
}

/** Find LaneGraph entry points near a building (scans Chebyshev ZONE_ROAD_REACH). */
function findNearbyEntryPoints(
  graph: LaneGraph,
  bx: number, by: number,
  lookup: UnifiedRoadLookup,
): ConnectionPoint[] {
  return collectNearbyConnectionPoints(graph, bx, by, lookup, 'entry');
}

function manhattanDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * A* on LaneGraph from start point(s) to end point(s).
 * Multi-source / multi-target: starts from all exit points near the origin,
 * terminates when any entry point near the destination is reached.
 *
 * @param penalty Map of "cellKey:lane" → penalty multiplier (for variant generation)
 */
function laneAStar(
  graph: LaneGraph,
  startPoints: ConnectionPoint[],
  endPoints: ConnectionPoint[],
  endPos: { x: number; y: number },
  maxSteps = 8000,
  penalty?: Map<string, number>,
  lookup?: UnifiedRoadLookup,
): LaneEdge[] | null {
  if (startPoints.length === 0 || endPoints.length === 0) return null;

  const endSet = new Set(endPoints.map(p => p.id));
  const gScore = new Map<string, number>();
  const parentEdge = new Map<string, LaneEdge | null>();

  // Open list: { pointId, f-score }
  const open: { id: string; pos: { x: number; y: number }; f: number }[] = [];

  // Seed: all start exit points at cost 0
  for (const sp of startPoints) {
    gScore.set(sp.id, 0);
    parentEdge.set(sp.id, null);
    const h = manhattanDist(sp.position, endPos) * 0.01; // admissible heuristic
    open.push({ id: sp.id, pos: sp.position, f: h });
  }

  let steps = 0;
  const closed = new Set<string>();

  while (open.length > 0 && steps < maxSteps) {
    steps++;

    // Find best node
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestIdx]!.f) bestIdx = i;
    }
    const current = open[bestIdx]!;
    open[bestIdx] = open[open.length - 1]!;
    open.pop();

    // Reached destination?
    if (endSet.has(current.id)) {
      // Reconstruct LaneEdge path
      const path: LaneEdge[] = [];
      let curId: string | undefined = current.id;
      while (curId) {
        const edge = parentEdge.get(curId);
        if (!edge) break;
        path.unshift(edge);
        curId = edge.from.id;
      }
      return path;
    }

    if (closed.has(current.id)) continue;
    closed.add(current.id);

    const currentG = gScore.get(current.id)!;

    // Expand neighbors via edges from this point
    for (const edge of graph.getEdgesFrom(current.id)) {
      const neighborId = edge.to.id;
      if (closed.has(neighborId)) continue;

      // Cost = travel time: edge length / (lane speed × road speed ratio)
      // Higher speed limit → lower cost → A* prefers faster roads.
      const cell = lookup ? lookup.getCellByKey(edge.to.cellKey) : null;
      const speedLimit = cell ? (ROAD_CONFIGS[cell.roadType as RoadType]?.speedLimit ?? REFERENCE_SPEED_LIMIT) : REFERENCE_SPEED_LIMIT;
      let cost = edge.length / (getLaneSpeedMultiplier(edge.to.lane) * (speedLimit / REFERENCE_SPEED_LIMIT));
      if (penalty) {
        const p = penalty.get(`${edge.to.cellKey}:${edge.to.lane}`);
        if (p) cost *= p;
      }

      const tentativeG = currentG + cost;
      const prevG = gScore.get(neighborId);
      if (prevG !== undefined && tentativeG >= prevG) continue;

      gScore.set(neighborId, tentativeG);
      parentEdge.set(neighborId, edge);
      const h = manhattanDist(edge.to.position, endPos) * 0.01;
      open.push({ id: neighborId, pos: edge.to.position, f: tentativeG + h });
    }
  }

  return null;
}

/**
 * Find a lane-level path from building position `from` to building position `to`.
 * Returns LaneEdge[] directly usable by TrafficSimulation.
 */
export function findLanePath(
  graph: LaneGraph,
  lookup: UnifiedRoadLookup,
  from: { x: number; y: number },
  to: { x: number; y: number },
): LaneEdge[] | null {
  const startPoints = findNearbyExitPoints(graph, from.x, from.y, lookup);
  const endPoints = findNearbyEntryPoints(graph, to.x, to.y, lookup);
  return laneAStar(graph, startPoints, endPoints, to, 8000, undefined, lookup);
}

/**
 * Generate multiple lane path variants for vehicle distribution across lanes.
 * Uses penalty method: edges used in previous variants get higher cost.
 */
export function findLanePathVariants(
  graph: LaneGraph,
  lookup: UnifiedRoadLookup,
  from: { x: number; y: number },
  to: { x: number; y: number },
  count = VARIANT_COUNT,
): LaneEdge[][] {
  const startPoints = findNearbyExitPoints(graph, from.x, from.y, lookup);
  const endPoints = findNearbyEntryPoints(graph, to.x, to.y, lookup);
  if (startPoints.length === 0 || endPoints.length === 0) return [];

  const variants: LaneEdge[][] = [];
  const penalty = new Map<string, number>();

  // Determine start/end cells to exclude from penalties (shared by all variants)
  const startCells = new Set(startPoints.map(p => p.cellKey));
  const endCells = new Set(endPoints.map(p => p.cellKey));

  for (let i = 0; i < count; i++) {
    const path = laneAStar(graph, startPoints, endPoints, to, 8000, i > 0 ? penalty : undefined, lookup);
    if (!path || path.length === 0) break;
    variants.push(path);

    // Apply penalty per cell+lane: each cell's lane used by this variant gets penalized,
    // so the next variant avoids the same cell+lane combinations and stays in a different lane.
    // Start and end cells are excluded (all variants may share the same lane there).
    for (const edge of path) {
      const cell = edge.to.cellKey;
      if (startCells.has(cell) || endCells.has(cell)) continue;
      const key = `${cell}:${edge.to.lane}`;
      penalty.set(key, (penalty.get(key) ?? 1) * VARIANT_PENALTY);
    }
  }

  return variants;
}
