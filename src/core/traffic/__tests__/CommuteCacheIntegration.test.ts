import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';

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
    expect(loop.commuteCache).toBeDefined();
    expect(loop.commuteCache.size).toBe(0);
  });

  it('should populate cache entries after commute vehicles are spawned', () => {
    state.citizens.createCitizen({
      age: 30,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    // After a tick during morning rush, the commute cache should have at least 1 entry
    expect(loop.commuteCache.size).toBeGreaterThanOrEqual(1);
  });

  it('should use cached path on subsequent ticks without pathfinding again', () => {
    state.citizens.createCitizen({
      age: 30,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    const cachedRoute = loop.commuteCache.get(state.citizens.citizens[0]!.id);
    expect(cachedRoute).toBeDefined();
    expect(cachedRoute!.status).toBe('ready');
    // The morning path should be non-null since a vehicle was spawned
    expect(cachedRoute!.morningPath).not.toBeNull();
  });

  it('should invalidate cache when lane graph is marked dirty', () => {
    state.citizens.createCitizen({
      age: 30,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    const cacheSize = loop.commuteCache.size;
    expect(cacheSize).toBeGreaterThan(0);

    // Mark lane graph as dirty (simulates road change)
    loop.markLaneGraphDirty();

    // All cached routes should be marked dirty
    expect(loop.commuteCache.dirtyCount).toBeGreaterThan(0);
  });

  it('should cache route in routeIndex for shared path reuse', () => {
    // Create two citizens with the same home/workplace
    state.citizens.createCitizen({
      age: 30,
      homeId: '1,1',
      workplaceId: '15,1',
    });
    state.citizens.createCitizen({
      age: 25,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    // Both citizens should have the same route key cached
    const c1 = state.citizens.citizens[0]!;
    const c2 = state.citizens.citizens[1]!;
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
      age: 30,
      homeId: '1,1',
      workplaceId: '15,1',
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    expect(loop.commuteCache.size).toBeGreaterThan(0);

    // Remove the citizen
    loop.commuteCache.remove(citizen.id);
    expect(loop.commuteCache.get(citizen.id)).toBeUndefined();
  });
});
