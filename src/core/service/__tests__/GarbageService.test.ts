import { describe, it, expect } from 'vitest';
import { GarbageService, GARBAGE, GARBAGE_PRODUCTION } from '../GarbageService';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import type { SizedGrid } from '../../grid/GridHelpers';

/**
 * Create a GarbageService with a 10×10 grid (short distances).
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
 * Create a GarbageService with a 30×10 grid (long distances — trucks stay in transit).
 * TWO_LANE cost = 2 per tile. Position (20,1) → cost ≈ 36.
 * Round-trip remainingTicks = ceil(36 * 2 * 6 / 10) = ceil(43.2) = 44 > 6.
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
    expect(fac.bagsInTransit).toBe(0);
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
    expect(gs.getCoverage(3, 1)).toBe(true);
    expect(gs.getCoverage(9, 0)).toBe(true);
    expect(gs.getCoverage(9, 1)).toBe(true);
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

  // ── reportGarbage + accumulator ──

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

  // ── TruckTrip dispatch (multi-stop collection) ──

  it('tick dispatches a truck trip collecting bags from multiple positions', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 3);
    gs.reportGarbage(15, 1, 2);
    gs.tick();

    const trips = gs.getTruckTrips();
    expect(trips).toHaveLength(1);
    expect(trips[0]!.totalBags).toBe(5);
    expect(trips[0]!.stops.length).toBe(2);
    // Bags removed from pending
    expect(gs.getUncollected()).toBe(0);
    // Facility tracks truck
    const fac = gs.getFacilities()[0]!;
    expect(fac.inTransit).toBe(1);
    expect(fac.bagsInTransit).toBe(5);
  });

  it('truck trip collects up to TRUCK_CAPACITY bags', () => {
    const { gs } = createGSWithLongGrid();
    // Report more bags than TRUCK_CAPACITY
    gs.reportGarbage(20, 1, GARBAGE.TRUCK_CAPACITY + 5);
    gs.tick();

    const trips = gs.getTruckTrips();
    // First truck takes TRUCK_CAPACITY, second truck takes the rest
    const totalCollected = trips.reduce((s, t) => s + t.totalBags, 0);
    expect(totalCollected).toBe(GARBAGE.TRUCK_CAPACITY + 5);
    expect(trips.length).toBe(2); // 2 trucks dispatched
  });

  it('truck count limits concurrent trips per facility', () => {
    const { gs } = createGSWithLongGrid();
    // Spread many bags so multiple trucks are needed
    for (let i = 0; i < GARBAGE.TRUCK_COUNT + 2; i++) {
      gs.reportGarbage(10 + i, 1, GARBAGE.TRUCK_CAPACITY);
    }
    gs.tick();

    const fac = gs.getFacilities()[0]!;
    expect(fac.inTransit).toBe(GARBAGE.TRUCK_COUNT);
    // Some bags remain uncollected
    expect(gs.getUncollected()).toBeGreaterThan(0);
  });

  it('trip arrives and delivers bags to facility', () => {
    const { gs } = createGSWithGrid(); // short distance — arrives quickly
    gs.reportGarbage(3, 1, 5);
    // Tick multiple times to ensure arrival
    for (let i = 0; i < 10; i++) gs.tick();

    expect(gs.getTruckTrips()).toHaveLength(0);
    const fac = gs.getFacilities()[0]!;
    expect(fac.inTransit).toBe(0);
    expect(fac.bagsInTransit).toBe(0);
    // Bags were received (may have been burned already)
    expect(fac.todayReceived).toBeGreaterThanOrEqual(5);
  });

  it('capacity limits bags assigned (currentLoad + bagsInTransit >= capacity)', () => {
    const { gs } = createGSWithLongGrid({ capacity: 10 });
    gs.reportGarbage(20, 1, 15);
    gs.tick();

    const fac = gs.getFacilities()[0]!;
    // Only 10 bags should be in transit (capacity limit)
    expect(fac.bagsInTransit).toBe(10);
    // 5 bags remain uncollected
    expect(gs.getUncollected()).toBe(5);
  });

  it('removing facility returns trip bags to pending', () => {
    const { gs, facId } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 3);
    gs.tick();
    expect(gs.getTruckTrips()).toHaveLength(1);
    expect(gs.getUncollected()).toBe(0);

    gs.removeFacility(facId);
    // Bags returned to pending
    expect(gs.getTruckTrips()).toHaveLength(0);
    expect(gs.getUncollected()).toBe(3);
  });

  it('no bags in queue → no dispatch', () => {
    const { gs } = createGSWithGrid();
    gs.tick();
    expect(gs.getTruckTrips()).toHaveLength(0);
  });

  it('bags at unreachable positions are not dispatched', () => {
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
    expect(gs.getTruckTrips()).toHaveLength(0);
    expect(gs.getUncollected()).toBe(1);
  });

  // ── clearPendingAt ──

  it('clearPendingAt removes pending bags at position', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 3);
    gs.clearPendingAt(3, 1);
    expect(gs.getUncollected()).toBe(0);
  });

  it('clearPendingAt clears accumulator for that position', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 0.5);
    gs.clearPendingAt(3, 1);
    gs.reportGarbage(3, 1, 0.4);
    expect(gs.getUncollected()).toBe(0);
  });

  it('clearPendingAt does not affect bags already on trucks', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 3);
    gs.tick(); // dispatch trip
    expect(gs.getTruckTrips()).toHaveLength(1);

    gs.clearPendingAt(20, 1);
    // Trip continues — bags are committed to the truck
    expect(gs.getTruckTrips()).toHaveLength(1);
    expect(gs.getTruckTrips()[0]!.totalBags).toBe(3);
  });

  // ── Decompose ──

  it('garbage decomposes after DECOMPOSE_TICKS', () => {
    const gs = new GarbageService();
    gs.reportGarbage(3, 1, 1);
    const bags = gs.getPendingGarbageQueue() as any[];
    bags[0].waitTicks = GARBAGE.DECOMPOSE_TICKS;
    gs.tick();
    expect(gs.getUncollected()).toBe(0);
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
    const bags = gs.getPendingGarbageQueue() as any[];
    bags[0].waitTicks = GARBAGE.HEAVY_THRESHOLD;
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
    expect(sources.length).toBe(8);
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

  // ── Facility burn ──

  it('facility burns garbage each tick', () => {
    const { gs } = createGSWithGrid();
    const fac = gs.getFacilities()[0]! as any;
    fac.currentLoad = 30;
    gs.tick();
    expect(fac.currentLoad).toBe(30 - GARBAGE.BURN_RATE);
  });

  // ── Serialization ──

  it('toJSON / fromJSON round-trip preserves state', () => {
    const { gs } = createGSWithLongGrid();
    gs.reportGarbage(20, 1, 5);
    gs.tick(); // dispatch trip

    const json = gs.toJSON();
    const restored = GarbageService.fromJSON(json);

    expect(restored.getTotalCapacity()).toBe(gs.getTotalCapacity());
    expect(restored.getCurrentLoad()).toBe(gs.getCurrentLoad());
    expect(restored.getUncollected()).toBe(gs.getUncollected());
    expect(restored.getTruckTrips().length).toBe(gs.getTruckTrips().length);
  });

  it('fromJSON handles legacy overflow field', () => {
    const legacy = {
      facilities: [{ id: 'garbage_1', x: 0, y: 0, capacity: 1000, currentLoad: 50 }],
      overflow: 5,
    };
    const restored = GarbageService.fromJSON(legacy as any);
    expect(restored.getUncollected()).toBe(5);
  });

  it('fromJSON handles legacy pendingGarbageQueue format', () => {
    const legacy = {
      facilities: [{ id: 'garbage_1', x: 0, y: 0, capacity: 1000, currentLoad: 0 }],
      pendingGarbageQueue: [
        { x: 3, y: 1, facilityId: null, remainingTicks: -1, waitTicks: 5 },
        { x: 5, y: 2, facilityId: 'garbage_1', remainingTicks: 10, waitTicks: 3 },
      ],
    };
    const restored = GarbageService.fromJSON(legacy as any);
    // Both entries become pendingBags (trips are not preserved from legacy)
    expect(restored.getUncollected()).toBe(2);
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

  it('truck capacity should be positive', () => {
    expect(GARBAGE.TRUCK_CAPACITY).toBeGreaterThan(0);
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
