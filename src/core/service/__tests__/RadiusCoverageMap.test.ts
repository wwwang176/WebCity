import { describe, it, expect } from 'vitest';
import { RadiusCoverageMap } from '../RadiusCoverageMap';

describe('RadiusCoverageMap', () => {
  it('should start empty with no coverage', () => {
    const map = new RadiusCoverageMap();
    expect(map.getCoverageCount(5, 5)).toBe(0);
    expect(map.hasCoverage(5, 5)).toBe(false);
  });

  it('should compute coverage from a single facility', () => {
    const map = new RadiusCoverageMap();
    map.recalculate([{ x: 5, y: 5, radius: 2 }]);

    expect(map.hasCoverage(5, 5)).toBe(true);
    expect(map.getCoverageCount(5, 5)).toBe(1);
    // Within radius
    expect(map.hasCoverage(6, 5)).toBe(true);
    expect(map.hasCoverage(5, 6)).toBe(true);
    // Outside radius
    expect(map.hasCoverage(8, 5)).toBe(false);
  });

  it('should stack coverage from overlapping facilities', () => {
    const map = new RadiusCoverageMap();
    map.recalculate([
      { x: 5, y: 5, radius: 3 },
      { x: 6, y: 5, radius: 3 },
    ]);

    // Cell (5,5) is covered by both
    expect(map.getCoverageCount(5, 5)).toBe(2);
    // Cell (6,5) is covered by both
    expect(map.getCoverageCount(6, 5)).toBe(2);
  });

  it('should clear previous coverage on recalculate', () => {
    const map = new RadiusCoverageMap();
    map.recalculate([{ x: 5, y: 5, radius: 2 }]);
    expect(map.hasCoverage(5, 5)).toBe(true);

    map.recalculate([]); // No facilities
    expect(map.hasCoverage(5, 5)).toBe(false);
  });

  it('should handle multiple recalculations correctly', () => {
    const map = new RadiusCoverageMap();
    map.recalculate([{ x: 0, y: 0, radius: 1 }]);
    expect(map.hasCoverage(0, 0)).toBe(true);

    map.recalculate([{ x: 10, y: 10, radius: 1 }]);
    expect(map.hasCoverage(0, 0)).toBe(false);
    expect(map.hasCoverage(10, 10)).toBe(true);
  });
});
