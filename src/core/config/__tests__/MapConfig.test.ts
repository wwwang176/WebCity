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
  it('sparse forest → small depth, large water gap', () => {
    const tc = resolveTerrainConfig(configWith({ forestDensity: 'sparse' }));
    expect(tc.forestDepth).toBe(0.15);
    expect(tc.forestWaterGap).toBe(3);
  });

  it('normal forest → medium depth and water gap', () => {
    const tc = resolveTerrainConfig(configWith({ forestDensity: 'normal' }));
    expect(tc.forestDepth).toBe(0.5);
    expect(tc.forestWaterGap).toBe(2);
  });

  it('dense forest → large depth, small water gap', () => {
    const tc = resolveTerrainConfig(configWith({ forestDensity: 'dense' }));
    expect(tc.forestDepth).toBe(0.85);
    expect(tc.forestWaterGap).toBe(1);
  });

  it('forest depth ascending: sparse < normal < dense', () => {
    const sparse = resolveTerrainConfig(configWith({ forestDensity: 'sparse' }));
    const normal = resolveTerrainConfig(configWith({ forestDensity: 'normal' }));
    const dense = resolveTerrainConfig(configWith({ forestDensity: 'dense' }));
    expect(sparse.forestDepth).toBeLessThan(normal.forestDepth);
    expect(normal.forestDepth).toBeLessThan(dense.forestDepth);
  });
});
