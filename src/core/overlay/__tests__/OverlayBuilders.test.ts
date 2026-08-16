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
    commuteByHome: new Map<string, number>(),
    commuteMax: 60,
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

  it('traffic: uses log scale for density', () => {
    const ctx = makeCtx({ traffic: { getSegmentDensity: () => 300 } });
    const value = buildOverlayValue(ctx, 'traffic', makeCell(), 0, 0);
    // log2(1+300) ≈ 8.2 × TRAFFIC_LOG_FACTOR(10) ≈ 82
    expect(value).toBeGreaterThan(70);
    expect(value).toBeLessThan(100);
  });

  it('traffic: zero flow returns 0', () => {
    const ctx = makeCtx({ traffic: { getSegmentDensity: () => 0 } });
    expect(buildOverlayValue(ctx, 'traffic', makeCell(), 0, 0)).toBe(0);
  });

  it('traffic: high flow should not exceed DISPLAY_MAX', () => {
    const ctx = makeCtx({ traffic: { getSegmentDensity: () => 10000 } });
    const value = buildOverlayValue(ctx, 'traffic', makeCell(), 0, 0);
    expect(value).toBeLessThanOrEqual(O.DISPLAY_MAX);
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

  it('district: maps district id to a value the renderer keeps', () => {
    const ctx = makeCtx({
      districts: { getDistrictAt: () => ({ id: 'downtown' }) },
    });
    const v = buildOverlayValue(ctx, 'district', makeCell(), 0, 0);
    // 0 會被 buildOverlayData 當成「這一格沒東西」丟掉；超過 100 會被夾成 1。
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(100);
  });

  it('district: keeps consecutively created districts far apart', () => {
    // 這個值是拿去當色相用的，而分區 id 是流水號 —— 玩家連續畫出來的幾區必然
    // 是連號。均勻雜湊在這裡沒有用:它讓連號變成亂數，而亂數會撞在一起。
    const values = [1, 2, 3, 4, 5, 6, 7, 8].map(n =>
      buildOverlayValue(
        makeCtx({ districts: { getDistrictAt: () => ({ id: `district_${n}` }) } }),
        'district', makeCell(), 0, 0,
      ));

    // 色相是環狀的，99 與 2 其實只差 3 —— 比大小要繞回去算。
    const gap = (a: number, b: number) => {
      const d = Math.abs(a - b) % 100;
      return Math.min(d, 100 - d);
    };
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        expect(gap(values[i]!, values[j]!),
          `district_${i + 1} 與 district_${j + 1} 的顏色分不開`
            + `（${values[i]!.toFixed(1)} vs ${values[j]!.toFixed(1)}）`)
          .toBeGreaterThan(5);
      }
    }
  });

  it('district: still gives a stable value to an id with no sequence number', () => {
    const of = (id: string) => buildOverlayValue(
      makeCtx({ districts: { getDistrictAt: () => ({ id }) } }), 'district', makeCell(), 0, 0);
    expect(of('downtown')).toBe(of('downtown'));
    expect(of('downtown')).not.toBe(of('riverside'));
    expect(of('downtown')).toBeGreaterThan(0);
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

describe('通勤圖層', () => {
  /**
   * 顏色的刻度是絕對值：紅色代表「這裡的人已經在想換工作了」。相對刻度的話，
   * 一座通勤全都很好的城市裡最慢的那一格照樣會被畫成紅色。
   */
  const ctx = (byHome: [string, number][]) =>
    makeCtx({ commuteByHome: new Map(byHome), commuteMax: 60 });

  it('leaves a cell with no commuters uncoloured', () => {
    expect(buildOverlayValue(ctx([]), 'commute', makeCell(), 3, 3)).toBe(0);
  });

  it('scales towards the maximum as the commute gets worse', () => {
    const short = buildOverlayValue(ctx([['3,3', 15]]), 'commute', makeCell(), 3, 3);
    const long = buildOverlayValue(ctx([['3,3', 45]]), 'commute', makeCell(), 3, 3);
    expect(short).toBeLessThan(long);
    expect(long).toBeLessThan(OVERLAY_SCALE.DISPLAY_MAX);
  });

  it('saturates at the threshold rather than growing without bound', () => {
    const at = buildOverlayValue(ctx([['3,3', 60]]), 'commute', makeCell(), 3, 3);
    const way = buildOverlayValue(ctx([['3,3', 400]]), 'commute', makeCell(), 3, 3);
    expect(at).toBe(OVERLAY_SCALE.DISPLAY_MAX);
    expect(way, '超過門檻之後還在變紅，看不出誰才是最糟的').toBe(OVERLAY_SCALE.DISPLAY_MAX);
  });

  it('keeps a very short commute visible', () => {
    // 通勤 0 與「這一格沒有人住」在畫面上必須分得開，所以有住戶就至少上一點色。
    expect(buildOverlayValue(ctx([['3,3', 0]]), 'commute', makeCell(), 3, 3)).toBeGreaterThan(0);
  });
});
