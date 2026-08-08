/**
 * Single-phase lane-level A* pathfinder on LaneGraph.
 *
 * Replaces the two-phase system (cell-level A* + refineLanePathVariants).
 * Uses LaneGraph edges as the sole source of truth — no cell-level
 * heuristics, no intersection transparency issues.
 *
 * Returns LaneEdge[] directly usable by TrafficSimulation.
 */

import { type LaneGraph, type LaneEdge, type ConnectionPoint, turnLanePenalty } from './LaneGraph';
import { ROAD_CONFIGS, RoadType, getLaneCount } from '../road/types';
import { parsePosKeyUnsafe, parseLevelFromKey, toPosKey } from '../grid/GridHelpers';
import { ZONE_ROAD_REACH } from '../grid/constants';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';
import { laneEdgeCost } from './Pathfinding';

/** Cost multiplier applied per cell+lane used in previous variants (point-level penalty). */
const VARIANT_PENALTY = 3;

/** Cost multiplier applied to all points in a cell used by a previous route (cell-level penalty). */
const CELL_ROUTE_PENALTY = 8;

/** Reference speed limit (km/h) used as the baseline for A* cost normalization. */
const REFERENCE_SPEED_LIMIT = 50;

/** Number of variants to generate: 2 routes × 2 lane variants each. */
const VARIANT_COUNT = 4;

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
      let cost = laneEdgeCost(edge, speedLimit / REFERENCE_SPEED_LIMIT);
      // A turn taken from the wrong lane cuts across the through traffic beside
      // it, and nothing downstream stops it: findCrossEdgeGap only compares
      // vehicles that share a destination point (BUG-214). Charged against the
      // APPROACH road's width, since that is the lane the arc starts in.
      if (lookup) {
        const fromCell = lookup.getCellByKey(edge.from.cellKey);
        if (fromCell) cost += turnLanePenalty(edge, getLaneCount(fromCell.roadType));
      }
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
 * Generate lane path variants: 2 route-level (different cells) × 2 lane-level each.
 *
 * 1. Route A: normal A*
 * 2. Route B: cell-level penalty on A's cells → A* finds different route
 * 3. Lane A2: point-level penalty on A's points → same cells, different lane
 * 4. Lane B2: point-level penalty on B's points → same cells, different lane
 *
 * Degrades gracefully: if only one route exists, all variants differ by lane only.
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

  // Determine start/end cells to exclude from penalties
  const startCells = new Set(startPoints.map(p => p.cellKey));
  const endCells = new Set(endPoints.map(p => p.cellKey));

  // ── Phase 1: find route-level variants (cell penalty) ──
  const routeCount = Math.min(2, count);
  const routes: LaneEdge[][] = [];
  const cellPenalty = new Map<string, number>(); // cellKey → penalty multiplier

  for (let r = 0; r < routeCount; r++) {
    // Build combined penalty: cell-level for route diversity
    const combinedPenalty = cellPenalty.size > 0 ? cellPenalty : undefined;
    const path = laneAStar(graph, startPoints, endPoints, to, 8000, combinedPenalty, lookup);
    if (!path || path.length === 0) break;
    routes.push(path);
    variants.push(path);

    // Apply cell-level penalty: penalize all cell+lane combos in this route's cells.
    // Exclude start/end cells AND fork/merge cells (first/last edge cells).
    const forkCells = new Set<string>();
    if (path.length > 0) {
      forkCells.add(path[0]!.from.cellKey);
      forkCells.add(path[0]!.to.cellKey);
      forkCells.add(path[path.length - 1]!.from.cellKey);
      forkCells.add(path[path.length - 1]!.to.cellKey);
    }
    const routeCells = new Set<string>();
    for (const edge of path) {
      const cell = edge.to.cellKey;
      if (!startCells.has(cell) && !endCells.has(cell) && !forkCells.has(cell)) {
        routeCells.add(cell);
      }
    }
    // Apply to all lanes of penalized cells
    for (const cell of routeCells) {
      for (let lane = 0; lane < 4; lane++) {
        const key = `${cell}:${lane}`;
        cellPenalty.set(key, (cellPenalty.get(key) ?? 1) * CELL_ROUTE_PENALTY);
      }
    }
  }

  // ── Phase 2: find lane-level variants for each route (point penalty) ──
  for (const route of routes) {
    if (variants.length >= count) break;

    const pointPenalty = new Map<string, number>();
    for (const edge of route) {
      const cell = edge.to.cellKey;
      if (startCells.has(cell) || endCells.has(cell)) continue;
      const key = `${cell}:${edge.to.lane}`;
      pointPenalty.set(key, (pointPenalty.get(key) ?? 1) * VARIANT_PENALTY);
    }

    const laneVariant = laneAStar(graph, startPoints, endPoints, to, 8000, pointPenalty, lookup);
    if (laneVariant && laneVariant.length > 0) {
      variants.push(laneVariant);
    }
  }

  return variants;
}
