import { describe, it, expect, vi } from 'vitest';
import { buildExportPayload, parseAndValidateImport, type ExportFile } from '../ImportExport';
import { serializeGameState } from '../Serializer';
import { createGameState } from '../../simulation/GameState';
import { CURRENT_SAVE_VERSION } from '../migrations';
import { TerrainType, ZoneType } from '../../grid/types';
import type { SaveSlot } from '../SaveManager';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function makeSlot(overrides?: Partial<SaveSlot>): SaveSlot {
  const state = createGameState(10, 10);
  return {
    id: 1,
    name: 'Test City',
    date: '2026-01-01T00:00:00.000Z',
    data: serializeGameState(state),
    population: 42,
    ...overrides,
  };
}

function makeExportJson(slotOverrides?: Partial<SaveSlot>): string {
  const slot = makeSlot(slotOverrides);
  const payload = buildExportPayload(slot);
  return JSON.stringify(payload);
}

/* ================================================================== */
/*  buildExportPayload                                                */
/* ================================================================== */
describe('buildExportPayload', () => {
  it('should produce correct format and exportVersion', () => {
    const payload = buildExportPayload(makeSlot());
    expect(payload.format).toBe('webcity-save');
    expect(payload.exportVersion).toBe(1);
  });

  it('should include exportedAt as ISO string', () => {
    const payload = buildExportPayload(makeSlot());
    expect(typeof payload.exportedAt).toBe('string');
    expect(() => new Date(payload.exportedAt)).not.toThrow();
  });

  it('should exclude slot.id from output', () => {
    const payload = buildExportPayload(makeSlot({ id: 99 }));
    expect((payload.slot as Record<string, unknown>).id).toBeUndefined();
  });

  it('should preserve name, date, data, and population', () => {
    const slot = makeSlot({ name: 'My City', population: 1000 });
    const payload = buildExportPayload(slot);
    expect(payload.slot.name).toBe('My City');
    expect(payload.slot.date).toBe(slot.date);
    expect(payload.slot.data).toBe(slot.data);
    expect(payload.slot.population).toBe(1000);
  });
});

/* ================================================================== */
/*  parseAndValidateImport                                            */
/* ================================================================== */
describe('parseAndValidateImport', () => {
  it('should accept a valid export file', () => {
    const json = makeExportJson();
    const result = parseAndValidateImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe('Test City');
      expect(typeof result.data).toBe('string');
    }
  });

  it('should reject invalid JSON', () => {
    const result = parseAndValidateImport('not valid json {{{');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('should reject non-webcity JSON', () => {
    const result = parseAndValidateImport(JSON.stringify({ foo: 'bar' }));
    expect(result.ok).toBe(false);
  });

  it('should reject oversized file content', () => {
    // Create a string > 50MB
    const huge = 'x'.repeat(51 * 1024 * 1024);
    const result = parseAndValidateImport(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('size');
    }
  });

  it('should reject prototype pollution in wrapper', () => {
    const polluted = '{"format":"webcity-save","exportVersion":1,"exportedAt":"2026-01-01","__proto__":{"isAdmin":true},"slot":{"name":"x","date":"2026-01-01","data":"{}"}}';
    const result = parseAndValidateImport(polluted);
    expect(result.ok).toBe(false);
  });

  it('should reject save data with invalid grid', () => {
    const badData = JSON.stringify({
      version: CURRENT_SAVE_VERSION,
      grid: { width: -1, height: 10, cells: [] },
      clock: { tick: 0, speed: 1, paused: false },
      budget: { funds: 50000, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05 },
      taxRates: { residential: 9, commercial: 9, industrial: 9, office: 9 },
    });
    const exportFile: ExportFile = {
      format: 'webcity-save',
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      slot: { name: 'Bad', date: new Date().toISOString(), data: badData },
    };
    const result = parseAndValidateImport(JSON.stringify(exportFile));
    expect(result.ok).toBe(false);
  });

  it('should sanitize save name with HTML', () => {
    const json = makeExportJson({ name: '<script>alert(1)</script>' });
    const result = parseAndValidateImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).not.toContain('<script>');
    }
  });

  it('should accept old save versions (migration compatible)', () => {
    const oldData = JSON.stringify({
      version: 1,
      grid: { width: 10, height: 10, cells: [] },
      clock: { tick: 0, speed: 1, paused: false },
      budget: { funds: 50000, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05 },
      taxRates: { residential: 9, commercial: 9, industrial: 9, office: 9 },
    });
    const exportFile: ExportFile = {
      format: 'webcity-save',
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      slot: { name: 'Old Save', date: new Date().toISOString(), data: oldData },
    };
    const result = parseAndValidateImport(JSON.stringify(exportFile));
    expect(result.ok).toBe(true);
  });
});

/* ================================================================== */
/*  Round-trip                                                        */
/* ================================================================== */
describe('Round-trip export → import', () => {
  it('should preserve game state through export/import cycle', () => {
    const state = createGameState(16, 16);
    state.clock.tick = 500;
    state.clock.paused = true;
    state.budget.funds = 75000;
    state.taxRates.residential = 11;
    state.grid.setCell(3, 4, { terrainType: TerrainType.WATER });
    state.grid.setCell(5, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, landValue: 50 });

    const slot: SaveSlot = {
      id: 1,
      name: 'Round Trip City',
      date: new Date().toISOString(),
      data: serializeGameState(state),
      population: 100,
    };

    // Export
    const payload = buildExportPayload(slot);
    const exportedJson = JSON.stringify(payload);

    // Import
    const result = parseAndValidateImport(exportedJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify data is preserved
    expect(result.name).toBe('Round Trip City');
    const parsed = JSON.parse(result.data);
    expect(parsed.clock.tick).toBe(500);
    expect(parsed.clock.paused).toBe(false); // save always stores paused=false
    expect(parsed.budget.funds).toBe(75000);
    expect(parsed.taxRates.residential).toBe(11);
  });
});
