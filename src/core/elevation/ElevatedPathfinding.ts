import { RoadType, ROAD_CONFIGS } from '../road/types';
import { toPosKey, manhattanDistance, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { type ElevationManager } from './ElevationManager';
import { MIN_ELEVATION_LEVEL, MAX_ELEVATION_LEVEL } from './types';

interface GridLike {
  getCell(x: number, y: number): { roadType: number } | null;
  readonly width: number;
  readonly height: number;
}

/** Cost multiplier for ramp cells (slower due to incline). */
const RAMP_COST_MULTIPLIER = 1.5;
const MAX_SPEED = 100;

/**
 * Parse an elevated node key. Format: "x,y" (level 0) or "x,y,level" (level > 0).
 */
function parseNodeKey(key: string): { x: number; y: number; level: number } {
  const parts = key.split(',');
  return {
    x: Number(parts[0]),
    y: Number(parts[1]),
    level: parts.length > 2 ? Number(parts[2]) : 0,
  };
}

function nodeKey(x: number, y: number, level: number): string {
  return level === 0 ? toPosKey(x, y) : `${x},${y},${level}`;
}

/**
 * A* pathfinding that traverses both ground roads and elevated segments.
 * Ramp cells act as portals between ground (level 0) and elevated levels.
 *
 * Node IDs:
 * - "x,y" = ground level
 * - "x,y,L" = elevated level L
 */
export function findElevatedPath(
  grid: GridLike,
  em: ElevationManager,
  start: { x: number; y: number },
  end: { x: number; y: number },
  maxSteps = 5000,
): string[] | null {
  const target = toPosKey(end.x, end.y); // destination is always ground level
  const startKey = toPosKey(start.x, start.y);

  const gScore = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const closed = new Set<string>();

  const open: { k: string; x: number; y: number; level: number; f: number }[] = [];

  gScore.set(startKey, 0);
  parent.set(startKey, null);
  const h0 = manhattanDistance(start.x, start.y, end.x, end.y) / MAX_SPEED;
  open.push({ k: startKey, x: start.x, y: start.y, level: 0, f: h0 });

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
    const neighbors = getNeighbors(grid, em, current.x, current.y, current.level);

    for (const n of neighbors) {
      if (closed.has(n.key)) continue;

      const moveCost = n.cost;
      const tentativeG = currentG + moveCost;
      const prevG = gScore.get(n.key);
      if (prevG !== undefined && tentativeG >= prevG) continue;

      gScore.set(n.key, tentativeG);
      parent.set(n.key, current.k);
      const h = manhattanDistance(n.x, n.y, end.x, end.y) / MAX_SPEED;
      open.push({ k: n.key, x: n.x, y: n.y, level: n.level, f: tentativeG + h });
    }
  }

  return null;
}

interface Neighbor {
  key: string;
  x: number;
  y: number;
  level: number;
  cost: number;
}

/** Get all traversable neighbors of a node (same level + ramp transitions). */
function getNeighbors(
  grid: GridLike,
  em: ElevationManager,
  x: number,
  y: number,
  level: number,
): Neighbor[] {
  const result: Neighbor[] = [];

  if (level === 0) {
    // --- Ground level: check 4 neighbors ---
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;

      const cell = grid.getCell(nx, ny);

      // Ground road neighbor
      if (cell && cell.roadType !== RoadType.NONE) {
        const config = ROAD_CONFIGS[cell.roadType as RoadType];
        const speed = config?.speedLimit || 50;
        result.push({ key: nodeKey(nx, ny, 0), x: nx, y: ny, level: 0, cost: 1 / speed });
      }

      // Elevated road neighbor (cell may have no ground road but has elevated segment)
      for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
        const seg = em.get(nx, ny, lv);
        if (seg && seg.roadType !== RoadType.NONE) {
          const config = ROAD_CONFIGS[seg.roadType as RoadType];
          const speed = config?.speedLimit || 50;
          const cost = seg.isRamp ? (1 / speed) * RAMP_COST_MULTIPLIER : 1 / speed;
          result.push({ key: nodeKey(nx, ny, lv), x: nx, y: ny, level: lv, cost });
        }
      }
    }

    // --- Check if any ramp at THIS cell connects ground to elevated ---
    for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
      const seg = em.get(x, y, lv);
      if (seg && seg.isRamp && seg.roadType !== RoadType.NONE) {
        const config = ROAD_CONFIGS[seg.roadType as RoadType];
        const speed = config?.speedLimit || 50;
        result.push({
          key: nodeKey(x, y, lv),
          x, y, level: lv,
          cost: (1 / speed) * RAMP_COST_MULTIPLIER,
        });
      }
    }
  } else {
    // --- Elevated level: check 4 neighbors at all levels ---
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;

      // Check all elevated levels at neighbor (same level + other levels for ramp transitions)
      for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
        const seg = em.get(nx, ny, lv);
        if (seg && seg.roadType !== RoadType.NONE) {
          const config = ROAD_CONFIGS[seg.roadType as RoadType];
          const speed = config?.speedLimit || 50;
          const cost = seg.isRamp ? (1 / speed) * RAMP_COST_MULTIPLIER : 1 / speed;
          result.push({ key: nodeKey(nx, ny, lv), x: nx, y: ny, level: lv, cost });
        }
      }

      // Ground road neighbor
      const groundCell = grid.getCell(nx, ny);
      if (groundCell && groundCell.roadType !== RoadType.NONE) {
        const config = ROAD_CONFIGS[groundCell.roadType as RoadType];
        const speed = config?.speedLimit || 50;
        result.push({ key: nodeKey(nx, ny, 0), x: nx, y: ny, level: 0, cost: 1 / speed });
      }
    }

    // --- Check if this cell's ramp connects back to ground at same position ---
    const thisSeg = em.get(x, y, level);
    if (thisSeg && thisSeg.isRamp) {
      const groundCell = grid.getCell(x, y);
      if (groundCell && groundCell.roadType !== RoadType.NONE) {
        const config = ROAD_CONFIGS[groundCell.roadType as RoadType];
        const speed = config?.speedLimit || 50;
        result.push({
          key: nodeKey(x, y, 0),
          x, y, level: 0,
          cost: (1 / speed) * RAMP_COST_MULTIPLIER,
        });
      }
    }
  }

  return result;
}
