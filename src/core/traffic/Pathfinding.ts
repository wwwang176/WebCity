import { RoadNetwork } from '../road/RoadNetwork';
import { RoadType, ROAD_CONFIGS } from '../road/types';
import type { LaneGraph, LaneEdge } from './LaneGraph';
import { parsePosKeyUnsafe, toPosKey, FOUR_NEIGHBORS, manhattanDistance } from '../grid/GridHelpers';

function heuristic(a: string, b: string): number {
  const ap = parsePosKeyUnsafe(a);
  const bp = parsePosKeyUnsafe(b);
  return manhattanDistance(ap.x, ap.y, bp.x, bp.y);
}

export interface PathCostFactors {
  congestion: Map<string, number>;
  trafficLights: Set<string>;
}

/** Pathfinding cost configuration */
export const PATH_COST = {
  /** Congestion weight when calculating path move cost */
  CONGESTION_WEIGHT: 2,
  /** Extra cost added for traffic light intersections */
  TRAFFIC_LIGHT_COST: 0.5,
} as const;

export function findPath(
  network: RoadNetwork,
  from: string,
  to: string,
  costs?: PathCostFactors,
): string[] | null {
  if (!network.isConnected(from, to)) return null;

  const open = new Map<string, { g: number; parent: string | null }>();
  const closed = new Map<string, { g: number; parent: string | null }>();

  open.set(from, { g: 0, parent: null });

  while (open.size > 0) {
    let bestId = '';
    let bestF = Infinity;

    for (const [id, data] of open) {
      const f = data.g + heuristic(id, to);
      if (f < bestF) {
        bestF = f;
        bestId = id;
      }
    }

    if (bestId === to) {
      const path: string[] = [];
      let cur: string | null = bestId;
      const all = new Map([...open, ...closed]);
      while (cur) {
        path.unshift(cur);
        cur = all.get(cur)?.parent ?? null;
      }
      return path;
    }

    const data = open.get(bestId)!;
    open.delete(bestId);
    closed.set(bestId, data);

    for (const neighborId of network.getNeighbors(bestId)) {
      if (closed.has(neighborId)) continue;

      let moveCost = 1;
      if (costs) {
        const congestion = costs.congestion.get(neighborId) ?? 0;
        moveCost += congestion * PATH_COST.CONGESTION_WEIGHT;
        if (costs.trafficLights.has(neighborId)) moveCost += PATH_COST.TRAFFIC_LIGHT_COST;
      }

      const g = data.g + moveCost;
      const existing = open.get(neighborId);

      if (!existing || g < existing.g) {
        open.set(neighborId, { g, parent: bestId });
      }
    }
  }

  return null;
}

/**
 * Grid-based A* pathfinding with speed-limit weighting.
 * Cost per cell = 1 / speedLimit (slower roads cost more).
 * Heuristic = Manhattan distance / MAX_SPEED_LIMIT (admissible).
 */
const MAX_SPEED_LIMIT = 100; // highway — used for admissible heuristic

export function gridAStarPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  grid: { getCell(x: number, y: number): { roadType: number } | null; width: number; height: number },
  maxSteps = 5000,
): string[] | null {
  const key = toPosKey;
  const target = key(end.x, end.y);
  const startKey = key(start.x, start.y);

  // g: cost from start, parent: for path reconstruction
  const gScore = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const closed = new Set<string>();

  // Simple open list (sorted insert would be faster, but sufficient for grid scale)
  const open: { x: number; y: number; k: string; f: number }[] = [];

  gScore.set(startKey, 0);
  parent.set(startKey, null);
  const h0 = manhattanDistance(start.x, start.y, end.x, end.y) / MAX_SPEED_LIMIT;
  open.push({ x: start.x, y: start.y, k: startKey, f: h0 });

  let steps = 0;

  while (open.length > 0 && steps < maxSteps) {
    steps++;

    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestIdx]!.f) bestIdx = i;
    }
    const current = open[bestIdx]!;
    open[bestIdx] = open[open.length - 1]!;
    open.pop();

    if (current.k === target) {
      // Reconstruct path
      const path: string[] = [];
      let cur: string | null = target;
      while (cur !== null) {
        path.push(cur);
        cur = parent.get(cur) ?? null;
      }
      path.reverse();
      return path;
    }

    if (closed.has(current.k)) continue;
    closed.add(current.k);

    const currentG = gScore.get(current.k)!;

    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = current.x + dx!;
      const ny = current.y + dy!;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      const cell = grid.getCell(nx, ny);
      if (!cell || cell.roadType === RoadType.NONE) continue;

      const config = ROAD_CONFIGS[cell.roadType as RoadType];
      const speedLimit = config?.speedLimit || 50;
      const moveCost = 1 / speedLimit; // faster road = lower cost

      const tentativeG = currentG + moveCost;
      const prevG = gScore.get(nk);
      if (prevG !== undefined && tentativeG >= prevG) continue;

      gScore.set(nk, tentativeG);
      parent.set(nk, current.k);
      const h = manhattanDistance(nx, ny, end.x, end.y) / MAX_SPEED_LIMIT;
      open.push({ x: nx, y: ny, k: nk, f: tentativeG + h });
    }
  }

  return null;
}

