import { describe, it, expect } from 'vitest';
import { getEconomyBreakdown, type EconomyBreakdownContext } from '../EconomyBreakdown';

/** Helper to create a mock context with sensible defaults. */
function makeCtx(overrides: Partial<EconomyBreakdownContext> = {}): EconomyBreakdownContext {
  return {
    forEachCell: overrides.forEachCell ?? (() => {}),
    taxRates: overrides.taxRates ?? { residential: 9, business: 9 },
    getCitizensByHome: overrides.getCitizensByHome ?? (() => []),
    roadTileCount: overrides.roadTileCount ?? 0,
    loans: overrides.loans ?? 0,
    loanInterestRate: overrides.loanInterestRate ?? 0.05,
    powerMaintenanceCost: overrides.powerMaintenanceCost ?? 0,
    waterMaintenanceCost: overrides.waterMaintenanceCost ?? 0,
    transportOperatingCost: overrides.transportOperatingCost ?? 0,
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
