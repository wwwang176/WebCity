import { describe, it, expect } from 'vitest';
import { HealthService, HEALTH } from '../HealthService';
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

describe('HealthService', () => {
  it('should create an instance', () => {
    const health = new HealthService();
    expect(health).toBeDefined();
  });

  it('should add a hospital and return an id', () => {
    const health = new HealthService();
    const id = health.addHospital(10, 10);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should add a hospital with default radius=12 and capacity=100', () => {
    const health = new HealthService();
    health.addHospital(10, 10);
    const hospitals = health.getHospitals();
    expect(hospitals).toHaveLength(1);
    expect(hospitals[0]!.x).toBe(10);
    expect(hospitals[0]!.y).toBe(10);
    expect(hospitals[0]!.radius).toBe(12);
    expect(hospitals[0]!.capacity).toBe(100);
  });

  it('should add a hospital with custom radius and capacity', () => {
    const health = new HealthService();
    health.addHospital(5, 5, 20, 200);
    const hospitals = health.getHospitals();
    expect(hospitals[0]!.radius).toBe(20);
    expect(hospitals[0]!.capacity).toBe(200);
  });

  it('getCoverage should return true for positions along road near hospital', () => {
    const grid = makeCrossRoadGrid(30, 10, 10);
    const health = new HealthService();
    health.addHospital(10, 10);
    health.recalculateCoverage(grid);
    // Hospital at intersection — adjacent road cells are covered
    expect(health.getCoverage(10, 10)).toBe(true);
    expect(health.getCoverage(11, 10)).toBe(true); // road along row 10
    expect(health.getCoverage(10, 11)).toBe(true); // road along col 10
  });

  it('getCoverage should return false for positions far from hospital with no road', () => {
    const grid = makeCrossRoadGrid(60, 10, 10);
    const health = new HealthService();
    health.addHospital(10, 10);
    health.recalculateCoverage(grid);
    // Cell not on road and not adjacent to any covered road cell
    expect(health.getCoverage(25, 25)).toBe(false);
  });

  it('getHealthBonus should return +20 for positions within coverage', () => {
    const grid = makeCrossRoadGrid(30, 10, 10);
    const health = new HealthService();
    health.addHospital(10, 10);
    health.recalculateCoverage(grid);
    expect(health.getHealthBonus(10, 10)).toBe(20);
    expect(health.getHealthBonus(11, 10)).toBe(20);
  });

  it('getHealthBonus should return 0 for positions outside coverage', () => {
    const grid = makeCrossRoadGrid(60, 10, 10);
    const health = new HealthService();
    health.addHospital(10, 10);
    health.recalculateCoverage(grid);
    expect(health.getHealthBonus(50, 50)).toBe(0);
  });

  it('multiple hospitals should stack health bonus up to cap of 35', () => {
    const grid = makeCrossRoadGrid(30, 10, 10);
    const health = new HealthService();
    // Two hospitals near the same road intersection
    health.addHospital(10, 10);
    health.addHospital(10, 8); // also on column 10 road
    health.recalculateCoverage(grid);
    // Position on the road intersection is covered by both
    expect(health.getCoverage(10, 10)).toBe(true);
    expect(health.getHealthBonus(10, 10)).toBe(35); // 20+20=40 capped at 35
  });

  it('multiple hospitals with non-overlapping coverage give +20 each independently', () => {
    // Two separate cross roads, far apart
    const grid: SizedGrid = {
      width: 60, height: 60,
      getCell(x: number, y: number) {
        if (x < 0 || y < 0 || x >= 60 || y >= 60) return null;
        const isRoad = (x === 5 || y === 5) || (x === 50 || y === 50);
        return { roadType: isRoad ? RoadType.TWO_LANE : RoadType.NONE, buildingId: 0, zoneType: 0 };
      },
    };
    const health = new HealthService();
    health.addHospital(5, 5);
    health.addHospital(50, 50);
    health.recalculateCoverage(grid);
    expect(health.getHealthBonus(5, 5)).toBe(20);
    expect(health.getHealthBonus(50, 50)).toBe(20);
    expect(health.getHealthBonus(30, 30)).toBe(0); // between the two, no coverage
  });

  it('removeHospital should remove coverage', () => {
    const grid = makeCrossRoadGrid(30, 10, 10);
    const health = new HealthService();
    const id = health.addHospital(10, 10);
    health.recalculateCoverage(grid);
    expect(health.getCoverage(10, 10)).toBe(true);
    health.removeHospital(id);
    health.recalculateCoverage(grid);
    expect(health.getCoverage(10, 10)).toBe(false);
    expect(health.getHealthBonus(10, 10)).toBe(0);
  });

  it('tick(grid) should update coverage', () => {
    const grid = makeCrossRoadGrid(30, 10, 10);
    const health = new HealthService();
    const id = health.addHospital(10, 10);
    health.tick(grid);
    expect(health.getCoverage(10, 10)).toBe(true);
    health.removeHospital(id);
    health.tick(grid);
    expect(health.getCoverage(10, 10)).toBe(false);
  });

  it('toJSON() should serialize state', () => {
    const health = new HealthService();
    health.addHospital(10, 10, 12, 100);
    health.addHospital(20, 20, 15, 200);
    const json = health.toJSON();
    expect(json.hospitals).toHaveLength(2);
    expect(json.hospitals[0]!.x).toBe(10);
    expect(json.hospitals[0]!.y).toBe(10);
    expect(json.hospitals[0]!.radius).toBe(12);
    expect(json.hospitals[0]!.capacity).toBe(100);
    expect(json.hospitals[1]!.x).toBe(20);
    expect(json.hospitals[1]!.y).toBe(20);
  });

  it('fromJSON() should restore state', () => {
    const grid = makeCrossRoadGrid(60, 10, 10);
    const health = new HealthService();
    health.addHospital(10, 10, 12, 100);
    const json = health.toJSON();

    const restored = HealthService.fromJSON(json);
    restored.recalculateCoverage(grid);
    expect(restored.getHospitals()).toHaveLength(1);
    expect(restored.getCoverage(10, 10)).toBe(true);
    expect(restored.getHealthBonus(10, 10)).toBe(20);
  });
});

describe('HEALTH constants', () => {
  it('bonus per hospital should be positive', () => {
    expect(HEALTH.BONUS_PER_HOSPITAL).toBeGreaterThan(0);
  });

  it('bonus cap should be >= bonus per hospital', () => {
    expect(HEALTH.BONUS_CAP).toBeGreaterThanOrEqual(HEALTH.BONUS_PER_HOSPITAL);
  });
});
