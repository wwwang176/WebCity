import { Grid } from './Grid';
import { TerrainType, NaturalResource } from './types';

export function isWater(grid: Grid, x: number, y: number): boolean {
  const cell = grid.getCell(x, y);
  return cell ? cell.terrainType === TerrainType.WATER : false;
}

export function canBuild(grid: Grid, x: number, y: number): boolean {
  const cell = grid.getCell(x, y);
  if (!cell) return false;
  return cell.terrainType !== TerrainType.WATER && cell.terrainType !== TerrainType.MOUNTAIN;
}

export function setNaturalResource(grid: Grid, x: number, y: number, resource: NaturalResource): void {
  const index = y * grid.width + x;
  grid.naturalResources[index] = resource;
}

export function getNaturalResource(grid: Grid, x: number, y: number): NaturalResource {
  const index = y * grid.width + x;
  return (grid.naturalResources[index] ?? NaturalResource.NONE) as NaturalResource;
}

export function getElevation(grid: Grid, x: number, y: number): number {
  const cell = grid.getCell(x, y);
  if (!cell) return 0;
  return cell.elevation;
}

/** Check if a position is on the shore: must be land AND have at least one cardinally adjacent water cell. */
export function isShorePosition(grid: Grid, x: number, y: number): boolean {
  const cell = grid.getCell(x, y);
  if (!cell || cell.terrainType === TerrainType.WATER) return false;
  const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dx, dy] of dirs) {
    const nc = grid.getCell(x + dx, y + dy);
    if (nc && nc.terrainType === TerrainType.WATER) return true;
  }
  return false;
}

/** Maximum Manhattan distance for groundwater detection */
export const GROUNDWATER_SEARCH_RANGE = 3;

/** Returns groundwater level 0-100 based on Manhattan distance to nearest water. */
export function getGroundwaterLevel(grid: Grid, x: number, y: number): number {
  const range = GROUNDWATER_SEARCH_RANGE;
  let minDist = range + 1;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const cell = grid.getCell(x + dx, y + dy);
      if (cell && cell.terrainType === TerrainType.WATER) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist < minDist) minDist = dist;
      }
    }
  }
  if (minDist > range) return 0;
  return Math.round(100 * (1 - (minDist - 1) / range));
}
