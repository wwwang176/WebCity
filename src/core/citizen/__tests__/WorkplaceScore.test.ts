import { describe, it, expect } from 'vitest';
import { scoreWorkplace, scoreCommuteByCost, scoreWorkplaceWithCost, scoreEducationMatch, type WorkplaceCandidate } from '../WorkplaceScore';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel } from '../types';
import { ZoneType } from '../../grid/types';

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

describe('scoreWorkplace', () => {
  it('close to home = high score', () => {
    const citizen = makeCitizen({ homeId: '5,5' });
    const nearScore = scoreWorkplace(citizen, '6,6', ZoneType.COMMERCIAL_LOW);
    const farScore = scoreWorkplace(citizen, '30,30', ZoneType.COMMERCIAL_LOW);
    expect(nearScore).toBeGreaterThan(farScore);
  });

  it('UNIVERSITY education prefers OFFICE', () => {
    const citizen = makeCitizen({
      education: EducationLevel.UNIVERSITY,
      homeId: '10,10',
    });
    const officeScore = scoreWorkplace(citizen, '11,11', ZoneType.OFFICE);
    const industrialScore = scoreWorkplace(citizen, '11,11', ZoneType.INDUSTRIAL);
    expect(officeScore).toBeGreaterThan(industrialScore);
  });

  it('NONE education prefers INDUSTRIAL', () => {
    const citizen = makeCitizen({
      education: EducationLevel.NONE,
      homeId: '10,10',
    });
    const industrialScore = scoreWorkplace(citizen, '11,11', ZoneType.INDUSTRIAL);
    const officeScore = scoreWorkplace(citizen, '11,11', ZoneType.OFFICE);
    expect(industrialScore).toBeGreaterThan(officeScore);
  });

  it('no homeId = commute score is 0, education preference counts', () => {
    const citizen = makeCitizen({
      education: EducationLevel.UNIVERSITY,
      homeId: null,
    });
    // With no home, commute is 0 for both — only education preference matters
    const officeScore = scoreWorkplace(citizen, '5,5', ZoneType.OFFICE);
    const industrialScore = scoreWorkplace(citizen, '5,5', ZoneType.INDUSTRIAL);
    expect(officeScore).toBeGreaterThan(industrialScore);
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
  it('NONE edu + INDUSTRIAL + close commute', () => {
    const citizen = makeCitizen({ education: EducationLevel.NONE });
    const score = scoreWorkplaceWithCost(citizen, ZoneType.INDUSTRIAL, 5);
    // edu match NONE→IND = +10, commute cost 5 → +15
    expect(score).toBe(25);
  });

  it('NONE edu + OFFICE + unreachable', () => {
    const citizen = makeCitizen({ education: EducationLevel.NONE });
    const score = scoreWorkplaceWithCost(citizen, ZoneType.OFFICE, null);
    // edu match NONE→OFFICE = -10, unreachable → -20
    expect(score).toBe(-30);
  });
});

describe('scoreEducationMatch', () => {
  it('UNIVERSITY citizen strongly prefers OFFICE', () => {
    expect(scoreEducationMatch(EducationLevel.UNIVERSITY, ZoneType.OFFICE)).toBe(15);
  });

  it('UNIVERSITY citizen dislikes INDUSTRIAL', () => {
    expect(scoreEducationMatch(EducationLevel.UNIVERSITY, ZoneType.INDUSTRIAL)).toBe(-10);
  });

  it('NONE citizen prefers INDUSTRIAL', () => {
    expect(scoreEducationMatch(EducationLevel.NONE, ZoneType.INDUSTRIAL)).toBe(10);
  });

  it('NONE citizen dislikes OFFICE', () => {
    expect(scoreEducationMatch(EducationLevel.NONE, ZoneType.OFFICE)).toBe(-10);
  });

  it('ELEMENTARY/HIGH_SCHOOL citizen mildly prefers COMMERCIAL', () => {
    expect(scoreEducationMatch(EducationLevel.ELEMENTARY, ZoneType.COMMERCIAL_LOW)).toBe(5);
    expect(scoreEducationMatch(EducationLevel.HIGH_SCHOOL, ZoneType.COMMERCIAL_HIGH)).toBe(5);
  });

  it('education-zone match affects overall workplace score', () => {
    const uneducated = makeCitizen({ education: EducationLevel.NONE, homeId: '10,10' });
    const university = makeCitizen({ education: EducationLevel.UNIVERSITY, homeId: '10,10' });

    const uneducatedOffice = scoreWorkplace(uneducated, '11,11', ZoneType.OFFICE);
    const universityOffice = scoreWorkplace(university, '11,11', ZoneType.OFFICE);
    expect(universityOffice).toBeGreaterThan(uneducatedOffice);
  });
});
