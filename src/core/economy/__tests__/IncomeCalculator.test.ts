import { describe, it, expect } from 'vitest';
import { calculateZoneIncomes, calculateBuildingIncome, type IncomeCalcDeps, type BuildingIncomeDeps } from '../IncomeCalculator';
import { ZoneType } from '../../grid/types';
import { EducationLevel } from '../../citizen/types';

function makeDeps(overrides: Partial<IncomeCalcDeps> = {}): IncomeCalcDeps {
  return {
    forEachCell: overrides.forEachCell ?? (() => {}),
    taxRates: overrides.taxRates ?? { residential: 9, business: 9 },
    getResidentEducations: overrides.getResidentEducations ?? (() => []),
    isPowered: overrides.isPowered,
  };
}

describe('calculateZoneIncomes', () => {
  it('returns all zeros when grid is empty', () => {
    const result = calculateZoneIncomes(makeDeps());
    expect(result.residential).toBe(0);
    expect(result.commercial).toBe(0);
    expect(result.industrial).toBe(0);
    expect(result.office).toBe(0);
  });

  it('calculates residential income from resident count', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        // Simulate a residential building at (1,1) with buildingId=1, zoneType=RESIDENTIAL_LOW
        fn({ buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW, reserved: 0 }, 1, 1);
      },
      taxRates: { residential: 10, business: 9 },
      getResidentEducations: (key) => key === '1,1' ? [EducationLevel.NONE] : [],
    });
    const result = calculateZoneIncomes(deps);
    expect(result.residential).toBeGreaterThan(0);
    expect(result.commercial).toBe(0);
  });

  it('calculates commercial income from building companyIncome', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        // buildingId 7 = Small Shop, COMMERCIAL_LOW level 1 (companyIncome=10)
        fn({ buildingId: 7, zoneType: ZoneType.COMMERCIAL_LOW, reserved: 0 }, 2, 2);
      },
      taxRates: { residential: 9, business: 10 },
    });
    const result = calculateZoneIncomes(deps);
    expect(result.commercial).toBeGreaterThan(0);
    expect(result.residential).toBe(0);
  });

  it('calculates industrial income separately from commercial', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        // buildingId 13 = Small Factory, INDUSTRIAL level 1 (companyIncome=15)
        fn({ buildingId: 13, zoneType: ZoneType.INDUSTRIAL, reserved: 0 }, 3, 3);
      },
      taxRates: { residential: 9, business: 10 },
    });
    const result = calculateZoneIncomes(deps);
    expect(result.industrial).toBeGreaterThan(0);
    expect(result.commercial).toBe(0);
  });

  it('skips burned buildings (reserved=3)', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        fn({ buildingId: 7, zoneType: ZoneType.COMMERCIAL_LOW, reserved: 3 }, 0, 0);
      },
    });
    const result = calculateZoneIncomes(deps);
    expect(result.commercial).toBe(0);
  });

  it('skips multi-cell occupied buildings (reserved=4)', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        // MULTI_CELL_OCCUPIED = 4
        fn({ buildingId: 7, zoneType: ZoneType.COMMERCIAL_LOW, reserved: 4 }, 0, 0);
      },
    });
    const result = calculateZoneIncomes(deps);
    expect(result.commercial).toBe(0);
  });

  it('returns zero for infrastructure buildings', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        // buildingId 252 = police station (infrastructure, not a zone building)
        fn({ buildingId: 252, zoneType: 0, reserved: 0 }, 0, 0);
      },
    });
    const result = calculateZoneIncomes(deps);
    expect(result.residential).toBe(0);
    expect(result.commercial).toBe(0);
  });

  it('scales income with tax rate', () => {
    const makeTaxDeps = (rate: number) => makeDeps({
      forEachCell: (fn) => {
        // buildingId 7 = Small Shop, COMMERCIAL_LOW
        fn({ buildingId: 7, zoneType: ZoneType.COMMERCIAL_LOW, reserved: 0 }, 0, 0);
      },
      taxRates: { residential: 9, business: rate },
    });
    const low = calculateZoneIncomes(makeTaxDeps(5));
    const high = calculateZoneIncomes(makeTaxDeps(15));
    expect(high.commercial).toBeGreaterThan(low.commercial);
  });

  it('unpowered buildings produce zero income', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        fn({ buildingId: 7, zoneType: ZoneType.COMMERCIAL_LOW, reserved: 0 }, 2, 2);
      },
      taxRates: { residential: 9, business: 10 },
      isPowered: () => false,
    });
    const result = calculateZoneIncomes(deps);
    expect(result.commercial).toBe(0);
  });

  it('powered buildings produce normal income', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        fn({ buildingId: 7, zoneType: ZoneType.COMMERCIAL_LOW, reserved: 0 }, 2, 2);
      },
      taxRates: { residential: 9, business: 10 },
      isPowered: () => true,
    });
    const result = calculateZoneIncomes(deps);
    expect(result.commercial).toBeGreaterThan(0);
  });

  it('unpowered residential buildings produce zero income', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        fn({ buildingId: 1, zoneType: ZoneType.RESIDENTIAL_LOW, reserved: 0 }, 1, 1);
      },
      taxRates: { residential: 10, business: 9 },
      getResidentEducations: (key) => key === '1,1' ? [EducationLevel.NONE] : [],
      isPowered: () => false,
    });
    const result = calculateZoneIncomes(deps);
    expect(result.residential).toBe(0);
  });

  it('defaults to powered when isPowered not provided (backward compat)', () => {
    const deps = makeDeps({
      forEachCell: (fn) => {
        fn({ buildingId: 7, zoneType: ZoneType.COMMERCIAL_LOW, reserved: 0 }, 0, 0);
      },
      taxRates: { residential: 9, business: 10 },
    });
    const result = calculateZoneIncomes(deps);
    expect(result.commercial).toBeGreaterThan(0);
  });
});

