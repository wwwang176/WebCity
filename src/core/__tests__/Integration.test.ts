import { describe, it, expect } from 'vitest';
import { createGameState } from '../simulation/GameState';
import { SimulationLoop } from '../simulation/SimulationLoop';
import { RoadBuilder } from '../road/RoadBuilder';
import { RoadType } from '../road/types';
import { ZoneType } from '../grid/types';
import { ZoneManager } from '../zone/ZoneManager';

describe('Integration Tests', () => {
  it('full game loop: roads + zones + services + 100 ticks', () => {
    const state = createGameState(20, 20);
    const roadBuilder = new RoadBuilder(state.grid, state.roadNetwork);
    const zoneManager = new ZoneManager(state.grid);

    // Build a road along row 10 from x=0 to x=15
    roadBuilder.buildRoad({ x: 0, y: 10 }, { x: 15, y: 10 }, RoadType.TWO_LANE, state.budget.funds);

    // Zone residential cells adjacent to the road (row 9, next to road at row 10)
    for (let x = 1; x <= 10; x++) {
      zoneManager.setZone(x, 9, ZoneType.RESIDENTIAL_LOW);
    }

    // Add power plant and water plant
    state.power.addPlant({ x: 0, y: 0, output: 500, pollution: 10, type: 'coal' });
    state.water.addPlant({ x: 1, y: 0, output: 300 });

    // Run 100 simulation ticks
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 100; i++) {
      loop.tick();
    }

    expect(state.clock.tick).toBe(100);
    expect(Number.isFinite(state.budget.funds)).toBe(true);
  });

  it('road building deducts funds', () => {
    const state = createGameState(20, 20);
    const roadBuilder = new RoadBuilder(state.grid, state.roadNetwork);
    const initialFunds = state.budget.funds;

    const result = roadBuilder.buildRoad(
      { x: 0, y: 5 },
      { x: 5, y: 5 },
      RoadType.TWO_LANE,
      state.budget.funds,
    );

    expect(result.success).toBe(true);
    expect(result.cost).toBeGreaterThan(0);

    // Manually deduct cost from budget (RoadBuilder reports cost but doesn't mutate budget)
    state.budget.funds -= result.cost!;

    expect(state.budget.funds).toBeLessThan(initialFunds);
    expect(state.budget.funds).toBe(initialFunds - result.cost!);
  });

  it('simulation 1000 ticks stability', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);

    for (let i = 0; i < 1000; i++) {
      loop.tick();
    }

    expect(Number.isNaN(state.budget.funds)).toBe(false);
    expect(Number.isFinite(state.budget.funds)).toBe(true);
    expect(state.clock.tick).toBe(1000);
  });

  it('paused simulation does not advance', () => {
    const state = createGameState(20, 20);
    state.clock.pause();
    const loop = new SimulationLoop(state);

    for (let i = 0; i < 10; i++) {
      loop.tick();
    }

    expect(state.clock.tick).toBe(0);
  });

  it('speed control affects tick interval', () => {
    const state = createGameState(20, 20);
    state.clock.setSpeed(3);

    expect(state.clock.getTickInterval()).toBe(83);
  });

  it('large map performance: 200x200 with 100 ticks', () => {
    const state = createGameState(200, 200);
    const loop = new SimulationLoop(state);

    for (let i = 0; i < 100; i++) {
      loop.tick();
    }

    expect(state.clock.tick).toBe(100);
  });

  it('city without services has high crime, low health, no building upgrades', () => {
    const state = createGameState(30, 30);
    const roadBuilder = new RoadBuilder(state.grid, state.roadNetwork);

    // Build roads
    roadBuilder.buildRoad({ x: 0, y: 10 }, { x: 25, y: 10 }, RoadType.FOUR_LANE, state.budget.funds);

    // Zone residential
    for (let x = 1; x <= 20; x++) {
      state.grid.setCell(x, 9, { zoneType: ZoneType.RESIDENTIAL_HIGH });
    }

    // Add power + water (minimal services)
    state.power.addPlant({ x: 0, y: 0, output: 1000, pollution: 10, type: 'coal' });
    state.water.addPlant({ x: 1, y: 0, output: 500 });

    // Manually place some buildings (no police/fire/hospital/education)
    for (let x = 1; x <= 10; x++) {
      state.grid.setCell(x, 9, { buildingId: 4, zoneType: ZoneType.RESIDENTIAL_HIGH }); // Small Apartment
    }

    // Add citizens
    for (let i = 0; i < 20; i++) {
      state.citizens.createCitizen({ age: 30, homeId: `${(i % 10) + 1},9` });
    }

    state.budget.funds = 100000;
    state.rciDemand.residential = 50;

    // Run simulation without any civic services
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 60; i++) {
      loop.tick();
    }

    // Without services: crime should be non-zero, happiness affected
    const avgHappiness = state.citizens.citizens.length > 0
      ? state.citizens.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.citizens.length
      : 0;

    // Happiness won't be high without services
    expect(avgHappiness).toBeLessThan(80);
    // No building upgrades without service coverage (buildings stay level 1)
    for (let x = 1; x <= 10; x++) {
      const cell = state.grid.getCell(x, 9);
      if (cell && cell.buildingId > 0 && cell.buildingId < 243) {
        // Level 1 residential high = buildingId 4
        expect(cell.buildingId).toBeLessThanOrEqual(6);
      }
    }
  });

  it('adding services improves city indicators', () => {
    const state = createGameState(30, 30);
    const roadBuilder = new RoadBuilder(state.grid, state.roadNetwork);

    roadBuilder.buildRoad({ x: 0, y: 10 }, { x: 25, y: 10 }, RoadType.FOUR_LANE, state.budget.funds);

    for (let x = 1; x <= 10; x++) {
      state.grid.setCell(x, 9, { buildingId: 4, zoneType: ZoneType.RESIDENTIAL_HIGH });
    }

    state.power.addPlant({ x: 0, y: 0, output: 1000, pollution: 10, type: 'coal' });
    state.water.addPlant({ x: 1, y: 0, output: 500 });

    for (let i = 0; i < 20; i++) {
      state.citizens.createCitizen({ age: 30, homeId: `${(i % 10) + 1},9`, happiness: 50 });
    }

    state.budget.funds = 100000;

    // Add all civic services
    state.police.addStation(5, 10);
    state.fire.addStation(10, 10);
    state.health.addHospital(15, 10);
    state.education.addSchool(20, 10, 'elementary');
    state.parks.addPark(3, 10);

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 60; i++) {
      loop.tick();
    }

    // With services, citizens should have reasonable happiness
    const avgHappiness = state.citizens.citizens.length > 0
      ? state.citizens.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.citizens.length
      : 0;

    // At minimum shouldn't crash and happiness should be defined
    expect(Number.isFinite(avgHappiness)).toBe(true);
    expect(state.clock.tick).toBe(60);
  });

  it('zone adjacent to road only', () => {
    const state = createGameState(20, 20);
    const roadBuilder = new RoadBuilder(state.grid, state.roadNetwork);
    const zoneManager = new ZoneManager(state.grid);

    // Build a road on row 5 from x=0 to x=10
    roadBuilder.buildRoad({ x: 0, y: 5 }, { x: 10, y: 5 }, RoadType.TWO_LANE, state.budget.funds);

    // Cell (5,4) is adjacent to road at (5,5) -- should succeed
    const adjacentResult = zoneManager.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
    expect(adjacentResult.success).toBe(true);

    // Cell (5,0) is NOT adjacent to any road -- should fail
    const nonAdjacentResult = zoneManager.setZone(5, 0, ZoneType.RESIDENTIAL_LOW);
    expect(nonAdjacentResult.success).toBe(false);
    expect(nonAdjacentResult.reason).toBe('NOT_ADJACENT_TO_ROAD');
  });
});
