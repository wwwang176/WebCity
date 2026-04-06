import { describe, it, expect } from 'vitest';
import {
  getDefaultMapConfig,
  STARTING_FUNDS_MAP,
  DISASTER_CHANCE_MAP,
  resolveTerrainConfig,
  type MapConfig,
} from '../MapConfig';

describe('getDefaultMapConfig', () => {
  it('returns valid seed > 0', () => {
    const cfg = getDefaultMapConfig();
    expect(cfg.seed).toBeGreaterThan(0);
    expect(Number.isInteger(cfg.seed)).toBe(true);
  });

  it('returns expected defaults', () => {
    const cfg = getDefaultMapConfig();
    expect(cfg.waterAmount).toBe('medium');
    expect(cfg.forestDensity).toBe('normal');
    expect(cfg.mountainAmount).toBe('medium');
    expect(cfg.startingFunds).toBe('normal');
    expect(cfg.disastersEnabled).toBe(true);
    expect(cfg.disasterFrequency).toBe('medium');
  });
});

describe('STARTING_FUNDS_MAP', () => {
  it('has correct values', () => {
    expect(STARTING_FUNDS_MAP.easy).toBe(75000);
    expect(STARTING_FUNDS_MAP.normal).toBe(50000);
    expect(STARTING_FUNDS_MAP.hard).toBe(25000);
  });
});

describe('DISASTER_CHANCE_MAP', () => {
  it('has ascending values low < medium < high', () => {
    expect(DISASTER_CHANCE_MAP.low).toBeLessThan(DISASTER_CHANCE_MAP.medium);
    expect(DISASTER_CHANCE_MAP.medium).toBeLessThan(DISASTER_CHANCE_MAP.high);
  });

  it('all values > 0', () => {
    expect(DISASTER_CHANCE_MAP.low).toBeGreaterThan(0);
    expect(DISASTER_CHANCE_MAP.medium).toBeGreaterThan(0);
    expect(DISASTER_CHANCE_MAP.high).toBeGreaterThan(0);
  });
});

describe('resolveTerrainConfig', () => {
  function configWith(overrides: Partial<MapConfig>): MapConfig {
    return { ...getDefaultMapConfig(), ...overrides };
  }

  // Water
  it('low water → riverHalfWidth 1, lakeCount 0', () => {
    const tc = resolveTerrainConfig(configWith({ waterAmount: 'low' }));
    expect(tc.riverHalfWidth).toBe(1);
    expect(tc.lakeCount).toBe(0);
  });

  it('medium water → riverHalfWidth 1, lakeCount 0', () => {
    const tc = resolveTerrainConfig(configWith({ waterAmount: 'medium' }));
    expect(tc.riverHalfWidth).toBe(1);
    expect(tc.lakeCount).toBe(0);
  });

  it('high water → riverHalfWidth 2, lakeCount 2', () => {
    const tc = resolveTerrainConfig(configWith({ waterAmount: 'high' }));
    expect(tc.riverHalfWidth).toBe(2);
    expect(tc.lakeCount).toBe(2);
  });

  // Forest
  it('sparse forest → patchCount 4, fillChance 0.4', () => {
    const tc = resolveTerrainConfig(configWith({ forestDensity: 'sparse' }));
    expect(tc.forestPatchCount).toBe(4);
    expect(tc.forestFillChance).toBe(0.4);
  });

  it('normal forest → patchCount 8, fillChance 0.7', () => {
    const tc = resolveTerrainConfig(configWith({ forestDensity: 'normal' }));
    expect(tc.forestPatchCount).toBe(8);
    expect(tc.forestFillChance).toBe(0.7);
  });

  it('dense forest → patchCount 14, fillChance 0.9', () => {
    const tc = resolveTerrainConfig(configWith({ forestDensity: 'dense' }));
    expect(tc.forestPatchCount).toBe(14);
    expect(tc.forestFillChance).toBe(0.9);
  });

  // Mountain
  it('low mountain → count 0', () => {
    const tc = resolveTerrainConfig(configWith({ mountainAmount: 'low' }));
    expect(tc.mountainCount).toBe(0);
  });

  it('medium mountain → count 1', () => {
    const tc = resolveTerrainConfig(configWith({ mountainAmount: 'medium' }));
    expect(tc.mountainCount).toBe(1);
  });

  it('high mountain → count 3', () => {
    const tc = resolveTerrainConfig(configWith({ mountainAmount: 'high' }));
    expect(tc.mountainCount).toBe(3);
  });
});
