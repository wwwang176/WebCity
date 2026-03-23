import { Grid } from './Grid';
import { TerrainType, type CellData } from './types';
import { RoadType } from '../road/types';
import { RailType } from '../rail/types';
import { isInfrastructureBuilding } from '../building/InfraConfig';

/**
 * White-list check: a cell is buildable (can receive a zone) if it has
 * buildable terrain AND no infrastructure occupying it (road/rail/infra building).
 * Zone buildings are allowed (rezoning replaces them).
 */
export function isCellBuildable(cell: CellData): boolean {
  if (cell.terrainType === TerrainType.WATER || cell.terrainType === TerrainType.MOUNTAIN) return false;
  if (cell.roadType !== RoadType.NONE) return false;
  if (cell.railType !== RailType.NONE) return false;
  if (isInfrastructureBuilding(cell.buildingId)) return false;
  return true;
}

/** Check if any of the 4-directional neighbors has a road */
export function isAdjacentToRoad(grid: Grid, x: number, y: number): boolean {
  return grid.getNeighbors(x, y).some(cell => cell.roadType !== RoadType.NONE);
}

/** Create a "x,y" position key string */
export function toPosKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Parse a "x,y" or "x,y,level" position key string — returns null if invalid */
export function parsePosKey(key: string): { x: number; y: number } | null {
  const i = key.indexOf(',');
  if (i === -1) return null;
  const j = key.indexOf(',', i + 1);
  // "x,y,level" — only take x and y
  if (j !== -1) return { x: Number(key.slice(0, i)), y: Number(key.slice(i + 1, j)) };
  return { x: Number(key.slice(0, i)), y: Number(key.slice(i + 1)) };
}

/** Parse a "x,y" or "x,y,level" position key — unsafe, assumes valid input */
export function parsePosKeyUnsafe(key: string): { x: number; y: number } {
  const i = key.indexOf(',');
  const j = key.indexOf(',', i + 1);
  if (j !== -1) return { x: Number(key.slice(0, i)), y: Number(key.slice(i + 1, j)) };
  return { x: Number(key.slice(0, i)), y: Number(key.slice(i + 1)) };
}

/** Parse the elevation level from a "x,y,level" key. Returns 0 for "x,y" format. */
export function parseLevelFromKey(key: string): number {
  const i = key.indexOf(',');
  if (i === -1) return 0;
  const j = key.indexOf(',', i + 1);
  if (j === -1) return 0;
  return Number(key.slice(j + 1));
}

/** Minimal grid interface for road lookups (DIP). */
export interface ReadableGrid {
  getCell(x: number, y: number): { roadType: number } | null;
}

/** ReadableGrid with known dimensions — needed for dense array coverage caches. */
export interface SizedGrid extends ReadableGrid {
  readonly width: number;
  readonly height: number;
}

/** Euclidean distance between two points */
export function euclideanDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Manhattan (taxicab) distance between two points */
export function manhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
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

/**
 * Cardinal direction offsets with bitflag values.
 * Compatible with both RoadDirection and TrackDirection (both use N=1,S=2,W=4,E=8).
 */
export const CARDINAL_DIRECTIONS: ReadonlyArray<{
  dx: number; dy: number; flag: number; opposite: number;
}> = [
  { dx: 0, dy: -1, flag: 0b0001, opposite: 0b0010 }, // NORTH → SOUTH
  { dx: 0, dy: 1, flag: 0b0010, opposite: 0b0001 },  // SOUTH → NORTH
  { dx: -1, dy: 0, flag: 0b0100, opposite: 0b1000 }, // WEST → EAST
  { dx: 1, dy: 0, flag: 0b1000, opposite: 0b0100 },  // EAST → WEST
];

/** Check if direction flags contain any vertical (NORTH/SOUTH) component. Works with both RoadDirection and TrackDirection. */
export function hasVerticalFlag(flags: number): boolean {
  return (flags & (0b0001 | 0b0010)) !== 0; // NORTH | SOUTH
}

/** Check if direction flags contain any horizontal (WEST/EAST) component. Works with both RoadDirection and TrackDirection. */
export function hasHorizontalFlag(flags: number): boolean {
  return (flags & (0b0100 | 0b1000)) !== 0; // WEST | EAST
}

/**
 * Returns the cardinal direction bitflag from `from` toward `to`.
 * Compatible with both RoadDirection and TrackDirection.
 * Returns 0 if from === to. Prefers vertical when both dx/dy are nonzero.
 */
export function getDirectionFlag(from: { x: number; y: number }, to: { x: number; y: number }): number {
  if (to.y < from.y) return 0b0001; // NORTH
  if (to.y > from.y) return 0b0010; // SOUTH
  if (to.x < from.x) return 0b0100; // WEST
  if (to.x > from.x) return 0b1000; // EAST
  return 0;
}

/** Simple 4-neighbor offsets as [dx, dy] tuples. */
export const FOUR_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
] as const;

/**
 * Returns an L-shaped path of grid cells from `from` to `to`.
 * Moves horizontally first, then vertically.
 */
export function getLShapedPath(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);

  let x = from.x;
  let y = from.y;

  // Horizontal leg
  while (x !== to.x) {
    cells.push({ x, y });
    x += dx;
  }
  // Vertical leg
  while (y !== to.y) {
    cells.push({ x, y });
    y += dy;
  }
  cells.push({ x: to.x, y: to.y });

  return cells;
}

/** Check if a footprint (w×h starting at x,y) has any adjacent road cell outside the footprint. */
export function isFootprintAdjacentToRoad(
  grid: ReadableGrid,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      for (const [ndx, ndy] of FOUR_NEIGHBORS) {
        const nx = cx + ndx!;
        const ny = cy + ndy!;
        // Skip if neighbor is within footprint
        if (nx >= x && nx < x + w && ny >= y && ny < y + h) continue;
        const cell = grid.getCell(nx, ny);
        if (cell && cell.roadType !== 0) return true;
      }
    }
  }
  return false;
}

/** Find the cell itself or an adjacent road cell. Returns null if none found. */
export function findAdjacentRoad(
  grid: ReadableGrid,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const self = grid.getCell(x, y);
  if (self && self.roadType !== RoadType.NONE) return { x, y };
  for (const [dx, dy] of FOUR_NEIGHBORS) {
    const nx = x + dx!;
    const ny = y + dy!;
    const cell = grid.getCell(nx, ny);
    if (cell && cell.roadType !== RoadType.NONE) return { x: nx, y: ny };
  }
  return null;
}

/** Find the first item in an array that matches the given (x, y) coordinates. */
export function findAtPosition<T extends { x: number; y: number }>(
  items: readonly T[],
  x: number,
  y: number,
): T | undefined {
  return items.find(item => item.x === x && item.y === y);
}

/** Count the number of grid cells that contain a road. */
export function countRoadTiles(grid: { forEachCell(fn: (cell: { roadType: number }, x: number, y: number) => void): void }): number {
  let count = 0;
  grid.forEachCell((cell) => {
    if (cell.roadType !== RoadType.NONE) count++;
  });
  return count;
}

/** Normalize two corner coordinates into { minX, maxX, minY, maxY }. */
export function normalizeRect(x1: number, y1: number, x2: number, y2: number): {
  minX: number; maxX: number; minY: number; maxY: number;
} {
  return {
    minX: Math.min(x1, x2),
    maxX: Math.max(x1, x2),
    minY: Math.min(y1, y2),
    maxY: Math.max(y1, y2),
  };
}
