import { describe, it, expect } from 'vitest';
import { GarbageService, GARBAGE, GARBAGE_PRODUCTION } from '../GarbageService';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import type { SizedGrid } from '../../grid/GridHelpers';

function createGSWithGrid(opts?: { capacity?: number }): {
  gs: GarbageService;
  grid: Grid;
  facId: string;
} {
  const grid = new Grid(10, 10);
  for (let x = 2; x < 10; x++) {
    grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
  }
  const gs = new GarbageService();
  const facId = gs.addFacility(0, 0, opts?.capacity ?? 1000);
  gs.recalculateCoverage(grid);
  return { gs, grid, facId };
}

function makeRoadGrid(width: number, height: number, roadY?: number): SizedGrid {
  const ry = roadY ?? Math.floor(height / 2);
  return {
    width, height,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: y === ry && x >= 1 ? RoadType.TWO_LANE : RoadType.NONE };
    },
  };
}

describe('GarbageService', () => {
  // ── Basic facility management ──

  it('should create instance with no facilities', () => {
    const gs = new GarbageService();
    expect(gs.getTotalCapacity()).toBe(0);
    expect(gs.getCurrentLoad()).toBe(0);
    expect(gs.getUncollected()).toBe(0);
  });

  it('should addFacility with default capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5);
    expect(gs.getTotalCapacity()).toBe(GARBAGE.DEFAULT_CAPACITY);
  });

  it('should addFacility with custom capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(10, 10, 500);
    expect(gs.getTotalCapacity()).toBe(500);
  });

  it('should removeFacility by id', () => {
    const gs = new GarbageService();
    const id = gs.addFacility(5, 5, 1000);
    gs.removeFacility(id);
    expect(gs.getTotalCapacity()).toBe(0);
  });

  it('should support multiple facilities', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 1000);
    gs.addFacility(15, 15, 500);
    expect(gs.getTotalCapacity()).toBe(1500);
  });

  // ── Global coverage ──

  it('getCoverage returns true for reachable cells', () => {
    const { gs } = createGSWithGrid();
    expect(gs.getCoverage(3, 1)).toBe(true);
    expect(gs.getCoverage(9, 0)).toBe(true);
  });

  it('getCoverage returns false for disconnected areas', () => {
    const { gs } = createGSWithGrid();
    expect(gs.getCoverage(5, 5)).toBe(false);
  });

  it('getCoverage returns false when no roads', () => {
    const noRoadGrid: SizedGrid = {
      width: 20, height: 20,
      getCell(x, y) {
        if (x < 0 || y < 0 || x >= 20 || y >= 20) return null;
        return { roadType: RoadType.NONE };
      },
    };
    const gs = new GarbageService();
    gs.addFacility(10, 10, 1000);
    gs.recalculateCoverage(noRoadGrid);
    expect(gs.getCoverage(10, 10)).toBe(false);
  });

  it('getCostRatio returns normalized distance', () => {
    const { gs } = createGSWithGrid();
    expect(gs.getCostRatio(3, 1)).toBeGreaterThanOrEqual(0);
    expect(gs.getCostRatio(3, 1)).toBeLessThanOrEqual(1);
  });

  it('getCostRatio returns -1 for uncovered', () => {
    const { gs } = createGSWithGrid();
    expect(gs.getCostRatio(5, 5)).toBe(-1);
  });

  it('getCoveredCellsWithCost returns map', () => {
    const { gs } = createGSWithGrid();
    expect(gs.getCoveredCellsWithCost().size).toBeGreaterThan(0);
  });

  it('previewCoverage does not affect main state', () => {
    const grid = makeRoadGrid(20, 10, 5);
    const gs = new GarbageService();
    const preview = gs.previewCoverage({ x: 0, y: 5 }, grid);
    expect(preview.size).toBeGreaterThan(0);
    expect(gs.getCoverage(1, 5)).toBe(false);
  });

  it('combined coverage from multiple facilities', () => {
    const grid = new Grid(20, 10);
    for (let x = 2; x < 8; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    for (let x = 12; x < 18; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    const gs = new GarbageService();
    gs.addFacility(0, 0);
    gs.addFacility(10, 0);
    gs.recalculateCoverage(grid);
    expect(gs.getCoverage(5, 0)).toBe(true);
    expect(gs.getCoverage(15, 0)).toBe(true);
  });

  // ── reportGarbage + accumulator ──

  it('accumulates fractional amounts', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 0.3);
    expect(gs.getUncollected()).toBe(0);
    gs.reportGarbage(3, 1, 0.3);
    expect(gs.getUncollected()).toBe(0);
    gs.reportGarbage(3, 1, 0.5);
    expect(gs.getUncollected()).toBe(1);
  });

  it('emits multiple bags when amount >= 2', () => {
    const gs = new GarbageService();
    gs.reportGarbage(5, 5, 3.5);
    expect(gs.getUncollected()).toBe(3);
  });

  // ── Weighted-random collection ──

  it('tick collects bags from covered buildings', () => {
    const { gs } = createGSWithGrid();
    gs.reportGarbage(3, 1, 5);
    gs.tick();
    // Bags should be collected (removed from pending, added to facility load)
    expect(gs.getUncollected()).toBe(0);
    const fac = gs.getFacilities()[0]!;
    // Some may have been burned in same tick
    expect(fac.todayReceived).toBe(5);
  });

  it('does not collect from unreachable positions', () => {
    const noRoadGrid: SizedGrid = {
      width: 10, height: 10,
      getCell(x, y) {
        if (x < 0 || y < 0 || x >= 10 || y >= 10) return null;
        return { roadType: RoadType.NONE };
      },
    };
    const gs = new GarbageService();
    gs.addFacility(0, 0);
    gs.recalculateCoverage(noRoadGrid);
    gs.reportGarbage(5, 5, 3);
    gs.tick();
    expect(gs.getUncollected()).toBe(3); // still there
  });

  it('collection limited by COLLECTION_RATE', () => {
    const { gs } = createGSWithGrid();
    const budget = GARBAGE.COLLECTION_RATE;
    gs.reportGarbage(3, 1, budget + 20);
    gs.tick();
    // Should collect at most budget bags, rest stays
    expect(gs.getUncollected()).toBe(20);
  });

  it('collection limited by facility capacity', () => {
    const { gs } = createGSWithGrid({ capacity: 10 });
    gs.reportGarbage(3, 1, 30);
    gs.tick();
    const fac = gs.getFacilities()[0]!;
    // Collected 10 (capacity), burned some, rest stays in pending
    // todayReceived = 10 (capacity limit)
    expect(fac.todayReceived).toBe(10);
    expect(gs.getUncollected()).toBe(20);
  });

  it('closer buildings are more likely to be collected', () => {
    const grid = new Grid(30, 10);
    for (let x = 2; x < 30; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    const gs = new GarbageService();
    // Small capacity to limit budget so not everything gets collected
    gs.addFacility(0, 0, 10000);
    gs.recalculateCoverage(grid);

    let nearCollected = 0;
    let farCollected = 0;

    // Each tick: produce equal bags at near and far, then tick
    for (let t = 0; t < 200; t++) {
      gs.reportGarbage(3, 1, 50);  // near
      gs.reportGarbage(25, 1, 50); // far
      const beforeNear = gs.getPendingGarbageQueue().filter(b => b.x === 3).length;
      const beforeFar = gs.getPendingGarbageQueue().filter(b => b.x === 25).length;
      gs.tick();
      const afterNear = gs.getPendingGarbageQueue().filter(b => b.x === 3).length;
      const afterFar = gs.getPendingGarbageQueue().filter(b => b.x === 25).length;
      nearCollected += beforeNear - afterNear;
      farCollected += beforeFar - afterFar;
    }

    // Near should be collected more than far (weighted random)
    expect(nearCollected).toBeGreaterThan(farCollected);
    // But far should also get some collection (not zero)
    expect(farCollected).toBeGreaterThan(0);
  });

  it('facility burns garbage each tick', () => {
    const { gs } = createGSWithGrid();
    const fac = gs.getFacilities()[0]! as any;
    fac.currentLoad = 500;
    gs.tick();
    expect(fac.currentLoad).toBe(500 - GARBAGE.BURN_RATE);
  });

  // ── clearPendingAt ──

  it('removes pending bags at position', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 3);
    gs.clearPendingAt(3, 1);
    expect(gs.getUncollected()).toBe(0);
  });

  it('clears accumulator', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 0.5);
    gs.clearPendingAt(3, 1);
    gs.reportGarbage(3, 1, 0.4);
    expect(gs.getUncollected()).toBe(0);
  });

  // ── Decompose ──

  it('decomposes after DECOMPOSE_TICKS', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 1);
    const bags = gs.getPendingGarbageQueue() as any[];
    bags[0].waitTicks = GARBAGE.DECOMPOSE_TICKS;
    gs.tick();
    expect(gs.getUncollected()).toBe(0);
  });

  // ── Happiness penalty ──

  it('returns 0 when no pending', () => {
    const gs = new GarbageService();
    expect(gs.getHappinessPenalty()).toBe(0);
  });

  it('scales with bag count', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 3);
    expect(gs.getHappinessPenalty()).toBe(3 * GARBAGE.HAPPINESS_PER_BAG);
  });

  it('increases after HEAVY_THRESHOLD', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 1);
    (gs.getPendingGarbageQueue() as any[])[0].waitTicks = GARBAGE.HEAVY_THRESHOLD;
    expect(gs.getHappinessPenalty()).toBe(GARBAGE.HEAVY_HAPPINESS_PER_BAG);
  });

  // ── Pollution ──

  it('getPollutionPenalty 0 when none', () => {
    expect(new GarbageService().getPollutionPenalty()).toBe(0);
  });

  it('getPollutionPenalty scales', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 5);
    expect(gs.getPollutionPenalty()).toBe(5 * GARBAGE.UNCOLLECTED_POLLUTION_MULTIPLIER);
  });

  it('getPollutionPenalty capped', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 200);
    expect(gs.getPollutionPenalty()).toBe(GARBAGE.MAX_POLLUTION_PENALTY);
  });

  it('base pollution from 2x2 facility', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 1000);
    const sources = gs.getPollutionSources();
    expect(sources.length).toBe(4);
    expect(sources.every(s => s.amount === GARBAGE.BASE_POLLUTION)).toBe(true);
  });

  it('overload pollution when load > threshold', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 100);
    (gs.getFacilities()[0]! as any).currentLoad = 100;
    expect(gs.getPollutionSources().length).toBe(8);
  });

  // ── Day tracking ──

  it('advanceDay flushes stats', () => {
    const gs = new GarbageService();
    gs.addFacility(0, 0);
    gs.reportGarbage(3, 1, 5);
    gs.advanceDay();
    expect(gs.getProducedPerWeek()).toBe(5);
  });

  // ── Serialization ──

  it('toJSON/fromJSON round-trip', () => {
    const { gs } = createGSWithGrid();
    gs.reportGarbage(3, 1, 5);
    const json = gs.toJSON();
    const restored = GarbageService.fromJSON(json);
    expect(restored.getTotalCapacity()).toBe(gs.getTotalCapacity());
    expect(restored.getUncollected()).toBe(gs.getUncollected());
  });

  it('fromJSON handles legacy overflow', () => {
    const legacy = {
      facilities: [{ id: 'garbage_1', x: 0, y: 0, capacity: 1000, currentLoad: 50 }],
      overflow: 5,
    };
    const restored = GarbageService.fromJSON(legacy as any);
    expect(restored.getUncollected()).toBe(5);
  });

  it('fromJSON handles legacy truckTrips', () => {
    const legacy = {
      facilities: [{ id: 'garbage_1', x: 0, y: 0, capacity: 1000, currentLoad: 0 }],
      truckTrips: [{ facilityId: 'garbage_1', stops: [{ x: 3, y: 1, bagCount: 5 }], totalBags: 5, remainingTicks: 10 }],
    };
    const restored = GarbageService.fromJSON(legacy as any);
    expect(restored.getUncollected()).toBe(5);
  });

  it('fromJSON restores accumulators', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 0.7);
    const json = gs.toJSON();
    const restored = GarbageService.fromJSON(json);
    restored.reportGarbage(3, 1, 0.4);
    expect(restored.getUncollected()).toBe(1);
  });
});

describe('GARBAGE constants', () => {
  it('maintenance positive', () => expect(GARBAGE.MAINTENANCE_PER_FACILITY).toBeGreaterThan(0));
  it('pollution threshold 0-1', () => {
    expect(GARBAGE.POLLUTION_LOAD_THRESHOLD).toBeGreaterThan(0);
    expect(GARBAGE.POLLUTION_LOAD_THRESHOLD).toBeLessThanOrEqual(1);
  });
  it('collection rate positive', () => expect(GARBAGE.COLLECTION_RATE).toBeGreaterThan(0));
  it('burn rate positive', () => expect(GARBAGE.BURN_RATE).toBeGreaterThan(0));
  it('GARBAGE_PRODUCTION has rates', () => {
    expect(GARBAGE_PRODUCTION.RESIDENTIAL.base).toBeGreaterThan(0);
    expect(GARBAGE_PRODUCTION.COMMERCIAL.base).toBeGreaterThan(0);
    expect(GARBAGE_PRODUCTION.INDUSTRIAL.base).toBeGreaterThan(0);
    expect(GARBAGE_PRODUCTION.OFFICE.base).toBeGreaterThan(0);
  });
});
