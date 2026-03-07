import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import { TerrainType, NaturalResource } from '../types';
import { canBuild, getNaturalResource, getElevation, setNaturalResource } from '../Terrain';

describe('Terrain', () => {
  it('should not allow building on water', () => {
    const grid = new Grid(10, 10);
    grid.setCell(3, 3, { terrainType: TerrainType.WATER });
    expect(canBuild(grid, 3, 3)).toBe(false);
  });

  it('should allow building on plain terrain', () => {
    const grid = new Grid(10, 10);
    expect(canBuild(grid, 3, 3)).toBe(true);
  });

  it('should not allow building on mountain', () => {
    const grid = new Grid(10, 10);
    grid.setCell(3, 3, { terrainType: TerrainType.MOUNTAIN });
    expect(canBuild(grid, 3, 3)).toBe(false);
  });

  it('should return ORE natural resource when set', () => {
    const grid = new Grid(10, 10);
    setNaturalResource(grid, 5, 5, NaturalResource.ORE);
    expect(getNaturalResource(grid, 5, 5)).toBe(NaturalResource.ORE);
  });

  it('should return NONE natural resource by default', () => {
    const grid = new Grid(10, 10);
    expect(getNaturalResource(grid, 5, 5)).toBe(NaturalResource.NONE);
  });

  it('should read elevation correctly', () => {
    const grid = new Grid(10, 10);
    grid.setCell(4, 4, { elevation: 10 });
    expect(getElevation(grid, 4, 4)).toBe(10);
  });

  it('should handle negative elevation', () => {
    const grid = new Grid(10, 10);
    grid.setCell(4, 4, { elevation: -5 });
    expect(getElevation(grid, 4, 4)).toBe(-5);
  });
});
