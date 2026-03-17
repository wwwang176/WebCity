import { describe, it, expect } from 'vitest';
import { EducationService, type SchoolType } from '../EducationService';
import { RoadType } from '../../road/types';
import type { SizedGrid } from '../../grid/GridHelpers';

/** Grid with a cross-shaped road centered at (cx, cy). */
function makeCrossRoadGrid(size: number, cx: number, cy: number): SizedGrid {
  return {
    width: size,
    height: size,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      const isRoad = x === cx || y === cy;
      return { roadType: isRoad ? RoadType.TWO_LANE : RoadType.NONE, buildingId: 0, zoneType: 0 };
    },
  };
}

/** Grid with multiple cross roads for testing non-overlapping coverage. */
function makeMultiCrossGrid(size: number, centers: [number, number][]): SizedGrid {
  return {
    width: size,
    height: size,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      const isRoad = centers.some(([cx, cy]) => x === cx || y === cy);
      return { roadType: isRoad ? RoadType.TWO_LANE : RoadType.NONE, buildingId: 0, zoneType: 0 };
    },
  };
}

describe('EducationService', () => {
  it('should create an instance with no schools', () => {
    const edu = new EducationService();
    expect(edu.getSchools()).toHaveLength(0);
  });

  describe('addSchool', () => {
    it('should add an elementary school with default radius', () => {
      const edu = new EducationService();
      const id = edu.addSchool(5, 5, 'elementary');
      expect(id).toBeTruthy();
      const schools = edu.getSchools();
      expect(schools).toHaveLength(1);
      expect(schools[0]!.type).toBe('elementary');
      expect(schools[0]!.x).toBe(5);
      expect(schools[0]!.y).toBe(5);
      expect(schools[0]!.radius).toBe(10);
    });

    it('should add a highschool with default radius 12', () => {
      const edu = new EducationService();
      const id = edu.addSchool(10, 10, 'highschool');
      expect(id).toBeTruthy();
      const schools = edu.getSchools();
      expect(schools).toHaveLength(1);
      expect(schools[0]!.type).toBe('highschool');
      expect(schools[0]!.radius).toBe(12);
    });

    it('should add a university with default radius 15', () => {
      const edu = new EducationService();
      const id = edu.addSchool(20, 20, 'university');
      expect(id).toBeTruthy();
      const schools = edu.getSchools();
      expect(schools).toHaveLength(1);
      expect(schools[0]!.type).toBe('university');
      expect(schools[0]!.radius).toBe(15);
    });

    it('should allow custom radius and capacity', () => {
      const edu = new EducationService();
      edu.addSchool(5, 5, 'elementary', 20, 500);
      const school = edu.getSchools()[0]!;
      expect(school.radius).toBe(20);
      expect(school.capacity).toBe(500);
    });

    it('should assign unique ids to each school', () => {
      const edu = new EducationService();
      const id1 = edu.addSchool(0, 0, 'elementary');
      const id2 = edu.addSchool(5, 5, 'highschool');
      const id3 = edu.addSchool(10, 10, 'university');
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
    });
  });

  describe('getTotalCapacity', () => {
    it('should return 0 when no schools exist', () => {
      const edu = new EducationService();
      expect(edu.getTotalCapacity('elementary')).toBe(0);
      expect(edu.getTotalCapacity('highschool')).toBe(0);
      expect(edu.getTotalCapacity('university')).toBe(0);
    });

    it('should return capacity of a single school', () => {
      const edu = new EducationService();
      edu.addSchool(5, 5, 'elementary');
      expect(edu.getTotalCapacity('elementary')).toBe(200); // DEFAULT_CAPACITY
    });

    it('should sum capacities of same-type schools', () => {
      const edu = new EducationService();
      edu.addSchool(5, 5, 'elementary');
      edu.addSchool(10, 10, 'elementary');
      expect(edu.getTotalCapacity('elementary')).toBe(400);
    });

    it('should only count specified type', () => {
      const edu = new EducationService();
      edu.addSchool(5, 5, 'elementary');
      edu.addSchool(10, 10, 'highschool');
      expect(edu.getTotalCapacity('elementary')).toBe(200);
      expect(edu.getTotalCapacity('highschool')).toBe(300);
      expect(edu.getTotalCapacity('university')).toBe(0);
    });

    it('should return custom capacity correctly', () => {
      const edu = new EducationService();
      edu.addSchool(5, 5, 'elementary', undefined, 100);
      edu.addSchool(10, 10, 'elementary', undefined, 150);
      expect(edu.getTotalCapacity('elementary')).toBe(250);
    });
  });

  describe('getCoverage', () => {
    it('should return true for a position within elementary school road coverage', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      edu.recalculateCoverage(grid);
      expect(edu.getCoverage(10, 10, 'elementary')).toBe(true);
      expect(edu.getCoverage(11, 10, 'elementary')).toBe(true); // adjacent road
    });

    it('should return false for a position outside elementary school road coverage', () => {
      const grid = makeCrossRoadGrid(60, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      edu.recalculateCoverage(grid);
      // Far away and not on road
      expect(edu.getCoverage(50, 50, 'elementary')).toBe(false);
    });

    it('should return true for a position within highschool road coverage', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'highschool');
      edu.recalculateCoverage(grid);
      expect(edu.getCoverage(10, 10, 'highschool')).toBe(true);
      expect(edu.getCoverage(11, 10, 'highschool')).toBe(true);
    });

    it('should return false for a position outside highschool road coverage', () => {
      const grid = makeCrossRoadGrid(60, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'highschool');
      edu.recalculateCoverage(grid);
      expect(edu.getCoverage(50, 50, 'highschool')).toBe(false);
    });

    it('should return true for a position within university road coverage', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'university');
      edu.recalculateCoverage(grid);
      expect(edu.getCoverage(10, 10, 'university')).toBe(true);
      expect(edu.getCoverage(11, 10, 'university')).toBe(true);
    });

    it('should return false for a position outside university road coverage', () => {
      const grid = makeCrossRoadGrid(60, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'university');
      edu.recalculateCoverage(grid);
      expect(edu.getCoverage(50, 50, 'university')).toBe(false);
    });

    it('should check coverage across all schools when type is not specified', () => {
      const grid = makeMultiCrossGrid(60, [[10, 10], [40, 40]]);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      edu.addSchool(40, 40, 'university');
      edu.recalculateCoverage(grid);
      expect(edu.getCoverage(10, 10)).toBe(true);  // near elementary
      expect(edu.getCoverage(40, 40)).toBe(true);  // near university
      expect(edu.getCoverage(25, 25)).toBe(false); // between, not on any road
    });

    it('should only check coverage for the specified type', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      edu.recalculateCoverage(grid);
      // Position is covered by elementary but NOT by highschool
      expect(edu.getCoverage(10, 10, 'elementary')).toBe(true);
      expect(edu.getCoverage(10, 10, 'highschool')).toBe(false);
    });
  });

  describe('getEducationLevel', () => {
    it('should return NONE when no schools cover the position', () => {
      const edu = new EducationService();
      expect(edu.getEducationLevel(50, 50)).toBe('none');
    });

    it('should return elementary when only elementary school covers position', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      edu.recalculateCoverage(grid);
      expect(edu.getEducationLevel(10, 10)).toBe('elementary');
    });

    it('should return highschool when highschool covers position', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'highschool');
      edu.recalculateCoverage(grid);
      expect(edu.getEducationLevel(10, 10)).toBe('highschool');
    });

    it('should return university when university covers position', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'university');
      edu.recalculateCoverage(grid);
      expect(edu.getEducationLevel(10, 10)).toBe('university');
    });

    it('should return the highest education level when multiple schools cover position', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      edu.addSchool(10, 10, 'highschool');
      edu.recalculateCoverage(grid);
      expect(edu.getEducationLevel(10, 10)).toBe('highschool');
    });

    it('should return university as highest when all three types cover position', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      edu.addSchool(10, 10, 'highschool');
      edu.addSchool(10, 10, 'university');
      edu.recalculateCoverage(grid);
      expect(edu.getEducationLevel(10, 10)).toBe('university');
    });

    it('should return elementary even with highschool and university if only elementary is in range', () => {
      const grid = makeMultiCrossGrid(90, [[10, 10], [50, 50], [80, 80]]);
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      edu.addSchool(50, 50, 'highschool');
      edu.addSchool(80, 80, 'university');
      edu.recalculateCoverage(grid);
      // (11, 10) is on road near elementary only, far from highschool/university
      expect(edu.getEducationLevel(11, 10)).toBe('elementary');
    });
  });

  describe('removeSchool', () => {
    it('should remove a school by id', () => {
      const edu = new EducationService();
      const id = edu.addSchool(10, 10, 'elementary');
      expect(edu.getSchools()).toHaveLength(1);
      edu.removeSchool(id);
      expect(edu.getSchools()).toHaveLength(0);
    });

    it('should remove coverage after school is removed', () => {
      const grid = makeCrossRoadGrid(30, 10, 10);
      const edu = new EducationService();
      const id = edu.addSchool(10, 10, 'elementary');
      edu.recalculateCoverage(grid);
      expect(edu.getCoverage(10, 10, 'elementary')).toBe(true);
      expect(edu.getEducationLevel(10, 10)).toBe('elementary');
      edu.removeSchool(id);
      edu.recalculateCoverage(grid);
      expect(edu.getCoverage(10, 10, 'elementary')).toBe(false);
      expect(edu.getEducationLevel(10, 10)).toBe('none');
    });

    it('should not affect other schools when one is removed', () => {
      const grid = makeMultiCrossGrid(60, [[10, 10], [40, 40]]);
      const edu = new EducationService();
      const id1 = edu.addSchool(10, 10, 'elementary');
      edu.addSchool(40, 40, 'highschool');
      edu.recalculateCoverage(grid);
      edu.removeSchool(id1);
      edu.recalculateCoverage(grid);
      expect(edu.getSchools()).toHaveLength(1);
      expect(edu.getCoverage(40, 40, 'highschool')).toBe(true);
    });

    it('should do nothing when removing a nonexistent id', () => {
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      edu.removeSchool('nonexistent-id');
      expect(edu.getSchools()).toHaveLength(1);
    });
  });

  describe('tick', () => {
    it('should not throw when called', () => {
      const edu = new EducationService();
      edu.addSchool(10, 10, 'elementary');
      expect(() => edu.tick()).not.toThrow();
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON and deserialize back', () => {
      const grid = makeMultiCrossGrid(60, [[5, 5], [15, 15], [25, 25]]);
      const edu = new EducationService();
      edu.addSchool(5, 5, 'elementary', 10, 200);
      edu.addSchool(15, 15, 'highschool', 12, 300);
      edu.addSchool(25, 25, 'university', 15, 500);

      const json = edu.toJSON();
      const restored = EducationService.fromJSON(json);

      expect(restored.getSchools()).toHaveLength(3);
      expect(restored.getSchools()[0]!.type).toBe('elementary');
      expect(restored.getSchools()[0]!.x).toBe(5);
      expect(restored.getSchools()[0]!.y).toBe(5);
      expect(restored.getSchools()[0]!.radius).toBe(10);
      expect(restored.getSchools()[0]!.capacity).toBe(200);

      expect(restored.getSchools()[1]!.type).toBe('highschool');
      expect(restored.getSchools()[2]!.type).toBe('university');

      // Verify coverage works after deserialization
      restored.recalculateCoverage(grid);
      expect(restored.getCoverage(5, 5, 'elementary')).toBe(true);
      expect(restored.getEducationLevel(25, 25)).toBe('university');
    });

    it('should serialize empty service', () => {
      const edu = new EducationService();
      const json = edu.toJSON();
      const restored = EducationService.fromJSON(json);
      expect(restored.getSchools()).toHaveLength(0);
    });
  });
});
