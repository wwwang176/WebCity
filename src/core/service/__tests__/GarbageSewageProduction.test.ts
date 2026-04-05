import { describe, it, expect } from 'vitest';
import { produceGarbageAndSewage } from '../GarbageSewageProduction';
import { ZoneType } from '../../grid/types';
import { getBuildingType } from '../../building/types';
import type { GarbageService } from '../GarbageService';
import type { SewageService } from '../SewageService';

/**
 * Test helper: run produceGarbageAndSewage with fake services that accumulate
 * reported amounts, using building capacity as the occupancy source. Returns
 * aggregate { garbage, sewage } totals.
 *
 * These tests verify formula shape (accumulation, zero handling, non-building
 * skipping), not live-citizen occupancy, so capacity-as-occupancy keeps the
 * test inputs self-contained while exercising the real production function.
 */
function computeAggregates(
  forEachCell: (fn: (cell: { buildingId: number; zoneType: number }, x: number, y: number) => void) => void,
): { garbage: number; sewage: number } {
  // Build a (x,y) → cell lookup by replaying forEachCell once
  const cellMap = new Map<string, { buildingId: number; zoneType: number }>();
  forEachCell((cell, x, y) => { cellMap.set(`${x},${y}`, cell); });

  let garbageTotal = 0;
  let sewageTotal = 0;
  const fakeGarbage = {
    reportGarbage: (_x: number, _y: number, amt: number) => { garbageTotal += amt; },
  } as unknown as GarbageService;
  const fakeSewage = {
    reportSewage: (_x: number, _y: number, amt: number) => { sewageTotal += amt; },
    clearSewageCells: () => {},
  } as unknown as SewageService;

  const occupancyFrom = (field: 'residents' | 'workers') => (x: number, y: number): number => {
    const cell = cellMap.get(`${x},${y}`);
    if (!cell) return 0;
    const bt = getBuildingType(cell.buildingId);
    return bt?.[field] ?? 0;
  };

  produceGarbageAndSewage(
    forEachCell,
    fakeGarbage,
    fakeSewage,
    occupancyFrom('residents'),
    occupancyFrom('workers'),
  );

  return { garbage: Math.floor(garbageTotal), sewage: Math.floor(sewageTotal) };
}

describe('produceGarbageAndSewage', () => {
  it('returns zeros for empty grid', () => {
    const result = computeAggregates((fn) => {
      // no cells
    });
    expect(result.garbage).toBe(0);
    expect(result.sewage).toBe(0);
  });

  it('calculates garbage for residential buildings', () => {
    // Multiple buildings to exceed Math.floor threshold
    // buildingId=4 = Small Apartment (RESIDENTIAL_HIGH, residents=80)
    // GARBAGE: base=0.025 + perCapita=0.0025 * 80 = 0.225 per building, ×5 = 1.125 → floor=1
    const result = computeAggregates((fn) => {
      for (let i = 0; i < 5; i++) fn({ buildingId: 4, zoneType: ZoneType.RESIDENTIAL_HIGH }, i, 0);
    });
    expect(result.garbage).toBeGreaterThan(0);
  });

  it('calculates garbage for industrial building', () => {
    // buildingId=13 = Small Factory (INDUSTRIAL, workers=10)
    // GARBAGE: base=0.1 + perCapita=0.005 * 10 = 0.15, ×7 = 1.05 → floor=1
    const result = computeAggregates((fn) => {
      for (let i = 0; i < 7; i++) fn({ buildingId: 13, zoneType: ZoneType.INDUSTRIAL }, i, 0);
    });
    expect(result.garbage).toBeGreaterThan(0);
  });

  it('calculates sewage from water demand × sewage rate', () => {
    // buildingId=4 = Small Apartment (RESIDENTIAL_HIGH, residents=80)
    // Water: base=0.375 + perCapita=0.0375 * 80 = 3.375; Sewage rate=0.85 → 2.87 per building
    const result = computeAggregates((fn) => {
      fn({ buildingId: 4, zoneType: ZoneType.RESIDENTIAL_HIGH }, 0, 0);
    });
    expect(result.sewage).toBeGreaterThan(0);
  });

  it('skips non-building cells', () => {
    const result = computeAggregates((fn) => {
      fn({ buildingId: 0, zoneType: ZoneType.NONE }, 0, 0);
    });
    expect(result.garbage).toBe(0);
    expect(result.sewage).toBe(0);
  });

  it('accumulates across multiple buildings', () => {
    const single = computeAggregates((fn) => {
      fn({ buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW }, 0, 0);
    });
    const double = computeAggregates((fn) => {
      fn({ buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW }, 0, 0);
      fn({ buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW }, 1, 0);
    });
    expect(double.garbage).toBeCloseTo(single.garbage * 2);
    expect(double.sewage).toBeCloseTo(single.sewage * 2);
  });
});
