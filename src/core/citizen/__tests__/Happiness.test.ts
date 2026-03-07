import { describe, it, expect } from 'vitest';
import { calculateHappiness, type HappinessFactors } from '../Happiness';
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
});
