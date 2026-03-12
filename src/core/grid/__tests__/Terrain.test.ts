import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import { TerrainType, NaturalResource } from '../types';
import { canBuild, getNaturalResource, getElevation, setNaturalResource, getGroundwaterLevel } from '../Terrain';
import { TERRAIN_GEN } from '../TerrainGenerator';

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

describe('getGroundwaterLevel', () => {
  it('should return max value when cell is water (dist=0)', () => {
    const grid = new Grid(10, 10);
    grid.setCell(5, 5, { terrainType: TerrainType.WATER });
    // Formula: round(100 * (1 - (0-1)/3)) = 133
    expect(getGroundwaterLevel(grid, 5, 5)).toBe(133);
  });

  it('should return 100 for cells 1 step from water', () => {
    const grid = new Grid(10, 10);
    grid.setCell(5, 5, { terrainType: TerrainType.WATER });
    // Formula: round(100 * (1 - (1-1)/3)) = 100
    expect(getGroundwaterLevel(grid, 5, 6)).toBe(100);
    expect(getGroundwaterLevel(grid, 6, 5)).toBe(100);
  });

  it('should return 0 for cells beyond range 3', () => {
    const grid = new Grid(10, 10);
    grid.setCell(0, 0, { terrainType: TerrainType.WATER });
    // Manhattan distance 4+ from (0,0)
    expect(getGroundwaterLevel(grid, 4, 1)).toBe(0);
  });

  it('should return 0 when no water is nearby', () => {
    const grid = new Grid(10, 10);
    expect(getGroundwaterLevel(grid, 5, 5)).toBe(0);
  });
});

describe('TERRAIN_GEN constants', () => {
  it('river position ratio should be between 0 and 1', () => {
    expect(TERRAIN_GEN.RIVER_POSITION_RATIO).toBeGreaterThan(0);
    expect(TERRAIN_GEN.RIVER_POSITION_RATIO).toBeLessThan(1);
  });

  it('forest fill chance should be between 0 and 1', () => {
    expect(TERRAIN_GEN.FOREST_FILL_CHANCE).toBeGreaterThan(0);
    expect(TERRAIN_GEN.FOREST_FILL_CHANCE).toBeLessThanOrEqual(1);
  });

  it('mountain ratios should be between 0 and 1', () => {
    expect(TERRAIN_GEN.MOUNTAIN_X_RATIO).toBeGreaterThan(0);
    expect(TERRAIN_GEN.MOUNTAIN_X_RATIO).toBeLessThan(1);
    expect(TERRAIN_GEN.MOUNTAIN_Y_RATIO).toBeGreaterThan(0);
    expect(TERRAIN_GEN.MOUNTAIN_Y_RATIO).toBeLessThan(1);
  });

  it('mountain peak elevation should be positive', () => {
    expect(TERRAIN_GEN.MOUNTAIN_PEAK_ELEVATION).toBeGreaterThan(0);
  });

  it('forest patch count and radius should be positive', () => {
    expect(TERRAIN_GEN.FOREST_PATCH_COUNT).toBeGreaterThan(0);
    expect(TERRAIN_GEN.FOREST_PATCH_RADIUS).toBeGreaterThan(0);
  });
});
