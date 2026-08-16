import { describe, it, expect, vi } from 'vitest';
import { serializeGameState, deserializeGameState } from '../Serializer';
import { createGameState } from '../../simulation/GameState';
import { AutoSaver } from '../AutoSave';
import { SAVE_CONFIG } from '../SaveManager';
import { TerrainType, ZoneType } from '../../grid/types';
import { MULTI_CELL_OCCUPIED } from '../../building/InfraPlacement';
import { getInfraConfig } from '../../building/InfraConfig';
import { PolicyType, Specialization } from '../../district/types';
import { CitySpecType } from '../../district/CitySpecialization';
import { ResourceType } from '../../economy/GlobalMarket';

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
    expect(restored.clock.paused).toBe(false); // save always stores paused=false
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

  it('should serialize and restore transport systems with routes and vehicles', () => {
    const state = createGameState(20, 20);
    // Set up bus with stop + route
    const s1 = state.bus.addStop(5, 5);
    state.grid.setCell(5, 5, { buildingId: 242 });
    const s2 = state.bus.addStop(10, 10);
    state.grid.setCell(10, 10, { buildingId: 242 });
    state.bus.createRoute([s1, s2], 2);

    // Set up metro with station + line
    const st1 = state.metro.addStation(8, 8);
    state.grid.setCell(8, 8, { buildingId: 241 });
    const st2 = state.metro.addStation(15, 15);
    state.grid.setCell(15, 15, { buildingId: 241 });
    state.metro.createLine([st1, st2]);

    const json = serializeGameState(state);
    const restored = deserializeGameState(json);

    // Bus: stops + routes + vehicles preserved
    expect(restored.bus.getStops()).toHaveLength(2);
    expect(restored.bus.getRoutes()).toHaveLength(1);
    expect(restored.bus.getVehicles()).toHaveLength(2);
    expect(restored.bus.getStops()[0]!.x).toBe(5);

    // Metro: stations + lines + trains preserved
    expect(restored.metro.getStations()).toHaveLength(2);
    expect(restored.metro.getLines()).toHaveLength(1);
    expect(restored.metro.getTrains()).toHaveLength(1);

  });
});

