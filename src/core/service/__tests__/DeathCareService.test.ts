import { describe, it, expect } from 'vitest';
import { DeathCareService, DEATH_CARE } from '../DeathCareService';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';

/**
 * Create a DeathCareService with a minimal grid where BFS can reach death locations.
 *
 * Layout (10×10 grid):
 *   Cemetery 2×2 at (0,0): cells (0,0) (1,0) (0,1) (1,1)
 *   Road strip at y=0: (2,0) (3,0) (4,0) (5,0) (6,0) (7,0) (8,0) (9,0)
 *   Buildings adjacent to road at y=1: (2,1) (3,1) ... (9,1)
 *
 * After recalculateCoverage, the BFS floods from cemetery footprint
 * along the road and expands to adjacent non-road cells.
 */
function createDCWithGrid(opts?: { capacity?: number }): {
  dc: DeathCareService;
  grid: Grid;
  cemId: string;
} {
  const grid = new Grid(10, 10);
  // Road strip adjacent to cemetery
  for (let x = 2; x < 10; x++) {
    grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
  }
  const dc = new DeathCareService();
  const cemId = dc.addCemetery(0, 0, opts?.capacity ?? 500);
  dc.recalculateCoverage(grid);
  return { dc, grid, cemId };
}

describe('DeathCareService', () => {
  // ── Basic facility management ──

  it('should create instance with no facilities', () => {
    const dc = new DeathCareService();
    expect(dc.getCemeteries()).toHaveLength(0);
    expect(dc.getUnprocessed()).toBe(0);
  });

  it('should add a cemetery with default capacity', () => {
    const dc = new DeathCareService();
    const id = dc.addCemetery(5, 10);
    expect(id).toBeTruthy();
    const cemeteries = dc.getCemeteries();
    expect(cemeteries).toHaveLength(1);
    expect(cemeteries[0]!.x).toBe(5);
    expect(cemeteries[0]!.y).toBe(10);
    expect(cemeteries[0]!.capacity).toBe(50);
    expect(cemeteries[0]!.currentLoad).toBe(0);
  });

  it('should add a cemetery with custom capacity', () => {
    const dc = new DeathCareService();
    dc.addCemetery(3, 7, 200);
    const cem = dc.getCemeteries()[0]!;
    expect(cem.capacity).toBe(200);
  });

  it('should remove a cemetery by id', () => {
    const dc = new DeathCareService();
    const id = dc.addCemetery(5, 5);
    expect(dc.getCemeteries()).toHaveLength(1);
    const removed = dc.removeCemetery(id);
    expect(removed).toBe(true);
    expect(dc.getCemeteries()).toHaveLength(0);
  });

  it('should return false when removing non-existent cemetery', () => {
    const dc = new DeathCareService();
    expect(dc.removeCemetery('nonexistent')).toBe(false);
  });

  // ── Pending death queue ──

  it('should add deaths to pending queue via reportDeath()', () => {
    const dc = new DeathCareService();
    dc.reportDeath(5, 5);
    dc.reportDeath(3, 3);
    dc.reportDeath(7, 7);
    expect(dc.getPendingDeathQueue()).toHaveLength(3);
    expect(dc.getUnprocessed()).toBe(3);
  });

  it('should collect deaths at reachable locations on tick', () => {
    const { dc } = createDCWithGrid();
    expect(dc.getCoverage(3, 1)).toBe(true);

    dc.reportDeath(3, 1);
    dc.tick();
    // Body should be collected instantly (budget-based, same tick)
    expect(dc.getPendingDeathQueue()).toHaveLength(0);
    // Body is now at cemetery (currentLoad or already cremated)
    const cem = dc.getCemeteries()[0]!;
    expect(cem.todayReceived).toBe(1);
  });

  it('should not collect deaths at unreachable locations', () => {
    const { dc } = createDCWithGrid();
    // Death at (0,9) — no road connection
    dc.reportDeath(0, 9);
    dc.tick();
    const queue = dc.getPendingDeathQueue();
    expect(queue).toHaveLength(1);
  });

  // ── Collection rate budget ──

  it('should collect up to COLLECTION_RATE bodies per cemetery per tick', () => {
    const { dc } = createDCWithGrid();
    // Report more deaths than COLLECTION_RATE
    for (let i = 0; i < DEATH_CARE.COLLECTION_RATE + 5; i++) {
      dc.reportDeath(3, 1);
    }

    dc.tick();
    const cem = dc.getCemeteries()[0]!;
    // CREMATION_RATE=1 so 1 cremated from collected
    expect(cem.todayReceived).toBe(DEATH_CARE.COLLECTION_RATE);
    expect(dc.getPendingDeathQueue()).toHaveLength(5);
  });

  it('should not collect when cemetery is at capacity', () => {
    const { dc } = createDCWithGrid({ capacity: 2 });
    for (let i = 0; i < 5; i++) dc.reportDeath(3, 1);

    dc.tick();
    const cem = dc.getCemeteries()[0]!;
    // capacity=2, CREMATION_RATE=1: collect 2, cremate 1 → currentLoad=1
    expect(cem.todayReceived).toBe(2);
    // Remaining 3 still in queue
    expect(dc.getPendingDeathQueue()).toHaveLength(3);
  });

  // ── Cemetery processing ──

  it('should cremate up to CREMATION_RATE per tick', () => {
    const { dc } = createDCWithGrid();
    for (let i = 0; i < 3; i++) dc.reportDeath(3, 1);

    dc.tick(); // collect 3 (COLLECTION_RATE=3), cremate 1
    const cem = dc.getCemeteries()[0]!;
    expect(cem.todayCremated).toBe(DEATH_CARE.CREMATION_RATE);
    expect(cem.currentLoad).toBe(2); // 3 collected - 1 cremated
  });

  it('should cremate stored bodies over time (currentLoad decreases)', () => {
    const { dc } = createDCWithGrid();
    for (let i = 0; i < 3; i++) dc.reportDeath(3, 1);

    dc.tick(); // collect 3, cremate 1 → currentLoad=2
    dc.tick(); // cremate 1 → currentLoad=1
    dc.tick(); // cremate 1 → currentLoad=0

    const cem = dc.getCemeteries()[0]!;
    expect(cem.currentLoad).toBe(0);
    expect(cem.todayCremated).toBe(3);
  });

  // ── Multiple cemeteries ──

  it('should assign deaths to nearest cemetery', () => {
    const grid = new Grid(20, 5);
    for (let x = 2; x < 16; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    }

    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500);
    dc.addCemetery(16, 0, 500);
    dc.recalculateCoverage(grid);

    dc.reportDeath(3, 1);  // closer to cem-1
    dc.reportDeath(14, 1); // closer to cem-2

    dc.tick();

    const cems = dc.getCemeteries();
    expect(cems[0]!.todayReceived).toBeGreaterThanOrEqual(1);
    expect(cems[1]!.todayReceived).toBeGreaterThanOrEqual(1);
  });

  it('should fall back to farther cemetery when nearest is full', () => {
    const grid = new Grid(20, 5);
    for (let x = 2; x < 16; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    }

    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 1);     // cem-1: capacity 1
    dc.addCemetery(16, 0, 500);  // cem-2: large capacity
    dc.recalculateCoverage(grid);

    dc.reportDeath(4, 1);
    dc.reportDeath(4, 1);

    // Multiple ticks to allow collection + fallback
    for (let i = 0; i < 5; i++) dc.tick();

    const cems = dc.getCemeteries();
    // cem-2 should have received at least 1 (fallback from full cem-1)
    expect(cems[1]!.todayReceived).toBeGreaterThanOrEqual(1);
  });

  // ── Happiness penalty ──

  it('should return 0 penalty when no pending deaths', () => {
    const dc = new DeathCareService();
    expect(dc.getHappinessPenalty()).toBe(0);
  });

  it('should return per-body penalty for waiting deaths', () => {
    const dc = new DeathCareService();
    dc.reportDeath(5, 5);
    dc.reportDeath(5, 5);
    // Need at least one tick to increment waitTicks
    dc.tick();
    expect(dc.getHappinessPenalty()).toBe(2 * DEATH_CARE.HAPPINESS_PER_BODY);
  });

  it('should increase penalty after heavy threshold', () => {
    const dc = new DeathCareService();
    dc.reportDeath(5, 5); // no cemetery → stays uncollected
    // Tick past heavy threshold
    for (let i = 0; i < DEATH_CARE.HEAVY_THRESHOLD + 1; i++) dc.tick();
    expect(dc.getHappinessPenalty()).toBe(DEATH_CARE.HEAVY_HAPPINESS_PER_BODY);
  });

  it('should return 0 penalty when all deaths are processed', () => {
    const { dc } = createDCWithGrid();
    dc.reportDeath(3, 1);
    for (let i = 0; i < 5; i++) dc.tick();
    expect(dc.getHappinessPenalty()).toBe(0);
  });

  // ── Coverage (global, road-based) ──

  it('should cover road-connected cells globally', () => {
    const { dc } = createDCWithGrid();
    expect(dc.getCoverage(3, 1)).toBe(true);
    expect(dc.getCoverage(9, 1)).toBe(true);
  });

  it('should not cover cells without road connection', () => {
    const { dc } = createDCWithGrid();
    expect(dc.getCoverage(0, 9)).toBe(false);
  });

  it('should return cost ratio based on road distance', () => {
    const { dc } = createDCWithGrid();
    const nearRatio = dc.getCostRatio(3, 1);
    const farRatio = dc.getCostRatio(9, 1);
    expect(nearRatio).toBeGreaterThanOrEqual(0);
    expect(farRatio).toBeGreaterThanOrEqual(0);
    expect(farRatio).toBeGreaterThan(nearRatio);
  });

  it('should return -1 cost ratio for uncovered cells', () => {
    const { dc } = createDCWithGrid();
    expect(dc.getCostRatio(0, 9)).toBe(-1);
  });

  // ── Ring buffer / advanceDay ──

  it('should track todayCremated during tick', () => {
    const { dc } = createDCWithGrid();
    for (let i = 0; i < 5; i++) dc.reportDeath(3, 1);
    for (let i = 0; i < 10; i++) dc.tick();

    const cem = dc.getCemeteries()[0]!;
    expect(cem.todayCremated).toBeGreaterThan(0);
  });

  it('advanceDay should rotate ring buffer and reset todayCremated', () => {
    const { dc } = createDCWithGrid();
    for (let i = 0; i < 3; i++) dc.reportDeath(3, 1);
    for (let i = 0; i < 10; i++) dc.tick();

    dc.advanceDay();
    const cem = dc.getCemeteries()[0]!;
    expect(cem.todayCremated).toBe(0);
    expect(cem.recentDaily.some(v => v > 0)).toBe(true);
  });

  it('getRecentWeekly should sum last 7 days of cremations', () => {
    const { dc } = createDCWithGrid();

    for (let day = 0; day < 5; day++) {
      dc.reportDeath(3, 1);
      dc.reportDeath(3, 1);
      for (let i = 0; i < 10; i++) dc.tick();
      dc.advanceDay();
    }

    const cem = dc.getCemeteries()[0]!;
    const recent = cem.recentDaily.reduce((a, b) => a + b, 0);
    expect(recent).toBe(10); // 5 days × 2
  });

  it('ring buffer should roll over after 7 days', () => {
    const { dc } = createDCWithGrid();

    for (let day = 0; day < 7; day++) {
      dc.reportDeath(3, 1);
      for (let i = 0; i < 10; i++) dc.tick();
      dc.advanceDay();
    }
    const cem = dc.getCemeteries()[0]!;
    expect(cem.recentDaily.reduce((a, b) => a + b, 0)).toBe(7);

    // Day 8: oldest overwritten
    dc.reportDeath(3, 1);
    for (let i = 0; i < 10; i++) dc.tick();
    dc.advanceDay();
    expect(cem.recentDaily.reduce((a, b) => a + b, 0)).toBe(7);
  });

  // ── No-op tick ──

  it('should not throw when tick with no deaths and no stored bodies', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500);
    dc.tick();
    expect(dc.getUnprocessed()).toBe(0);
    expect(dc.getCemeteries()[0]!.currentLoad).toBe(0);
  });

  // ── Maintenance ──

  it('should calculate maintenance cost per cemetery', () => {
    const dc = new DeathCareService();
    expect(dc.getMaintenanceCost()).toBe(0);
    dc.addCemetery(5, 5);
    expect(dc.getMaintenanceCost()).toBe(2);
    dc.addCemetery(10, 10);
    expect(dc.getMaintenanceCost()).toBe(4);
  });

  // ── Serialization ──

  it('should serialize to JSON and deserialize back', () => {
    const { dc } = createDCWithGrid({ capacity: 300 });
    dc.reportDeath(3, 1);
    dc.reportDeath(3, 1);
    dc.reportDeath(3, 1);
    for (let i = 0; i < 10; i++) dc.tick();
    dc.advanceDay();

    const json = dc.toJSON();
    const restored = DeathCareService.fromJSON(json);

    const cem = restored.getCemeteries()[0]!;
    expect(cem.capacity).toBe(300);
    expect(cem.x).toBe(0);
    expect(cem.y).toBe(0);
    expect(cem.recentDaily).toHaveLength(7);
  });

  it('fromJSON should handle legacy saves with pendingDeaths number', () => {
    const legacyJSON = {
      cemeteries: [{ id: 'cem-1', x: 5, y: 5, capacity: 500, used: 3 }],
      pendingDeaths: 2,
    };
    const restored = DeathCareService.fromJSON(legacyJSON as any);
    expect(restored.getPendingDeathQueue()).toHaveLength(2);
    expect(restored.getCemeteries()[0]!.currentLoad).toBe(3);
    restored.advanceDay();
  });

  it('fromJSON should handle legacy saves with used+pending → currentLoad', () => {
    const legacyJSON = {
      cemeteries: [{ id: 'cem-1', x: 5, y: 5, capacity: 500, used: 10, pending: 5 }],
      pendingDeathQueue: [],
    };
    const restored = DeathCareService.fromJSON(legacyJSON as any);
    expect(restored.getCemeteries()[0]!.currentLoad).toBe(15);
  });

  it('fromJSON should handle legacy saves missing ring buffer fields', () => {
    const legacyJSON = {
      cemeteries: [{ id: 'cem-1', x: 5, y: 5, capacity: 500, used: 3 }],
      pendingDeaths: 1,
    };
    const restored = DeathCareService.fromJSON(legacyJSON as any);
    const cem = restored.getCemeteries()[0]!;
    expect(cem.recentDaily).toHaveLength(7);
    expect(cem.recentDaily.every(v => v === 0)).toBe(true);
  });

  it('should recover nextId correctly after deserialization', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0);
    dc.addCemetery(1, 1);
    const json = dc.toJSON();
    const restored = DeathCareService.fromJSON(json);
    const newId = restored.addCemetery(2, 2);
    expect(newId).toBe('cem-3');
  });

  // ── Decomposition ──

  it('should decompose uncollected bodies after DECOMPOSE_TICKS', () => {
    const dc = new DeathCareService();
    dc.reportDeath(5, 5); // no cemetery → stays uncollected
    for (let i = 0; i < DEATH_CARE.DECOMPOSE_TICKS - 1; i++) dc.tick();
    expect(dc.getPendingDeathQueue()).toHaveLength(1);

    dc.tick();
    expect(dc.getPendingDeathQueue()).toHaveLength(0);
  });

  it('should decompose bodies individually based on their own waitTicks', () => {
    const dc = new DeathCareService();
    dc.reportDeath(5, 5);
    for (let i = 0; i < 100; i++) dc.tick();
    dc.reportDeath(6, 6);

    // First body decomposes at DECOMPOSE_TICKS, second remains
    for (let i = 0; i < DEATH_CARE.DECOMPOSE_TICKS - 100; i++) dc.tick();
    expect(dc.getPendingDeathQueue()).toHaveLength(1);
    expect(dc.getPendingDeathQueue()[0]!.x).toBe(6);
  });

  // ── clearPendingAt ──

  it('should clear all pending deaths at a specific position', () => {
    const dc = new DeathCareService();
    dc.reportDeath(5, 5);
    dc.reportDeath(5, 5);
    dc.reportDeath(7, 7);
    expect(dc.getPendingDeathQueue()).toHaveLength(3);

    dc.clearPendingAt(5, 5);
    expect(dc.getPendingDeathQueue()).toHaveLength(1);
    expect(dc.getPendingDeathQueue()[0]!.x).toBe(7);
  });

  it('should not affect other positions when clearing', () => {
    const { dc } = createDCWithGrid();
    dc.reportDeath(9, 1);
    dc.reportDeath(5, 1);

    dc.clearPendingAt(9, 1);
    const remaining = dc.getPendingDeathQueue();
    expect(remaining.filter(d => d.x === 9 && d.y === 1)).toHaveLength(0);
    expect(remaining.filter(d => d.x === 5 && d.y === 1)).toHaveLength(1);
  });

  // ── DEATH_CARE constants ──

  it('COLLECTION_RATE should be positive', () => {
    expect(DEATH_CARE.COLLECTION_RATE).toBeGreaterThan(0);
  });

  it('CREMATION_RATE should be positive', () => {
    expect(DEATH_CARE.CREMATION_RATE).toBeGreaterThan(0);
  });

  it('DECOMPOSE_TICKS should be positive', () => {
    expect(DEATH_CARE.DECOMPOSE_TICKS).toBeGreaterThan(0);
  });
});
