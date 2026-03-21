import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType } from '../../grid/types';
import {
  canPlaceInfra,
  placeInfraOnGrid,
  removeInfraFromGrid,
  findPrimaryCell,
  forEachMultiCell,
  getInfraCenter,
  getInfraCenterById,
  isPrimaryCellReserved,
  MULTI_CELL_OCCUPIED,
  BURNED,
  ROTATION_RESERVED,
  RESERVED_TO_ROTATION,
  type PlaceResult,
} from '../InfraPlacement';
import { getInfraConfig } from '../InfraConfig';

function makeGrid(w = 20, h = 20): Grid {
  return new Grid(w, h);
}

/** Place a road adjacent to position (x, y) so infrastructure can be placed. */
function placeAdjacentRoad(grid: Grid, x: number, y: number): void {
  grid.setCell(x - 1, y, { roadType: 1 });
}

function expectFail(result: PlaceResult, reason: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe(reason);
}

describe('InfraPlacement', () => {
  describe('canPlaceInfra', () => {
    it('should allow placing 1x1 park on empty tile with adjacent road', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      const result = canPlaceInfra(grid, 5, 5, 'park', 0);
      expect(result.ok).toBe(true);
    });

    it('should allow placing 2x2 police on empty tiles with adjacent road', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      const result = canPlaceInfra(grid, 5, 5, 'police', 0);
      expect(result.ok).toBe(true);
    });

    it('should allow placing 3x3 university on empty tiles with adjacent road', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      const result = canPlaceInfra(grid, 5, 5, 'school_univ', 0);
      expect(result.ok).toBe(true);
    });

    it('should reject if no adjacent road', () => {
      const grid = makeGrid();
      expectFail(canPlaceInfra(grid, 5, 5, 'park', 0), 'NOT_ADJACENT_TO_ROAD');
    });

    it('should reject 2x2 police if no adjacent road', () => {
      const grid = makeGrid();
      expectFail(canPlaceInfra(grid, 5, 5, 'police', 0), 'NOT_ADJACENT_TO_ROAD');
    });

    it('should allow if road is adjacent to any cell of footprint', () => {
      const grid = makeGrid();
      // Road adjacent to bottom-right cell of 2x2
      grid.setCell(7, 6, { roadType: 1 });
      const result = canPlaceInfra(grid, 5, 5, 'police', 0);
      expect(result.ok).toBe(true);
    });

    it('should reject if any tile is out of bounds', () => {
      const grid = makeGrid();
      expectFail(canPlaceInfra(grid, 19, 19, 'police', 0), 'OUT_OF_BOUNDS');
    });

    it('should reject if any tile is water', () => {
      const grid = makeGrid();
      grid.setCell(6, 5, { terrainType: TerrainType.WATER });
      expectFail(canPlaceInfra(grid, 5, 5, 'police', 0), 'WATER_TILE');
    });

    it('should reject if any tile has a road', () => {
      const grid = makeGrid();
      grid.setCell(5, 6, { roadType: 1 });
      expectFail(canPlaceInfra(grid, 5, 5, 'police', 0), 'TILE_OCCUPIED');
    });

    it('should allow placement on zone buildings (auto-demolish)', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      grid.setCell(6, 6, { buildingId: 1 }); // zone building
      const result = canPlaceInfra(grid, 5, 5, 'police', 0);
      expect(result.ok).toBe(true);
    });

    it('should reject if any tile has infrastructure building', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      grid.setCell(6, 6, { buildingId: 252 }); // police station buildingId
      expectFail(canPlaceInfra(grid, 5, 5, 'police', 0), 'INFRASTRUCTURE_EXISTS');
    });

    it('should reject if any tile has a rail track', () => {
      const grid = makeGrid();
      grid.setCell(5, 6, { railType: 1 });
      expectFail(canPlaceInfra(grid, 5, 5, 'police', 0), 'TILE_OCCUPIED');
    });

    it('should allow train_station on a tile with rail track and adjacent road', () => {
      const grid = makeGrid();
      grid.setCell(5, 5, { railType: 1 });
      placeAdjacentRoad(grid, 5, 5);
      const result = canPlaceInfra(grid, 5, 5, 'train_station', 0);
      expect(result.ok).toBe(true);
    });

    it('should reject train_station on a tile without rail track', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      expectFail(canPlaceInfra(grid, 5, 5, 'train_station', 0), 'NEED_RAIL_TRACK');
    });

    it('should allow ferry_dock next to water with adjacent road', () => {
      const grid = makeGrid();
      grid.setCell(6, 5, { terrainType: TerrainType.WATER });
      placeAdjacentRoad(grid, 5, 5);
      const result = canPlaceInfra(grid, 5, 5, 'ferry_dock', 0);
      expect(result.ok).toBe(true);
    });

    it('should reject ferry_dock with no adjacent water', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      expectFail(canPlaceInfra(grid, 5, 5, 'ferry_dock', 0), 'NEED_ADJACENT_WATER');
    });

    it('should handle 2x3 hospital with rotation 0 (occupies 2 wide, 3 tall)', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      const result = canPlaceInfra(grid, 5, 5, 'hospital', 0);
      expect(result.ok).toBe(true);
    });

    it('should handle 2x3 hospital with rotation 90 (occupies 3 wide, 2 tall)', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      const result = canPlaceInfra(grid, 5, 5, 'hospital', 90);
      expect(result.ok).toBe(true);
    });

    it('should reject 2x3 hospital rotated 90 if out of bounds', () => {
      const grid = makeGrid();
      expectFail(canPlaceInfra(grid, 18, 5, 'hospital', 90), 'OUT_OF_BOUNDS');
    });

    it('should allow water plant if any tile has groundwater and adjacent road', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 4, 4);
      const result = canPlaceInfra(grid, 4, 4, 'water', 0, (x: number, y: number) => {
        return Math.abs(x - 6) + Math.abs(y - 5) <= 3 ? 1 : 0;
      });
      expect(result.ok).toBe(true);
    });

    it('should reject water plant if no tile has groundwater', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 5, 5);
      expectFail(canPlaceInfra(grid, 5, 5, 'water', 0, () => 0), 'NO_GROUNDWATER');
    });
  });

  describe('placeInfraOnGrid', () => {
    it('should place 1x1 park: single cell with buildingId', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'park', 0);
      const cell = grid.getCell(5, 5)!;
      expect(cell.buildingId).toBe(248);
      expect(cell.reserved).toBe(0);
    });

    it('should place 2x2 police: primary at (5,5), secondaries at (6,5),(5,6),(6,6)', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 0);

      const primary = grid.getCell(5, 5)!;
      expect(primary.buildingId).toBe(252);
      expect(primary.reserved).not.toBe(MULTI_CELL_OCCUPIED);

      for (const [sx, sy] of [[6, 5], [5, 6], [6, 6]] as [number, number][]) {
        const sec = grid.getCell(sx, sy)!;
        expect(sec.buildingId).toBe(252);
        expect(sec.reserved).toBe(MULTI_CELL_OCCUPIED);
      }
    });

    it('should place 3x3 university: 1 primary + 8 secondaries', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 3, 3, 'school_univ', 0);

      const cfg = getInfraConfig('school_univ')!;
      let primaryCount = 0;
      let secondaryCount = 0;

      for (let dy = 0; dy < cfg.height; dy++) {
        for (let dx = 0; dx < cfg.width; dx++) {
          const cell = grid.getCell(3 + dx, 3 + dy)!;
          expect(cell.buildingId).toBe(243);
          if (dx === 0 && dy === 0) {
            expect(cell.reserved).not.toBe(MULTI_CELL_OCCUPIED);
            primaryCount++;
          } else {
            expect(cell.reserved).toBe(MULTI_CELL_OCCUPIED);
            secondaryCount++;
          }
        }
      }

      expect(primaryCount).toBe(1);
      expect(secondaryCount).toBe(8);
    });

    it('should place 2x3 hospital rotated 90: occupies 3 wide x 2 tall', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'hospital', 90);

      const primary = grid.getCell(5, 5)!;
      expect(primary.buildingId).toBe(250);

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const cell = grid.getCell(5 + dx, 5 + dy)!;
          expect(cell.buildingId).toBe(250);
        }
      }

      expect(grid.getCell(8, 5)!.buildingId).toBe(0);
      expect(grid.getCell(5, 7)!.buildingId).toBe(0);
    });
  });

  describe('removeInfraFromGrid', () => {
    it('should remove 2x2 building when clicking primary cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 0);
      removeInfraFromGrid(grid, 5, 5);

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cell = grid.getCell(5 + dx, 5 + dy)!;
          expect(cell.buildingId).toBe(0);
          expect(cell.reserved).toBe(0);
        }
      }
    });

    it('should remove 2x2 building when clicking secondary cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 0);
      removeInfraFromGrid(grid, 6, 6);

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cell = grid.getCell(5 + dx, 5 + dy)!;
          expect(cell.buildingId).toBe(0);
          expect(cell.reserved).toBe(0);
        }
      }
    });

    it('should remove 3x3 university when clicking any cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 3, 3, 'school_univ', 0);
      removeInfraFromGrid(grid, 5, 5);

      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const cell = grid.getCell(3 + dx, 3 + dy)!;
          expect(cell.buildingId).toBe(0);
          expect(cell.reserved).toBe(0);
        }
      }
    });

    it('should remove rotated 2x3 hospital (90°) correctly', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'hospital', 90);
      removeInfraFromGrid(grid, 7, 6);

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const cell = grid.getCell(5 + dx, 5 + dy)!;
          expect(cell.buildingId).toBe(0);
          expect(cell.reserved).toBe(0);
        }
      }
    });

    it('should return primary cell coordinates', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 0);
      const result = removeInfraFromGrid(grid, 6, 6);
      expect(result).toEqual({ primaryX: 5, primaryY: 5 });
    });

    it('should return null for empty cell', () => {
      const grid = makeGrid();
      const result = removeInfraFromGrid(grid, 5, 5);
      expect(result).toBeNull();
    });
  });

  describe('findPrimaryCell', () => {
    it('should return same coords for primary cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 0);
      expect(findPrimaryCell(grid, 5, 5)).toEqual({ x: 5, y: 5 });
    });

    it('should find primary from any secondary cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 0);
      expect(findPrimaryCell(grid, 6, 5)).toEqual({ x: 5, y: 5 });
      expect(findPrimaryCell(grid, 5, 6)).toEqual({ x: 5, y: 5 });
      expect(findPrimaryCell(grid, 6, 6)).toEqual({ x: 5, y: 5 });
    });

    it('should return null for non-infra cell', () => {
      const grid = makeGrid();
      expect(findPrimaryCell(grid, 5, 5)).toBeNull();
    });

    it('should find primary for 3x3 university from any cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 3, 3, 'school_univ', 0);

      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          expect(findPrimaryCell(grid, 3 + dx, 3 + dy)).toEqual({ x: 3, y: 3 });
        }
      }
    });
  });

  describe('edge cases', () => {
    it('should place 7x6 airport', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 0, 0, 'airport', 0);

      let count = 0;
      for (let dy = 0; dy < 6; dy++) {
        for (let dx = 0; dx < 7; dx++) {
          const cell = grid.getCell(dx, dy)!;
          expect(cell.buildingId).toBe(237);
          count++;
        }
      }
      expect(count).toBe(42);
    });

    it('should allow 3x3 placement when zone building exists (auto-demolish)', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 3, 3);
      grid.setCell(4, 4, { buildingId: 1 }); // zone building
      const result = canPlaceInfra(grid, 3, 3, 'school_univ', 0);
      expect(result.ok).toBe(true);
    });

    it('should reject 3x3 placement when infra building exists', () => {
      const grid = makeGrid();
      placeAdjacentRoad(grid, 3, 3);
      grid.setCell(4, 4, { buildingId: 252 }); // police station
      expectFail(canPlaceInfra(grid, 3, 3, 'school_univ', 0), 'INFRASTRUCTURE_EXISTS');
    });

    it('should reject placement at map edge', () => {
      const grid = makeGrid();
      const result = canPlaceInfra(grid, 19, 19, 'police', 0);
      expect(result.ok).toBe(false);
    });
  });

  describe('getInfraCenter', () => {
    it('should return same coords for 1x1 park', () => {
      expect(getInfraCenter(5, 5, 'park', 0)).toEqual({ cx: 5, cy: 5 });
    });

    it('should return offset (1,1) for 2x2 building', () => {
      expect(getInfraCenter(5, 5, 'police', 0)).toEqual({ cx: 6, cy: 6 });
    });

    it('should return offset (1,1) for 2x3 hospital (rot 0)', () => {
      expect(getInfraCenter(5, 5, 'hospital', 0)).toEqual({ cx: 6, cy: 6 });
    });

    it('should return offset (1,1) for 2x3 hospital (rot 90)', () => {
      // rot 90 → 3w×2h → floor(3/2)=1, floor(2/2)=1 → same center
      expect(getInfraCenter(5, 5, 'hospital', 90)).toEqual({ cx: 6, cy: 6 });
    });

    it('should return offset (1,1) for 3x3 university', () => {
      expect(getInfraCenter(5, 5, 'school_univ', 0)).toEqual({ cx: 6, cy: 6 });
    });

    it('should return center for 7x6 airport', () => {
      // Math.floor(7/2)=3, Math.floor(6/2)=3
      expect(getInfraCenter(5, 5, 'airport', 0)).toEqual({ cx: 8, cy: 8 });
    });

    it('should give same center regardless of rotation for 2x3', () => {
      const rot0 = getInfraCenter(10, 10, 'hospital', 0);
      const rot90 = getInfraCenter(10, 10, 'hospital', 90);
      const rot180 = getInfraCenter(10, 10, 'hospital', 180);
      const rot270 = getInfraCenter(10, 10, 'hospital', 270);
      expect(rot0).toEqual(rot90);
      expect(rot90).toEqual(rot180);
      expect(rot180).toEqual(rot270);
    });
  });

  describe('getInfraCenterById', () => {
    it('should compute center for 2x2 police by buildingId', () => {
      expect(getInfraCenterById(5, 5, 252)).toEqual({ cx: 6, cy: 6 });
    });

    it('should compute center for 1x1 park by buildingId', () => {
      expect(getInfraCenterById(5, 5, 248)).toEqual({ cx: 5, cy: 5 });
    });

    it('should compute center for 7x6 airport by buildingId', () => {
      expect(getInfraCenterById(0, 0, 237)).toEqual({ cx: 3, cy: 3 });
    });

    it('should return same coords for unknown buildingId', () => {
      expect(getInfraCenterById(5, 5, 999)).toEqual({ cx: 5, cy: 5 });
    });

    it('all 1x1 transport stops should have center === primary', () => {
      // bus_stop=242, metro_station=241, train_station=239, ferry_dock=238
      for (const id of [242, 241, 239, 238]) {
        expect(getInfraCenterById(10, 20, id)).toEqual({ cx: 10, cy: 20 });
      }
    });
  });

  describe('forEachMultiCell', () => {
    it('should iterate all cells of a 2x2 building', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 0);
      const cells: { x: number; y: number }[] = [];
      forEachMultiCell(grid, 5, 5, (x, y) => cells.push({ x, y }));
      expect(cells).toHaveLength(4);
      expect(cells).toContainEqual({ x: 5, y: 5 });
      expect(cells).toContainEqual({ x: 6, y: 5 });
      expect(cells).toContainEqual({ x: 5, y: 6 });
      expect(cells).toContainEqual({ x: 6, y: 6 });
    });

    it('should iterate all cells of a 3x3 building', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 3, 3, 'school_univ', 0);
      const cells: { x: number; y: number }[] = [];
      forEachMultiCell(grid, 4, 4, (x, y) => cells.push({ x, y }));
      expect(cells).toHaveLength(9);
    });

    it('should not call callback for non-infra cell', () => {
      const grid = makeGrid();
      const cells: { x: number; y: number }[] = [];
      forEachMultiCell(grid, 5, 5, (x, y) => cells.push({ x, y }));
      expect(cells).toHaveLength(0);
    });

    it('should work when called from any cell of the building', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 0);
      const cells: { x: number; y: number }[] = [];
      // Call from secondary cell (6,6)
      forEachMultiCell(grid, 6, 6, (x, y) => cells.push({ x, y }));
      expect(cells).toHaveLength(4);
    });
  });

  describe('rotation storage in grid', () => {
    it('should store rotation=0 as reserved=0 on primary cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 0);
      expect(grid.getCell(5, 5)!.reserved).toBe(ROTATION_RESERVED[0]); // 0
    });

    it('should store rotation=90 as reserved=5 on primary cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'hospital', 90);
      expect(grid.getCell(5, 5)!.reserved).toBe(ROTATION_RESERVED[90]); // 5
    });

    it('should store rotation=180 as reserved=6 on primary cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 180);
      expect(grid.getCell(5, 5)!.reserved).toBe(ROTATION_RESERVED[180]); // 6
    });

    it('should store rotation=270 as reserved=7 on primary cell', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'police', 270);
      expect(grid.getCell(5, 5)!.reserved).toBe(ROTATION_RESERVED[270]); // 7
    });

    it('should read rotation back from reserved value', () => {
      expect(RESERVED_TO_ROTATION[0]).toBe(0);
      expect(RESERVED_TO_ROTATION[5]).toBe(90);
      expect(RESERVED_TO_ROTATION[6]).toBe(180);
      expect(RESERVED_TO_ROTATION[7]).toBe(270);
    });

    it('isPrimaryCellReserved should identify primary cells', () => {
      expect(isPrimaryCellReserved(0)).toBe(true);
      expect(isPrimaryCellReserved(5)).toBe(true);
      expect(isPrimaryCellReserved(6)).toBe(true);
      expect(isPrimaryCellReserved(7)).toBe(true);
      expect(isPrimaryCellReserved(BURNED)).toBe(false);
      expect(isPrimaryCellReserved(MULTI_CELL_OCCUPIED)).toBe(false);
    });

    it('BURNED constant should equal 3', () => {
      expect(BURNED).toBe(3);
    });

    it('findPrimaryCell should work with rotated buildings', () => {
      const grid = makeGrid();
      placeInfraOnGrid(grid, 5, 5, 'hospital', 90);
      // 90° rotation: 3w×2h, cells at (5,5)-(7,6)
      expect(findPrimaryCell(grid, 7, 6)).toEqual({ x: 5, y: 5 });
      expect(findPrimaryCell(grid, 5, 5)).toEqual({ x: 5, y: 5 });
    });
  });
});
