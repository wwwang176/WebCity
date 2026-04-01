import { describe, it, expect } from 'vitest';
import { HealthService, HEALTH, HOSPITAL_LOAD, citizenHospitalDemand, loadRatioToDeathMultiplier, uncoveredPollutionMultiplier } from '../HealthService';
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

  it('should add a hospital with default radius=12 and capacity=1200', () => {
    const health = new HealthService();
    health.addHospital(10, 10);
    const hospitals = health.getHospitals();
    expect(hospitals).toHaveLength(1);
    expect(hospitals[0]!.x).toBe(10);
    expect(hospitals[0]!.y).toBe(10);
    expect(hospitals[0]!.radius).toBe(12);
    expect(hospitals[0]!.capacity).toBe(1500);
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
    health.addHospital(10, 10, 12, 1500);
    health.addHospital(20, 20, 15, 200);
    const json = health.toJSON();
    expect(json.hospitals).toHaveLength(2);
    expect(json.hospitals[0]!.x).toBe(10);
    expect(json.hospitals[0]!.y).toBe(10);
    expect(json.hospitals[0]!.radius).toBe(12);
    expect(json.hospitals[0]!.capacity).toBe(1500);
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

describe('citizenHospitalDemand', () => {
  it('returns base demand (0.3) with zero pollution', () => {
    expect(citizenHospitalDemand(0)).toBe(HOSPITAL_LOAD.BASE_DEMAND);
  });

  it('returns doubled demand (0.6) at max pollution', () => {
    expect(citizenHospitalDemand(255)).toBeCloseTo(
      HOSPITAL_LOAD.BASE_DEMAND + HOSPITAL_LOAD.POLLUTION_DEMAND,
      5,
    );
  });

  it('scales linearly with pollution', () => {
    const half = citizenHospitalDemand(127.5);
    expect(half).toBeCloseTo(0.45, 2);
  });
});

describe('loadRatioToDeathMultiplier', () => {
  it('returns COVERED_MIN (0.3) when load ≤ 1.0', () => {
    expect(loadRatioToDeathMultiplier(0)).toBe(HOSPITAL_LOAD.COVERED_MIN);
    expect(loadRatioToDeathMultiplier(0.5)).toBe(HOSPITAL_LOAD.COVERED_MIN);
    expect(loadRatioToDeathMultiplier(1.0)).toBe(HOSPITAL_LOAD.COVERED_MIN);
  });

  it('returns COVERED_MAX (1.0) when load ≥ 2.0', () => {
    expect(loadRatioToDeathMultiplier(2.0)).toBe(HOSPITAL_LOAD.COVERED_MAX);
    expect(loadRatioToDeathMultiplier(3.0)).toBe(HOSPITAL_LOAD.COVERED_MAX);
  });

  it('lerps linearly between 1.0 and 2.0 load', () => {
    const mid = loadRatioToDeathMultiplier(1.5);
    expect(mid).toBeCloseTo(0.65, 5);
  });

  it('lerps at 25% overload', () => {
    const quarter = loadRatioToDeathMultiplier(1.25);
    expect(quarter).toBeCloseTo(0.475, 5);
  });
});

describe('uncoveredPollutionMultiplier', () => {
  it('returns 1.0 with zero pollution', () => {
    expect(uncoveredPollutionMultiplier(0)).toBe(1.0);
  });

  it('returns 1.5 at max pollution', () => {
    expect(uncoveredPollutionMultiplier(255)).toBeCloseTo(1.5, 5);
  });

  it('scales linearly', () => {
    expect(uncoveredPollutionMultiplier(127.5)).toBeCloseTo(1.25, 2);
  });
});

describe('HealthService hospital load', () => {
  it('getTotalCapacity sums all hospital capacities', () => {
    const health = new HealthService();
    health.addHospital(0, 0, 12, 100);
    health.addHospital(5, 5, 12, 200);
    expect(health.getTotalCapacity()).toBe(300);
  });

  it('getTotalCapacity returns 0 with no hospitals', () => {
    const health = new HealthService();
    expect(health.getTotalCapacity()).toBe(0);
  });

  it('getLoadRatio defaults to 0', () => {
    const health = new HealthService();
    expect(health.getLoadRatio()).toBe(0);
  });

  it('updateLoads computes correct global load ratio', () => {
    const health = new HealthService();
    health.addHospital(0, 0, 12, 100);
    // 1 citizen at (1,1), no pollution → demand 0.3 / capacity 100 = 0.003
    health.updateLoads([{ x: 1, y: 1, pollution: 0 }]);
    expect(health.getLoadRatio()).toBeCloseTo(0.3 / 100, 5);
  });

  it('updateLoads with zero capacity and positive demand returns Infinity', () => {
    const health = new HealthService();
    health.updateLoads([{ x: 0, y: 0, pollution: 0 }]);
    expect(health.getLoadRatio()).toBe(Infinity);
  });

  it('updateLoads with zero capacity and zero demand returns 0', () => {
    const health = new HealthService();
    health.updateLoads([]);
    expect(health.getLoadRatio()).toBe(0);
  });

  it('pollution doubles per-citizen demand', () => {
    const health = new HealthService();
    health.addHospital(0, 0, 12, 100);
    // 100 citizens, no pollution: demand = 100×0.3 = 30
    const noPollution = Array.from({ length: 100 }, () => ({ x: 1, y: 1, pollution: 0 }));
    health.updateLoads(noPollution);
    const ratioClean = health.getLoadRatio();
    // 100 citizens, max pollution: demand = 100×0.6 = 60
    const maxPollution = Array.from({ length: 100 }, () => ({ x: 1, y: 1, pollution: 255 }));
    health.updateLoads(maxPollution);
    const ratioPolluted = health.getLoadRatio();
    expect(ratioPolluted).toBeCloseTo(ratioClean * 2, 2);
  });

  it('getHospitalLoad returns per-hospital demand', () => {
    const health = new HealthService();
    const id1 = health.addHospital(0, 0, 12, 100);
    const id2 = health.addHospital(20, 20, 12, 100);
    // 10 citizens near hospital 1 (at x=1), none near hospital 2
    const citizens = Array.from({ length: 10 }, () => ({ x: 1, y: 1, pollution: 0 }));
    health.updateLoads(citizens);
    expect(health.getHospitalLoad(id1)).toBe(Math.round(10 * 0.3)); // 3
    expect(health.getHospitalLoad(id2)).toBe(0);
  });

  it('citizens assigned to nearest hospital', () => {
    const health = new HealthService();
    const id1 = health.addHospital(0, 0, 12, 100);
    const id2 = health.addHospital(10, 0, 12, 100);
    // Citizen at (3,0) → closer to hospital 1
    // Citizen at (8,0) → closer to hospital 2
    health.updateLoads([
      { x: 3, y: 0, pollution: 0 },
      { x: 8, y: 0, pollution: 0 },
    ]);
    expect(health.getHospitalLoad(id1)).toBe(Math.round(0.3)); // 0
    expect(health.getHospitalLoad(id2)).toBe(Math.round(0.3)); // 0
    // With more citizens to see rounding
    const nearH1 = Array.from({ length: 20 }, () => ({ x: 2, y: 0, pollution: 0 }));
    const nearH2 = Array.from({ length: 5 }, () => ({ x: 9, y: 0, pollution: 0 }));
    health.updateLoads([...nearH1, ...nearH2]);
    expect(health.getHospitalLoad(id1)).toBe(Math.round(20 * 0.3)); // 6
    expect(health.getHospitalLoad(id2)).toBe(Math.round(5 * 0.3)); // 2
  });

  it('fromJSON restores loadRatio to 0', () => {
    const health = new HealthService();
    health.addHospital(0, 0, 12, 100);
    health.updateLoads([{ x: 1, y: 1, pollution: 0 }]);
    const json = health.toJSON();
    const restored = HealthService.fromJSON(json);
    expect(restored.getLoadRatio()).toBe(0);
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