/**
 * Phase 2: Refine a cell-level path into a LaneEdge sequence.
 * Greedy forward search — at each step pick the edge leading toward the next cell,
 * preferring same-lane traversal over lane changes.
 */
export function refineLanePath(
  graph: LaneGraph,
  cellPath: string[],
  preferredLane = 0,
): LaneEdge[] | null {
  if (cellPath.length <= 1) return [];

  const result: LaneEdge[] = [];
  let currentPointId: string | null = null;
  let currentLane = preferredLane;

  for (let i = 0; i < cellPath.length - 1; i++) {
    const fromCell = cellPath[i]!;
    const toCell = cellPath[i + 1]!;

    const dir = cellDirection(fromCell, toCell);
    if (!dir) return null;

    // Internal traversal: entry → exit within fromCell
    if (currentPointId) {
      const internalEdges = graph.getEdgesFrom(currentPointId).filter(
        e => e.to.cellKey === fromCell && e.to.direction === dir && e.to.type === 'exit'
      );
      const bestEdge = internalEdges.find(e => e.to.lane === currentLane) ?? internalEdges[0];
      if (bestEdge) {
        result.push(bestEdge);
        currentPointId = bestEdge.to.id;
        currentLane = bestEdge.to.lane;
      }
    }

    // Cross-cell: fromCell exit → toCell entry
    const crossEdges = graph.getEdgesBetween(fromCell, toCell).filter(
      e => e.from.type === 'exit' && e.to.type === 'entry'
    );

    let crossEdge: LaneEdge | undefined;
    if (currentPointId) {
      crossEdge = crossEdges.find(e => e.from.id === currentPointId);
    }
    if (!crossEdge) {
      crossEdge = crossEdges.find(e => e.from.lane === currentLane);
    }
    if (!crossEdge) {
      crossEdge = crossEdges[0];
    }
    if (!crossEdge) return null;

    // Bridge from current point to cross edge start if needed
    if (currentPointId && currentPointId !== crossEdge.from.id) {
      const bridge = graph.getEdgesFrom(currentPointId).find(
        e => e.to.id === crossEdge!.from.id
      );
      if (bridge) {
        result.push(bridge);
      } else {
        const reachable = graph.getEdgesFrom(currentPointId);
        for (const r of reachable) {
          const altCross = crossEdges.find(e => e.from.id === r.to.id);
          if (altCross) {
            result.push(r);
            crossEdge = altCross;
            break;
          }
        }
      }
    }

    result.push(crossEdge);
    currentPointId = crossEdge.to.id;
    currentLane = crossEdge.to.lane;
  }

  // Fix connectivity gaps
  for (let i = 1; i < result.length; i++) {
    if (result[i - 1]!.to.id !== result[i]!.from.id) {
      const bridge = graph.getEdgesFrom(result[i - 1]!.to.id).find(
        e => e.to.id === result[i]!.from.id
      );
      if (bridge) {
        result.splice(i, 0, bridge);
        i++;
      }
    }
  }

  return result;
}

function cellDirection(from: string, to: string): string | null {
  const f = parsePosKeyUnsafe(from);
  const t = parsePosKeyUnsafe(to);
  const dx = t.x - f.x, dy = t.y - f.y;
  if (dx === 1 && dy === 0) return 'east';
  if (dx === -1 && dy === 0) return 'west';
  if (dx === 0 && dy === 1) return 'south';
  if (dx === 0 && dy === -1) return 'north';
  return null;
}
