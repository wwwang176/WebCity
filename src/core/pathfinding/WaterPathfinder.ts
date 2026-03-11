/**
 * WaterPathfinder — A* 水域尋路演算法。
 *
 * 渡輪在水面上沿可通行的水域格子移動，支援 8 方向（含對角線）。
 * 純邏輯模組，禁止 import Three.js。
 */

import { parsePosKeyUnsafe } from '../grid/GridHelpers';

export interface WaterGrid {
  width: number;
  height: number;
  isWater(x: number, y: number): boolean;
}

export interface WaterPathResult {
  path: Array<{ x: number; y: number }>;
  distance: number;
}

/** 8 方向移動偏移量（含對角線） */
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

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  // 歐幾里得距離
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * A* 水域尋路。
 * @returns 路徑和總距離，或 null（無路可走）。
 */
export function findWaterPath(
  grid: WaterGrid,
  from: { x: number; y: number },
  to: { x: number; y: number },
): WaterPathResult | null {
  // 起終相同
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

  // 使用簡單的 open set（小地圖效能足夠）
  const openSet = new Set<string>();
  openSet.add(startKey);

  while (openSet.size > 0) {
    // 取 fScore 最小的節點
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
      // 重建路徑
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

  return null; // 無路可走
}
