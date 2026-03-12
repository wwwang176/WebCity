import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import { TerrainType, ZoneType } from '../types';

describe('Grid', () => {
  describe('creation', () => {
    it('should create a grid with specified dimensions', () => {
      const grid = new Grid(200, 200);
      expect(grid.width).toBe(200);
      expect(grid.height).toBe(200);
    });

    it('should have 40,000 cells for a 200x200 grid', () => {
      const grid = new Grid(200, 200);
      expect(grid.totalCells).toBe(40000);
    });
  });

  describe('getCell', () => {
    it('should return a valid cell with default values at (0, 0)', () => {
      const grid = new Grid(10, 10);
      const cell = grid.getCell(0, 0);
      expect(cell).not.toBeNull();
      expect(cell!.terrainType).toBe(TerrainType.PLAIN);
      expect(cell!.zoneType).toBe(ZoneType.NONE);
      expect(cell!.buildingId).toBe(0);
      expect(cell!.roadFlags).toBe(0);
      expect(cell!.roadType).toBe(0);
      expect(cell!.trafficDensity).toBe(0);
      expect(cell!.landValue).toBe(0);
      expect(cell!.pollution).toBe(0);
      expect(cell!.noiseLevel).toBe(0);
      expect(cell!.serviceCoverage).toBe(0);
      expect(cell!.elevation).toBe(0);
    });

    it('should return null for negative x coordinate', () => {
      const grid = new Grid(10, 10);
      expect(grid.getCell(-1, 0)).toBeNull();
    });

    it('should return null for negative y coordinate', () => {
      const grid = new Grid(10, 10);
      expect(grid.getCell(0, -1)).toBeNull();
    });

    it('should return null for x >= width', () => {
      const grid = new Grid(200, 200);
      expect(grid.getCell(200, 0)).toBeNull();
    });

    it('should return null for y >= height', () => {
      const grid = new Grid(200, 200);
      expect(grid.getCell(0, 200)).toBeNull();
    });
  });

  describe('setCell', () => {
    it('should set terrainType and read it back', () => {
      const grid = new Grid(10, 10);
      grid.setCell(5, 5, { terrainType: TerrainType.WATER });
      const cell = grid.getCell(5, 5);
      expect(cell!.terrainType).toBe(TerrainType.WATER);
    });

    it('should set zoneType and read it back', () => {
      const grid = new Grid(10, 10);
      grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW });
      const cell = grid.getCell(3, 3);
      expect(cell!.zoneType).toBe(ZoneType.RESIDENTIAL_LOW);
    });

    it('should set multiple properties at once', () => {
      const grid = new Grid(10, 10);
      grid.setCell(2, 2, {
        terrainType: TerrainType.FOREST,
        landValue: 100,
        pollution: 50,
      });
      const cell = grid.getCell(2, 2);
      expect(cell!.terrainType).toBe(TerrainType.FOREST);
      expect(cell!.landValue).toBe(100);
      expect(cell!.pollution).toBe(50);
    });

    it('should not change other properties when setting one', () => {
      const grid = new Grid(10, 10);
      grid.setCell(1, 1, { terrainType: TerrainType.MOUNTAIN });
      grid.setCell(1, 1, { landValue: 200 });
      const cell = grid.getCell(1, 1);
      expect(cell!.terrainType).toBe(TerrainType.MOUNTAIN);
      expect(cell!.landValue).toBe(200);
    });
  });

  describe('getCellsInRect', () => {
    it('should return 16 cells for a 4x4 rect (0,0 to 3,3)', () => {
      const grid = new Grid(10, 10);
      const cells = grid.getCellsInRect({ x: 0, y: 0 }, { x: 3, y: 3 });
      expect(cells.length).toBe(16);
    });

    it('should clamp to grid bounds', () => {
      const grid = new Grid(5, 5);
      const cells = grid.getCellsInRect({ x: 3, y: 3 }, { x: 10, y: 10 });
      expect(cells.length).toBe(4); // (3,3),(3,4),(4,3),(4,4)
    });
  });

  describe('getNeighbors', () => {
    it('should return 4 neighbors for a center cell', () => {
      const grid = new Grid(10, 10);
      const neighbors = grid.getNeighbors(5, 5);
      expect(neighbors.length).toBe(4);
    });

    it('should return 2 neighbors for corner cell (0,0)', () => {
      const grid = new Grid(10, 10);
      const neighbors = grid.getNeighbors(0, 0);
      expect(neighbors.length).toBe(2);
    });

    it('should return 3 neighbors for edge cell (0,5)', () => {
      const grid = new Grid(10, 10);
      const neighbors = grid.getNeighbors(0, 5);
      expect(neighbors.length).toBe(3);
    });
  });

  describe('getNeighbors8', () => {
    it('should return 8 neighbors for a center cell', () => {
      const grid = new Grid(10, 10);
      const neighbors = grid.getNeighbors8(5, 5);
      expect(neighbors.length).toBe(8);
    });

    it('should return 3 neighbors for corner cell (0,0)', () => {
      const grid = new Grid(10, 10);
      const neighbors = grid.getNeighbors8(0, 0);
      expect(neighbors.length).toBe(3);
    });

    it('should return 5 neighbors for edge cell (0,5)', () => {
      const grid = new Grid(10, 10);
      const neighbors = grid.getNeighbors8(0, 5);
      expect(neighbors.length).toBe(5);
    });
  });

  describe('forEachCell', () => {
    it('visits every cell exactly once', () => {
      const grid = new Grid(4, 3);
      let count = 0;
      grid.forEachCell(() => { count++; });
      expect(count).toBe(12); // 4 * 3
    });

    it('provides correct x, y coordinates', () => {
      const grid = new Grid(3, 2);
      const coords: [number, number][] = [];
      grid.forEachCell((_cell, x, y) => { coords.push([x, y]); });
      // Should iterate row-by-row: (0,0),(1,0),(2,0),(0,1),(1,1),(2,1)
      expect(coords).toEqual([
        [0, 0], [1, 0], [2, 0],
        [0, 1], [1, 1], [2, 1],
      ]);
    });

    it('provides valid CellData for each cell', () => {
      const grid = new Grid(2, 2);
      grid.setCell(1, 0, { buildingId: 5 });
      const buildings: number[] = [];
      grid.forEachCell((cell) => { buildings.push(cell.buildingId); });
      expect(buildings).toEqual([0, 5, 0, 0]);
    });
  });
});
