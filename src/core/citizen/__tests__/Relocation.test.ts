import { describe, it, expect } from 'vitest';
import {
  relocationTick,
  DEFAULT_RELOCATION_CONFIG,
  type RelocationConfig,
} from '../Relocation';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel, IncomeLevel } from '../types';
import type { HousingCandidate } from '../HousingScore';

function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 1,
    birthTick: 0,
    age: 30,
    lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE,
    incomeLevel: IncomeLevel.MEDIUM,
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
    level: 2,
    landValue: 100,
    groundPollution: 0,
    noisePollution: 0,
    serviceCoverage: 4,
    hasPark: false,
    ...overrides,
  };
}

describe('relocationTick', () => {
  it('happiness >= threshold — citizens do not relocate', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      happiness: 50,
      homeId: '1,1',
      incomeLevel: IncomeLevel.MEDIUM,
    });
    const candidates: HousingCandidate[] = [
      makeCandidate({ pos: '1,1', level: 2 }),
      makeCandidate({ pos: '5,5', level: 2, landValue: 200, serviceCoverage: 6, hasPark: true }),
    ];
    const occupancy = new Map<string, number>([['1,1', 1]]);

    const { count } = relocationTick([citizen], candidates, occupancy);

    expect(count).toBe(0);
    expect(citizen.homeId).toBe('1,1');
  });

  it('happiness < threshold + better housing (gap > scoreGap) — relocates', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      happiness: 20,
      homeId: '1,1',
      incomeLevel: IncomeLevel.MEDIUM,
      workplaceId: '5,5',
    });
    // Current home: bad (polluted, no services)
    const currentHome = makeCandidate({
      pos: '1,1', level: 2, landValue: 20, groundPollution: 200,
      noisePollution: 150, serviceCoverage: 0,
    });
    // Better option: great (near work, clean, good services)
    const betterHome = makeCandidate({
      pos: '5,6', capacity: 10, level: 2, landValue: 200,
      serviceCoverage: 6, hasPark: true,
    });
    const candidates = [currentHome, betterHome];
    const occupancy = new Map<string, number>([['1,1', 1]]);

    const { count } = relocationTick([citizen], candidates, occupancy);

    expect(count).toBe(1);
    expect(citizen.homeId).toBe('5,6');
    expect(occupancy.get('1,1')).toBe(0);
    expect(occupancy.get('5,6')).toBe(1);
  });

  it('score gap insufficient — does not relocate', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      happiness: 20,
      homeId: '5,5',
      incomeLevel: IncomeLevel.MEDIUM,
    });
    // Both homes are very similar
    const candidates: HousingCandidate[] = [
      makeCandidate({ pos: '5,5', level: 2, landValue: 100 }),
      makeCandidate({ pos: '5,6', level: 2, landValue: 105 }),
    ];
    const occupancy = new Map<string, number>([['5,5', 1]]);

    const { count } = relocationTick([citizen], candidates, occupancy);

    expect(count).toBe(0);
    expect(citizen.homeId).toBe('5,5');
  });

  it('after relocation: old building occupancy -1, new building +1', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      happiness: 10,
      homeId: '1,1',
      incomeLevel: IncomeLevel.MEDIUM,
      workplaceId: '10,10',
    });
    const candidates: HousingCandidate[] = [
      makeCandidate({ pos: '1,1', level: 2, groundPollution: 200, noisePollution: 200, landValue: 10 }),
      makeCandidate({ pos: '10,10', level: 2, landValue: 200, serviceCoverage: 6, hasPark: true }),
    ];
    const occupancy = new Map<string, number>([['1,1', 3]]);

    relocationTick([citizen], candidates, occupancy);

    expect(occupancy.get('1,1')).toBe(2); // decreased
    expect(occupancy.get('10,10')).toBe(1); // increased
  });

  it('max 5% of unhappy citizens relocate per tick', () => {
    // 100 unhappy citizens, max 5% = 5 should relocate
    const citizens = Array.from({ length: 100 }, (_, i) => makeCitizen({
      id: i,
      happiness: 10,
      homeId: '1,1',
      incomeLevel: IncomeLevel.MEDIUM,
      workplaceId: '10,10',
    }));
    const candidates: HousingCandidate[] = [
      makeCandidate({ pos: '1,1', capacity: 200, level: 2, groundPollution: 200, noisePollution: 200, landValue: 10 }),
      makeCandidate({ pos: '10,10', capacity: 200, level: 2, landValue: 200, serviceCoverage: 6, hasPark: true }),
    ];
    const occupancy = new Map<string, number>([['1,1', 100]]);

    const { count } = relocationTick(citizens, candidates, occupancy);

    expect(count).toBeLessThanOrEqual(5);
    expect(count).toBeGreaterThan(0);
  });

  it('relocation respects affordability', () => {
    const citizen = makeCitizen({
      id: 1,
    birthTick: 0,
      happiness: 10,
      homeId: '1,1',
      incomeLevel: IncomeLevel.LOW,
      workplaceId: '10,10',
    });
    const candidates: HousingCandidate[] = [
      makeCandidate({ pos: '1,1', level: 1, groundPollution: 200, landValue: 10 }),
      // Only Lv3 available — LOW income can't afford
      makeCandidate({ pos: '10,10', level: 3, landValue: 200, serviceCoverage: 6, hasPark: true }),
    ];
    const occupancy = new Map<string, number>([['1,1', 1]]);

    const { count } = relocationTick([citizen], candidates, occupancy);

    // Cannot relocate because the only other option is not affordable
    expect(count).toBe(0);
    expect(citizen.homeId).toBe('1,1');
  });

  it('citizens without homeId are skipped', () => {
    const citizen = makeCitizen({ id: 1, happiness: 10, homeId: null });
    const candidates: HousingCandidate[] = [
      makeCandidate({ pos: '5,5' }),
    ];
    const occupancy = new Map<string, number>();

    const { count } = relocationTick([citizen], candidates, occupancy);

    expect(count).toBe(0);
    expect(citizen.homeId).toBeNull();
  });

  it('returns 0 when no candidates available', () => {
    const citizen = makeCitizen({ id: 1, happiness: 10, homeId: '1,1' });
    const occupancy = new Map<string, number>([['1,1', 1]]);

    const { count } = relocationTick([citizen], [], occupancy);

    expect(count).toBe(0);
  });

  it('DEFAULT_RELOCATION_CONFIG has expected values', () => {
    expect(DEFAULT_RELOCATION_CONFIG.happinessThreshold).toBe(35);
    expect(DEFAULT_RELOCATION_CONFIG.scoreGap).toBe(20);
    expect(DEFAULT_RELOCATION_CONFIG.maxRelocateRatio).toBe(0.05);
    expect(DEFAULT_RELOCATION_CONFIG.tickInterval).toBe(60);
  });
});