describe('calculateBuildingIncome (DRY extraction)', () => {
  function makeBldDeps(overrides: Partial<BuildingIncomeDeps> = {}): BuildingIncomeDeps {
    return {
      taxRates: overrides.taxRates ?? { residential: 9, business: 9 },
      getResidentEducations: overrides.getResidentEducations ?? (() => []),
      isPowered: overrides.isPowered,
      getRevenueMultiplier: overrides.getRevenueMultiplier,
      getFreightSupply: overrides.getFreightSupply,
      freightSurplusRatio: overrides.freightSurplusRatio,
      isExporting: overrides.isExporting,
      getWorkerCount: overrides.getWorkerCount,
    };
  }

  it('returns 0 for unpowered building', () => {
    const deps = makeBldDeps({ isPowered: () => false });
    expect(calculateBuildingIncome(deps, 0, 0, 7)).toBe(0);
  });

  it('returns 0 for invalid buildingId', () => {
    const deps = makeBldDeps();
    expect(calculateBuildingIncome(deps, 0, 0, 99999)).toBe(0);
  });

  it('calculates residential income from education', () => {
    const deps = makeBldDeps({
      taxRates: { residential: 10, business: 9 },
      getResidentEducations: () => [EducationLevel.NONE, EducationLevel.UNIVERSITY],
    });
    const income = calculateBuildingIncome(deps, 1, 1, 1);
    expect(income).toBeGreaterThan(0);
  });

  it('calculates commercial income from companyIncome', () => {
    const deps = makeBldDeps({
      taxRates: { residential: 9, business: 10 },
    });
    // buildingId 7 = Small Shop, COMMERCIAL_LOW
    const income = calculateBuildingIncome(deps, 2, 2, 7);
    expect(income).toBeGreaterThan(0);
  });

  it('applies revenue multiplier', () => {
    const base = makeBldDeps({ taxRates: { residential: 9, business: 10 } });
    const boosted = makeBldDeps({
      taxRates: { residential: 9, business: 10 },
      getRevenueMultiplier: () => 2.0,
    });
    const baseInc = calculateBuildingIncome(base, 0, 0, 7);
    const boostInc = calculateBuildingIncome(boosted, 0, 0, 7);
    expect(boostInc).toBeCloseTo(baseInc * 2.0);
  });

  it('matches calculateZoneIncomes for a single building', () => {
    // Verify DRY: single building income from shared function matches zone total
    const deps = makeDeps({
      forEachCell: (fn) => {
        fn({ buildingId: 13, zoneType: ZoneType.INDUSTRIAL, reserved: 0 }, 3, 3);
      },
      taxRates: { residential: 9, business: 10 },
    });
    const zoneResult = calculateZoneIncomes(deps);
    const singleResult = calculateBuildingIncome(
      { taxRates: { residential: 9, business: 10 }, getResidentEducations: () => [] },
      3, 3, 13,
    );
    expect(zoneResult.industrial).toBeCloseTo(singleResult);
  });
});
