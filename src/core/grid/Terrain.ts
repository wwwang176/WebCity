import { Grid } from './Grid';
import { TerrainType, NaturalResource } from './types';

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
