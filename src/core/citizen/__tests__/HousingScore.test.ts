import { describe, it, expect } from 'vitest';
import {
  scoreLevelMatch,
  scoreLandValue,
  scorePollution,
  scoreCommute,
  serviceScore,
  scoreHousing,
  POLLUTION_COMBO,
  HOUSING_SCORE,
  type HousingCandidate,
} from '../HousingScore';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel } from '../types';

function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 1,
    birthTick: 0,
    age: 30,
    lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE,
    happiness: 50,
    health: 80,
    homeId: null,
    workplaceId: null,
    unemployedSince: null,
    homelessSince: null,
    emigrationTolerance: 25,
    educationProgress: 0,
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

describe('scoreLevelMatch', () => {
  it('perfect match returns +30', () => {
    // NONE→1, ELEMENTARY→1, HIGH_SCHOOL→2, UNIVERSITY→3
    expect(scoreLevelMatch(EducationLevel.NONE, 1)).toBe(30);
    expect(scoreLevelMatch(EducationLevel.ELEMENTARY, 1)).toBe(30);
    expect(scoreLevelMatch(EducationLevel.HIGH_SCHOOL, 2)).toBe(30);
    expect(scoreLevelMatch(EducationLevel.UNIVERSITY, 3)).toBe(30);
  });

  it('off by 1 returns +10', () => {
    expect(scoreLevelMatch(EducationLevel.NONE, 2)).toBe(10);
    expect(scoreLevelMatch(EducationLevel.HIGH_SCHOOL, 1)).toBe(10);
    expect(scoreLevelMatch(EducationLevel.HIGH_SCHOOL, 3)).toBe(10);
    expect(scoreLevelMatch(EducationLevel.UNIVERSITY, 2)).toBe(10);
  });

  it('off by 2 returns -10', () => {
    expect(scoreLevelMatch(EducationLevel.NONE, 3)).toBe(-10);
    expect(scoreLevelMatch(EducationLevel.UNIVERSITY, 1)).toBe(-10);
  });
});

describe('scoreLandValue', () => {
  it('UNIVERSITY education + high land value = high score', () => {
    const score = scoreLandValue(EducationLevel.UNIVERSITY, 200);
    expect(score).toBeGreaterThan(5);
  });

  it('UNIVERSITY education + low land value = low/negative score', () => {
    const highLV = scoreLandValue(EducationLevel.UNIVERSITY, 200);
    const lowLV = scoreLandValue(EducationLevel.UNIVERSITY, 20);
    expect(highLV).toBeGreaterThan(lowLV);
  });

  it('NONE education + any land value = small difference', () => {
    const highLV = scoreLandValue(EducationLevel.NONE, 200);
    const lowLV = scoreLandValue(EducationLevel.NONE, 20);
    // NONE education citizens don't care much about land value
    expect(Math.abs(highLV - lowLV)).toBeLessThan(10);
  });
});

describe('scorePollution', () => {
  it('high pollution penalizes UNIVERSITY education most', () => {
    const uniEdu = scorePollution(EducationLevel.UNIVERSITY, 200, 100);
    const noneEdu = scorePollution(EducationLevel.NONE, 200, 100);
    expect(uniEdu).toBeLessThan(noneEdu);
  });

  it('zero pollution returns 0 penalty', () => {
    expect(scorePollution(EducationLevel.UNIVERSITY, 0, 0)).toBe(0);
    expect(scorePollution(EducationLevel.NONE, 0, 0)).toBe(0);
  });

  it('returns negative values for polluted areas', () => {
    expect(scorePollution(EducationLevel.HIGH_SCHOOL, 100, 50)).toBeLessThan(0);
  });
});

describe('scoreCommute', () => {
  // How good a commute is follows how long it takes rather than how far it is; see
  // CommuteTimeScoring.test.ts.
  it('a short commute returns +15', () => {
    expect(scoreCommute(15)).toBe(15);
    expect(scoreCommute(0)).toBe(15);
  });

  it('a long commute returns -15', () => {
    expect(scoreCommute(61)).toBe(-15);
  });

  it('mid-range commute returns intermediate score', () => {
    const score = scoreCommute(35);
    expect(score).toBeGreaterThan(-15);
    expect(score).toBeLessThan(15);
  });

  it('unknown commute returns 0', () => {
    expect(scoreCommute(null)).toBe(0);
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
  it('UNIVERSITY education prefers high land value, low pollution, Lv3', () => {
    const citizen = makeCitizen({
      education: EducationLevel.UNIVERSITY,
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

  it('NONE education prefers low commute, Lv1', () => {
    const citizen = makeCitizen({
      education: EducationLevel.NONE,
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

  it('POLLUTION_COMBO weights should sum to 1', () => {
    expect(POLLUTION_COMBO.GROUND_WEIGHT).toBe(0.7);
    expect(POLLUTION_COMBO.NOISE_WEIGHT).toBe(0.3);
    expect(POLLUTION_COMBO.GROUND_WEIGHT + POLLUTION_COMBO.NOISE_WEIGHT).toBeCloseTo(1.0);
  });

  it('HOUSING_SCORE constants should have correct values', () => {
    expect(HOUSING_SCORE.LEVEL_MATCH_EXACT).toBe(30);
    expect(HOUSING_SCORE.LEVEL_MATCH_NEAR).toBe(10);
    expect(HOUSING_SCORE.LEVEL_MATCH_FAR).toBe(-10);
    expect(HOUSING_SCORE.LAND_VALUE_MIDPOINT).toBe(128);
    expect(HOUSING_SCORE.COMMUTE_TIME_NEAR).toBe(15);
    expect(HOUSING_SCORE.COMMUTE_TIME_FAR).toBe(60);
    expect(HOUSING_SCORE.SERVICE_MAX).toBe(6);
    expect(HOUSING_SCORE.PARK_BONUS).toBe(5);
  });
});
