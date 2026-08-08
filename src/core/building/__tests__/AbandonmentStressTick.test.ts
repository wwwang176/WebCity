import { describe, it, expect, vi } from 'vitest';
import {
  abandonmentStressTick,
  type AbandonmentStressTickDeps,
} from '../AbandonmentStressTick';
import { ZoneType } from '../../grid/types';
import { ABANDONED, BURNED } from '../InfraPlacement';

function makeCell(overrides: Record<string, unknown> = {}) {
  return {
    zoneType: ZoneType.RESIDENTIAL_LOW,
    buildingId: 5, // zone building
    reserved: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AbandonmentStressTickDeps> = {}): AbandonmentStressTickDeps {
  return {
    forEachCell: vi.fn(),
    // Default: every position still holds a live zone building, so the pruning
    // pass added for stale stress entries is a no-op for these stub fixtures.
    getCell: () => makeCell(),
    isZoneBuilding: () => true,
    getBuildingLevel: () => 1,
    getPollution: () => ({ ground: 0, water: 0 }),
    getCrimeReduction: () => 0,
    getServiceScore: () => 5,
    isPowered: () => true,
    isWatered: () => true,
    getFreightSupplyRatio: () => undefined,
    getFreightSurplusRatio: () => undefined,
    baseCrime: 0,
    businessTax: 10,
    residentialTax: 10,
    stressMap: new Map(),
    ...overrides,
  };
}

describe('abandonmentStressTick', () => {
  it('returns empty result when no zone buildings', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        fn({ buildingId: 0, zoneType: ZoneType.NONE, reserved: 0 }, 0, 0);
      },
      isZoneBuilding: () => false,
    });
    const result = abandonmentStressTick(deps);
    expect(result.abandoned).toHaveLength(0);
    expect(result.changed).toBe(false);
  });

  it('skips already abandoned buildings', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        fn(makeCell({ reserved: ABANDONED }), 0, 0);
      },
    });
    const result = abandonmentStressTick(deps);
    expect(result.abandoned).toHaveLength(0);
  });

  it('skips burned buildings', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        fn(makeCell({ reserved: BURNED }), 0, 0);
      },
    });
    const result = abandonmentStressTick(deps);
    expect(result.abandoned).toHaveLength(0);
  });

  it('increases stress when no power', () => {
    const stressMap = new Map<string, number>();
    const deps = makeDeps({
      forEachCell: (fn) => { fn(makeCell(), 5, 5); },
      isPowered: () => false,
      stressMap,
    });
    abandonmentStressTick(deps);
    expect(stressMap.get('5,5')).toBeGreaterThan(0);
  });

  it('removes stress entry when stress drops to 0', () => {
    const stressMap = new Map<string, number>([['3,3', 1]]);
    const deps = makeDeps({
      forEachCell: (fn) => { fn(makeCell(), 3, 3); },
      getServiceScore: () => 10, // high service → strong recovery
      stressMap,
    });
    abandonmentStressTick(deps);
    expect(stressMap.has('3,3')).toBe(false);
  });

  it('triggers abandonment when stress reaches 100', () => {
    const stressMap = new Map<string, number>([['2,2', 99]]);
    const deps = makeDeps({
      forEachCell: (fn) => { fn(makeCell(), 2, 2); },
      isPowered: () => false,
      isWatered: () => false,
      stressMap,
    });
    const result = abandonmentStressTick(deps);
    expect(result.abandoned.length).toBeGreaterThanOrEqual(1);
    expect(result.changed).toBe(true);
  });

  it('applies resilience modifier based on position hash', () => {
    const stressMap1 = new Map<string, number>();
    const stressMap2 = new Map<string, number>();
    // Same conditions, different positions → different resilience
    const baseDeps = {
      isPowered: () => false,
      isWatered: () => false,
    };
    const deps1 = makeDeps({
      ...baseDeps,
      forEachCell: (fn) => { fn(makeCell(), 0, 0); },
      stressMap: stressMap1,
    });
    const deps2 = makeDeps({
      ...baseDeps,
      forEachCell: (fn) => { fn(makeCell(), 7, 3); },
      stressMap: stressMap2,
    });
    abandonmentStressTick(deps1);
    abandonmentStressTick(deps2);
    // Different positions should produce different stress values
    const s1 = stressMap1.get('0,0') ?? 0;
    const s2 = stressMap2.get('7,3') ?? 0;
    // Both should have stress (no power + no water), but different amounts
    expect(s1).toBeGreaterThan(0);
    expect(s2).toBeGreaterThan(0);
    expect(s1).not.toBeCloseTo(s2, 5);
  });
});
