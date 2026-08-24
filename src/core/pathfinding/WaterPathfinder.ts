/**
 * WaterPathfinder — A* pathfinding across water.
 *
 * Ferries move over navigable water cells in 8 directions, diagonals included.
 * Pure logic module; importing Three.js is forbidden.
 */

import { parsePosKeyUnsafe, toPosKey, euclideanDistance } from '../grid/GridHelpers';

export interface WaterGrid {
  width: number;
  height: number;
  isWater(x: number, y: number): boolean;
}

export interface WaterPathResult {
  path: Array<{ x: number; y: number }>;
  distance: number;
}

/** The 8 movement offsets, diagonals included. */
const DIRS: ReadonlyArray<{ dx: number; dy: number; cost: number }> = [
  { dx: 0, dy: -1, cost: 1 },        // N
  { dx: 0, dy: 1, cost: 1 },         // S
  { dx: -1, dy: 0, cost: 1 },        // W
  { dx: 1, dy: 0, cost: 1 },         // E
  { dx: -1, dy: -1, cost: Math.SQRT2 }, // NW
  { dx: 1, dy: -1, cost: Math.SQRT2 },  // NE
  { dx: -1, dy: 1, cost: Math.SQRT2 },  // SW
  { dx: 1, dy: 1, cost: Math.SQRT2 },   // SE
];

const heuristic = euclideanDistance;

const key = toPosKey;

/**
 * A* pathfinding across water.
 * @returns the path and its total distance, or null when no route exists.
 */
export function findWaterPath(
  grid: WaterGrid,
  from: { x: number; y: number },
  to: { x: number; y: number },
): WaterPathResult | null {
  // Start equals destination.
  if (from.x === to.x && from.y === to.y) {
    return { path: [{ x: from.x, y: from.y }], distance: 0 };
  }

  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();

  const startKey = key(from.x, from.y);
  const endKey = key(to.x, to.y);

  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(from.x, from.y, to.x, to.y));

  // A plain open set; fast enough at these map sizes.
  const openSet = new Set<string>();
  openSet.add(startKey);

  while (openSet.size > 0) {
    // Take the node with the lowest fScore.
    let currentKey = '';
    let minF = Infinity;
    for (const k of openSet) {
      const f = fScore.get(k) ?? Infinity;
      if (f < minF) {
        minF = f;
        currentKey = k;
      }
    }

    if (currentKey === endKey) {
      // Rebuild the path.
      const path: Array<{ x: number; y: number }> = [];
      let ck: string | undefined = currentKey;
      while (ck) {
        const pos = parsePosKeyUnsafe(ck);
        path.unshift(pos);
        ck = cameFrom.get(ck);
      }
      return { path, distance: gScore.get(currentKey)! };
    }

    openSet.delete(currentKey);
    const cur = parsePosKeyUnsafe(currentKey);

    for (const dir of DIRS) {
      const nx = cur.x + dir.dx;
      const ny = cur.y + dir.dy;

      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;
      // Allow water tiles + destination tile (shore dock)
      if (!grid.isWater(nx, ny) && !(nx === to.x && ny === to.y)) continue;

      const nk = key(nx, ny);
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + dir.cost;

      if (tentativeG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, currentKey);
        gScore.set(nk, tentativeG);
        fScore.set(nk, tentativeG + heuristic(nx, ny, to.x, to.y));
        openSet.add(nk);
      }
    }
  }

  return null; // no route exists
}
