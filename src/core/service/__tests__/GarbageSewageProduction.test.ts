import { describe, it, expect } from 'vitest';
import { calculateGarbageSewageProduction } from '../GarbageSewageProduction';
import { ZoneType } from '../../grid/types';

describe('calculateGarbageSewageProduction', () => {
  it('returns zeros for empty grid', () => {
    const result = calculateGarbageSewageProduction((fn) => {
      // no cells
    });
    expect(result.garbage).toBe(0);
    expect(result.sewage).toBe(0);
  });

  it('calculates garbage for residential buildings', () => {
    // Multiple buildings to exceed Math.floor threshold
    // buildingId=4 = Small Apartment (RESIDENTIAL_HIGH, residents=80)
    // GARBAGE: base=0.05 + perCapita=0.005 * 80 = 0.45 per building, ×3 = 1.35 → floor=1
    const result = calculateGarbageSewageProduction((fn) => {
      fn({ buildingId: 4, zoneType: ZoneType.RESIDENTIAL_HIGH }, 0, 0);
      fn({ buildingId: 4, zoneType: ZoneType.RESIDENTIAL_HIGH }, 1, 0);
      fn({ buildingId: 4, zoneType: ZoneType.RESIDENTIAL_HIGH }, 2, 0);
    });
    expect(result.garbage).toBeGreaterThan(0);
  });

  it('calculates garbage for industrial building', () => {
    // buildingId=13 = Small Factory (INDUSTRIAL, workers=10)
    // GARBAGE: base=0.2 + perCapita=0.01 * 10 = 0.3, ×4 = 1.2 → floor=1
    const result = calculateGarbageSewageProduction((fn) => {
      for (let i = 0; i < 4; i++) fn({ buildingId: 13, zoneType: ZoneType.INDUSTRIAL }, i, 0);
    });
    expect(result.garbage).toBeGreaterThan(0);
  });

  it('calculates sewage from water demand × sewage rate', () => {
    // buildingId=4 = Small Apartment (RESIDENTIAL_HIGH, residents=80)
    // Water: base=0.375 + perCapita=0.0375 * 80 = 3.375; Sewage rate=0.85 → 2.87 per building
    const result = calculateGarbageSewageProduction((fn) => {
      fn({ buildingId: 4, zoneType: ZoneType.RESIDENTIAL_HIGH }, 0, 0);
    });
    expect(result.sewage).toBeGreaterThan(0);
  });

  it('skips non-building cells', () => {
    const result = calculateGarbageSewageProduction((fn) => {
      fn({ buildingId: 0, zoneType: ZoneType.NONE }, 0, 0);
    });
    expect(result.garbage).toBe(0);
    expect(result.sewage).toBe(0);
  });

  it('accumulates across multiple buildings', () => {
    const single = calculateGarbageSewageProduction((fn) => {
      fn({ buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW }, 0, 0);
    });
    const double = calculateGarbageSewageProduction((fn) => {
      fn({ buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW }, 0, 0);
      fn({ buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW }, 1, 0);
    });
    expect(double.garbage).toBeCloseTo(single.garbage * 2);
    expect(double.sewage).toBeCloseTo(single.sewage * 2);
  });
});
