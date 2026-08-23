import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../types';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';

function makeGrid(size: number): Grid {
  return new Grid(size, size);
}

describe('UnifiedRoadLookup', () => {
  let grid: Grid;
  let em: ElevationManager;
  let lookup: UnifiedRoadLookup;

  beforeEach(() => {
    grid = makeGrid(20);
    em = new ElevationManager();
    lookup = new UnifiedRoadLookup(grid, em);
  });

  // --- getCellByKey ---

  describe('getCellByKey', () => {
    it('returns ground road for "x,y" key', () => {
      grid.setCell(5, 5, { roadType: RoadType.HIGHWAY, roadFlags: 0b1010 });
      const cell = lookup.getCellByKey('5,5');
      expect(cell).not.toBeNull();
      expect(cell!.roadType).toBe(RoadType.HIGHWAY);
    });

    it('returns elevated road for "x,y,level" key', () => {
      em.set(5, 5, 1, { roadType: RoadType.FOUR_LANE, roadFlags: 0b0101, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      const cell = lookup.getCellByKey('5,5,1');
      expect(cell).not.toBeNull();
      expect(cell!.roadType).toBe(RoadType.FOUR_LANE);
    });

    it('returns null for empty cell', () => {
      expect(lookup.getCellByKey('5,5')).toBeNull();
    });
  });


  // --- getAllKeysAtPosition ---

  describe('getAllKeysAtPosition', () => {
    // 這幾條是突變驗證逼出來的:高架那一段原本沒有任何測試守著，把它整段
    // 短路掉全套測試仍然全綠。而 `NetworkCoverage` 的水電洪水正是靠它找起點,
    // 少了高架就是「橋上的路不通電」。
    it('should list the ground road', () => {
      grid.setCell(4, 4, { roadType: RoadType.TWO_LANE });

      expect(lookup.getAllKeysAtPosition(4, 4)).toEqual(['4,4']);
    });

    it('should list an elevated road standing over empty ground', () => {
      em.set(4, 4, 2, { roadType: RoadType.HIGHWAY, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });

      expect(lookup.getAllKeysAtPosition(4, 4)).toEqual(['4,4,2']);
    });

    it('should list every level, ground first', () => {
      grid.setCell(4, 4, { roadType: RoadType.TWO_LANE });
      em.set(4, 4, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      em.set(4, 4, 3, { roadType: RoadType.HIGHWAY, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });

      expect(lookup.getAllKeysAtPosition(4, 4)).toEqual(['4,4', '4,4,1', '4,4,3']);
    });

    it('should skip an elevated rail deck', () => {
      // 高架鐵軌住在同一張表裡，`roadType` 是 NONE。它不是路。
      em.set(4, 4, 1, { roadType: RoadType.NONE, roadFlags: 0, railType: 1, railFlags: 0, isRamp: false, rampAscendDirection: 0 });

      expect(lookup.getAllKeysAtPosition(4, 4)).toEqual([]);
    });

    it('should say nothing outside the grid', () => {
      expect(lookup.getAllKeysAtPosition(-1, 4)).toEqual([]);
      expect(lookup.getAllKeysAtPosition(4, 999)).toEqual([]);
    });
  });
  // --- getCompatibleNeighborKeys ---

  describe('getCompatibleNeighborKeys', () => {
    it('ground connects to ground', () => {
      grid.setCell(5, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b0010 });
      const keys = lookup.getCompatibleNeighborKeys('5,5', 5, 4);
      expect(keys).toEqual(['5,4']);
    });

    it('ground connects to ramp (level diff=1, ramp present)', () => {
      em.set(5, 4, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0b0010, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });
      const keys = lookup.getCompatibleNeighborKeys('5,5', 5, 4);
      expect(keys).toContain('5,4,1');
    });

    it('ground does NOT connect to non-ramp elevated (level diff=1)', () => {
      em.set(5, 4, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0b0010, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      const keys = lookup.getCompatibleNeighborKeys('5,5', 5, 4);
      expect(keys).not.toContain('5,4,1');
    });

    it('elevated connects to same level', () => {
      em.set(5, 4, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0b0010, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      const keys = lookup.getCompatibleNeighborKeys('5,5,1', 5, 4);
      expect(keys).toEqual(['5,4,1']);
    });

    it('elevated does NOT connect to different level non-ramp', () => {
      em.set(5, 4, 2, { roadType: RoadType.HIGHWAY, roadFlags: 0b0010, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      const keys = lookup.getCompatibleNeighborKeys('5,5,1', 5, 4);
      expect(keys).toEqual([]);
    });

    it('elevated connects to adjacent level ramp', () => {
      em.set(5, 4, 2, { roadType: RoadType.HIGHWAY, roadFlags: 0b0010, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });
      const keys = lookup.getCompatibleNeighborKeys('5,5,1', 5, 4);
      expect(keys).toContain('5,4,2');
    });

    it('level 0 does NOT connect to level 2 (diff=2)', () => {
      em.set(5, 4, 2, { roadType: RoadType.HIGHWAY, roadFlags: 0b0010, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });
      const keys = lookup.getCompatibleNeighborKeys('5,5', 5, 4);
      expect(keys).not.toContain('5,4,2');
    });

    it('three layers at same position — each only sees own level', () => {
      grid.setCell(5, 4, { roadType: RoadType.TWO_LANE, roadFlags: 0b0010 });
      em.set(5, 4, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0b0101, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      em.set(5, 4, 2, { roadType: RoadType.HIGHWAY, roadFlags: 0b1010, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });

      expect(lookup.getCompatibleNeighborKeys('5,5', 5, 4)).toEqual(['5,4']);
      expect(lookup.getCompatibleNeighborKeys('5,5,1', 5, 4)).toEqual(['5,4,1']);
      expect(lookup.getCompatibleNeighborKeys('5,5,2', 5, 4)).toEqual(['5,4,2']);
    });
  });

  // --- getAllCellKeys ---

  describe('getAllCellKeys', () => {
    it('collects ground + elevated keys', () => {
      grid.setCell(3, 3, { roadType: RoadType.TWO_LANE, roadFlags: 0b0011 });
      em.set(5, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0b0101, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      const keys = lookup.getAllCellKeys();
      expect(keys).toContain('3,3');
      expect(keys).toContain('5,5,1');
    });
  });

  // --- isRamp ---

  describe('isRamp', () => {
    it('returns false for ground cell', () => {
      expect(lookup.isRamp('5,5')).toBe(false);
    });

    it('returns true for ramp segment', () => {
      em.set(5, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });
      expect(lookup.isRamp('5,5,1')).toBe(true);
    });

    it('returns false for non-ramp elevated segment', () => {
      em.set(5, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      expect(lookup.isRamp('5,5,1')).toBe(false);
    });
  });
});
