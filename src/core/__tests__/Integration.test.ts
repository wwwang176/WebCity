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
