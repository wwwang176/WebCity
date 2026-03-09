import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { DebugTools } from '../DebugTools';

describe('DebugTools', () => {
  it('should extract a snapshot of current simulation parameters', () => {
    const state = createGameState(20, 20);
    state.budget.funds = 12345;
    const tools = new DebugTools(state);
    const snap = tools.getSnapshot();

    expect(snap.funds).toBe(12345);
    expect(snap.population).toBe(0);
    expect(snap.vehicleCount).toBe(0);
    expect(snap.tick).toBe(0);
    expect(typeof snap.rciDemand.r).toBe('number');
    expect(typeof snap.rciDemand.c).toBe('number');
    expect(typeof snap.rciDemand.i).toBe('number');
    expect(typeof snap.powerSupply).toBe('number');
    expect(typeof snap.waterSupply).toBe('number');
    expect(typeof snap.avgHappiness).toBe('number');
    expect(typeof snap.avgLandValue).toBe('number');
    expect(typeof snap.avgPollution).toBe('number');
    expect(typeof snap.buildingCount).toBe('number');
    expect(typeof snap.roadCount).toBe('number');
  });

  it('should allow setting funds directly', () => {
    const state = createGameState(20, 20);
    const tools = new DebugTools(state);
    tools.setFunds(99999);
    expect(state.budget.funds).toBe(99999);
  });

  it('should allow setting game speed', () => {
    const state = createGameState(20, 20);
    const tools = new DebugTools(state);
    tools.setSpeed(3);
    expect(state.clock.speed).toBe(3);
  });

  it('should count buildings on the grid', () => {
    const state = createGameState(20, 20);
    state.grid.setCell(5, 5, { buildingId: 10 });
    state.grid.setCell(6, 6, { buildingId: 20 });
    state.grid.setCell(7, 7, { buildingId: 254 }); // infrastructure
    const tools = new DebugTools(state);
    const snap = tools.getSnapshot();
    expect(snap.buildingCount).toBe(2);
    expect(snap.infraCount).toBe(1);
  });

  it('should count roads on the grid', () => {
    const state = createGameState(20, 20);
    state.grid.setCell(3, 3, { roadType: 3 });
    state.grid.setCell(4, 3, { roadType: 3 });
    state.grid.setCell(5, 3, { roadType: 2 });
    const tools = new DebugTools(state);
    const snap = tools.getSnapshot();
    expect(snap.roadCount).toBe(3);
  });

  it('should calculate average happiness from citizens', () => {
    const state = createGameState(20, 20);
    (state.citizens as unknown as { citizens: { id: number; happiness: number }[] }).citizens = [
      { id: 1, happiness: 80 },
      { id: 2, happiness: 60 },
      { id: 3, happiness: 40 },
    ];
    const tools = new DebugTools(state);
    const snap = tools.getSnapshot();
    expect(snap.avgHappiness).toBe(60);
    expect(snap.population).toBe(3);
  });

  it('should get power supply totals', () => {
    const state = createGameState(20, 20);
    state.power.addPlant({ x: 0, y: 0, output: 500, pollution: 10, type: 'coal' });
    state.power.addPlant({ x: 2, y: 0, output: 300, pollution: 5, type: 'wind' });
    const tools = new DebugTools(state);
    const snap = tools.getSnapshot();
    expect(snap.powerSupply).toBe(800);
  });

  it('should return modifiable parameters list', () => {
    const state = createGameState(20, 20);
    const tools = new DebugTools(state);
    const params = tools.getModifiableParams();
    expect(params).toContainEqual(expect.objectContaining({ name: 'funds', type: 'number' }));
    expect(params).toContainEqual(expect.objectContaining({ name: 'speed', type: 'number' }));
    expect(params).toContainEqual(expect.objectContaining({ name: 'taxRate', type: 'number' }));
  });

  it('should modify income tax rate via setParam taxRate', () => {
    const state = createGameState(20, 20);
    const tools = new DebugTools(state);
    tools.setParam('taxRate', 15);
    expect(state.taxRates.residential).toBe(15);
  });

  it('should modify business tax rate via setParam businessTaxRate', () => {
    const state = createGameState(20, 20);
    const tools = new DebugTools(state);
    tools.setParam('businessTaxRate', 12);
    expect(state.taxRates.business).toBe(12);
    expect(state.taxRates.commercial).toBe(12);
    expect(state.taxRates.industrial).toBe(12);
    expect(state.taxRates.office).toBe(12);
  });

  it('should modify funds via setParam', () => {
    const state = createGameState(20, 20);
    const tools = new DebugTools(state);
    tools.setParam('funds', 777777);
    expect(state.budget.funds).toBe(777777);
  });
});
