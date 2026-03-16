import { describe, it, expect } from 'vitest';
import { scoreWorkplace, scoreCommuteByCost, scoreWorkplaceWithCost, type WorkplaceCandidate } from '../WorkplaceScore';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel, IncomeLevel } from '../types';
import { ZoneType } from '../../grid/types';

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

describe('scoreWorkplace', () => {
  it('close to home = high score', () => {
    const citizen = makeCitizen({ homeId: '5,5' });
    const nearScore = scoreWorkplace(citizen, '6,6', ZoneType.COMMERCIAL_LOW);
    const farScore = scoreWorkplace(citizen, '30,30', ZoneType.COMMERCIAL_LOW);
    expect(nearScore).toBeGreaterThan(farScore);
  });

  it('HIGH income prefers OFFICE', () => {
    const citizen = makeCitizen({
      incomeLevel: IncomeLevel.HIGH,
      homeId: '10,10',
    });
    const officeScore = scoreWorkplace(citizen, '11,11', ZoneType.OFFICE);
    const industrialScore = scoreWorkplace(citizen, '11,11', ZoneType.INDUSTRIAL);
    expect(officeScore).toBeGreaterThan(industrialScore);
  });

  it('LOW income prefers INDUSTRIAL', () => {
    const citizen = makeCitizen({
      incomeLevel: IncomeLevel.LOW,
      homeId: '10,10',
    });
    const industrialScore = scoreWorkplace(citizen, '11,11', ZoneType.INDUSTRIAL);
    const officeScore = scoreWorkplace(citizen, '11,11', ZoneType.OFFICE);
    expect(industrialScore).toBeGreaterThan(officeScore);
  });

  it('no homeId = commute score is 0, only zone preference counts', () => {
    const citizen = makeCitizen({
      incomeLevel: IncomeLevel.HIGH,
      homeId: null,
    });
    // With no home, commute is 0 for both — only zone preference matters
    const officeScore = scoreWorkplace(citizen, '5,5', ZoneType.OFFICE);
    const industrialScore = scoreWorkplace(citizen, '5,5', ZoneType.INDUSTRIAL);
    expect(officeScore).toBeGreaterThan(industrialScore);
  });

  it('MEDIUM income has moderate preference for COMMERCIAL', () => {
    const citizen = makeCitizen({
      incomeLevel: IncomeLevel.MEDIUM,
      homeId: '10,10',
    });
    const commercialScore = scoreWorkplace(citizen, '11,11', ZoneType.COMMERCIAL_LOW);
    const industrialScore = scoreWorkplace(citizen, '11,11', ZoneType.INDUSTRIAL);
    expect(commercialScore).toBeGreaterThan(industrialScore);
  });

  it('returns a finite number', () => {
    const citizen = makeCitizen();
    const score = scoreWorkplace(citizen, '5,5', ZoneType.COMMERCIAL_HIGH);
    expect(typeof score).toBe('number');
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe('scoreCommuteByCost', () => {
  it('unreachable (null) returns -20', () => {
    expect(scoreCommuteByCost(null)).toBe(-20);
  });

  it('very close (cost <= 10) returns +15', () => {
    expect(scoreCommuteByCost(0)).toBe(15);
    expect(scoreCommuteByCost(5)).toBe(15);
    expect(scoreCommuteByCost(10)).toBe(15);
  });

  it('very far (cost > 40) returns -15', () => {
    expect(scoreCommuteByCost(41)).toBe(-15);
    expect(scoreCommuteByCost(100)).toBe(-15);
  });

  it('mid-range linearly interpolates', () => {
    // cost=25 → 15 - (25-10) * (30/30) = 15 - 15 = 0
    expect(scoreCommuteByCost(25)).toBe(0);
  });
});

describe('scoreWorkplaceWithCost', () => {
  it('LOW income + INDUSTRIAL + close commute', () => {
    const citizen = makeCitizen({ incomeLevel: IncomeLevel.LOW });
    const score = scoreWorkplaceWithCost(citizen, ZoneType.INDUSTRIAL, 5);
    // INDUSTRIAL pref for LOW = 20, commute cost 5 → +15
    expect(score).toBe(35);
  });

  it('HIGH income + OFFICE + unreachable', () => {
    const citizen = makeCitizen({ incomeLevel: IncomeLevel.HIGH });
    const score = scoreWorkplaceWithCost(citizen, ZoneType.OFFICE, null);
    // OFFICE pref for HIGH = 20, unreachable → -20
    expect(score).toBe(0);
  });
});
