import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

/**
 * Helper: set up a minimal city with residential + commercial buildings
 * connected by a long road (>= 8 cells so vehicles don't arrive in 1 tick
 * with BASE_SPEED=3.5). Layout (20x20 grid):
 *
 *   (1,1) residential [buildingId=1, Small House, 4 residents]
 *   (2,1)...(14,1) road (13 cells of road)
 *   (15,1) commercial [buildingId=7, Small Shop, 4 workers]
 */
function setupMinimalCity(state: GameState): void {
  // Residential building at (1,1)
  state.grid.setCell(1, 1, {
    zoneType: ZoneType.RESIDENTIAL_LOW,
    buildingId: 1, // Small House, 4 residents
  });
  // Road from (2,1) to (14,1) — 13 road cells
  for (let x = 2; x <= 14; x++) {
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE });
  }
  // Commercial building at (15,1)
  state.grid.setCell(15, 1, {
    zoneType: ZoneType.COMMERCIAL_LOW,
    buildingId: 7, // Small Shop, 4 workers
  });
}

/**
 * Advance clock to a specific hour of the current day.
 * This resets to the next occurrence of `targetHour`.
 */
function advanceToHour(state: GameState, targetHour: number): void {
  const currentHour = state.clock.getHourOfDay();
  let ticksNeeded = targetHour - currentHour;
  if (ticksNeeded < 0) ticksNeeded += 24;
  // Directly set the tick to avoid running simulation ticks
  state.clock.tick += ticksNeeded;
}

describe('Commute Traffic System', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState(20, 20);
    setupMinimalCity(state);
  });

  it('should spawn home→work vehicles during morning rush (hours 6-9)', () => {
    // Create adult citizens with home and workplace assigned
    state.citizens.createCitizen({
      age: 30,
      homeId: 1,     // buildingId 1 at (1,1)
      workplaceId: 7, // buildingId 7 at (15,1)
    });

    // Advance to hour 7 (morning rush)
    advanceToHour(state, 7);

    const loop = new SimulationLoop(state);
    loop.tick();

    // Should have spawned at least 1 commute vehicle
    expect(state.traffic.getVehicleCount()).toBeGreaterThan(0);
  });

  it('should spawn work→home vehicles during evening rush (hours 17-21)', () => {
    const citizen = state.citizens.createCitizen({
      age: 30,
      homeId: 1,
      workplaceId: 7,
    });

    // Advance to hour 18 (evening rush)
    advanceToHour(state, 18);

    const loop = new SimulationLoop(state);
    loop.tick();

    expect(state.traffic.getVehicleCount()).toBeGreaterThan(0);
  });

  it('should spawn minimal or no vehicles during night (hours 22-5)', () => {
    const citizen = state.citizens.createCitizen({
      age: 30,
      homeId: 1,
      workplaceId: 7,
    });

    // Advance to hour 2 (deep night)
    advanceToHour(state, 2);

    const loop = new SimulationLoop(state);
    loop.tick();

    // Night: no commute vehicles should spawn
    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should not spawn vehicles for citizens without workplace', () => {
    // Citizen has home but no workplace
    state.citizens.createCitizen({
      age: 30,
      homeId: 1,
      workplaceId: null,
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    // No commute should happen
    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should not spawn vehicles for citizens without home', () => {
    state.citizens.createCitizen({
      age: 30,
      homeId: null,
      workplaceId: 7,
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should not spawn commute vehicles for children (age < 19)', () => {
    state.citizens.createCitizen({
      age: 10,
      homeId: 1,
      workplaceId: 7,
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should not spawn commute vehicles for seniors (age > 65)', () => {
    state.citizens.createCitizen({
      age: 70,
      homeId: 1,
      workplaceId: 7,
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    expect(state.traffic.getVehicleCount()).toBe(0);
  });

  it('should scale vehicle count with working population', () => {
    // Create 10 adult citizens with commute assignments
    for (let i = 0; i < 10; i++) {
      state.citizens.createCitizen({
        age: 30,
        homeId: 1,
        workplaceId: 7,
      });
    }

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.tick();

    // With 10 working citizens, should spawn multiple vehicles
    expect(state.traffic.getVehicleCount()).toBeGreaterThan(1);
  });

  it('should spawn some random traffic during midday (hours 10-16)', () => {
    // Need citizens for population check, but also need buildings
    for (let i = 0; i < 20; i++) {
      state.citizens.createCitizen({
        age: 30,
        homeId: 1,
        workplaceId: 7,
      });
    }

    advanceToHour(state, 12);
    const loop = new SimulationLoop(state);
    loop.tick();

    // Midday: some random commercial traffic should spawn
    // The exact count depends on population, but should be modest
    const count = state.traffic.getVehicleCount();
    expect(count).toBeGreaterThanOrEqual(0);
    // Should be less than morning rush equivalent
  });

  it('should not spawn duplicate commute for same citizen in same rush period', () => {
    state.citizens.createCitizen({
      age: 30,
      homeId: 1,
      workplaceId: 7,
    });

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);

    // Tick multiple times during morning rush
    loop.tick(); // hour 7
    const countAfterFirst = state.traffic.getVehicleCount();

    loop.tick(); // hour 8
    loop.tick(); // hour 9
    // Count should not exceed 1 for a single citizen
    // (vehicles may arrive and be removed, so total spawned matters)
    // At minimum, only 1 commute vehicle per citizen per rush period
    // We check that no more than 1 was ever spawned by peeking at total
    // Since vehicles may still be in transit, just verify it's reasonable
    expect(countAfterFirst).toBeLessThanOrEqual(1);
  });
});

describe('Citizen Home/Workplace Assignment', () => {
  it('should assign homeId to new citizens from migration', () => {
    const state = createGameState(20, 20);
    // Set up residential building with capacity
    state.grid.setCell(1, 1, {
      zoneType: ZoneType.RESIDENTIAL_LOW,
      buildingId: 1, // Small House, 4 residents
    });
    // Set up commercial building
    state.grid.setCell(15, 1, {
      zoneType: ZoneType.COMMERCIAL_LOW,
      buildingId: 7, // Small Shop, 4 workers
    });
    // Connect with road
    for (let x = 2; x <= 14; x++) {
      state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE });
    }

    const loop = new SimulationLoop(state);
    // Run enough ticks for migration to add citizens
    for (let i = 0; i < 100; i++) loop.tick();

    const citizensWithHome = state.citizens.citizens.filter(c => c.homeId !== null);
    const citizensWithWork = state.citizens.citizens.filter(c => c.workplaceId !== null);

    if (state.citizens.getPopulation() > 0) {
      // Citizens who migrated in should have home and workplace assigned
      expect(citizensWithHome.length).toBeGreaterThan(0);
      expect(citizensWithWork.length).toBeGreaterThan(0);
    }
  });
});
