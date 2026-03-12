import { describe, it, expect } from 'vitest';
import {
  canAfford,
  scoreLevelMatch,
  scoreLandValue,
  scorePollution,
  scoreCommute,
  serviceScore,
  scoreHousing,
  type HousingCandidate,
} from '../HousingScore';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel, IncomeLevel } from '../types';

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

function makeCandidate(overrides: Partial<HousingCandidate> = {}): HousingCandidate {
  return {
    pos: '5,5',
    capacity: 10,
    level: 1,
    landValue: 50,
    groundPollution: 0,
    noisePollution: 0,
    serviceCoverage: 3,
    hasPark: false,
    ...overrides,
  };
}

describe('canAfford', () => {
  it('LOW income can live in Lv1 and Lv2 but not Lv3', () => {
    expect(canAfford(IncomeLevel.LOW, 1)).toBe(true);
    expect(canAfford(IncomeLevel.LOW, 2)).toBe(true);
    expect(canAfford(IncomeLevel.LOW, 3)).toBe(false);
  });

  it('MEDIUM income can live in all levels', () => {
    expect(canAfford(IncomeLevel.MEDIUM, 1)).toBe(true);
    expect(canAfford(IncomeLevel.MEDIUM, 2)).toBe(true);
    expect(canAfford(IncomeLevel.MEDIUM, 3)).toBe(true);
  });

  it('HIGH income can live in all levels', () => {
    expect(canAfford(IncomeLevel.HIGH, 1)).toBe(true);
    expect(canAfford(IncomeLevel.HIGH, 2)).toBe(true);
    expect(canAfford(IncomeLevel.HIGH, 3)).toBe(true);
  });
});

describe('scoreLevelMatch', () => {
  it('perfect match returns +30', () => {
    expect(scoreLevelMatch(IncomeLevel.LOW, 1)).toBe(30);
    expect(scoreLevelMatch(IncomeLevel.MEDIUM, 2)).toBe(30);
    expect(scoreLevelMatch(IncomeLevel.HIGH, 3)).toBe(30);
  });

  it('off by 1 returns +10', () => {
    expect(scoreLevelMatch(IncomeLevel.LOW, 2)).toBe(10);
    expect(scoreLevelMatch(IncomeLevel.MEDIUM, 1)).toBe(10);
    expect(scoreLevelMatch(IncomeLevel.MEDIUM, 3)).toBe(10);
    expect(scoreLevelMatch(IncomeLevel.HIGH, 2)).toBe(10);
  });

  it('off by 2 returns -10', () => {
    expect(scoreLevelMatch(IncomeLevel.LOW, 3)).toBe(-10);
    expect(scoreLevelMatch(IncomeLevel.HIGH, 1)).toBe(-10);
  });
});

describe('scoreLandValue', () => {
  it('HIGH income + high land value = high score', () => {
    const score = scoreLandValue(IncomeLevel.HIGH, 200);
    expect(score).toBeGreaterThan(5);
  });

  it('HIGH income + low land value = low/negative score', () => {
    const highLV = scoreLandValue(IncomeLevel.HIGH, 200);
    const lowLV = scoreLandValue(IncomeLevel.HIGH, 20);
    expect(highLV).toBeGreaterThan(lowLV);
  });

  it('LOW income + any land value = small difference', () => {
    const highLV = scoreLandValue(IncomeLevel.LOW, 200);
    const lowLV = scoreLandValue(IncomeLevel.LOW, 20);
    // LOW income citizens don't care much about land value
    expect(Math.abs(highLV - lowLV)).toBeLessThan(10);
  });
});

describe('scorePollution', () => {
  it('high pollution penalizes HIGH income most', () => {
    const highIncome = scorePollution(IncomeLevel.HIGH, 200, 100);
    const lowIncome = scorePollution(IncomeLevel.LOW, 200, 100);
    expect(highIncome).toBeLessThan(lowIncome);
  });

  it('zero pollution returns 0 penalty', () => {
    expect(scorePollution(IncomeLevel.HIGH, 0, 0)).toBe(0);
    expect(scorePollution(IncomeLevel.LOW, 0, 0)).toBe(0);
  });

  it('returns negative values for polluted areas', () => {
    expect(scorePollution(IncomeLevel.MEDIUM, 100, 50)).toBeLessThan(0);
  });
});

describe('scoreCommute', () => {
  it('distance <= 5 returns +15', () => {
    expect(scoreCommute('5,5', '7,8')).toBe(15); // manhattan = 5
    expect(scoreCommute('5,5', '5,5')).toBe(15); // manhattan = 0
    expect(scoreCommute('5,5', '10,5')).toBe(15); // manhattan = 5
  });

  it('distance > 20 returns -15', () => {
    expect(scoreCommute('0,0', '15,10')).toBe(-15); // manhattan = 25
  });

  it('mid-range distance returns intermediate score', () => {
    const score = scoreCommute('0,0', '10,0'); // manhattan = 10
    expect(score).toBeGreaterThan(-15);
    expect(score).toBeLessThan(15);
  });

  it('null homeId returns 0', () => {
    expect(scoreCommute(null, '5,5')).toBe(0);
  });
});

describe('serviceScore', () => {
  it('full services + park = +15', () => {
    expect(serviceScore(6, true)).toBe(15);
  });

  it('no services, no park = 0', () => {
    expect(serviceScore(0, false)).toBe(0);
  });

  it('some services without park', () => {
    const score = serviceScore(3, false);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(15);
  });

  it('park alone gives bonus', () => {
    expect(serviceScore(0, true)).toBeGreaterThan(serviceScore(0, false));
  });
});

describe('scoreHousing (integration)', () => {
  it('HIGH income prefers high land value, low pollution, Lv3', () => {
    const citizen = makeCitizen({
      incomeLevel: IncomeLevel.HIGH,
      workplaceId: '10,10',
    });

    const luxury = makeCandidate({
      pos: '11,11',
      level: 3,
      landValue: 200,
      groundPollution: 0,
      noisePollution: 0,
      serviceCoverage: 5,
      hasPark: true,
    });

    const basic = makeCandidate({
      pos: '12,12',
      level: 1,
      landValue: 20,
      groundPollution: 100,
      noisePollution: 80,
      serviceCoverage: 1,
      hasPark: false,
    });

    const luxuryScore = scoreHousing(citizen, luxury);
    const basicScore = scoreHousing(citizen, basic);
    expect(luxuryScore).toBeGreaterThan(basicScore);
  });

  it('LOW income prefers low commute, Lv1', () => {
    const citizen = makeCitizen({
      incomeLevel: IncomeLevel.LOW,
      workplaceId: '5,5',
    });

    const nearby = makeCandidate({
      pos: '6,6',
      level: 1,
      landValue: 30,
      groundPollution: 10,
      noisePollution: 10,
      serviceCoverage: 3,
      hasPark: false,
    });

    const farAway = makeCandidate({
      pos: '30,30',
      level: 1,
      landValue: 30,
      groundPollution: 10,
      noisePollution: 10,
      serviceCoverage: 3,
      hasPark: false,
    });

    const nearbyScore = scoreHousing(citizen, nearby);
    const farScore = scoreHousing(citizen, farAway);
    expect(nearbyScore).toBeGreaterThan(farScore);
  });

  it('returns a number for citizen with no workplace', () => {
    const citizen = makeCitizen({ workplaceId: null });
    const candidate = makeCandidate();
    const score = scoreHousing(citizen, candidate);
    expect(typeof score).toBe('number');
    expect(Number.isFinite(score)).toBe(true);
  });
});
