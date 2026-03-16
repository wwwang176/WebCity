import { describe, it, expect } from 'vitest';
import { buildOverlayValue, OVERLAY_BUILDERS, type OverlayBuildContext } from '../OverlayBuilders';
import { OVERLAY_SCALE } from '../CoverageOverlay';

/** Minimal cell stub. */
function makeCell(overrides: Partial<{
  zoneType: number; pollution: number; landValue: number; buildingId: number;
}> = {}) {
  return {
    zoneType: 0, pollution: 0, landValue: 0, buildingId: 0,
    ...overrides,
  };
}

/** Minimal context stub. */
function makeCtx(overrides: Partial<OverlayBuildContext> = {}): OverlayBuildContext {
  return {
    power: { isPowered: () => false, isInCoverage: () => false, getSupplyRatio: () => 1 },
    water: { isSupplied: () => false, isInCoverage: () => false, getSupplyRatio: () => 1 },
    traffic: { getSegmentDensity: () => 0 },
    police: { getCrimeReduction: () => 0, getCoverage: () => false },
    fire: { getCoverage: () => false },
    health: { getCoverage: () => false },
    education: { getCoverage: () => false },
    parks: { getCoverage: () => false },
    garbage: { getCoverage: () => false },
    districts: { getDistrictAt: () => null },
    grid: { getCell: () => null },
    ...overrides,
  };
}

describe('OVERLAY_BUILDERS', () => {
  it('should have builders for all non-none overlay types', () => {
    const expected = [
      'power', 'water', 'zone', 'traffic', 'pollution',
      'landValue', 'crime', 'district',
      'police', 'fire', 'health', 'education', 'park', 'garbage',
    ];
    for (const t of expected) {
      expect(OVERLAY_BUILDERS[t as keyof typeof OVERLAY_BUILDERS]).toBeDefined();
    }
  });

  it('each builder should be a function', () => {
    for (const fn of Object.values(OVERLAY_BUILDERS)) {
      expect(typeof fn).toBe('function');
    }
  });
});

describe('buildOverlayValue', () => {
  const O = OVERLAY_SCALE;

  it('power: powered cell returns DISPLAY_MAX', () => {
    const ctx = makeCtx({ power: { isPowered: () => true, isInCoverage: () => true, getSupplyRatio: () => 1 } });
    expect(buildOverlayValue(ctx, 'power', makeCell(), 0, 0)).toBe(O.DISPLAY_MAX);
  });

  it('power: unpowered empty cell returns 0', () => {
    expect(buildOverlayValue(makeCtx(), 'power', makeCell(), 0, 0)).toBe(0);
  });

  it('power: underpowered cell in coverage returns half DISPLAY_MAX', () => {
    const ctx = makeCtx({
      power: { isPowered: () => false, isInCoverage: () => true, getSupplyRatio: () => 0.5 },
    });
    expect(buildOverlayValue(ctx, 'power', makeCell(), 0, 0)).toBe(O.DISPLAY_MAX * 0.5);
  });

  it('power: building outside coverage returns 15% DISPLAY_MAX', () => {
    const ctx = makeCtx({
      power: { isPowered: () => false, isInCoverage: () => false, getSupplyRatio: () => 0.5 },
    });
    const cell = makeCell({ buildingId: 1 });
    expect(buildOverlayValue(ctx, 'power', cell, 0, 0)).toBeCloseTo(O.DISPLAY_MAX * 0.15, 1);
  });

  it('water: supplied cell returns DISPLAY_MAX', () => {
    const ctx = makeCtx({ water: { isSupplied: () => true, isInCoverage: () => true, getSupplyRatio: () => 1 } });
    expect(buildOverlayValue(ctx, 'water', makeCell(), 5, 5)).toBe(O.DISPLAY_MAX);
  });

  it('zone: zoneType multiplied by factor', () => {
    const cell = makeCell({ zoneType: 3 });
    expect(buildOverlayValue(makeCtx(), 'zone', cell, 0, 0)).toBe(3 * O.ZONE_TYPE_FACTOR);
  });

  it('zone: zoneType 0 returns 0', () => {
    expect(buildOverlayValue(makeCtx(), 'zone', makeCell(), 0, 0)).toBe(0);
  });

  it('traffic: density multiplied by factor', () => {
    const ctx = makeCtx({ traffic: { getSegmentDensity: () => 3 } });
    expect(buildOverlayValue(ctx, 'traffic', makeCell(), 0, 0)).toBe(3 * O.TRAFFIC_DENSITY_FACTOR);
  });

  it('pollution: scaled from RAW_MAX to DISPLAY_MAX', () => {
    const cell = makeCell({ pollution: 255 });
    expect(buildOverlayValue(makeCtx(), 'pollution', cell, 0, 0)).toBe(O.DISPLAY_MAX);
  });

  it('landValue: only for cells with buildingId > 0', () => {
    const cell = makeCell({ buildingId: 5, landValue: 128 });
    const v = buildOverlayValue(makeCtx(), 'landValue', cell, 0, 0);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(O.DISPLAY_MAX);
  });

  it('landValue: returns 0 when no building', () => {
    const cell = makeCell({ landValue: 128 });
    expect(buildOverlayValue(makeCtx(), 'landValue', cell, 0, 0)).toBe(0);
  });

  it('crime: applies base + reduction for buildings', () => {
    const ctx = makeCtx({ police: { getCrimeReduction: () => -10, getCoverage: () => false } });
    const cell = makeCell({ buildingId: 1 });
    expect(buildOverlayValue(ctx, 'crime', cell, 0, 0)).toBe(O.CRIME_BASE - 10);
  });

  it('crime: returns 0 for empty cells', () => {
    expect(buildOverlayValue(makeCtx(), 'crime', makeCell(), 0, 0)).toBe(0);
  });

  it('district: hashes district id to overlay value', () => {
    const ctx = makeCtx({
      districts: { getDistrictAt: () => ({ id: 'downtown' }) },
    });
    const v = buildOverlayValue(ctx, 'district', makeCell(), 0, 0);
    expect(v).toBeGreaterThanOrEqual(20);
    expect(v).toBeLessThan(100);
  });

  it('district: returns 0 when no district', () => {
    expect(buildOverlayValue(makeCtx(), 'district', makeCell(), 0, 0)).toBe(0);
  });

  it('police (coverage): returns COVERAGE_VALUE when covered', () => {
    const ctx = makeCtx({ police: { getCoverage: () => true, getCrimeReduction: () => 0 } });
    expect(buildOverlayValue(ctx, 'police', makeCell(), 0, 0)).toBe(O.COVERAGE_VALUE);
  });

  it('none overlay returns 0', () => {
    expect(buildOverlayValue(makeCtx(), 'none', makeCell(), 0, 0)).toBe(0);
  });
});
