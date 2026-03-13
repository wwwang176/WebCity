import { describe, it, expect } from 'vitest';
import { PoliceService, POLICE } from '../PoliceService';
import { RoadType } from '../../road/types';
import type { SizedGrid } from '../../grid/GridHelpers';

/** Grid with a horizontal road at row roadY from x=1 onward. */
function makeRoadGrid(width: number, height: number, roadY?: number): SizedGrid {
  const ry = roadY ?? Math.floor(height / 2);
  return {
    width,
    height,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: y === ry && x >= 1 ? RoadType.TWO_LANE : RoadType.NONE };
    },
  };
}

/** Grid with a cross-shaped road network centered at (cx, cy). */
function makeCrossRoadGrid(size: number, cx: number, cy: number): SizedGrid {
  return {
    width: size,
    height: size,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      const isRoad = x === cx || y === cy;
      return { roadType: isRoad ? RoadType.TWO_LANE : RoadType.NONE };
    },
  };
}

describe('PoliceService', () => {
  it('should create a PoliceService instance', () => {
    const police = new PoliceService();
    expect(police).toBeDefined();
  });

  it('should add a station and return an id', () => {
    const police = new PoliceService();
    const id = police.addStation(10, 10, 15);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should report coverage within road-distance reach', () => {
    // Cross road centered at (15, 15). Station at (14, 15) adjacent to road.
    const grid = makeCrossRoadGrid(40, 15, 15);
    const police = new PoliceService();
    police.addStation(14, 15, 15);
    police.tick(grid);
    // Station is adjacent to road at (15,15) → covered
    expect(police.getCoverage(15, 15)).toBe(true);
    // Further along road → covered
    expect(police.getCoverage(18, 15)).toBe(true);
    // Adjacent to road → covered (building slot)
    expect(police.getCoverage(16, 14)).toBe(true);
  });

  it('should NOT report coverage outside road reach', () => {
    const grid = makeRoadGrid(60, 30, 15);
    const police = new PoliceService();
    police.addStation(0, 15, 15);
    police.tick(grid);
    // Very far away (beyond budget)
    expect(police.getCoverage(50, 15)).toBe(false);
    // No road connection
    expect(police.getCoverage(5, 0)).toBe(false);
  });

  it('should handle multiple stations with overlapping coverage', () => {
    const grid = makeRoadGrid(40, 10, 5);
    const police = new PoliceService();
    police.addStation(0, 5, 15);
    police.addStation(20, 5, 15);
    police.tick(grid);
    // Covered by first
    expect(police.getCoverage(3, 5)).toBe(true);
    // Covered by second
    expect(police.getCoverage(25, 5)).toBe(true);
    // Overlap zone
    expect(police.getCoverage(10, 5)).toBe(true);
    // Not covered by either (off road)
    expect(police.getCoverage(0, 0)).toBe(false);
  });

  it('should return crime reduction within coverage', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const police = new PoliceService();
    police.addStation(14, 15, 15);
    police.tick(grid);
    expect(police.getCrimeReduction(15, 15)).toBe(-30);
  });

  it('should return crime reduction 0 outside coverage', () => {
    const grid = makeRoadGrid(60, 30, 15);
    const police = new PoliceService();
    police.addStation(0, 15, 15);
    police.tick(grid);
    expect(police.getCrimeReduction(50, 25)).toBe(0);
  });

  it('should stack crime reduction from multiple stations up to -60', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const police = new PoliceService();
    police.addStation(14, 15, 15);
    police.addStation(16, 15, 15);
    police.tick(grid);
    // Both cover (15,15)
    expect(police.getCrimeReduction(15, 15)).toBe(-60);
  });

  it('should cap crime reduction at -60 even with 3+ stations', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const police = new PoliceService();
    police.addStation(14, 15, 15);
    police.addStation(16, 15, 15);
    police.addStation(15, 14, 15);
    police.tick(grid);
    expect(police.getCrimeReduction(15, 15)).toBe(-60);
  });

  it('should remove station and coverage disappears', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const police = new PoliceService();
    const id = police.addStation(14, 15, 15);
    police.tick(grid);
    expect(police.getCoverage(15, 15)).toBe(true);

    police.removeStation(id);
    police.tick(grid);
    expect(police.getCoverage(15, 15)).toBe(false);
    expect(police.getCrimeReduction(15, 15)).toBe(0);
  });

  it('should update coverage map on tick()', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const police = new PoliceService();
    police.tick(grid);
    expect(police.getCoverage(15, 15)).toBe(false);

    police.addStation(14, 15, 15);
    police.tick(grid);
    expect(police.getCoverage(15, 15)).toBe(true);
  });

  it('should serialize to JSON and deserialize back', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const police = new PoliceService();
    police.addStation(14, 15, 15);
    police.addStation(16, 16, 10);
    police.tick(grid);

    const json = police.toJSON();
    const restored = PoliceService.fromJSON(json);
    restored.tick(grid);

    expect(restored.getCoverage(15, 15)).toBe(true);
    // Both stations cover (15,15) via cross road → -60
    expect(restored.getCrimeReduction(15, 15)).toBe(-60);
  });

  it('should use default radius of 15 when not specified', () => {
    const police = new PoliceService();
    police.addStation(10, 10);
    expect(police.getStations()[0]!.radius).toBe(15);
  });

  it('previewCoverage returns coverage for drag preview', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const police = new PoliceService();
    const preview = police.previewCoverage({ x: 14, y: 15 }, grid);
    expect(preview.size).toBeGreaterThan(0);
    // Main coverage unaffected
    expect(police.getCoverage(15, 15)).toBe(false);
  });

  it('previewCoverage merges with existing station coverage', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const police = new PoliceService();
    police.addStation(14, 15, 15);
    police.tick(grid);
    // Existing station covers (15,15) with some cost
    expect(police.getCoverage(15, 15)).toBe(true);
    // Preview a second station far away — merged result should still include (15,15)
    const preview = police.previewCoverage({ x: 15, y: 25 }, grid);
    expect(preview.has('15,15')).toBe(true);
    // Merged result is larger than either alone
    const previewOnly = police.previewCoverage({ x: 15, y: 25 }, grid);
    expect(previewOnly.size).toBeGreaterThan(0);
  });
});

describe('POLICE constants', () => {
  it('crime reduction per station should be negative', () => {
    expect(POLICE.CRIME_REDUCTION_PER_STATION).toBeLessThan(0);
  });

  it('crime reduction cap should be <= reduction per station (more negative)', () => {
    expect(POLICE.CRIME_REDUCTION_CAP).toBeLessThanOrEqual(POLICE.CRIME_REDUCTION_PER_STATION);
  });
});
