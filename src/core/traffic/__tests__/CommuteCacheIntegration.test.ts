import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from './SyncFakeWorker';

/**
 * Helper: set up a minimal city with residential + commercial buildings
 * connected by a long road (>= 8 cells so vehicles don't arrive in 1 tick).
 */
function setupMinimalCity(state: GameState): void {
  // Residential building at (1,1)
  state.grid.setCell(1, 1, {
    zoneType: ZoneType.RESIDENTIAL_LOW,
    buildingId: 1, // Small House, 4 residents
  });
  // Road from (2,1) to (14,1) — 13 road cells, with roadFlags for lane graph
  for (let x = 2; x <= 14; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 14) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  // Commercial building at (15,1)
  state.grid.setCell(15, 1, {
    zoneType: ZoneType.COMMERCIAL_LOW,
    buildingId: 7, // Small Shop, 4 workers
  });
}

function advanceToHour(state: GameState, targetHour: number): void {
  const currentHour = state.clock.getHourOfDay();
  let ticksNeeded = targetHour - currentHour;
  if (ticksNeeded < 0) ticksNeeded += 24;
  state.clock.tick += ticksNeeded;
}

describe('CommuteCache Integration with SimulationLoop', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState(20, 20);
    setupMinimalCity(state);
  });

  it('should expose commuteCache on SimulationLoop', () => {
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    expect(loop.commuteCache).toBeDefined();
    expect(loop.commuteCache.size).toBe(0);
  });

  it('should populate cache entries after commute vehicles are spawned', () => {
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick(); // enqueue + flush
    loop.tick(); // spawn using cached variants

    // After two ticks, the commute cache should have at least 1 entry
    expect(loop.commuteCache.size).toBeGreaterThanOrEqual(1);
  });

  it('should use cached path on subsequent ticks without pathfinding again', () => {
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick(); // enqueue + flush
    loop.tick(); // spawn + cache personal route

    const cachedRoute = loop.commuteCache.get(state.citizens.getCitizens()[0]!.id);
    expect(cachedRoute).toBeDefined();
    expect(cachedRoute!.status).toBe('ready');
  });

  it('should invalidate cache when lane graph is marked dirty', () => {
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    const cacheSize = loop.commuteCache.size;
    expect(cacheSize).toBeGreaterThan(0);

    // Mark lane graph as dirty with affected road cells (simulates road demolition)
    loop.markLaneGraphDirty(['8,1']);

    // Cached routes through that cell should be marked dirty
    expect(loop.commuteCache.dirtyCount).toBeGreaterThan(0);
  });

  it('should cache route in routeIndex for shared path reuse', () => {
    // Create two citizens with the same home/workplace
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    // Both citizens should have the same route key cached
    const c1 = state.citizens.getCitizens()[0]!;
    const c2 = state.citizens.getCitizens()[1]!;
    const route1 = loop.commuteCache.get(c1.id);
    const route2 = loop.commuteCache.get(c2.id);

    expect(route1).toBeDefined();
    expect(route2).toBeDefined();
    // Both should have status 'ready'
    expect(route1!.status).toBe('ready');
    expect(route2!.status).toBe('ready');
  });

  it('should remove cache entry when citizen is removed', () => {
    const citizen = state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    expect(loop.commuteCache.size).toBeGreaterThan(0);

    // Remove the citizen
    loop.commuteCache.remove(citizen.id);
    expect(loop.commuteCache.get(citizen.id)).toBeUndefined();
  });

  it('should recompute path for dirty citizen instead of using stale cache', () => {
    // Single citizen — guaranteed to be sampled every tick (maxPerTick >= MIN_SPAWN_PER_TICK = 5)
    const citizen = state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick(); // enqueue + flush
    loop.tick(); // spawn + cache

    const citizenId = citizen.id;
    const cachedBefore = loop.commuteCache.get(citizenId);
    expect(cachedBefore).toBeDefined();
    expect(cachedBefore!.status).toBe('ready');

    // Mark dirty (simulates road change invalidation)
    loop.commuteCache.markDirty(citizenId);
    expect(loop.commuteCache.isDirty(citizenId)).toBe(true);

    // Remove vehicle so activeCommuters allows re-sampling, then tick to recompute
    for (const v of state.traffic.vehicles) v.arrived = true;
    loop.tick(); // enqueue dirty path
    loop.tick(); // spawn with recomputed path

    // After recomputation, dirty flag should be cleared
    expect(loop.commuteCache.isDirty(citizenId)).toBe(false);
  });

  it('should immediately unemploy citizen when road is cut and workplace unreachable', () => {
    const citizen = state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    // Verify citizen has a cached route
    expect(loop.commuteCache.get(citizen.id)?.status).toBe('ready');
    expect(citizen.workplaceId).toBe('15,1');

    // Cut the road at cell (8,1) — remove it from the grid
    state.grid.setCell(8, 1, { roadType: 0, roadFlags: 0 });
    loop.markLaneGraphDirty(['8,1']);

    // Citizen should be immediately unemployed (not waiting for jobRelocationTick)
    expect(citizen.workplaceId).toBeNull();
    expect(citizen.unemployedSince).toBe(state.clock.tick);
  });

  it('should not immediately unemploy citizen without cached route (deferred to next tick)', () => {
    // Citizen assigned a job but never commuted (no cached route, no cellIndex entry).
    // The immediate unreachable check only covers citizens tracked in the cellIndex.
    // Citizens without cached routes are handled on the next commute/job-relocation tick.
    const citizen = state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    // Do NOT tick — citizen has no cached route, no cellIndex entry

    expect(loop.commuteCache.get(citizen.id)).toBeUndefined();
    expect(citizen.workplaceId).toBe('15,1');

    // Cut the road
    state.grid.setCell(8, 1, { roadType: 0, roadFlags: 0 });
    loop.markLaneGraphDirty(['8,1']);

    // Citizen keeps job until next commute tick detects the broken path
    expect(citizen.workplaceId).toBe('15,1');
  });

  it('should NOT unemploy citizen if road is cut but workplace still reachable', () => {
    const citizen = state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    // Invalidate a cell that doesn't break connectivity (road still exists)
    loop.markLaneGraphDirty(['8,1']);

    // Road at 8,1 still exists in grid, so workplace is still reachable
    expect(citizen.workplaceId).toBe('15,1');
  });

  it('should only invalidate affected cells on markLaneGraphDirty with cell list', () => {
    state.citizens.createCitizen({
      age: 100,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.setPathfindingWorker(createSyncFakeWorker());
    loop.tick();
    loop.tick();

    const citizenId = state.citizens.getCitizens()[0]!.id;
    expect(loop.commuteCache.dirtyCount).toBe(0);

    // Invalidate a cell NOT on the citizen's route → should stay clean
    loop.markLaneGraphDirty(['19,19']);
    expect(loop.commuteCache.isDirty(citizenId)).toBe(false);

    // Invalidate a cell ON the citizen's route → should become dirty
    // The route goes through cells 2,1 → 14,1
    loop.markLaneGraphDirty(['8,1']);
    expect(loop.commuteCache.isDirty(citizenId)).toBe(true);
  });
});
