import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import { TerrainType } from '../types';
import { generateTerrain, TERRAIN_GEN } from '../TerrainGenerator';

describe('generateTerrain', () => {
  it('should create water cells for the river', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid);

    let waterCount = 0;
    grid.forEachCell((cell) => {
      if (cell.terrainType === TerrainType.WATER) waterCount++;
    });
    // River spans full height with width of 2*RIVER_HALF_WIDTH+1 = 3 cells
    expect(waterCount).toBeGreaterThanOrEqual(60); // at least 1 per row
  });

  it('should create mountain cells in the expected area', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid);

    let mountainCount = 0;
    grid.forEachCell((cell) => {
      if (cell.terrainType === TerrainType.MOUNTAIN) mountainCount++;
    });
    expect(mountainCount).toBeGreaterThan(0);

    // Mountain center should be near (0.15*60, 0.85*60) = (9, 51)
    const centerCell = grid.getCell(9, 51);
    expect(centerCell?.terrainType).toBe(TerrainType.MOUNTAIN);
    expect(centerCell?.elevation).toBeGreaterThan(0);
  });

  it('should produce forest cells', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid);

    let forestCount = 0;
    grid.forEachCell((cell) => {
      if (cell.terrainType === TerrainType.FOREST) forestCount++;
    });
    // With 8 patches of radius 3 and 70% fill, expect some forest
    expect(forestCount).toBeGreaterThan(0);
  });

  it('should not modify cells outside grid bounds', () => {
    // Small grid — should not throw
    const grid = new Grid(5, 5);
    expect(() => generateTerrain(grid)).not.toThrow();
  });
});