describe('Old save migration (1×1 → multi-cell)', () => {
  function makeOldSave(infraCells: { x: number; y: number; buildingId: number }[]): string {
    // Simulate an old save where infrastructure was stored as 1×1 (no reserved=4 secondary cells)
    const cells = infraCells.map(c => ({
      x: c.x,
      y: c.y,
      data: { buildingId: c.buildingId },
    }));
    return JSON.stringify({
      version: 1,
      grid: { width: 30, height: 30, cells },
      clock: { tick: 100, speed: 1, paused: false },
      budget: { funds: 50000, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05 },
      taxRates: { residential: 9, commercial: 9, industrial: 9, office: 9 },
    });
  }

  it('should expand 1×1 police (bid=252) to 2×2 on load', () => {
    const json = makeOldSave([{ x: 5, y: 5, buildingId: 252 }]);
    const state = deserializeGameState(json);

    // Primary cell should keep buildingId
    const primary = state.grid.getCell(5, 5)!;
    expect(primary.buildingId).toBe(252);
    expect(primary.reserved).not.toBe(MULTI_CELL_OCCUPIED);

    // Secondary cells should be filled
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]] as [number, number][]) {
      const cell = state.grid.getCell(5 + dx, 5 + dy)!;
      expect(cell.buildingId).toBe(252);
      expect(cell.reserved).toBe(MULTI_CELL_OCCUPIED);
    }
  });

  it('should expand 1×1 hospital (bid=250) to 2×3 on load', () => {
    const json = makeOldSave([{ x: 10, y: 10, buildingId: 250 }]);
    const state = deserializeGameState(json);

    const cfg = getInfraConfig('hospital')!;
    let primaryCount = 0;
    let secondaryCount = 0;

    for (let dy = 0; dy < cfg.height; dy++) {
      for (let dx = 0; dx < cfg.width; dx++) {
        const cell = state.grid.getCell(10 + dx, 10 + dy)!;
        expect(cell.buildingId).toBe(250);
        if (dx === 0 && dy === 0) {
          expect(cell.reserved).not.toBe(MULTI_CELL_OCCUPIED);
          primaryCount++;
        } else {
          expect(cell.reserved).toBe(MULTI_CELL_OCCUPIED);
          secondaryCount++;
        }
      }
    }
    expect(primaryCount).toBe(1);
    expect(secondaryCount).toBe(5);
  });

  it('should expand 1×1 university (bid=243) to 3×3 on load', () => {
    const json = makeOldSave([{ x: 15, y: 15, buildingId: 243 }]);
    const state = deserializeGameState(json);

    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const cell = state.grid.getCell(15 + dx, 15 + dy)!;
        expect(cell.buildingId).toBe(243);
        if (dx === 0 && dy === 0) {
          expect(cell.reserved).not.toBe(MULTI_CELL_OCCUPIED);
        } else {
          expect(cell.reserved).toBe(MULTI_CELL_OCCUPIED);
        }
      }
    }
  });

  it('should not re-expand already multi-cell infrastructure', () => {
    // New save already has secondary cells
    const state = createGameState(20, 20);
    state.grid.setCell(5, 5, { buildingId: 252, reserved: 0 });
    state.grid.setCell(6, 5, { buildingId: 252, reserved: MULTI_CELL_OCCUPIED });
    state.grid.setCell(5, 6, { buildingId: 252, reserved: MULTI_CELL_OCCUPIED });
    state.grid.setCell(6, 6, { buildingId: 252, reserved: MULTI_CELL_OCCUPIED });

    const json = serializeGameState(state);
    const restored = deserializeGameState(json);

    // Should remain unchanged
    expect(restored.grid.getCell(5, 5)!.buildingId).toBe(252);
    expect(restored.grid.getCell(5, 5)!.reserved).toBe(0);
    expect(restored.grid.getCell(6, 5)!.reserved).toBe(MULTI_CELL_OCCUPIED);
    expect(restored.grid.getCell(5, 6)!.reserved).toBe(MULTI_CELL_OCCUPIED);
    expect(restored.grid.getCell(6, 6)!.reserved).toBe(MULTI_CELL_OCCUPIED);
  });

  it('should skip expansion if secondary cells are blocked', () => {
    // Old save: police at (5,5), but (6,5) has a road
    const cells = [
      { x: 5, y: 5, data: { buildingId: 252 } },
      { x: 6, y: 5, data: { roadType: 1 } },
    ];
    const json = JSON.stringify({
      version: 1,
      grid: { width: 20, height: 20, cells },
      clock: { tick: 0, speed: 1, paused: false },
      budget: { funds: 50000, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05 },
      taxRates: { residential: 9, commercial: 9, industrial: 9, office: 9 },
    });

    const state = deserializeGameState(json);
    // Primary cell should still have buildingId (not cleared)
    expect(state.grid.getCell(5, 5)!.buildingId).toBe(252);
    // Blocked cell should remain as road
    expect(state.grid.getCell(6, 5)!.roadType).toBe(1);
  });

  it('should expand 1×1 park (bid=248) without changes (already 1×1)', () => {
    const json = makeOldSave([{ x: 5, y: 5, buildingId: 248 }]);
    const state = deserializeGameState(json);

    expect(state.grid.getCell(5, 5)!.buildingId).toBe(248);
    // Park is 1×1, so no secondary cells needed
    expect(state.grid.getCell(6, 5)!.buildingId).toBe(0);
  });
});

