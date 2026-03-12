import { describe, it, expect } from 'vitest';
import { calculateHappiness, HAPPINESS, applyThresholdModifier, type HappinessFactors } from '../Happiness';
import { type Citizen, LifeStage, EducationLevel, IncomeLevel } from '../types';

function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 1,
    age: 30,
    lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE,
    incomeLevel: IncomeLevel.LOW,
    happiness: 50,
    health: 80,
    homeId: null,
    workplaceId: null,
    ...overrides,
  };
}

const baseFactors: HappinessFactors = {
  commuteDistance: 3,
  hasPark: false,
  pollution: 0,
  noiseLevel: 0,
  crimeRate: 0,
  isEmployed: true,
  taxRate: 9,
  serviceCoverage: 3,
};

describe('Happiness', () => {
  it('should give bonus for short commute', () => {
    const h = calculateHappiness(makeCitizen(), { ...baseFactors, commuteDistance: 3 });
    expect(h).toBeGreaterThan(50);
  });

  it('should penalize long commute', () => {
    const h = calculateHappiness(makeCitizen(), { ...baseFactors, commuteDistance: 25 });
    expect(h).toBeLessThan(50);
  });

  it('should give bonus for park', () => {
    const withPark = calculateHappiness(makeCitizen(), { ...baseFactors, hasPark: true });
    const without = calculateHappiness(makeCitizen(), { ...baseFactors, hasPark: false });
    expect(withPark).toBeGreaterThan(without);
  });

  it('should penalize high pollution', () => {
    const h = calculateHappiness(makeCitizen(), { ...baseFactors, pollution: 60 });
    const normal = calculateHappiness(makeCitizen(), baseFactors);
    expect(h).toBeLessThan(normal);
  });

  it('should penalize unemployment', () => {
    const h = calculateHappiness(makeCitizen(), { ...baseFactors, isEmployed: false });
    const employed = calculateHappiness(makeCitizen(), baseFactors);
    expect(h).toBeLessThan(employed);
  });

  it('should trigger emigration when happiness < 20', () => {
    const h = calculateHappiness(makeCitizen(), {
      ...baseFactors,
      commuteDistance: 30,
      pollution: 80,
      crimeRate: 80,
      isEmployed: false,
      taxRate: 20,
      serviceCoverage: 0,
    });
    expect(h).toBeLessThan(20);
  });

  it('HAPPINESS.BASE should be the starting value before modifiers', () => {
    const neutralFactors: HappinessFactors = {
      commuteDistance: 10, hasPark: false, pollution: 0, noiseLevel: 0,
      crimeRate: 0, isEmployed: true, taxRate: 9, serviceCoverage: 0,
    };
    const h = calculateHappiness(makeCitizen(), neutralFactors);
    expect(h).toBe(HAPPINESS.BASE);
  });

  it('HAPPINESS.TAX_BRACKETS should be sorted descending by threshold', () => {
    for (let i = 1; i < HAPPINESS.TAX_BRACKETS.length; i++) {
      expect(HAPPINESS.TAX_BRACKETS[i]!.threshold).toBeLessThan(HAPPINESS.TAX_BRACKETS[i - 1]!.threshold);
    }
  });
});

describe('applyThresholdModifier', () => {
  const thresholds = [
    { threshold: 50, modifier: -10 },
    { threshold: 25, modifier: -5 },
  ];

  it('returns first matching modifier (descending)', () => {
    expect(applyThresholdModifier(60, thresholds)).toBe(-10);
    expect(applyThresholdModifier(51, thresholds)).toBe(-10);
  });

  it('returns second modifier when value exceeds only second threshold', () => {
    expect(applyThresholdModifier(30, thresholds)).toBe(-5);
    expect(applyThresholdModifier(26, thresholds)).toBe(-5);
  });

  it('returns 0 when no threshold is exceeded', () => {
    expect(applyThresholdModifier(10, thresholds)).toBe(0);
    expect(applyThresholdModifier(25, thresholds)).toBe(0);
  });

  it('supports atOrAbove comparison', () => {
    expect(applyThresholdModifier(50, thresholds, 'atOrAbove')).toBe(-10);
    expect(applyThresholdModifier(25, thresholds, 'atOrAbove')).toBe(-5);
    expect(applyThresholdModifier(24, thresholds, 'atOrAbove')).toBe(0);
  });

  it('returns 0 for empty threshold list', () => {
    expect(applyThresholdModifier(100, [])).toBe(0);
  });

  it('HAPPINESS threshold arrays are sorted descending', () => {
    for (const arr of [HAPPINESS.POLLUTION_MODIFIERS, HAPPINESS.CRIME_MODIFIERS, HAPPINESS.SERVICE_MODIFIERS]) {
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i]!.threshold).toBeLessThan(arr[i - 1]!.threshold);
      }
    }
  });
});
