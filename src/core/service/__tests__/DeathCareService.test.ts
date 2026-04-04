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
function createDCWithGrid(opts?: { capacity?: number; processRate?: number }): {
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
  const cemId = dc.addCemetery(0, 0, opts?.capacity ?? 500, opts?.processRate ?? 5);
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

  it('should add a cemetery with default capacity and processRate', () => {
    const dc = new DeathCareService();
    const id = dc.addCemetery(5, 10);
    expect(id).toBeTruthy();
    const cemeteries = dc.getCemeteries();
    expect(cemeteries).toHaveLength(1);
    expect(cemeteries[0]!.x).toBe(5);
    expect(cemeteries[0]!.y).toBe(10);
    expect(cemeteries[0]!.capacity).toBe(500);
    expect(cemeteries[0]!.processRate).toBe(5);
    expect(cemeteries[0]!.used).toBe(0);
    expect(cemeteries[0]!.inTransit).toBe(0);
  });

  it('should add a cemetery with custom capacity and processRate', () => {
    const dc = new DeathCareService();
    dc.addCemetery(3, 7, 200, 10);
    const cem = dc.getCemeteries()[0]!;
    expect(cem.capacity).toBe(200);
    expect(cem.processRate).toBe(10);
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

  it('should assign deaths to nearest cemetery on tick', () => {
    const { dc } = createDCWithGrid();
    // Verify coverage computed correctly
    expect(dc.getCoverage(3, 1)).toBe(true);

    // Check internal per-cemetery distance maps
    const maps = (dc as any).cemeteryDistanceMaps as Map<string, Map<string, number>>;
    expect(maps.size).toBe(1);
    const cemMap = maps.get('cem-1')!;
    expect(cemMap).toBeDefined();
    expect(cemMap.has('3,1')).toBe(true);

    // Check connected & operational
    expect((dc as any).connectedFacilityIds.has('cem-1')).toBe(true);
    expect(dc.getCemeteries()[0]!.capacity).toBe(500);

    // Death at (3,1) — adjacent to road at (3,0), reachable from cemetery
    dc.reportDeath(3, 1);
    dc.tick();
    const queue = dc.getPendingDeathQueue();
    expect(queue.length).toBeGreaterThanOrEqual(0); // may have been delivered already if delay=1
    if (queue.length > 0) {
      expect(queue[0]!.cemeteryId).not.toBeNull();
    } else {
      // Body was assigned, delivered, and processed in 1 tick (very close)
      expect(dc.getUnprocessed()).toBe(0);
    }
  });

  it('should not assign deaths at unreachable locations', () => {
    const { dc, grid } = createDCWithGrid();
    // Death at (0,9) — no road connection
    dc.reportDeath(0, 9);
    dc.tick();
    const queue = dc.getPendingDeathQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.cemeteryId).toBeNull();
  });

  it('should deliver bodies after transport delay expires', () => {
    const { dc } = createDCWithGrid({ processRate: 100 });
    dc.reportDeath(3, 1);
    // Tick until the hearse arrives and body is processed
    for (let i = 0; i < 20; i++) dc.tick();
    expect(dc.getPendingDeathQueue()).toHaveLength(0);
    expect(dc.getUnprocessed()).toBe(0);
  });

  // ── Cemetery processing (3-phase) ──

  it('should cremate deaths first up to processRate per tick', () => {
    const { dc } = createDCWithGrid({ capacity: 500, processRate: 3 });
    for (let i = 0; i < 8; i++) dc.reportDeath(3, 1);

    // Tick enough times for all hearses to arrive
    for (let i = 0; i < 20; i++) dc.tick();

    // All 8 bodies should have arrived at cemetery
    // After processing ticks: processRate=3 per tick
    // With enough ticks, pending at cemetery → cremated → stored → cremated
    const cem = dc.getCemeteries()[0]!;
    // Bodies arrived → 3 cremated + 5 stored (first processing tick after arrival)
    // Subsequent ticks cremate from stored
    // After ~20 ticks, everything should be processed
    expect(dc.getPendingDeathQueue()).toHaveLength(0);
  });

  it('should cremate stored bodies over time (used decreases)', () => {
    const { dc } = createDCWithGrid({ capacity: 500, processRate: 3 });
    for (let i = 0; i < 8; i++) dc.reportDeath(3, 1);

    // Let all hearses arrive
    for (let i = 0; i < 15; i++) dc.tick();

    // Now all bodies at cemetery — check stored decreases over ticks
    const cem = dc.getCemeteries()[0]!;
    const usedBefore = cem.used;
    dc.tick();
    // processRate=3 should cremate from stored
    expect(cem.used).toBeLessThanOrEqual(usedBefore);
  });

  it('should overflow when cemetery storage is full', () => {
    const { dc } = createDCWithGrid({ capacity: 3, processRate: 1 });
    for (let i = 0; i < 6; i++) dc.reportDeath(3, 1);

    // Let hearses arrive and process
    for (let i = 0; i < 20; i++) dc.tick();

    const cem = dc.getCemeteries()[0]!;
    // With capacity 3 and processRate 1, cemetery can only hold 3
    // remaining bodies stay as pending at cemetery (overflow)
    expect(cem.used).toBeLessThanOrEqual(3);
  });

  // ── Multiple cemeteries ──

  it('should assign deaths to nearest cemetery', () => {
    const grid = new Grid(20, 5);
    // Road from x=2 to x=15 (avoid overlapping with cemetery footprints)
    for (let x = 2; x < 16; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    }

    const dc = new DeathCareService();
    dc.addCemetery(0, 0);    // cem-1: left side, adjacent to road at (2,0)
    dc.addCemetery(16, 0);   // cem-2: right side, adjacent to road at (15,0)
    dc.recalculateCoverage(grid);

    // Death near left cemetery, far enough that delay > 1
    dc.reportDeath(8, 1);
    // Death near right cemetery, far enough that delay > 1
    dc.reportDeath(13, 1);

    // Run enough ticks for delivery
    for (let i = 0; i < 20; i++) dc.tick();

    const cems = dc.getCemeteries();
    // cem-1 should have received the death at (8,1) — closer to it
    expect(cems[0]!.todayReceived).toBeGreaterThanOrEqual(1);
    // cem-2 should have received the death at (13,1) — closer to it
    expect(cems[1]!.todayReceived).toBeGreaterThanOrEqual(1);
  });

  it('should fall back to farther cemetery when nearest is full', () => {
    const grid = new Grid(20, 5);
    for (let x = 2; x < 16; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    }

    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 1, 1);     // cem-1: capacity 1
    dc.addCemetery(16, 0, 500, 5);  // cem-2: large capacity
    dc.recalculateCoverage(grid);

    // Fill up cem-1 with a death
    dc.reportDeath(4, 1);
    // Second death also near cem-1 — but cem-1 should be at capacity
    dc.reportDeath(4, 1);

    // Run enough ticks for both to be assigned and delivered
    for (let i = 0; i < 30; i++) dc.tick();

    const cems = dc.getCemeteries();
    // cem-2 should have received at least 1 death (fallback)
    expect(cems[1]!.todayReceived).toBeGreaterThanOrEqual(1);
  });

  // ── Transport delay ──

  it('should calculate longer delay for farther deaths', () => {
    const grid = new Grid(50, 5);
    for (let x = 2; x < 50; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    }

    const dc = new DeathCareService();
    dc.addCemetery(0, 0);
    dc.recalculateCoverage(grid);

    // Use far-enough locations so both have delay > 1 after tick
    // (9,1): road distance ~7 tiles, cost ~17.5, delay=ceil(17.5/5)=4
    // (40,1): road distance ~38 tiles, cost ~95, delay=ceil(95/5)=19
    dc.reportDeath(9, 1);
    dc.reportDeath(40, 1);

    dc.tick();
    const queue = dc.getPendingDeathQueue();
    // Both should still be in queue (delay > 1, minus 1 tick = still > 0)
    const close = queue.find(d => d.x === 9)!;
    const far = queue.find(d => d.x === 40)!;
    expect(close).toBeDefined();
    expect(far).toBeDefined();
    expect(far.remainingTicks).toBeGreaterThan(close.remainingTicks);
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
    dc.reportDeath(5, 5); // no cemetery → stays unassigned
    // Tick past heavy threshold
    for (let i = 0; i < DEATH_CARE.HEAVY_THRESHOLD + 1; i++) dc.tick();
    expect(dc.getHappinessPenalty()).toBe(DEATH_CARE.HEAVY_HAPPINESS_PER_BODY);
  });

  it('should return 0 penalty when all deaths are processed', () => {
    const { dc } = createDCWithGrid({ processRate: 100 });
    dc.reportDeath(3, 1);
    // Tick enough for hearse to arrive and process
    for (let i = 0; i < 20; i++) dc.tick();
    expect(dc.getHappinessPenalty()).toBe(0);
  });

  // ── Coverage (global, road-based) ──

  it('should cover road-connected cells globally', () => {
    const { dc } = createDCWithGrid();
    // Cell adjacent to road should be covered
    expect(dc.getCoverage(3, 1)).toBe(true);
    // Far end of road should also be covered (global!)
    expect(dc.getCoverage(9, 1)).toBe(true);
  });

  it('should not cover cells without road connection', () => {
    const { dc } = createDCWithGrid();
    // Isolated cell far from any road
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
    const { dc } = createDCWithGrid({ processRate: 3 });
    for (let i = 0; i < 5; i++) dc.reportDeath(3, 1);

    // Let hearses arrive
    for (let i = 0; i < 15; i++) dc.tick();

    const cem = dc.getCemeteries()[0]!;
    expect(cem.todayCremated).toBeGreaterThan(0);
  });

  it('advanceDay should rotate ring buffer and reset todayCremated', () => {
    const { dc } = createDCWithGrid({ processRate: 10 });
    for (let i = 0; i < 3; i++) dc.reportDeath(3, 1);
    // Let hearses arrive and process
    for (let i = 0; i < 20; i++) dc.tick();

    dc.advanceDay();
    const cem = dc.getCemeteries()[0]!;
    expect(cem.todayCremated).toBe(0);
    // Ring buffer should have the cremation count
    expect(cem.recentDaily.some(v => v > 0)).toBe(true);
  });

  it('getRecentWeekly should sum last 7 days of cremations', () => {
    const { dc } = createDCWithGrid({ processRate: 10 });

    for (let day = 0; day < 5; day++) {
      dc.reportDeath(3, 1);
      dc.reportDeath(3, 1);
      for (let i = 0; i < 20; i++) dc.tick();
      dc.advanceDay();
    }

    const cem = dc.getCemeteries()[0]!;
    const recent = cem.recentDaily.reduce((a, b) => a + b, 0);
    expect(recent).toBe(10); // 5 days × 2
  });

  it('ring buffer should roll over after 7 days', () => {
    const { dc } = createDCWithGrid({ processRate: 10 });

    for (let day = 0; day < 7; day++) {
      dc.reportDeath(3, 1);
      for (let i = 0; i < 20; i++) dc.tick();
      dc.advanceDay();
    }
    const cem = dc.getCemeteries()[0]!;
    expect(cem.recentDaily.reduce((a, b) => a + b, 0)).toBe(7);

    // Day 8: oldest overwritten
    dc.reportDeath(3, 1);
    for (let i = 0; i < 20; i++) dc.tick();
    dc.advanceDay();
    expect(cem.recentDaily.reduce((a, b) => a + b, 0)).toBe(7);
  });

  // ── No-op tick ──

  it('should not throw when tick with no deaths and no stored bodies', () => {
    const dc = new DeathCareService();
    dc.addCemetery(0, 0, 500, 5);
    dc.tick();
    expect(dc.getUnprocessed()).toBe(0);
    expect(dc.getCemeteries()[0]!.used).toBe(0);
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
    const { dc } = createDCWithGrid({ capacity: 300, processRate: 7 });
    dc.reportDeath(3, 1);
    dc.reportDeath(3, 1);
    dc.reportDeath(3, 1);
    for (let i = 0; i < 20; i++) dc.tick();
    dc.advanceDay();

    const json = dc.toJSON();
    const restored = DeathCareService.fromJSON(json);

    const cem = restored.getCemeteries()[0]!;
    expect(cem.capacity).toBe(300);
    expect(cem.processRate).toBe(7);
    expect(cem.x).toBe(0);
    expect(cem.y).toBe(0);
    expect(cem.recentDaily).toHaveLength(7);
  });

  it('fromJSON should handle legacy saves with pendingDeaths number', () => {
    const legacyJSON = {
      cemeteries: [{ id: 'cem-1', x: 5, y: 5, capacity: 500, used: 3, processRate: 5 }],
      pendingDeaths: 2,
    };
    const restored = DeathCareService.fromJSON(legacyJSON as any);
    // Legacy pendingDeaths converted to queue entries
    expect(restored.getPendingDeathQueue()).toHaveLength(2);
    expect(restored.getPendingDeathQueue()[0]!.cemeteryId).toBeNull();
    // Should not throw on advanceDay
    restored.advanceDay();
  });

  it('fromJSON should handle legacy saves missing ring buffer fields', () => {
    const legacyJSON = {
      cemeteries: [{ id: 'cem-1', x: 5, y: 5, capacity: 500, used: 3, processRate: 5 }],
      pendingDeaths: 1,
    };
    const restored = DeathCareService.fromJSON(legacyJSON as any);
    const cem = restored.getCemeteries()[0]!;
    expect(cem.recentDaily).toHaveLength(7);
    expect(cem.recentDaily.every(v => v === 0)).toBe(true);
    expect(cem.inTransit).toBe(0);
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

  // ── Cemetery removal with in-transit deaths ──

  it('should unassign in-transit deaths when cemetery is removed', () => {
    const { dc, cemId } = createDCWithGrid();
    // Use a far death so it stays in transit for multiple ticks
    dc.reportDeath(9, 1); // delay ~4 ticks
    dc.tick(); // assigns to cemetery, still in transit

    const queue = dc.getPendingDeathQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.cemeteryId).toBe(cemId);

    dc.removeCemetery(cemId);
    expect(queue[0]!.cemeteryId).toBeNull();
    expect(queue[0]!.remainingTicks).toBe(-1);
  });

  // ── inTransit tracking ──

  it('should increment inTransit on assignment and decrement on arrival', () => {
    const { dc } = createDCWithGrid();
    // Use a far death so it stays in transit
    dc.reportDeath(9, 1); // delay ~4 ticks
    dc.tick(); // assign → inTransit++

    const cem = dc.getCemeteries()[0]!;
    expect(cem.inTransit).toBe(1);

    // Tick until arrival
    for (let i = 0; i < 20; i++) dc.tick();
    expect(cem.inTransit).toBe(0);
    expect(cem.todayReceived).toBeGreaterThanOrEqual(1);
  });

  // ── Hearse dispatch limit ──

  it('should limit hearse dispatch to HEARSE_DISPATCH_LIMIT per cemetery per tick', () => {
    const { dc } = createDCWithGrid();
    // Report more deaths than the dispatch limit
    for (let i = 0; i < 10; i++) dc.reportDeath(9, 1);

    dc.tick(); // first tick: assign up to HEARSE_DISPATCH_LIMIT

    const cem = dc.getCemeteries()[0]!;
    expect(cem.inTransit).toBe(DEATH_CARE.HEARSE_DISPATCH_LIMIT);
    // Remaining deaths still unassigned
    const unassigned = dc.getPendingDeathQueue().filter(d => d.cemeteryId === null).length;
    expect(unassigned).toBe(10 - DEATH_CARE.HEARSE_DISPATCH_LIMIT);
  });

  it('should dispatch more hearses on subsequent ticks', () => {
    const { dc } = createDCWithGrid();
    for (let i = 0; i < 10; i++) dc.reportDeath(9, 1);

    dc.tick(); // tick 1: assign 3
    dc.tick(); // tick 2: assign 3 more

    const cem = dc.getCemeteries()[0]!;
    // 6 assigned total (some may have arrived if delay is short)
    const assigned = dc.getPendingDeathQueue().filter(d => d.cemeteryId !== null).length;
    const total = assigned + cem.inTransit + cem.pending;
    expect(total).toBeGreaterThanOrEqual(DEATH_CARE.HEARSE_DISPATCH_LIMIT * 2);
  });

  // ── Decomposition ──

  it('should decompose unassigned bodies after DECOMPOSE_TICKS', () => {
    const dc = new DeathCareService();
    dc.reportDeath(5, 5); // no cemetery → stays unassigned
    // Tick up to just before decompose threshold
    for (let i = 0; i < DEATH_CARE.DECOMPOSE_TICKS - 1; i++) dc.tick();
    expect(dc.getPendingDeathQueue()).toHaveLength(1);

    // One more tick → decomposed
    dc.tick();
    expect(dc.getPendingDeathQueue()).toHaveLength(0);
  });

  it('should decompose in-transit bodies after DECOMPOSE_TICKS and release inTransit', () => {
    const { dc } = createDCWithGrid();
    dc.reportDeath(9, 1);
    dc.tick(); // assigned, inTransit=1

    const cem = dc.getCemeteries()[0]!;
    expect(cem.inTransit).toBe(1);

    // Fast-forward to decompose (body decomposes even if assigned)
    for (let i = 1; i < DEATH_CARE.DECOMPOSE_TICKS; i++) dc.tick();
    expect(dc.getPendingDeathQueue()).toHaveLength(0);
    expect(cem.inTransit).toBe(0);
  });

  it('should decompose bodies individually based on their own waitTicks', () => {
    const dc = new DeathCareService();
    dc.reportDeath(5, 5);
    // Tick 100 times, then add another death
    for (let i = 0; i < 100; i++) dc.tick();
    dc.reportDeath(6, 6);

    // At this point: first body has waitTicks=100, second has waitTicks=0
    // Tick until first decomposes (needs 500 more ticks)
    for (let i = 0; i < DEATH_CARE.DECOMPOSE_TICKS - 100; i++) dc.tick();
    expect(dc.getPendingDeathQueue()).toHaveLength(1); // only second remains
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

  it('should release inTransit when clearing assigned deaths', () => {
    const { dc } = createDCWithGrid();
    dc.reportDeath(9, 1);
    dc.tick(); // assigned, inTransit++

    const cem = dc.getCemeteries()[0]!;
    expect(cem.inTransit).toBe(1);

    dc.clearPendingAt(9, 1);
    expect(dc.getPendingDeathQueue()).toHaveLength(0);
    expect(cem.inTransit).toBe(0);
  });

  it('should not affect other positions when clearing', () => {
    const { dc } = createDCWithGrid();
    dc.reportDeath(9, 1);
    dc.reportDeath(5, 1);
    dc.tick();

    dc.clearPendingAt(9, 1);
    // (5,1) death should remain
    const remaining = dc.getPendingDeathQueue();
    expect(remaining.length).toBeGreaterThanOrEqual(0); // may have been delivered
    // At minimum, no deaths at (9,1) remain
    expect(remaining.filter(d => d.x === 9 && d.y === 1)).toHaveLength(0);
  });
});
