import { describe, it, expect } from 'vitest';
import { GarbageService, GARBAGE } from '../GarbageService';
import { RoadType } from '../../road/types';
import type { ReadableGrid } from '../../grid/GridHelpers';

/** Create a grid with a road running from (1,y) to (width-1,y) at row y=center. */
function makeRoadGrid(width: number, height: number, roadY?: number): ReadableGrid {
  const ry = roadY ?? Math.floor(height / 2);
  return {
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: y === ry && x >= 1 ? RoadType.TWO_LANE : RoadType.NONE };
    },
  };
}

/** Helper: add facility and recalculate coverage. */
function addAndRecalc(
  gs: GarbageService, x: number, y: number,
  grid: ReadableGrid, type: 'landfill' | 'incinerator' = 'landfill', capacity?: number,
): string {
  const id = gs.addFacility(x, y, type, capacity);
  gs.recalculateCoverage(grid);
  return id;
}

describe('GarbageService', () => {
  it('should create a GarbageService instance', () => {
    const gs = new GarbageService();
    expect(gs).toBeDefined();
    expect(gs.getTotalCapacity()).toBe(0);
    expect(gs.getCurrentLoad()).toBe(0);
    expect(gs.getOverflow()).toBe(0);
  });

  it('should addFacility with type landfill', () => {
    const gs = new GarbageService();
    const id = gs.addFacility(5, 5, 'landfill', 1000);
    expect(id).toBeTruthy();
    expect(gs.getTotalCapacity()).toBe(1000);
  });

  it('should addFacility with type incinerator', () => {
    const gs = new GarbageService();
    const id = gs.addFacility(10, 10, 'incinerator', 500);
    expect(id).toBeTruthy();
    expect(gs.getTotalCapacity()).toBe(500);
  });

  it('should use default capacity if not specified', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill');
    expect(gs.getTotalCapacity()).toBe(1000);
    const gs2 = new GarbageService();
    gs2.addFacility(5, 5, 'incinerator');
    expect(gs2.getTotalCapacity()).toBe(500);
  });

  it('should getCoverage(x, y) return true for cells adjacent to road near facility', () => {
    // Road at y=5, facility at (0,5) adjacent to road at (1,5)
    const grid = makeRoadGrid(20, 10, 5);
    const gs = new GarbageService();
    addAndRecalc(gs, 0, 5, grid);
    // Road cells near facility are covered
    expect(gs.getCoverage(1, 5)).toBe(true);
    expect(gs.getCoverage(3, 5)).toBe(true);
    // Building cell adjacent to road
    expect(gs.getCoverage(2, 4)).toBe(true);
  });

  it('should getCoverage(x, y) return false for disconnected areas', () => {
    const grid = makeRoadGrid(60, 10, 5);
    const gs = new GarbageService();
    addAndRecalc(gs, 0, 5, grid);
    // Very far on the road — beyond budget
    expect(gs.getCoverage(50, 5)).toBe(false);
  });

  it('should getCoverage return false when no roads', () => {
    const noRoadGrid: ReadableGrid = {
      getCell(x, y) {
        if (x < 0 || y < 0 || x >= 20 || y >= 20) return null;
        return { roadType: RoadType.NONE };
      },
    };
    const gs = new GarbageService();
    gs.addFacility(10, 10, 'landfill', 1000);
    gs.recalculateCoverage(noRoadGrid);
    expect(gs.getCoverage(10, 10)).toBe(false);
  });

  it('should produceGarbage based on population (1 per 100 pop)', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 1000);
    gs.tick(500);
    expect(gs.getCurrentLoad()).toBe(5);
  });

  it('should collectGarbage not exceeding capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 10);
    for (let i = 0; i < 300; i++) {
      gs.tick(1000);
    }
    expect(gs.getCurrentLoad()).toBe(10);
    expect(gs.getOverflow()).toBeGreaterThan(0);
  });

  it('should return overflow > 0 when garbage exceeds capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 5);
    gs.tick(5000);
    expect(gs.getOverflow()).toBeGreaterThan(0);
  });

  it('should return pollutionPenalty > 0 when overflow exists', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 5);
    gs.tick(5000);
    expect(gs.getPollutionPenalty()).toBeGreaterThan(0);
  });

  it('should return pollutionPenalty 0 when no overflow', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 10000);
    gs.tick(100);
    expect(gs.getPollutionPenalty()).toBe(0);
  });

  it('should removeFacility by id', () => {
    const gs = new GarbageService();
    const id = gs.addFacility(5, 5, 'landfill', 1000);
    expect(gs.getTotalCapacity()).toBe(1000);
    gs.removeFacility(id);
    expect(gs.getTotalCapacity()).toBe(0);
  });

  it('should handle tick(population) to auto-produce and collect', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 100);
    gs.tick(200);
    expect(gs.getCurrentLoad()).toBe(2);
    gs.tick(300);
    expect(gs.getCurrentLoad()).toBe(5);
  });

  it('should serialize and deserialize (toJSON / fromJSON)', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 1000);
    gs.addFacility(10, 10, 'incinerator', 500);
    gs.tick(300);

    const json = gs.toJSON();
    const restored = GarbageService.fromJSON(json);

    expect(restored.getTotalCapacity()).toBe(1500);
    expect(restored.getCurrentLoad()).toBe(gs.getCurrentLoad());
    expect(restored.getOverflow()).toBe(gs.getOverflow());
  });

  it('should support multiple facilities with combined capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'landfill', 1000);
    gs.addFacility(15, 15, 'incinerator', 500);
    expect(gs.getTotalCapacity()).toBe(1500);
  });

  it('should have combined coverage from multiple facilities', () => {
    // Two separate road segments
    const grid: ReadableGrid = {
      getCell(x, y) {
        if (x < 0 || y < 0 || x >= 50 || y >= 50) return null;
        // Road at y=5 from x=1..20, road at y=40 from x=38..48
        const isRoad = (y === 5 && x >= 1 && x <= 20) || (y === 40 && x >= 38 && x <= 48);
        return { roadType: isRoad ? RoadType.TWO_LANE : RoadType.NONE };
      },
    };
    const gs = new GarbageService();
    gs.addFacility(0, 5, 'landfill', 1000);
    gs.addFacility(37, 40, 'incinerator', 500);
    gs.recalculateCoverage(grid);
    // Each facility covers its own road segment
    expect(gs.getCoverage(5, 5)).toBe(true);
    expect(gs.getCoverage(40, 40)).toBe(true);
  });

  it('should incinerator process garbage faster (reduce load over time)', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 'incinerator', 500);
    gs.tick(1000);
    const loadAfterFirst = gs.getCurrentLoad();
    expect(loadAfterFirst).toBeLessThanOrEqual(10);
  });

  it('previewCoverage returns coverage without affecting main state', () => {
    const grid = makeRoadGrid(20, 10, 5);
    const gs = new GarbageService();
    const preview = gs.previewCoverage({ x: 0, y: 5 }, grid);
    expect(preview.size).toBeGreaterThan(0);
    // Main coverage unaffected
    expect(gs.getCoverage(1, 5)).toBe(false);
  });
});

describe('GARBAGE constants', () => {
  it('maintenance per facility should be positive', () => {
    expect(GARBAGE.MAINTENANCE_PER_FACILITY).toBeGreaterThan(0);
  });

  it('pollution load threshold should be between 0 and 1', () => {
    expect(GARBAGE.POLLUTION_LOAD_THRESHOLD).toBeGreaterThan(0);
    expect(GARBAGE.POLLUTION_LOAD_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it('overflow pollution multiplier should be positive', () => {
    expect(GARBAGE.OVERFLOW_POLLUTION_MULTIPLIER).toBeGreaterThan(0);
  });

  it('service budget should be positive', () => {
    expect(GARBAGE.SERVICE_BUDGET).toBeGreaterThan(0);
  });

  it('incinerator burn rate should be between 0 and 1', () => {
    expect(GARBAGE.INCINERATOR_BURN_RATE).toBeGreaterThan(0);
    expect(GARBAGE.INCINERATOR_BURN_RATE).toBeLessThan(1);
  });

  it('garbage per pop should be positive', () => {
    expect(GARBAGE.GARBAGE_PER_POP).toBeGreaterThan(0);
  });
});
