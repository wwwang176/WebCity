import { describe, it, expect } from 'vitest';
import { ZoneType } from '../../grid/types';
import {
  calculateAbandonmentStress,
  ABANDONMENT,
  type AbandonmentConditions,
} from '../BuildingAbandonment';
import { ABANDONED } from '../InfraPlacement';

/** Default "all good" conditions — should produce recovery. */
function goodConditions(): AbandonmentConditions {
  return {
    businessTaxRate: 9,
    residentialTaxRate: 9,
    isPowered: true,
    isWatered: true,
    crimeRate: 10,
    pollution: 10,
    occupancy: 0.8,
  };
}

describe('BuildingAbandonment — ABANDONED constant', () => {
  it('ABANDONED = 1 (matches BuildingStatus.ABANDONED)', () => {
    expect(ABANDONED).toBe(1);
  });
});

describe('BuildingAbandonment — calculateAbandonmentStress', () => {
  it('all conditions good → recovery (totalDelta = -2)', () => {
    const result = calculateAbandonmentStress(ZoneType.RESIDENTIAL_LOW, goodConditions());
    expect(result.totalDelta).toBe(-ABANDONMENT.RECOVERY_RATE);
    expect(result.factors.tax).toBe(0);
    expect(result.factors.power).toBe(0);
    expect(result.factors.water).toBe(0);
    expect(result.factors.crime).toBe(0);
    expect(result.factors.pollution).toBe(0);
    expect(result.factors.vacancy).toBe(0);
  });

  // --- Tax ---

  it('business tax ≤ 9% → no tax pressure (Commercial)', () => {
    const result = calculateAbandonmentStress(ZoneType.COMMERCIAL_LOW, goodConditions());
    expect(result.factors.tax).toBe(0);
  });

  it('business tax 15% (Commercial) → tax stress = (15-9)*1.5*1.5 = 13.5', () => {
    const cond = { ...goodConditions(), businessTaxRate: 15 };
    const result = calculateAbandonmentStress(ZoneType.COMMERCIAL_LOW, cond);
    expect(result.factors.tax).toBeCloseTo(13.5);
  });

  it('business tax 15% (Industrial) → lower than Commercial (sens 1.0)', () => {
    const cond = { ...goodConditions(), businessTaxRate: 15 };
    const resultI = calculateAbandonmentStress(ZoneType.INDUSTRIAL, cond);
    const resultC = calculateAbandonmentStress(ZoneType.COMMERCIAL_LOW, cond);
    expect(resultI.factors.tax).toBeLessThan(resultC.factors.tax);
    expect(resultI.factors.tax).toBeCloseTo(9); // (15-9)*1.5*1.0
  });

  it('residential tax ≤ 12% → no tax pressure (Residential)', () => {
    const cond = { ...goodConditions(), residentialTaxRate: 12 };
    const result = calculateAbandonmentStress(ZoneType.RESIDENTIAL_LOW, cond);
    expect(result.factors.tax).toBe(0);
  });

  it('residential tax 15% → tax stress = (15-12)*1.0*0.7 = 2.1', () => {
    const cond = { ...goodConditions(), residentialTaxRate: 15 };
    const result = calculateAbandonmentStress(ZoneType.RESIDENTIAL_LOW, cond);
    expect(result.factors.tax).toBeCloseTo(2.1);
  });

  // --- Power ---

  it('no power → +8 stress', () => {
    const cond = { ...goodConditions(), isPowered: false };
    const result = calculateAbandonmentStress(ZoneType.RESIDENTIAL_LOW, cond);
    expect(result.factors.power).toBe(8);
  });

  // --- Water ---

  it('no water → +6 stress', () => {
    const cond = { ...goodConditions(), isWatered: false };
    const result = calculateAbandonmentStress(ZoneType.COMMERCIAL_HIGH, cond);
    expect(result.factors.water).toBe(6);
  });

  // --- Crime ---

  it('crime ≤ 30 → no crime pressure', () => {
    const cond = { ...goodConditions(), crimeRate: 30 };
    const result = calculateAbandonmentStress(ZoneType.COMMERCIAL_LOW, cond);
    expect(result.factors.crime).toBe(0);
  });

  it('crime 50 (Commercial) → (50-30)*0.15*1.3 = 3.9', () => {
    const cond = { ...goodConditions(), crimeRate: 50 };
    const result = calculateAbandonmentStress(ZoneType.COMMERCIAL_LOW, cond);
    expect(result.factors.crime).toBeCloseTo(3.9);
  });

  // --- Pollution ---

  it('pollution ≤ 40 → no pollution pressure', () => {
    const cond = { ...goodConditions(), pollution: 40 };
    const result = calculateAbandonmentStress(ZoneType.RESIDENTIAL_LOW, cond);
    expect(result.factors.pollution).toBe(0);
  });

  it('pollution 60 (Residential) → (60-40)*0.1*1.2 = 2.4', () => {
    const cond = { ...goodConditions(), pollution: 60 };
    const result = calculateAbandonmentStress(ZoneType.RESIDENTIAL_LOW, cond);
    expect(result.factors.pollution).toBeCloseTo(2.4);
  });

  it('pollution 60 (Industrial) → immune (0)', () => {
    const cond = { ...goodConditions(), pollution: 60 };
    const result = calculateAbandonmentStress(ZoneType.INDUSTRIAL, cond);
    expect(result.factors.pollution).toBe(0);
  });

  // --- Vacancy ---

  it('occupancy < 0.1 → +3 vacancy stress', () => {
    const cond = { ...goodConditions(), occupancy: 0.05 };
    const result = calculateAbandonmentStress(ZoneType.OFFICE, cond);
    expect(result.factors.vacancy).toBe(3);
  });

  it('occupancy ≥ 0.1 → no vacancy stress', () => {
    const cond = { ...goodConditions(), occupancy: 0.1 };
    const result = calculateAbandonmentStress(ZoneType.OFFICE, cond);
    expect(result.factors.vacancy).toBe(0);
  });

  // --- Multi-factor ---

  it('multiple factors stack correctly', () => {
    const cond: AbandonmentConditions = {
      businessTaxRate: 15,
      residentialTaxRate: 9,
      isPowered: false,
      isWatered: false,
      crimeRate: 50,
      pollution: 60,
      occupancy: 0.05,
    };
    const result = calculateAbandonmentStress(ZoneType.COMMERCIAL_LOW, cond);
    // tax: (15-9)*1.5*1.5 = 13.5
    // power: 8
    // water: 6
    // crime: (50-30)*0.15*1.3 = 3.9
    // pollution: (60-40)*0.1*1.0 = 2.0
    // vacancy: 3
    const expected = 13.5 + 8 + 6 + 3.9 + 2.0 + 3;
    expect(result.totalDelta).toBeCloseTo(expected);
  });

  it('has any stress factor → no recovery', () => {
    const cond = { ...goodConditions(), isPowered: false };
    const result = calculateAbandonmentStress(ZoneType.RESIDENTIAL_LOW, cond);
    expect(result.totalDelta).toBeGreaterThan(0);
  });

  // --- Zone sensitivity ---

  it('Office pollution sensitivity = 1.2 (not immune)', () => {
    const cond = { ...goodConditions(), pollution: 60 };
    const result = calculateAbandonmentStress(ZoneType.OFFICE, cond);
    expect(result.factors.pollution).toBeCloseTo(2.4); // (60-40)*0.1*1.2
  });

  // --- Threshold constants ---

  it('thresholds have correct values', () => {
    expect(ABANDONMENT.STRESS_DOWNGRADE).toBe(50);
    expect(ABANDONMENT.STRESS_NO_INCOME).toBe(75);
    expect(ABANDONMENT.STRESS_ABANDON).toBe(100);
    expect(ABANDONMENT.RECOVERY_RATE).toBe(2);
  });
});
