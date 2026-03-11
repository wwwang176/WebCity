import { describe, it, expect } from 'vitest';
import { calculateRCIDemand, RCI } from '../RCIDemand';
import { calculateBalance, takeLoan, tickBudget } from '../Budget';
import { calculateTaxRevenue, DEFAULT_TAX_RATES } from '../Tax';
import { calculateLandValue, LAND_VALUE } from '../LandValue';

describe('RCIDemand', () => {
  it('should have positive R demand for empty city', () => {
    const demand = calculateRCIDemand({
      residentialSupply: 0, commercialSupply: 0, industrialSupply: 0,
      population: 0, jobOpenings: 10, exportDemand: 0,
    });
    expect(demand.residential).toBeGreaterThan(0);
  });

  it('should increase C demand when population rises', () => {
    const low = calculateRCIDemand({
      residentialSupply: 10, commercialSupply: 10, industrialSupply: 10,
      population: 10, jobOpenings: 10, exportDemand: 0,
    });
    const high = calculateRCIDemand({
      residentialSupply: 10, commercialSupply: 10, industrialSupply: 10,
      population: 100, jobOpenings: 10, exportDemand: 0,
    });
    expect(high.commercial).toBeGreaterThan(low.commercial);
  });

  it('should clamp values between -100 and 100', () => {
    const demand = calculateRCIDemand({
      residentialSupply: 10000, commercialSupply: 0, industrialSupply: 0,
      population: 0, jobOpenings: 0, exportDemand: 0,
    });
    expect(demand.residential).toBeGreaterThanOrEqual(RCI.DEMAND_MIN);
    expect(demand.residential).toBeLessThanOrEqual(RCI.DEMAND_MAX);
  });

  it('RCI constants should have valid ranges', () => {
    expect(RCI.JOB_MULTIPLIER).toBeGreaterThan(0);
    expect(RCI.RESIDENTIAL_BASE).toBeGreaterThan(0);
    expect(RCI.DEMAND_MIN).toBeLessThan(0);
    expect(RCI.DEMAND_MAX).toBeGreaterThan(0);
  });
});

describe('Budget', () => {
  it('should calculate balance', () => {
    const balance = calculateBalance({
      funds: 10000, income: 500, expenses: 300, loans: 0, loanInterestRate: 0.05,
    });
    expect(balance).toBe(200);
  });

  it('should deduct loan interest', () => {
    const balance = calculateBalance({
      funds: 10000, income: 500, expenses: 300, loans: 10000, loanInterestRate: 0.05,
    });
    expect(balance).toBe(-300); // 500 - 300 - 500
  });

  it('should add funds when taking a loan', () => {
    const budget = takeLoan({
      funds: 5000, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05,
    }, 10000);
    expect(budget.funds).toBe(15000);
    expect(budget.loans).toBe(10000);
  });

  it('should update funds on tick', () => {
    const result = tickBudget({
      funds: 10000, income: 500, expenses: 300, loans: 0, loanInterestRate: 0.05,
    });
    expect(result.funds).toBe(10200);
  });
});

describe('Tax', () => {
  it('should calculate tax revenue', () => {
    const revenue = calculateTaxRevenue(
      { residential: 10, commercial: 5, industrial: 3, office: 2 },
      { residential: 10, commercial: 15, industrial: 20, office: 60 },
      DEFAULT_TAX_RATES,
    );
    expect(revenue).toBeGreaterThan(0);
  });

  it('should increase revenue with higher tax rate', () => {
    const base = { residential: 10, commercial: 0, industrial: 0, office: 0 };
    const baseTax = { residential: 10, commercial: 0, industrial: 0, office: 0 };
    const low = calculateTaxRevenue(base, baseTax, { ...DEFAULT_TAX_RATES, residential: 5 });
    const high = calculateTaxRevenue(base, baseTax, { ...DEFAULT_TAX_RATES, residential: 15 });
    expect(high).toBeGreaterThan(low);
  });
});

describe('LandValue', () => {
  it('should be higher near parks', () => {
    const withPark = calculateLandValue({
      serviceCoverage: 3, parkProximity: true, waterfront: false,
      pollution: 0, noise: 0, crimeRate: 0,
    });
    const without = calculateLandValue({
      serviceCoverage: 3, parkProximity: false, waterfront: false,
      pollution: 0, noise: 0, crimeRate: 0,
    });
    expect(withPark).toBeGreaterThan(without);
  });

  it('should be lower with high pollution', () => {
    const clean = calculateLandValue({
      serviceCoverage: 3, parkProximity: false, waterfront: false,
      pollution: 0, noise: 0, crimeRate: 0,
    });
    const polluted = calculateLandValue({
      serviceCoverage: 3, parkProximity: false, waterfront: false,
      pollution: 80, noise: 0, crimeRate: 0,
    });
    expect(polluted).toBeLessThan(clean);
  });

  it('LAND_VALUE.BASE should equal land value with no modifiers', () => {
    const base = calculateLandValue({
      serviceCoverage: 0, parkProximity: false, waterfront: false,
      pollution: 0, noise: 0, crimeRate: 0,
    });
    expect(base).toBe(LAND_VALUE.BASE);
  });

  it('should clamp between LAND_VALUE.MIN and LAND_VALUE.MAX', () => {
    const extreme = calculateLandValue({
      serviceCoverage: 0, parkProximity: false, waterfront: false,
      pollution: 999, noise: 999, crimeRate: 999,
    });
    expect(extreme).toBe(LAND_VALUE.MIN);
  });
});
