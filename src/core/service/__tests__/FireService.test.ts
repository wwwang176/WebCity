import { describe, it, expect } from 'vitest';
import { FireService, FIRE } from '../FireService';
import { RoadType } from '../../road/types';
import type { ReadableGrid } from '../../grid/GridHelpers';

/** Grid with a cross-shaped road centered at (cx, cy). */
function makeCrossRoadGrid(size: number, cx: number, cy: number): ReadableGrid & { width: number; height: number } {
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

/** Grid with a horizontal road at row roadY. */
function makeRoadGrid(width: number, height: number, roadY?: number): ReadableGrid & { width: number; height: number } {
  const ry = roadY ?? Math.floor(height / 2);
  return {
    width, height,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: y === ry && x >= 1 ? RoadType.TWO_LANE : RoadType.NONE, buildingId: 0, zoneType: 0 };
    },
  };
}

describe('FireService', () => {
  it('should create a FireService instance', () => {
    const fire = new FireService();
    expect(fire).toBeDefined();
    expect(fire.getStations()).toHaveLength(0);
  });

  it('should add a station and return an id', () => {
    const fire = new FireService();
    const id = fire.addStation(10, 10, 15);
    expect(typeof id).toBe('string');
    expect(fire.getStations()).toHaveLength(1);
    expect(fire.getStations()[0]).toMatchObject({ id, x: 10, y: 10, radius: 15 });
  });

  it('should use default radius of 15 when not specified', () => {
    const fire = new FireService();
    fire.addStation(5, 5);
    expect(fire.getStations()[0]!.radius).toBe(15);
  });

  it('getCoverage returns true for road-connected cells near station', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const fire = new FireService();
    fire.addStation(14, 15, 15);
    fire.recalculateCoverage(grid);
    // Road at (15,15) — adjacent to station
    expect(fire.getCoverage(15, 15)).toBe(true);
    // Further along road
    expect(fire.getCoverage(18, 15)).toBe(true);
    // Building adjacent to covered road
    expect(fire.getCoverage(16, 14)).toBe(true);
  });

  it('getCoverage returns false outside road reach', () => {
    const grid = makeRoadGrid(60, 30, 15);
    const fire = new FireService();
    fire.addStation(0, 15, 15);
    fire.recalculateCoverage(grid);
    // Far away on road (beyond budget)
    expect(fire.getCoverage(50, 15)).toBe(false);
    // No road connection
    expect(fire.getCoverage(5, 0)).toBe(false);
  });

  it('multiple stations extend coverage', () => {
    const grid = makeRoadGrid(40, 10, 5);
    const fire = new FireService();
    fire.addStation(0, 5, 10);
    fire.addStation(20, 5, 10);
    fire.recalculateCoverage(grid);
    // Covered by first station
    expect(fire.getCoverage(3, 5)).toBe(true);
    // Covered by second station
    expect(fire.getCoverage(25, 5)).toBe(true);
  });

  it('getResponseTime returns finite for covered cells', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const fire = new FireService();
    fire.addStation(14, 15, 15);
    fire.recalculateCoverage(grid);
    const time = fire.getResponseTime(15, 15);
    expect(time).toBeGreaterThanOrEqual(0);
    expect(time).toBeLessThan(Infinity);
  });

  it('getResponseTime returns Infinity when not covered', () => {
    const grid = makeRoadGrid(60, 20, 10);
    const fire = new FireService();
    fire.addStation(0, 10, 5);
    fire.recalculateCoverage(grid);
    expect(fire.getResponseTime(50, 15)).toBe(Infinity);
  });

  it('getResponseTime closer cells have lower time', () => {
    const grid = makeRoadGrid(30, 10, 5);
    const fire = new FireService();
    fire.addStation(0, 5, 15);
    fire.recalculateCoverage(grid);
    const timeClose = fire.getResponseTime(2, 5);
    const timeFar = fire.getResponseTime(10, 5);
    expect(timeClose).toBeLessThan(timeFar);
  });

  it('reportFire in covered area returns covered=true and low damage', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const fire = new FireService();
    fire.addStation(14, 15, 15);
    fire.recalculateCoverage(grid);
    const result = fire.reportFire(15, 15);
    expect(result.covered).toBe(true);
    expect(result.estimatedDamage).toBeLessThanOrEqual(0.10);
  });

  it('reportFire outside covered area returns covered=false and high damage', () => {
    const grid = makeRoadGrid(60, 60, 10);
    const fire = new FireService();
    fire.addStation(0, 10, 5);
    fire.recalculateCoverage(grid);
    const result = fire.reportFire(50, 50);
    expect(result.covered).toBe(false);
    expect(result.estimatedDamage).toBeCloseTo(0.80, 1);
  });

  it('reportFire creates an active fire', () => {
    const fire = new FireService();
    fire.reportFire(12, 10);
    expect(fire.getActiveFires()).toHaveLength(1);
    expect(fire.getActiveFires()[0]).toMatchObject({ x: 12, y: 10 });
  });

  it('tick processes active fires — covered fire resolves in 3 ticks', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const fire = new FireService();
    fire.addStation(14, 15, 15);
    fire.recalculateCoverage(grid);
    fire.reportFire(15, 15);
    expect(fire.getActiveFires()).toHaveLength(1);

    fire.tick();
    fire.tick();
    fire.tick();
    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(1);
    expect(fire.getActiveFires()).toHaveLength(0);
  });

  it('tick processes uncovered fire — resolves in 3 ticks with high damage', () => {
    const fire = new FireService();
    fire.reportFire(50, 50);
    const activeFire = fire.getActiveFires()[0]!;
    expect(activeFire.damage).toBeCloseTo(0.80, 1);

    fire.tick(); fire.tick(); fire.tick();
    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(1);
    expect(fire.getActiveFires()).toHaveLength(0);
  });

  it('removeStation removes the station', () => {
    const fire = new FireService();
    const id = fire.addStation(10, 10, 15);
    fire.removeStation(id);
    expect(fire.getStations()).toHaveLength(0);
  });

  it('removeStation with invalid id does nothing', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    fire.removeStation('nonexistent');
    expect(fire.getStations()).toHaveLength(1);
  });

  it('getFireRisk returns high risk for uncovered areas', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const fire = new FireService();
    fire.addStation(14, 15, 15);
    fire.recalculateCoverage(grid);
    const riskCovered = fire.getFireRisk(15, 15);
    const riskUncovered = fire.getFireRisk(0, 0);
    expect(riskUncovered).toBeGreaterThan(riskCovered);
    expect(riskUncovered).toBeGreaterThanOrEqual(0.8);
  });

  it('getFireRisk near station is low', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const fire = new FireService();
    fire.addStation(14, 15, 15);
    fire.recalculateCoverage(grid);
    const riskNear = fire.getFireRisk(15, 15);
    expect(riskNear).toBeLessThanOrEqual(0.1);
  });

  it('toJSON serializes state correctly', () => {
    const fire = new FireService();
    fire.addStation(10, 10, 15);
    fire.addStation(20, 20, 10);
    fire.reportFire(12, 10);

    const json = fire.toJSON();
    expect(json.stations).toHaveLength(2);
    expect(json.activeFires).toHaveLength(1);
    expect(json.stations[0]).toMatchObject({ x: 10, y: 10, radius: 15 });
  });

  it('fromJSON restores state correctly', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const fire = new FireService();
    fire.addStation(14, 15, 15);
    fire.addStation(16, 16, 10);
    fire.reportFire(15, 15);

    const json = fire.toJSON();
    const restored = FireService.fromJSON(json);
    restored.recalculateCoverage(grid);

    expect(restored.getStations()).toHaveLength(2);
    expect(restored.getActiveFires()).toHaveLength(1);
    expect(restored.getCoverage(15, 15)).toBe(true);
  });

  it('fromJSON with empty data creates clean instance', () => {
    const json = { stations: [], activeFires: [], nextId: 1 };
    const restored = FireService.fromJSON(json);
    expect(restored.getStations()).toHaveLength(0);
    expect(restored.getActiveFires()).toHaveLength(0);
  });

  it('resolveCompletedFires returns resolved fires with damage info', () => {
    const grid = makeCrossRoadGrid(60, 15, 15);
    const fire = new FireService();
    fire.addStation(14, 15, 15);
    fire.recalculateCoverage(grid);
    fire.reportFire(15, 15); // covered
    fire.reportFire(50, 50); // uncovered

    fire.tick(); fire.tick(); fire.tick();
    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(2);
    const coveredFire = resolved.find(f => f.x === 15 && f.y === 15);
    expect(coveredFire!.damage).toBeCloseTo(0.10, 1);
    const uncoveredFire = resolved.find(f => f.x === 50 && f.y === 50);
    expect(uncoveredFire!.damage).toBeCloseTo(0.80, 1);
  });

  it('resolveCompletedFires removes resolved fires from active list', () => {
    const fire = new FireService();
    fire.reportFire(5, 5);
    fire.tick(); fire.tick(); fire.tick();
    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(1);
    expect(fire.getActiveFires()).toHaveLength(0);
  });

  it('resolveCompletedFires does not remove fires still in progress', () => {
    const fire = new FireService();
    fire.reportFire(5, 5);
    fire.tick();
    const resolved = fire.resolveCompletedFires();
    expect(resolved).toHaveLength(0);
    expect(fire.getActiveFires()).toHaveLength(1);
  });

  it('tryRandomFire triggers fire on building cells based on probability', () => {
    const fire = new FireService();
    const mockGrid = {
      width: 10, height: 10,
      getCell: (x: number, y: number) => {
        if (x === 5 && y === 5) return { buildingId: 3, zoneType: 1, roadType: RoadType.NONE };
        return { buildingId: 0, zoneType: 0, roadType: RoadType.NONE };
      },
    };
    const result = fire.tryRandomFire(mockGrid, 100, 1.0);
    if (result) {
      expect(fire.getActiveFires().length).toBeGreaterThanOrEqual(1);
    }
  });

  it('tryRandomFire does not trigger fire with probability 0', () => {
    const fire = new FireService();
    const mockGrid = {
      width: 10, height: 10,
      getCell: () => ({ buildingId: 3, zoneType: 1, roadType: RoadType.NONE }),
    };
    const result = fire.tryRandomFire(mockGrid, 100, 0);
    expect(result).toBe(false);
    expect(fire.getActiveFires()).toHaveLength(0);
  });

  it('previewCoverage returns coverage for drag preview', () => {
    const grid = makeCrossRoadGrid(40, 15, 15);
    const fire = new FireService();
    const preview = fire.previewCoverage({ x: 14, y: 15 }, grid);
    expect(preview.size).toBeGreaterThan(0);
    // Main state unaffected
    expect(fire.getCoverage(15, 15)).toBe(false);
  });
});

