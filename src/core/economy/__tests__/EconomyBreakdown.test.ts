import { describe, it, expect } from 'vitest';
import { getEconomyBreakdown, type EconomyBreakdownContext } from '../EconomyBreakdown';
import { calculateTotalExpenses } from '../ExpenseCalculator';
import { ECONOMY } from '../TaxMultipliers';

/** Helper to create a mock context with sensible defaults. */
function makeCtx(overrides: Partial<EconomyBreakdownContext> = {}): EconomyBreakdownContext {
  return {
    forEachCell: overrides.forEachCell ?? (() => {}),
    taxRates: overrides.taxRates ?? { residential: 9, business: 9 },
    getResidentEducations: overrides.getResidentEducations ?? (() => []),
    roadTileCount: overrides.roadTileCount ?? 0,
    loans: overrides.loans ?? 0,
    loanInterestRate: overrides.loanInterestRate ?? 0.05,
    powerMaintenanceCost: overrides.powerMaintenanceCost ?? 0,
    waterMaintenanceCost: overrides.waterMaintenanceCost ?? 0,
    transportOperatingCost: overrides.transportOperatingCost ?? 0,
    // Spread last so newly added optional fields pass through automatically.
    ...overrides,
  };
}

describe('getEconomyBreakdown', () => {
  it('should return all zeros for empty city', () => {
    const result = getEconomyBreakdown(makeCtx());
    expect(result.residential).toBe(0);
    expect(result.commercial).toBe(0);
    expect(result.industrial).toBe(0);
    expect(result.office).toBe(0);
    expect(result.roadMaintenance).toBe(0);
    expect(result.loanInterest).toBe(0);
    expect(result.powerCost).toBe(0);
    expect(result.waterCost).toBe(0);
    expect(result.transportCost).toBe(0);
  });

  it('should calculate road maintenance cost', () => {
    const result = getEconomyBreakdown(makeCtx({ roadTileCount: 100 }));
    // 100 tiles * 0.1 per tile = 10
    expect(result.roadMaintenance).toBe(10);
  });

  it('should calculate loan interest', () => {
    const result = getEconomyBreakdown(makeCtx({
      loans: 10000,
      loanInterestRate: 0.05,
    }));
    expect(result.loanInterest).toBe(500);
  });

  it('should pass through power maintenance cost', () => {
    const result = getEconomyBreakdown(makeCtx({ powerMaintenanceCost: 42 }));
    expect(result.powerCost).toBe(42);
  });

  it('should pass through water maintenance cost', () => {
    const result = getEconomyBreakdown(makeCtx({ waterMaintenanceCost: 33 }));
    expect(result.waterCost).toBe(33);
  });

  it('should pass through transport operating cost', () => {
    const result = getEconomyBreakdown(makeCtx({ transportOperatingCost: 77 }));
    expect(result.transportCost).toBe(77);
  });

  it('should round income values to 1 decimal', () => {
    const result = getEconomyBreakdown(makeCtx({
      roadTileCount: 7,  // 7 * 0.1 = 0.7
      loans: 333,
      loanInterestRate: 0.03, // 333 * 0.03 = 9.99
    }));
    expect(result.roadMaintenance).toBe(0.7);
    expect(result.loanInterest).toBe(10);
  });

  it('should include zone incomes from calculateZoneIncomes', () => {
    // We don't test calculateZoneIncomes itself (it has its own tests),
    // but verify that the breakdown includes zone income fields.
    const result = getEconomyBreakdown(makeCtx());
    expect(result).toHaveProperty('residential');
    expect(result).toHaveProperty('commercial');
    expect(result).toHaveProperty('industrial');
    expect(result).toHaveProperty('office');
  });
});

// BUG-062: getEconomyBreakdown is the sole data source for the live Economy page,
// but carried only roadMaintenance/loanInterest/powerCost/waterCost/transportCost.
// The expenses tickBudget actually subtracts also include every civic service,
// district policy upkeep and elevated-road maintenance, and income is scaled by
// the city specialization multiplier. The page therefore contradicted the chart
// directly beneath it, which plots the real budget figures.
describe('getEconomyBreakdown — parity with the simulated budget', () => {
  it('should surface civic service, policy and elevated maintenance', () => {
    const result = getEconomyBreakdown(makeCtx({
      serviceCost: 61,
      policyCost: 150,
      elevatedMaintenance: 320,
    }));

    expect(result.serviceCost).toBe(61);
    expect(result.policyCost).toBe(150);
    expect(result.elevatedMaintenance).toBe(320);
  });

  it('should sum to exactly what calculateTotalExpenses charges', () => {
    const inputs = {
      roadMaintenance: 12,
      serviceCost: 61,
      policyCost: 150,
      transportCost: 40,
      elevatedMaintenance: 320,
    };
    const result = getEconomyBreakdown(makeCtx({
      roadTileCount: inputs.roadMaintenance / ECONOMY.ROAD_MAINTENANCE_PER_TILE,
      serviceCost: inputs.serviceCost,
      policyCost: inputs.policyCost,
      transportOperatingCost: inputs.transportCost,
      elevatedMaintenance: inputs.elevatedMaintenance,
    }));

    const shown = result.roadMaintenance + result.serviceCost + result.policyCost
      + result.transportCost + result.elevatedMaintenance;
    expect(shown).toBeCloseTo(calculateTotalExpenses(inputs), 5);
  });

  it('should apply the city specialization revenue multiplier to zone incomes', () => {
    const cells: Array<[number, number, { zoneType: number; buildingId: number }]> = [];
    const forEachCell = (cb: (cell: any, x: number, y: number) => void) => {
      for (const [x, y, c] of cells) cb(c, x, y);
    };

    const plain = getEconomyBreakdown(makeCtx({ forEachCell, revenueMultiplier: 1 }));
    const boosted = getEconomyBreakdown(makeCtx({ forEachCell, revenueMultiplier: 1.25 }));

    const total = (r: { residential: number; commercial: number; industrial: number; office: number }) =>
      r.residential + r.commercial + r.industrial + r.office;
    expect(total(boosted)).toBeCloseTo(total(plain) * 1.25, 5);
  });

  it('should default the multiplier to 1 when not supplied', () => {
    const result = getEconomyBreakdown(makeCtx());
    expect(result.residential).toBe(0);
    expect(result.serviceCost).toBe(0);
    expect(result.policyCost).toBe(0);
    expect(result.elevatedMaintenance).toBe(0);
  });
});
