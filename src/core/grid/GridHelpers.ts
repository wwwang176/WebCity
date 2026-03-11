import { Grid } from './Grid';
import { RoadType } from '../road/types';

/** Check if any of the 4-directional neighbors has a road */
export function isAdjacentToRoad(grid: Grid, x: number, y: number): boolean {
  return grid.getNeighbors(x, y).some(cell => cell.roadType !== RoadType.NONE);
}

/** Create a "x,y" position key string */
export function toPosKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Parse a "x,y" position key string — returns null if invalid */
export function parsePosKey(key: string): { x: number; y: number } | null {
  const i = key.indexOf(',');
  if (i === -1) return null;
  return { x: Number(key.slice(0, i)), y: Number(key.slice(i + 1)) };
}

/** Parse a "x,y" position key — unsafe, assumes valid input */
export function parsePosKeyUnsafe(key: string): { x: number; y: number } {
  const i = key.indexOf(',');
  return { x: Number(key.slice(0, i)), y: Number(key.slice(i + 1)) };
}

/** Minimal grid interface for findAdjacentRoad */
interface ReadableGrid {
  getCell(x: number, y: number): { roadType: number } | null;
}

/** Euclidean distance between two points */
export function euclideanDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Check if point (x,y) is within Euclidean distance of center (cx,cy) */
export function isWithinEuclideanRadius(
  cx: number, cy: number, x: number, y: number, radius: number,
): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Iterate over all integer cells within Euclidean radius, calling callback for each */
export function forEachCellInRadius(
  cx: number, cy: number, radius: number,
  callback: (x: number, y: number, distance: number) => void,
): void {
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const distSq = dx * dx + dy * dy;
      if (distSq <= r2) {
        callback(cx + dx, cy + dy, Math.sqrt(distSq));
      }
    }
  }
}

/** Find the cell itself or an adjacent road cell. Returns null if none found. */
export function findAdjacentRoad(
  grid: ReadableGrid,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const self = grid.getCell(x, y);
  if (self && self.roadType !== RoadType.NONE) return { x, y };
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dx, dy] of dirs) {
    const nx = x + dx!;
    const ny = y + dy!;
    const cell = grid.getCell(nx, ny);
    if (cell && cell.roadType !== RoadType.NONE) return { x: nx, y: ny };
  }
  return null;
}