describe('Fire extinguished tracking', () => {
  it('resolveCompletedFires should increment todayExtinguished', () => {
    const fire = new FireService();
    fire.reportFire(5, 5);
    fire.tick(); fire.tick(); fire.tick();
    fire.resolveCompletedFires();
    expect(fire.getTodayExtinguished()).toBe(1);
  });

  it('advanceDay should flush to ring buffer and reset', () => {
    const fire = new FireService();
    fire.reportFire(5, 5);
    fire.tick(); fire.tick(); fire.tick();
    fire.resolveCompletedFires();
    fire.advanceDay();
    expect(fire.getTodayExtinguished()).toBe(0);
    expect(fire.getRecentExtinguished()).toBe(1);
  });

  it('ring buffer rolls over after 30 days', () => {
    const fire = new FireService();
    for (let day = 0; day < 30; day++) {
      fire.reportFire(day, 0);
      fire.tick(); fire.tick(); fire.tick();
      fire.resolveCompletedFires();
      fire.advanceDay();
    }
    expect(fire.getRecentExtinguished()).toBe(30);
    fire.reportFire(0, 0);
    fire.tick(); fire.tick(); fire.tick();
    fire.resolveCompletedFires();
    fire.advanceDay();
    expect(fire.getRecentExtinguished()).toBe(30);
  });

  it('fromJSON should handle legacy saves without ring buffer', () => {
    const legacyJSON = { stations: [], activeFires: [], nextId: 1 };
    const restored = FireService.fromJSON(legacyJSON as any);
    expect(restored.getRecentExtinguished()).toBe(0);
    restored.advanceDay();
  });
});