describe('SAVE_CONFIG', () => {
  it('should export DB_NAME as a non-empty string', () => {
    expect(typeof SAVE_CONFIG.DB_NAME).toBe('string');
    expect(SAVE_CONFIG.DB_NAME.length).toBeGreaterThan(0);
  });

  it('should export STORE_NAME as a non-empty string', () => {
    expect(typeof SAVE_CONFIG.STORE_NAME).toBe('string');
    expect(SAVE_CONFIG.STORE_NAME.length).toBeGreaterThan(0);
  });

  it('should export DB_VERSION as a positive integer', () => {
    expect(SAVE_CONFIG.DB_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(SAVE_CONFIG.DB_VERSION)).toBe(true);
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

// BUG-053: districts / policies / city specialization / global market were
// simulated and player-editable but never serialized, so every save/load
// silently reset them to defaults.
describe('Serializer — districts, policies, specialization, market', () => {
  it('should round-trip districts and their cell membership', () => {
    const state = createGameState(20, 20);
    const d = state.districts.createDistrict('Downtown');
    state.districts.addCellToDistrict(d.id, 3, 4);
    state.districts.addCellToDistrict(d.id, 3, 5);
    state.districts.addCellToDistrict(d.id, 4, 4);

    const restored = deserializeGameState(serializeGameState(state));

    expect(restored.districts.getAllDistricts()).toHaveLength(1);
    const rd = restored.districts.getAllDistricts()[0]!;
    expect(rd.name).toBe('Downtown');
    expect([...rd.cells].sort()).toEqual(['3,4', '3,5', '4,4']);
    expect(restored.districts.getDistrictAt(3, 5)?.id).toBe(rd.id);
    expect(restored.districts.getDistrictAt(9, 9)).toBeNull();
  });

  it('should round-trip district policies and keep them enforceable', () => {
    const state = createGameState(20, 20);
    const d = state.districts.createDistrict('NoFactories');
    state.districts.addCellToDistrict(d.id, 5, 5);
    state.policies.setPolicyLevel(d.id, PolicyType.NO_HEAVY_INDUSTRY, 1);
    expect(state.policies.canBuildInDistrict(d.id, ZoneType.INDUSTRIAL)).toBe(false);

    const restored = deserializeGameState(serializeGameState(state));
    const rd = restored.districts.getAllDistricts()[0]!;

    expect(restored.policies.isPolicyActive(rd.id, PolicyType.NO_HEAVY_INDUSTRY)).toBe(true);
    expect(restored.policies.canBuildInDistrict(rd.id, ZoneType.INDUSTRIAL)).toBe(false);
    expect(restored.policies.canBuildInDistrict(rd.id, ZoneType.RESIDENTIAL_LOW)).toBe(true);
  });

  it('should round-trip district specialization', () => {
    const state = createGameState(20, 20);
    const d = state.districts.createDistrict('Farmland');
    d.specialization = Specialization.FARMING;

    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.districts.getAllDistricts()[0]!.specialization).toBe(Specialization.FARMING);
  });

  it('should round-trip city specialization and its revenue multiplier', () => {
    const state = createGameState(20, 20);
    expect(state.citySpec.choose(CitySpecType.TECH_CITY, 5000)).toBe(true);
    expect(state.citySpec.getBonus().revenueMultiplier).toBeCloseTo(1.25);

    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.citySpec.getCurrent()).toBe(CitySpecType.TECH_CITY);
    expect(restored.citySpec.getBonus().revenueMultiplier).toBeCloseTo(1.25);
  });

  it('should round-trip global market prices', () => {
    const state = createGameState(20, 20);
    // Drive the price away from its base so the assertion has discriminating
    // power — exportResource alone only moves supplyPressure, not price.
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    state.globalMarket.exportResource(ResourceType.OIL, 25);
    state.globalMarket.tick();
    rand.mockRestore();

    const priceBefore = state.globalMarket.getPrice(ResourceType.OIL);
    expect(priceBefore).not.toBeCloseTo(100);

    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.globalMarket.getPrice(ResourceType.OIL)).toBeCloseTo(priceBefore);
  });

  it('should not collide district ids created after a load', () => {
    const state = createGameState(20, 20);
    const a = state.districts.createDistrict('A');
    const b = state.districts.createDistrict('B');

    const restored = deserializeGameState(serializeGameState(state));
    const c = restored.districts.createDistrict('C');

    expect(c.id).not.toBe(a.id);
    expect(c.id).not.toBe(b.id);
    expect(restored.districts.getAllDistricts()).toHaveLength(3);
  });

  it('should not collide policy ids created after a load', () => {
    const state = createGameState(20, 20);
    const d = state.districts.createDistrict('D');
    state.policies.setPolicyLevel(d.id, PolicyType.NO_HEAVY_INDUSTRY, 1);
    const firstId = d.policies[0]!.id;

    const restored = deserializeGameState(serializeGameState(state));
    const rd = restored.districts.getAllDistricts()[0]!;
    restored.policies.setPolicyLevel(rd.id, PolicyType.TOURISM, 1);

    const newPolicy = rd.policies.find(p => p.type === PolicyType.TOURISM)!;
    expect(newPolicy.id).not.toBe(firstId);
  });

  it('should load an old save with no district data as empty defaults', () => {
    const state = createGameState(20, 20);
    const raw = JSON.parse(serializeGameState(state)) as Record<string, unknown>;
    delete raw.districts;
    delete raw.citySpec;
    delete raw.globalMarket;

    const restored = deserializeGameState(JSON.stringify(raw));
    expect(restored.districts.getAllDistricts()).toEqual([]);
    expect(restored.citySpec.getCurrent()).toBe(CitySpecType.NONE);
    expect(restored.globalMarket.getPrice(ResourceType.OIL)).toBeCloseTo(100);
  });
});
