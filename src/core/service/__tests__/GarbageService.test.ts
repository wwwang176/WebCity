import { describe, it, expect } from 'vitest';
import { GarbageService, GARBAGE, GARBAGE_PRODUCTION } from '../GarbageService';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import type { SizedGrid } from '../../grid/GridHelpers';

/**
 * Create a GarbageService with a 10×10 grid (short distances — bags may arrive same tick).
 *
 * Layout:
 *   Facility 2×2 at (0,0): cells (0,0) (1,0) (0,1) (1,1)
 *   Road strip at y=0: (2,0) (3,0) ... (9,0)
 *   Buildings adjacent to road at y=1: (2,1) (3,1) ... (9,1)
 */
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

/**
 * Create a GarbageService with a 30×10 grid (long distances — bags stay in transit).
 * TWO_LANE cost = 2 per tile. Position (20,1) → cost ≈ 36 → remainingTicks ≈ 22 > 6.
 */
function createGSWithLongGrid(opts?: { capacity?: number }): {
  gs: GarbageService;
  grid: Grid;
  facId: string;
} {
  const grid = new Grid(30, 10);
  for (let x = 2; x < 30; x++) {
    grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
  }
  const gs = new GarbageService();
  const facId = gs.addFacility(0, 0, opts?.capacity ?? 1000);
  gs.recalculateCoverage(grid);
  return { gs, grid, facId };
}