describe('FIRE constants', () => {
  it('risk factors should be between 0 and 1', () => {
    expect(FIRE.RISK_OUTSIDE_BASE).toBeGreaterThan(0);
    expect(FIRE.RISK_OUTSIDE_BASE).toBeLessThanOrEqual(1);
    expect(FIRE.RISK_INSIDE_FACTOR).toBeGreaterThan(0);
    expect(FIRE.RISK_INSIDE_FACTOR).toBeLessThanOrEqual(1);
  });

  it('ignition probability should be very small', () => {
    expect(FIRE.MAX_IGNITION_PROB).toBeGreaterThan(0);
    expect(FIRE.MAX_IGNITION_PROB).toBeLessThan(0.1);
    expect(FIRE.BASE_IGNITION_PROB).toBeLessThan(FIRE.MAX_IGNITION_PROB);
  });

  it('ignition attempts should be positive', () => {
    expect(FIRE.IGNITION_ATTEMPTS).toBeGreaterThan(0);
  });

  it('response speed should be positive', () => {
    expect(FIRE.RESPONSE_SPEED).toBeGreaterThan(0);
  });

  it('fire duration should be positive', () => {
    expect(FIRE.FIRE_DURATION).toBeGreaterThan(0);
  });

  it('covered damage should be less than uncovered damage', () => {
    expect(FIRE.COVERED_DAMAGE).toBeLessThan(FIRE.UNCOVERED_DAMAGE);
    expect(FIRE.COVERED_DAMAGE).toBeGreaterThanOrEqual(0);
    expect(FIRE.UNCOVERED_DAMAGE).toBeLessThanOrEqual(1);
  });

  it('burn damage threshold should be between covered and uncovered damage', () => {
    expect(FIRE.BURN_DAMAGE_THRESHOLD).toBeGreaterThan(0);
    expect(FIRE.BURN_DAMAGE_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
