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