/** Create a grid with a road running from (1,y) to (width-1,y) at row y=center. */
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
    const id = gs.addFacility(5, 5);
    expect(id).toBeTruthy();
    expect(gs.getTotalCapacity()).toBe(GARBAGE.DEFAULT_CAPACITY);
    const fac = gs.getFacilities()[0]!;
    expect(fac.inTransit).toBe(0);
  });

  it('should addFacility with custom capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(10, 10, 500);
    expect(gs.getTotalCapacity()).toBe(500);
  });

  it('should removeFacility by id', () => {
    const gs = new GarbageService();
    const id = gs.addFacility(5, 5, 1000);
    expect(gs.getTotalCapacity()).toBe(1000);
    gs.removeFacility(id);
    expect(gs.getTotalCapacity()).toBe(0);
  });

  it('should support multiple facilities with combined capacity', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 1000);
    gs.addFacility(15, 15, 500);
    expect(gs.getTotalCapacity()).toBe(1500);
  });

  // ── Global coverage (Infinity BFS) ──

  it('getCoverage returns true for cells reachable via road (global)', () => {
    const { gs } = createGSWithGrid();
    expect(gs.getCoverage(3, 1)).toBe(true);   // adjacent to road
    expect(gs.getCoverage(9, 0)).toBe(true);    // far end of road
    expect(gs.getCoverage(9, 1)).toBe(true);    // adjacent to far road
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
    const ratio = gs.getCostRatio(3, 1);
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it('getCostRatio returns -1 for uncovered cells', () => {
    const { gs } = createGSWithGrid();
    expect(gs.getCostRatio(5, 5)).toBe(-1);
  });

  it('getCoveredCellsWithCost returns merged distance map', () => {
    const { gs } = createGSWithGrid();
    const cells = gs.getCoveredCellsWithCost();
    expect(cells.size).toBeGreaterThan(0);
    expect(cells.has('3,1')).toBe(true);
  });

  it('previewCoverage returns coverage without affecting main state', () => {
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

  // ── Pending garbage queue + truck dispatch ──

  it('reportGarbage accumulates fractional amounts', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 0.3);
    expect(gs.getUncollected()).toBe(0);
    gs.reportGarbage(3, 1, 0.3);
    expect(gs.getUncollected()).toBe(0);
    gs.reportGarbage(3, 1, 0.5); // total 1.1 → 1 bag + 0.1 remainder
    expect(gs.getUncollected()).toBe(1);
  });

  it('reportGarbage emits multiple bags when amount >= 2', () => {
    const gs = new GarbageService();
    gs.reportGarbage(5, 5, 3.5);
    expect(gs.getUncollected()).toBe(3);
  });

  it('tick assigns bags to nearest facility (short distance: arrives same tick)', () => {
    const { gs } = createGSWithGrid();
    gs.reportGarbage(3, 1, 1);
    expect(gs.getUncollected()).toBe(1);

    gs.tick();
    // Short distance → bag arrives same tick, queue cleared
    expect(gs.getPendingGarbageQueue()).toHaveLength(0);
    // Bag arrived and may have been burned in same tick; check todayReceived
    const fac = gs.getFacilities()[0]!;
    expect(fac.todayReceived).toBeGreaterThanOrEqual(1);
  });

  it('tick assigns bags that stay in transit over long distance', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 1);
    gs.tick();

    // Long distance → bag still in transit
    const queue = gs.getPendingGarbageQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.facilityId).not.toBeNull();
    expect(queue[0]!.remainingTicks).toBeGreaterThan(0);
  });

  it('bag arrives at facility after enough ticks (long distance)', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 1);
    gs.tick(); // assign + start countdown

    const remaining = gs.getPendingGarbageQueue()[0]!.remainingTicks;
    expect(remaining).toBeGreaterThan(0);

    // Tick enough times for arrival
    const maxTicks = Math.ceil(remaining / 6) + 2;
    for (let i = 0; i < maxTicks; i++) gs.tick();

    expect(gs.getPendingGarbageQueue()).toHaveLength(0);
    // Bag arrived and may have been burned; check todayReceived
    const fac = gs.getFacilities()[0]!;
    expect(fac.todayReceived).toBeGreaterThanOrEqual(1);
  });

  it('unassigned bags stay in queue until facility available', () => {
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
    gs.reportGarbage(5, 5, 1);
    gs.tick();
    const queue = gs.getPendingGarbageQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.facilityId).toBeNull();
  });

  it('facility burns garbage each tick', () => {
    const { gs } = createGSWithGrid();
    const fac = gs.getFacilities()[0]! as any;
    fac.currentLoad = 10;
    gs.tick();
    expect(fac.currentLoad).toBe(10 - GARBAGE.BURN_RATE);
  });

  it('truck count limits concurrent pickups per facility', () => {
    const { gs } = createGSWithLongGrid();
    for (let i = 0; i < GARBAGE.TRUCK_COUNT + 3; i++) {
      gs.reportGarbage(20, 1, 1);
    }
    gs.tick();
    const fac = gs.getFacilities()[0]!;
    expect(fac.inTransit).toBe(GARBAGE.TRUCK_COUNT);
    const unassigned = gs.getPendingGarbageQueue().filter(b => b.facilityId === null);
    expect(unassigned.length).toBe(3);
  });

  it('capacity limits assignment (load + inTransit >= capacity)', () => {
    const { gs } = createGSWithLongGrid({ capacity: 3 });
    for (let i = 0; i < 5; i++) {
      gs.reportGarbage(20, 1, 1);
    }
    gs.tick();
    const fac = gs.getFacilities()[0]!;
    expect(fac.inTransit).toBe(3);
  });

  it('removing facility returns in-transit bags to unassigned', () => {
    const { gs, facId } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 1);
    gs.tick();
    expect(gs.getPendingGarbageQueue()[0]!.facilityId).toBe(facId);

    gs.removeFacility(facId);
    const queue = gs.getPendingGarbageQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.facilityId).toBeNull();
    expect(queue[0]!.remainingTicks).toBe(-1);
  });

  // ── clearPendingAt ──

  it('clearPendingAt removes all pending bags at position', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 3);
    gs.tick();
    gs.clearPendingAt(20, 1);
    expect(gs.getPendingGarbageQueue().filter(b => b.x === 20 && b.y === 1)).toHaveLength(0);
  });

  it('clearPendingAt clears accumulator for that position', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 0.5);
    gs.clearPendingAt(3, 1);
    gs.reportGarbage(3, 1, 0.4);
    expect(gs.getUncollected()).toBe(0);
  });

  it('clearPendingAt decrements inTransit for assigned bags', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 2);
    gs.tick();
    const fac = gs.getFacilities()[0]!;
    expect(fac.inTransit).toBeGreaterThan(0);

    gs.clearPendingAt(20, 1);
    expect(fac.inTransit).toBe(0);
  });

  // ── Decompose ──

  it('garbage decomposes after DECOMPOSE_TICKS', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 1);
    gs.tick(); // assign
    // Fast-forward waitTicks
    const queue = gs.getPendingGarbageQueue() as any[];
    queue[0].waitTicks = GARBAGE.DECOMPOSE_TICKS;
    gs.tick();
    expect(gs.getPendingGarbageQueue()).toHaveLength(0);
  });

  it('decomposed bag decrements inTransit', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 1);
    gs.tick(); // assign
    const fac = gs.getFacilities()[0]!;
    expect(fac.inTransit).toBe(1);

    const queue = gs.getPendingGarbageQueue() as any[];
    queue[0].waitTicks = GARBAGE.DECOMPOSE_TICKS;
    gs.tick();
    expect(fac.inTransit).toBe(0);
  });

  // ── Happiness penalty ──

  it('getHappinessPenalty returns 0 when no pending garbage', () => {
    const gs = new GarbageService();
    expect(gs.getHappinessPenalty()).toBe(0);
  });

  it('getHappinessPenalty scales with bag count', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 3);
    expect(gs.getHappinessPenalty()).toBe(3 * GARBAGE.HAPPINESS_PER_BAG);
  });

  it('getHappinessPenalty increases after HEAVY_THRESHOLD', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 1);
    const queue = gs.getPendingGarbageQueue() as any[];
    queue[0].waitTicks = GARBAGE.HEAVY_THRESHOLD;
    expect(gs.getHappinessPenalty()).toBe(GARBAGE.HEAVY_HAPPINESS_PER_BAG);
  });

  // ── Pollution ──

  it('getPollutionPenalty returns 0 when no uncollected garbage', () => {
    const gs = new GarbageService();
    expect(gs.getPollutionPenalty()).toBe(0);
  });

  it('getPollutionPenalty scales with uncollected count', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 5);
    expect(gs.getPollutionPenalty()).toBe(5 * GARBAGE.UNCOLLECTED_POLLUTION_MULTIPLIER);
  });

  it('getPollutionPenalty capped at MAX_POLLUTION_PENALTY', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 200);
    expect(gs.getPollutionPenalty()).toBe(GARBAGE.MAX_POLLUTION_PENALTY);
  });

  it('should emit base pollution from all 4 cells of a 2x2 facility', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 1000);
    const sources = gs.getPollutionSources();
    expect(sources.length).toBe(4);
    const coords = sources.map(s => `${s.x},${s.y}`).sort();
    expect(coords).toEqual(['5,5', '5,6', '6,5', '6,6']);
    for (const s of sources) {
      expect(s.amount).toBe(GARBAGE.BASE_POLLUTION);
      expect(s.radius).toBe(GARBAGE.POLLUTION_RADIUS);
      expect(s.type).toBe('ground');
    }
  });

  it('should emit base + overload from all cells when load > threshold', () => {
    const gs = new GarbageService();
    gs.addFacility(5, 5, 100);
    (gs.getFacilities()[0]! as any).currentLoad = 100;
    const sources = gs.getPollutionSources();
    expect(sources.length).toBe(8); // 4 base + 4 overload
  });

  // ── Day tracking ──

  it('advanceDay flushes stats into ring buffers', () => {
    const gs = new GarbageService();
    gs.addFacility(0, 0);
    gs.reportGarbage(3, 1, 5);
    gs.advanceDay();
    expect(gs.getProducedPerWeek()).toBe(5);
    gs.advanceDay();
    expect(gs.getProducedPerWeek()).toBe(5);
  });

  // ── Serialization ──

  it('toJSON / fromJSON round-trip preserves state', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 2);
    gs.tick();

    const json = gs.toJSON();
    const restored = GarbageService.fromJSON(json);

    expect(restored.getTotalCapacity()).toBe(gs.getTotalCapacity());
    expect(restored.getCurrentLoad()).toBe(gs.getCurrentLoad());
    expect(restored.getPendingGarbageQueue().length).toBe(gs.getPendingGarbageQueue().length);
  });

  it('fromJSON handles legacy overflow field', () => {
    const legacy = {
      facilities: [{ id: 'garbage_1', x: 0, y: 0, capacity: 1000, currentLoad: 50 }],
      overflow: 5,
    };
    const restored = GarbageService.fromJSON(legacy as any);
    expect(restored.getPendingGarbageQueue()).toHaveLength(5);
    expect(restored.getPendingGarbageQueue()[0]!.facilityId).toBeNull();
  });

  it('fromJSON restores garbageAccumulators', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 0.7);
    const json = gs.toJSON();
    expect(json.garbageAccumulators!['3,1']).toBeCloseTo(0.7);

    const restored = GarbageService.fromJSON(json);
    restored.reportGarbage(3, 1, 0.4); // 0.7 + 0.4 = 1.1 → 1 bag
    expect(restored.getUncollected()).toBe(1);
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

  it('truck count should be positive', () => {
    expect(GARBAGE.TRUCK_COUNT).toBeGreaterThan(0);
  });

  it('truck speed should be positive', () => {
    expect(GARBAGE.TRUCK_SPEED).toBeGreaterThan(0);
  });

  it('service budget should be positive', () => {
    expect(GARBAGE.SERVICE_BUDGET).toBeGreaterThan(0);
  });

  it('burn rate should be positive', () => {
    expect(GARBAGE.BURN_RATE).toBeGreaterThan(0);
  });

  it('GARBAGE_PRODUCTION has per-zone rates', () => {
    expect(GARBAGE_PRODUCTION.RESIDENTIAL.base).toBeGreaterThan(0);
    expect(GARBAGE_PRODUCTION.RESIDENTIAL.perCapita).toBeGreaterThan(0);
    expect(GARBAGE_PRODUCTION.COMMERCIAL.base).toBeGreaterThan(0);
    expect(GARBAGE_PRODUCTION.INDUSTRIAL.base).toBeGreaterThan(0);
    expect(GARBAGE_PRODUCTION.OFFICE.base).toBeGreaterThan(0);
  });
});
