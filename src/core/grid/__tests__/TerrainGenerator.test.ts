import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import { TerrainType } from '../types';
import { generateTerrain, TERRAIN_GEN, type TerrainConfig } from '../TerrainGenerator';

function countTerrain(grid: Grid) {
  let water = 0, forest = 0;
  grid.forEachCell((cell) => {
    if (cell.terrainType === TerrainType.WATER) water++;
    if (cell.terrainType === TerrainType.FOREST) forest++;
  });
  return { water, forest };
}

const DEFAULT_TC: TerrainConfig = {
  riverHalfWidth: 1, lakeCount: 0, coastalFeature: false,
  forestDepth: 0.5, forestWaterGap: 2,
};

describe('generateTerrain', () => {
  it('should create water cells for the river', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid);
    expect(countTerrain(grid).water).toBeGreaterThanOrEqual(60);
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
        expect(gridA.getCell(x, y)!.terrainType).toBe(gridB.getCell(x, y)!.terrainType);
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
  });

  it('river stays within grid bounds for any seed', () => {
    for (const seed of [1, 42, 9999, 123456]) {
      const grid = new Grid(60, 60);
      generateTerrain(grid, seed);
    }
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

  it('higher forestDepth produces more forest cells', () => {
    const seed = 42;
    const gridSparse = new Grid(60, 60);
    const gridDense = new Grid(60, 60);
    generateTerrain(gridSparse, seed, { ...DEFAULT_TC, forestDepth: 0.15, forestWaterGap: 2 });
    generateTerrain(gridDense, seed, { ...DEFAULT_TC, forestDepth: 0.85, forestWaterGap: 2 });
    expect(countTerrain(gridDense).forest).toBeGreaterThan(countTerrain(gridSparse).forest);
  });

  it('forest concentrates at edges, not center', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid, 42, { ...DEFAULT_TC, forestDepth: 0.5 });

    let edgeForest = 0, centerForest = 0;
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        const cell = grid.getCell(x, y)!;
        if (cell.terrainType !== TerrainType.FOREST) continue;
        const edgeDist = Math.min(x, y, 59 - x, 59 - y);
        if (edgeDist <= 5) edgeForest++;
        else if (edgeDist >= 20) centerForest++;
      }
    }
    expect(edgeForest).toBeGreaterThan(centerForest);
  });

  it('forest avoids water cells', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid, 42, { ...DEFAULT_TC, forestDepth: 0.85, forestWaterGap: 2 });

    let forestNearWater = 0;
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        const cell = grid.getCell(x, y)!;
        if (cell.terrainType !== TerrainType.FOREST) continue;
        for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const nc = grid.getCell(x + dx, y + dy);
          if (nc && nc.terrainType === TerrainType.WATER) {
            forestNearWater++;
            break;
          }
        }
      }
    }
    expect(forestNearWater).toBe(0);
  });

  it('forestDepth 0 produces no forest', () => {
    const grid = new Grid(60, 60);
    generateTerrain(grid, 42, { ...DEFAULT_TC, forestDepth: 0 });
    expect(countTerrain(grid).forest).toBe(0);
  });

  // --- Coastal feature ---

  it('coastalFeature generates more water than plain river', () => {
    const seed = 42;
    const gridPlain = new Grid(60, 60);
    const gridFeature = new Grid(60, 60);
    generateTerrain(gridPlain, seed, { ...DEFAULT_TC, riverHalfWidth: 2 });
    generateTerrain(gridFeature, seed, { ...DEFAULT_TC, riverHalfWidth: 2, coastalFeature: true });
    expect(countTerrain(gridFeature).water).toBeGreaterThan(countTerrain(gridPlain).water);
  });

  it('coastalFeature is deterministic with same seed', () => {
    const cfg: TerrainConfig = { ...DEFAULT_TC, riverHalfWidth: 2, coastalFeature: true };
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

  it('same seed + same config = deterministic', () => {
    const cfg: TerrainConfig = { riverHalfWidth: 2, lakeCount: 2, coastalFeature: false, forestDepth: 0.85, forestWaterGap: 1 };
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
  });
});
