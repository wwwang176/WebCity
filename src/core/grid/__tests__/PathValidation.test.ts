import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import { TerrainType } from '../types';
import { validatePathTerrain } from '../PathValidation';

describe('validatePathTerrain', () => {
  it('returns null for valid terrain cells', () => {
    const grid = new Grid(10, 10);
    const cells = [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }];
    expect(validatePathTerrain(grid, cells)).toBeNull();
  });

  it('returns OUT_OF_BOUNDS for out-of-range cell', () => {
    const grid = new Grid(5, 5);
    const cells = [{ x: 2, y: 3 }, { x: 6, y: 3 }];
    expect(validatePathTerrain(grid, cells)).toBe('OUT_OF_BOUNDS');
  });

  it('returns WATER_TILE for water terrain', () => {
    const grid = new Grid(10, 10);
    grid.setCell(3, 3, { terrainType: TerrainType.WATER });
    const cells = [{ x: 2, y: 3 }, { x: 3, y: 3 }];
    expect(validatePathTerrain(grid, cells)).toBe('WATER_TILE');
  });

  it('returns MOUNTAIN_TILE for mountain terrain', () => {
    const grid = new Grid(10, 10);
    grid.setCell(3, 3, { terrainType: TerrainType.MOUNTAIN });
    const cells = [{ x: 2, y: 3 }, { x: 3, y: 3 }];
    expect(validatePathTerrain(grid, cells)).toBe('MOUNTAIN_TILE');
  });

  it('returns INFRASTRUCTURE_EXISTS for infrastructure buildings', () => {
    const grid = new Grid(10, 10);
    grid.setCell(3, 3, { buildingId: 254 }); // Power Plant
    const cells = [{ x: 2, y: 3 }, { x: 3, y: 3 }];
    expect(validatePathTerrain(grid, cells)).toBe('INFRASTRUCTURE_EXISTS');
  });

  it('allows cells with regular zone buildings', () => {
    const grid = new Grid(10, 10);
    grid.setCell(3, 3, { buildingId: 1 }); // zone building
    const cells = [{ x: 2, y: 3 }, { x: 3, y: 3 }];
    expect(validatePathTerrain(grid, cells)).toBeNull();
  });
});
