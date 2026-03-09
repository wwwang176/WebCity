import { describe, it, expect } from 'vitest';
import { serializeGameState, deserializeGameState } from '../Serializer';
import { createGameState } from '../../simulation/GameState';
import { AutoSaver } from '../AutoSave';
import { TerrainType, ZoneType } from '../../grid/types';

describe('Serializer', () => {
  it('should produce valid JSON string', () => {
    const state = createGameState(10, 10);
    const json = serializeGameState(state);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should restore clock tick', () => {
    const state = createGameState(10, 10);
    state.clock.tick = 42;
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    expect(restored.clock.tick).toBe(42);
  });

  it('should restore budget funds', () => {
    const state = createGameState(10, 10);
    state.budget.funds = 99999;
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    expect(restored.budget.funds).toBe(99999);
  });

  it('should restore grid width', () => {
    const state = createGameState(64, 32);
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    expect(restored.grid.width).toBe(64);
    expect(restored.grid.height).toBe(32);
  });

  it('should include tax rates in serialized data', () => {
    const state = createGameState(10, 10);
    state.taxRates.residential = 12;
    state.taxRates.commercial = 7;
    const json = serializeGameState(state);
    const parsed = JSON.parse(json);
    expect(parsed.taxRates).toBeDefined();
    expect(parsed.taxRates.residential).toBe(12);
    expect(parsed.taxRates.commercial).toBe(7);
  });

  it('should round-trip serialize then deserialize consistently', () => {
    const state = createGameState(16, 16);
    state.clock.tick = 100;
    state.clock.paused = true;
    state.budget.funds = 75000;
    state.budget.income = 1200;
    state.budget.expenses = 800;
    state.budget.loans = 5000;
    state.budget.loanInterestRate = 0.03;
    state.taxRates.residential = 11;
    state.taxRates.commercial = 8;
    state.taxRates.industrial = 6;
    state.taxRates.office = 10;
    state.grid.setCell(3, 4, { terrainType: TerrainType.WATER, zoneType: ZoneType.NONE });
    state.grid.setCell(5, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, landValue: 50 });

    const json = serializeGameState(state);
    const restored = deserializeGameState(json);

    expect(restored.clock.tick).toBe(100);
    expect(restored.clock.paused).toBe(true);
    expect(restored.budget.funds).toBe(75000);
    expect(restored.budget.income).toBe(1200);
    expect(restored.budget.expenses).toBe(800);
    expect(restored.budget.loans).toBe(5000);
    expect(restored.budget.loanInterestRate).toBe(0.03);
    expect(restored.taxRates.residential).toBe(11);
    expect(restored.taxRates.commercial).toBe(8);
    expect(restored.taxRates.industrial).toBe(6);
    expect(restored.taxRates.office).toBe(10);

    const waterCell = restored.grid.getCell(3, 4);
    expect(waterCell?.terrainType).toBe(TerrainType.WATER);

    const resiCell = restored.grid.getCell(5, 5);
    expect(resiCell?.zoneType).toBe(ZoneType.RESIDENTIAL_LOW);
    expect(resiCell?.landValue).toBe(50);
  });

  it('should only store non-default cells as sparse array', () => {
    const state = createGameState(10, 10);
    // All cells are default, so the cells array should be empty
    const json = serializeGameState(state);
    const parsed = JSON.parse(json);
    expect(parsed.grid.cells).toHaveLength(0);

    // Set one cell to non-default
    state.grid.setCell(2, 3, { terrainType: TerrainType.MOUNTAIN });
    const json2 = serializeGameState(state);
    const parsed2 = JSON.parse(json2);
    expect(parsed2.grid.cells).toHaveLength(1);
    expect(parsed2.grid.cells[0].x).toBe(2);
    expect(parsed2.grid.cells[0].y).toBe(3);
  });

  it('should restore budget loan fields correctly', () => {
    const state = createGameState(10, 10);
    state.budget.loans = 20000;
    state.budget.loanInterestRate = 0.08;
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    expect(restored.budget.loans).toBe(20000);
    expect(restored.budget.loanInterestRate).toBe(0.08);
  });

  it('should rebuild transit stops from grid after deserialization', () => {
    const state = createGameState(20, 20);
    // Place bus stop (buildingId=242) and metro station (buildingId=241)
    state.bus.addStop(5, 5);
    state.grid.setCell(5, 5, { buildingId: 242 });
    state.metro.addStation(8, 8);
    state.grid.setCell(8, 8, { buildingId: 241 });
    state.taxi.addStand(3, 3);
    state.grid.setCell(3, 3, { buildingId: 236 });

    expect(state.bus.getStops()).toHaveLength(1);
    expect(state.metro.getStations()).toHaveLength(1);

    const json = serializeGameState(state);
    const restored = deserializeGameState(json);

    // Transit stops should be rebuilt from grid scan
    expect(restored.bus.getStops()).toHaveLength(1);
    expect(restored.bus.getStops()[0]!.x).toBe(5);
    expect(restored.bus.getStops()[0]!.y).toBe(5);
    expect(restored.metro.getStations()).toHaveLength(1);
    expect(restored.metro.getStations()[0]!.x).toBe(8);
    expect(restored.metro.getStations()[0]!.y).toBe(8);
  });
});

describe('AutoSaver', () => {
  it('should return true at interval ticks', () => {
    const saver = new AutoSaver(50);
    expect(saver.shouldSave(50)).toBe(true);
    expect(saver.shouldSave(100)).toBe(true);
    expect(saver.shouldSave(150)).toBe(true);
  });

  it('should return false between interval ticks', () => {
    const saver = new AutoSaver(50);
    expect(saver.shouldSave(1)).toBe(false);
    expect(saver.shouldSave(25)).toBe(false);
    expect(saver.shouldSave(49)).toBe(false);
    expect(saver.shouldSave(51)).toBe(false);
  });

  it('should track last save tick', () => {
    const saver = new AutoSaver(100);
    expect(saver.getLastSaveTick()).toBe(0);
    saver.shouldSave(100);
    expect(saver.getLastSaveTick()).toBe(100);
    saver.shouldSave(150);
    expect(saver.getLastSaveTick()).toBe(100);
    saver.shouldSave(200);
    expect(saver.getLastSaveTick()).toBe(200);
  });

  it('should not trigger save at tick 0', () => {
    const saver = new AutoSaver(100);
    expect(saver.shouldSave(0)).toBe(false);
  });
});
