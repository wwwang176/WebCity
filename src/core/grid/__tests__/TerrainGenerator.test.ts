import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import { TerrainType } from '../types';
import { generateTerrain, TERRAIN_GEN, type TerrainConfig } from '../TerrainGenerator';

function countTerrain(grid: Grid) {
  let water = 0, forest = 0, mountain = 0;
  grid.forEachCell((cell) => {
    if (cell.terrainType === TerrainType.WATER) water++;
    if (cell.terrainType === TerrainType.FOREST) forest++;
    if (cell.terrainType === TerrainType.MOUNTAIN) mountain++;
  });
  return { water, forest, mountain };
}

const DEFAULT_TC: TerrainConfig = {
  riverHalfWidth: 1, lakeCount: 0,
  forestPatchCount: 8, forestFillChance: 0.7,
  mountainCount: 1,
};

describe('generateTerrain', () => {
  it('should create water cells for the river', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid);
    expect(countTerrain(grid).water).toBeGreaterThanOrEqual(60);
  });

  it('should create mountain cells', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid);
    expect(countTerrain(grid).mountain).toBeGreaterThan(0);
  });

  it('should produce forest cells', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid);
    expect(countTerrain(grid).forest).toBeGreaterThan(0);
  });

  it('should not modify cells outside grid bounds', () => {
    const grid = new Grid(5, 5);
    expect(() => generateTerrain(grid)).not.toThrow();
  });

  // --- Seed-based determinism ---

  it('same seed produces identical terrain', () => {
    const gridA = new Grid(60, 60);
    const gridB = new Grid(60, 60);
    generateTerrain(gridA, 12345);
    generateTerrain(gridB, 12345);

    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        const a = gridA.getCell(x, y)!;
        const b = gridB.getCell(x, y)!;
        expect(a.terrainType).toBe(b.terrainType);
        expect(a.elevation).toBe(b.elevation);
      }
    }
  });

  it('different seeds produce different terrain', () => {
    const gridA = new Grid(60, 60);
    const gridB = new Grid(60, 60);
    generateTerrain(gridA, 111);
    generateTerrain(gridB, 999);

    let differences = 0;
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        if (gridA.getCell(x, y)!.terrainType !== gridB.getCell(x, y)!.terrainType) differences++;
      }
    }
    expect(differences).toBeGreaterThan(0);
  });

  it('no seed still generates valid terrain (auto-seed)', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid);
    const c = countTerrain(grid);
    expect(c.water).toBeGreaterThan(0);
    expect(c.forest).toBeGreaterThan(0);
    expect(c.mountain).toBeGreaterThan(0);
  });

  it('river stays within grid bounds for any seed', () => {
    for (const seed of [1, 42, 9999, 123456]) {
      const grid = new Grid(60, 60);
      generateTerrain(grid, seed);
    }
  });

  it('mountain has positive elevation at its center', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid, 42);
    let hasElevation = false;
    grid.forEachCell((cell) => {
      if (cell.terrainType === TerrainType.MOUNTAIN && cell.elevation > 0) hasElevation = true;
    });
    expect(hasElevation).toBe(true);
  });

  // --- TerrainConfig overrides ---

  it('wider river produces more water cells', () => {
    const seed = 42;
    const gridNormal = new Grid(60, 60);
    const gridWide = new Grid(60, 60);
    generateTerrain(gridNormal, seed, { ...DEFAULT_TC, riverHalfWidth: 1, lakeCount: 0 });
    generateTerrain(gridWide, seed, { ...DEFAULT_TC, riverHalfWidth: 2, lakeCount: 0 });
    expect(countTerrain(gridWide).water).toBeGreaterThan(countTerrain(gridNormal).water);
  });

  it('lakeCount > 0 produces extra water beyond river', () => {
    const seed = 42;
    const gridNoLake = new Grid(60, 60);
    const gridLake = new Grid(60, 60);
    generateTerrain(gridNoLake, seed, { ...DEFAULT_TC, lakeCount: 0 });
    generateTerrain(gridLake, seed, { ...DEFAULT_TC, lakeCount: 2 });
    expect(countTerrain(gridLake).water).toBeGreaterThan(countTerrain(gridNoLake).water);
  });

  it('more forest patches produce more forest cells', () => {
    const seed = 42;
    const gridSparse = new Grid(60, 60);
    const gridDense = new Grid(60, 60);
    generateTerrain(gridSparse, seed, { ...DEFAULT_TC, forestPatchCount: 4, forestFillChance: 0.4 });
    generateTerrain(gridDense, seed, { ...DEFAULT_TC, forestPatchCount: 14, forestFillChance: 0.9 });
    expect(countTerrain(gridDense).forest).toBeGreaterThan(countTerrain(gridSparse).forest);
  });

  it('mountainCount 0 produces no mountains', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid, 42, { ...DEFAULT_TC, mountainCount: 0 });
    expect(countTerrain(grid).mountain).toBe(0);
  });

  it('mountainCount 3 produces more mountain cells than 1', () => {
    const seed = 42;
    const grid1 = new Grid(60, 60);
    const grid3 = new Grid(60, 60);
    generateTerrain(grid1, seed, { ...DEFAULT_TC, mountainCount: 1 });
    generateTerrain(grid3, seed, { ...DEFAULT_TC, mountainCount: 3 });
    expect(countTerrain(grid3).mountain).toBeGreaterThan(countTerrain(grid1).mountain);
  });

  it('same seed + same config = deterministic', () => {
    const cfg: TerrainConfig = { riverHalfWidth: 2, lakeCount: 2, forestPatchCount: 14, forestFillChance: 0.9, mountainCount: 3 };
    const gridA = new Grid(60, 60);
    const gridB = new Grid(60, 60);
    generateTerrain(gridA, 777, cfg);
    generateTerrain(gridB, 777, cfg);
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        expect(gridA.getCell(x, y)!.terrainType).toBe(gridB.getCell(x, y)!.terrainType);
      }
    }
  });

  it('backward compatible: no config param uses defaults', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid, 42);
    const c = countTerrain(grid);
    expect(c.water).toBeGreaterThan(0);
    expect(c.forest).toBeGreaterThan(0);
    expect(c.mountain).toBeGreaterThan(0);
  });
});
