import { describe, it, expect, beforeEach } from 'vitest';
import { ElevationManager } from '../ElevationManager';

describe('ElevationManager', () => {
  let em: ElevationManager;

  beforeEach(() => {
    em = new ElevationManager();
  });

  // --- CRUD ---

  describe('get/set/delete', () => {
    it('returns null for empty cell', () => {
      expect(em.get(5, 3, 1)).toBeNull();
    });

    it('stores and retrieves a segment', () => {
      em.set(5, 3, 1, { roadType: 5, roadFlags: 0b1010, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      const seg = em.get(5, 3, 1);
      expect(seg).not.toBeNull();
      expect(seg!.roadType).toBe(5);
      expect(seg!.roadFlags).toBe(0b1010);
      expect(seg!.isRamp).toBe(false);
    });

    it('overwrites existing segment', () => {
      em.set(1, 2, 1, { roadType: 3, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      em.set(1, 2, 1, { roadType: 5, roadFlags: 0, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });
      expect(em.get(1, 2, 1)!.roadType).toBe(5);
      expect(em.get(1, 2, 1)!.isRamp).toBe(true);
    });

    it('different levels are independent', () => {
      em.set(0, 0, 1, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      em.set(0, 0, 2, { roadType: 2, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      expect(em.get(0, 0, 1)!.roadType).toBe(1);
      expect(em.get(0, 0, 2)!.roadType).toBe(2);
    });

    it('deletes a segment', () => {
      em.set(3, 4, 1, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      em.delete(3, 4, 1);
      expect(em.get(3, 4, 1)).toBeNull();
    });

    it('delete on non-existent segment is a no-op', () => {
      expect(() => em.delete(99, 99, 3)).not.toThrow();
    });

    it('rejects level 0', () => {
      expect(() => em.set(0, 0, 0, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 }))
        .toThrow();
    });

    it('rejects level > 3', () => {
      expect(() => em.set(0, 0, 4, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 }))
        .toThrow();
    });
  });

  // --- getAllLevels ---

  describe('getAllLevels', () => {
    it('returns empty array for cell with no elevated segments', () => {
      expect(em.getAllLevels(0, 0)).toEqual([]);
    });

    it('returns all levels for a cell', () => {
      em.set(5, 5, 1, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });
      em.set(5, 5, 3, { roadType: 3, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      const levels = em.getAllLevels(5, 5);
      expect(levels).toHaveLength(2);
      expect(levels.map(l => l.level)).toEqual([1, 3]);
      expect(levels[0]!.data.roadType).toBe(1);
      expect(levels[1]!.data.roadType).toBe(3);
    });
  });

  // --- hasElevatedSegment ---

  describe('hasElevatedSegment', () => {
    it('returns false for empty cell', () => {
      expect(em.hasElevatedSegment(0, 0)).toBe(false);
    });

    it('returns true when cell has elevated segment', () => {
      em.set(1, 1, 2, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      expect(em.hasElevatedSegment(1, 1)).toBe(true);
    });

    it('returns false after all segments deleted', () => {
      em.set(1, 1, 1, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      em.delete(1, 1, 1);
      expect(em.hasElevatedSegment(1, 1)).toBe(false);
    });
  });

  // --- getHighestLevel ---

  describe('getHighestLevel', () => {
    it('returns 0 for cell with no elevated segments', () => {
      expect(em.getHighestLevel(3, 3)).toBe(0);
    });

    it('returns the highest level', () => {
      em.set(3, 3, 1, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      em.set(3, 3, 3, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      expect(em.getHighestLevel(3, 3)).toBe(3);
    });
  });

  // --- toJSON / fromJSON ---

  describe('serialization', () => {
    it('round-trips correctly', () => {
      em.set(1, 2, 1, { roadType: 5, roadFlags: 0b0011, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });
      em.set(3, 4, 2, { roadType: 0, roadFlags: 0, railType: 1, railFlags: 0b1100, isRamp: false, rampAscendDirection: 0 });

      const json = em.toJSON();
      const em2 = new ElevationManager();
      em2.fromJSON(json);

      expect(em2.get(1, 2, 1)).toEqual(em.get(1, 2, 1));
      expect(em2.get(3, 4, 2)).toEqual(em.get(3, 4, 2));
      expect(em2.get(99, 99, 1)).toBeNull();
    });

    it('fromJSON on empty data produces empty manager', () => {
      const em2 = new ElevationManager();
      em2.fromJSON([]);
      expect(em2.getAllLevels(0, 0)).toEqual([]);
    });
  });

  // --- hasAnySegment / hasAnyElevatedRoad ---

  describe('hasAnyElevatedRoad', () => {
    // 這兩條原本在 ElevatedAwareReachability.test.ts，名字叫「會不會停用快取」。
    // 那道閘門已經隨 BUG-109 治本移除（快取現在也是樓層感知的），所以它們
    // 測的其實只是這兩個 predicate 本身 —— 搬回它們該在的地方。
    it('should not count an elevated RAIL line as an elevated road', () => {
      // 高架捷運與地面共用同一個 layers map，但 roadType 是 NONE，
      // 對道路可達性沒有貢獻。
      em.set(5, 6, 1, {
        roadType: 0, roadFlags: 0, railType: 1, railFlags: 12,
        isRamp: false, rampAscendDirection: 0,
      });
      expect(em.hasAnySegment()).toBe(true);
      expect(em.hasAnyElevatedRoad()).toBe(false);
    });

    it('should count an elevated road', () => {
      em.set(5, 6, 1, {
        roadType: 2, roadFlags: 12, railType: 0, railFlags: 0,
        isRamp: false, rampAscendDirection: 0,
      });
      expect(em.hasAnyElevatedRoad()).toBe(true);
    });
  });

  // --- clear ---

  describe('clear', () => {
    it('removes all segments', () => {
      em.set(1, 1, 1, { roadType: 1, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      em.set(2, 2, 2, { roadType: 2, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
      em.clear();
      expect(em.get(1, 1, 1)).toBeNull();
      expect(em.get(2, 2, 2)).toBeNull();
    });
  });
});
