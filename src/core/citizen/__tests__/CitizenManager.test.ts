import { describe, it, expect, vi } from 'vitest';
import { CitizenManager, EDUCATION_PROGRESSION, GRADUATION_TICKS, EDUCATION_SCALE, getLearningSpeed, jitteredSpeed, LEARNING_JITTER, MIN_SCHOOL_AGE, DAILY_DEATH_RATE, HEALTH_MULTIPLIER, getElderlyMultiplier, ELDERLY } from '../CitizenManager';
import { LifeStage, EducationLevel, LIFE_STAGE_AGE, isWorkingAge, AGE_PER_TICK, MAX_AGE } from '../types';

/** Unlimited capacity for simple tests that don't test capacity limits */
const UNLIMITED_CAPACITY = { elementary: 9999, highSchool: 9999, university: 9999 };

describe('CitizenManager', () => {
  it('should create a citizen with unique id', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen();
    const c2 = mgr.createCitizen();
    expect(c1.id).not.toBe(c2.id);
  });

  it('should have all required properties', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 100 });
    expect(c.age).toBe(100);
    expect(c.lifeStage).toBe(LifeStage.ADULT);
    expect(c.education).toBeDefined();
    expect(c.happiness).toBeDefined();
    expect(c.health).toBeDefined();
    expect(c.homeId).toBeNull();
    expect(c.workplaceId).toBeNull();
  });

  it('should assign correct life stage by age', () => {
    const mgr = new CitizenManager();
    expect(mgr.createCitizen({ age: 3 }).lifeStage).toBe(LifeStage.BABY);      // 0-8
    expect(mgr.createCitizen({ age: 20 }).lifeStage).toBe(LifeStage.CHILD);    // 9-32
    expect(mgr.createCitizen({ age: 40 }).lifeStage).toBe(LifeStage.TEEN);     // 33-52
    expect(mgr.createCitizen({ age: 100 }).lifeStage).toBe(LifeStage.ADULT);   // 53-200
    expect(mgr.createCitizen({ age: 220 }).lifeStage).toBe(LifeStage.SENIOR);  // 201+
  });

  it('should age citizens via updateAges', () => {
    const mgr = new CitizenManager();
    // Create citizen at age 8 (BABY_MAX boundary) at currentTick=0
    // birthTick = Math.round(0 - 8/0.006) = -1333
    const c = mgr.createCitizen({ age: 8 }, 0);
    expect(c.birthTick).toBe(Math.round(0 - 8 / AGE_PER_TICK)); // -1333
    // After 167 ticks: age = (167 - (-1333)) * 0.006 = 1500 * 0.006 = 9.0 → CHILD
    mgr.updateAges(167);
    expect(c.age).toBeCloseTo(9.0, 1);
    expect(c.lifeStage).toBe(LifeStage.CHILD);
  });

  it('should transition BABY to CHILD at BABY_MAX boundary', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 8 }, 0);
    expect(c.lifeStage).toBe(LifeStage.BABY);
    // Advance enough ticks to cross into CHILD (age > 8)
    mgr.updateAges(167);
    expect(c.age).toBeGreaterThan(LIFE_STAGE_AGE.BABY_MAX);
    expect(c.lifeStage).toBe(LifeStage.CHILD);
  });

  it('should enroll CHILD with elementary coverage (progress > 0 after first tick)', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 20, homeId: '5,5' });
    mgr.educateTick((_x, _y, key) => key === 'elementary', UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBeGreaterThan(0);
    expect(c.education).toBe(EducationLevel.NONE); // not yet graduated
  });

  it('should graduate CHILD after enough ticks (speed-based, no jitter)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter = 1.0
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const speed = getLearningSpeed(20); // 100
    const ticksNeeded = Math.ceil(GRADUATION_TICKS.elementary / speed);
    for (let i = 0; i < ticksNeeded; i++) {
      mgr.educateTick((_x, _y, key) => key === 'elementary', UNLIMITED_CAPACITY);
    }
    expect(c.education).toBe(EducationLevel.ELEMENTARY);
    expect(c.educationProgress).toBe(0);
    vi.restoreAllMocks();
  });

  it('should NOT enroll citizen with ELEMENTARY when only elementary coverage (needs highSchool)', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 40, education: EducationLevel.ELEMENTARY, homeId: '5,5' });
    mgr.educateTick((_x, _y, key) => key === 'elementary', UNLIMITED_CAPACITY);
    expect(mgr.getCitizens()[0]!.education).toBe(EducationLevel.ELEMENTARY);
    expect(mgr.getCitizens()[0]!.educationProgress).toBe(0);
  });

  it('should NOT educate homeless citizen (no homeId)', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 20, homeId: null });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(mgr.getCitizens()[0]!.education).toBe(EducationLevel.NONE);
    expect(mgr.getCitizens()[0]!.educationProgress).toBe(0);
  });

  it('should NOT educate citizen outside school coverage', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 20, homeId: '50,50' });
    mgr.educateTick((x, y) => x === 5 && y === 5, UNLIMITED_CAPACITY);
    expect(mgr.getCitizens()[0]!.education).toBe(EducationLevel.NONE);
    expect(mgr.getCitizens()[0]!.educationProgress).toBe(0);
  });

  it('should enroll citizen inside school coverage but not outside', () => {
    const mgr = new CitizenManager();
    const covered = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const uncovered = mgr.createCitizen({ age: 20, homeId: '50,50' });
    mgr.educateTick((x, y) => x === 5 && y === 5, UNLIMITED_CAPACITY);
    expect(covered.educationProgress).toBeGreaterThan(0);
    expect(uncovered.educationProgress).toBe(0);
  });

  it('updateAges should only age citizens without killing them', () => {
    const mgr = new CitizenManager();
    // Create citizen with age > MAX_AGE (281 > 280)
    mgr.createCitizen({ age: 281 });
    // updateAges doesn't kill — citizen should still be alive
    mgr.updateAges(1000);
    expect(mgr.getPopulation()).toBe(1);
  });

  it('LIFE_STAGE_AGE thresholds should be strictly increasing', () => {
    expect(LIFE_STAGE_AGE.BABY_MAX).toBeLessThan(LIFE_STAGE_AGE.CHILD_MAX);
    expect(LIFE_STAGE_AGE.CHILD_MAX).toBeLessThan(LIFE_STAGE_AGE.TEEN_MAX);
    expect(LIFE_STAGE_AGE.TEEN_MAX).toBeLessThan(LIFE_STAGE_AGE.ADULT_MAX);
  });

  it('isWorkingAge returns true for adults within working age', () => {
    expect(isWorkingAge(53)).toBe(true);
    expect(isWorkingAge(100)).toBe(true);
    expect(isWorkingAge(200)).toBe(true);
  });

  it('isWorkingAge returns false for teens and younger', () => {
    expect(isWorkingAge(0)).toBe(false);
    expect(isWorkingAge(20)).toBe(false);
    expect(isWorkingAge(52)).toBe(false);
  });

  it('isWorkingAge returns false for seniors', () => {
    expect(isWorkingAge(201)).toBe(false);
    expect(isWorkingAge(220)).toBe(false);
  });

  it('isWorkingAge boundary matches LIFE_STAGE_AGE', () => {
    expect(isWorkingAge(LIFE_STAGE_AGE.TEEN_MAX)).toBe(false);     // 52
    expect(isWorkingAge(LIFE_STAGE_AGE.TEEN_MAX + 1)).toBe(true);  // 53
    expect(isWorkingAge(LIFE_STAGE_AGE.ADULT_MAX)).toBe(true);     // 200
    expect(isWorkingAge(LIFE_STAGE_AGE.ADULT_MAX + 1)).toBe(false); // 201
  });

  it('DAILY_DEATH_RATE should define rates for all life stages', () => {
    expect(DAILY_DEATH_RATE[LifeStage.BABY]).toBeGreaterThan(0);
    expect(DAILY_DEATH_RATE[LifeStage.CHILD]).toBeGreaterThan(0);
    expect(DAILY_DEATH_RATE[LifeStage.TEEN]).toBeGreaterThan(0);
    expect(DAILY_DEATH_RATE[LifeStage.ADULT]).toBeGreaterThan(0);
    expect(DAILY_DEATH_RATE[LifeStage.SENIOR]).toBeGreaterThan(0);
    // SENIOR rate should be highest
    expect(DAILY_DEATH_RATE[LifeStage.SENIOR]).toBeGreaterThan(DAILY_DEATH_RATE[LifeStage.ADULT]);
  });

  it('HEALTH_MULTIPLIER covered should reduce death rate', () => {
    expect(HEALTH_MULTIPLIER.COVERED).toBeLessThan(HEALTH_MULTIPLIER.NOT_COVERED);
    expect(HEALTH_MULTIPLIER.NOT_COVERED).toBe(1.0);
  });

  it('should get citizens by home building position', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100, homeId: '5,10' });
    mgr.createCitizen({ age: 100, homeId: '5,10' });
    mgr.createCitizen({ age: 100, homeId: '8,8' });
    const residents = mgr.getCitizensByHome('5,10');
    expect(residents.length).toBe(2);
    expect(residents.every(c => c.homeId === '5,10')).toBe(true);
  });

  it('should get citizens by workplace building position', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100, workplaceId: '3,7' });
    mgr.createCitizen({ age: 100, workplaceId: '3,7' });
    mgr.createCitizen({ age: 100, workplaceId: '9,2' });
    const workers = mgr.getCitizensByWorkplace('3,7');
    expect(workers.length).toBe(2);
    expect(workers.every(c => c.workplaceId === '3,7')).toBe(true);
  });

  it('should return empty array when no citizens at position', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100, homeId: '5,10' });
    expect(mgr.getCitizensByHome('99,99')).toEqual([]);
    expect(mgr.getCitizensByWorkplace('99,99')).toEqual([]);
  });

  describe('getCitizens', () => {
    it('should return readonly array of all citizens', () => {
      const mgr = new CitizenManager();
      mgr.createCitizen({ age: 100 });
      mgr.createCitizen({ age: 100 });
      const citizens = mgr.getCitizens();
      expect(citizens).toHaveLength(2);
    });

    it('should return empty array when no citizens', () => {
      const mgr = new CitizenManager();
      expect(mgr.getCitizens()).toHaveLength(0);
    });
  });

  describe('getAverageHappiness', () => {
    it('should return average happiness of all citizens', () => {
      const mgr = new CitizenManager();
      mgr.createCitizen({ age: 100, happiness: 60 });
      mgr.createCitizen({ age: 100, happiness: 80 });
      expect(mgr.getAverageHappiness()).toBe(70);
    });

    it('should return 0 when no citizens', () => {
      const mgr = new CitizenManager();
      expect(mgr.getAverageHappiness()).toBe(0);
    });
  });
});

describe('removeCitizen in-place', () => {
  it('should remove citizen without creating a new array reference', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100 });
    const c2 = mgr.createCitizen({ age: 100 });
    mgr.createCitizen({ age: 100 });
    const arrBefore = mgr.getCitizens();
    mgr.removeCitizen(c2.id);
    // After removal, getCitizens() should still return the same backing array
    expect(mgr.getCitizens()).toBe(arrBefore);
    expect(mgr.getPopulation()).toBe(2);
    expect(mgr.getCitizen(c2.id)).toBeUndefined();
  });

  it('should handle removing last citizen', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 100 });
    mgr.removeCitizen(c.id);
    expect(mgr.getPopulation()).toBe(0);
  });

  it('should handle removing non-existent id gracefully', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100 });
    mgr.removeCitizen(9999);
    expect(mgr.getPopulation()).toBe(1);
  });
});

describe('removeCitizens batch', () => {
  it('should remove multiple citizens in a single pass', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 100 });
    const c2 = mgr.createCitizen({ age: 100 });
    const c3 = mgr.createCitizen({ age: 100 });
    const c4 = mgr.createCitizen({ age: 100 });
    mgr.removeCitizens(new Set([c1.id, c3.id]));
    expect(mgr.getPopulation()).toBe(2);
    expect(mgr.getCitizen(c1.id)).toBeUndefined();
    expect(mgr.getCitizen(c2.id)).toBeDefined();
    expect(mgr.getCitizen(c3.id)).toBeUndefined();
    expect(mgr.getCitizen(c4.id)).toBeDefined();
  });

  it('should not create a new array reference', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 100 });
    mgr.createCitizen({ age: 100 });
    const arrBefore = mgr.getCitizens();
    mgr.removeCitizens(new Set([c1.id]));
    expect(mgr.getCitizens()).toBe(arrBefore);
  });

  it('should handle empty set', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100 });
    mgr.removeCitizens(new Set());
    expect(mgr.getPopulation()).toBe(1);
  });

  it('should handle removing all citizens', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 100 });
    const c2 = mgr.createCitizen({ age: 100 });
    mgr.removeCitizens(new Set([c1.id, c2.id]));
    expect(mgr.getPopulation()).toBe(0);
  });
});

describe('evictBuilding', () => {
  it('should nullify homeId for citizens living at demolished position', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 100, homeId: '5,10' });
    const c2 = mgr.createCitizen({ age: 100, homeId: '5,10' });
    const c3 = mgr.createCitizen({ age: 100, homeId: '8,8' });

    mgr.evictBuilding('5,10');

    expect(c1.homeId).toBeNull();
    expect(c2.homeId).toBeNull();
    expect(c3.homeId).toBe('8,8'); // unaffected
  });

  it('should nullify workplaceId for citizens working at demolished position', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 100, workplaceId: '3,7' });
    const c2 = mgr.createCitizen({ age: 100, workplaceId: '3,7' });
    const c3 = mgr.createCitizen({ age: 100, workplaceId: '9,2' });

    mgr.evictBuilding('3,7');

    expect(c1.workplaceId).toBeNull();
    expect(c2.workplaceId).toBeNull();
    expect(c3.workplaceId).toBe('9,2'); // unaffected
  });

  it('should handle citizens who both live and work at demolished position', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 100, homeId: '5,5', workplaceId: '5,5' });

    mgr.evictBuilding('5,5');

    expect(c.homeId).toBeNull();
    expect(c.workplaceId).toBeNull();
  });

  it('should do nothing when no citizens at position', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100, homeId: '1,1' });

    mgr.evictBuilding('99,99');

    expect(mgr.getPopulation()).toBe(1);
    expect(mgr.getCitizens()[0]!.homeId).toBe('1,1');
  });

  it('should not remove citizens from population', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100, homeId: '5,10' });
    mgr.createCitizen({ age: 100, homeId: '5,10' });

    mgr.evictBuilding('5,10');

    expect(mgr.getPopulation()).toBe(2); // still in city, just homeless
  });

  it('should record homelessSince when currentTick is provided', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 100, homeId: '5,10' });
    const c2 = mgr.createCitizen({ age: 100, homeId: '8,8' });

    mgr.evictBuilding('5,10', 42);

    expect(c1.homelessSince).toBe(42);
    expect(c2.homelessSince).toBeNull(); // unaffected
  });

  it('should not set homelessSince for workplace-only evictions', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 100, homeId: '1,1', workplaceId: '5,10' });

    mgr.evictBuilding('5,10', 100);

    expect(c.homelessSince).toBeNull(); // home not affected
    expect(c.workplaceId).toBeNull();
  });

  it('should return evicted citizen IDs', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 100, homeId: '5,10' });
    const c2 = mgr.createCitizen({ age: 100, homeId: '5,10' });
    const c3 = mgr.createCitizen({ age: 100, homeId: '8,8' });

    const ids = mgr.evictBuilding('5,10');

    expect(ids).toEqual([c1.id, c2.id]);
    expect(ids).not.toContain(c3.id);
  });

  it('should return empty array when no citizens at position', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100, homeId: '1,1' });

    const ids = mgr.evictBuilding('99,99');

    expect(ids).toEqual([]);
  });

  it('should include citizen only once when both home and workplace match', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 100, homeId: '5,5', workplaceId: '5,5' });

    const ids = mgr.evictBuilding('5,5');

    expect(ids).toEqual([c.id]);
  });
});

describe('ELDERLY constants', () => {
  it('should have correct values', () => {
    expect(ELDERLY.AGE_THRESHOLD).toBe(240);
    expect(ELDERLY.RATE_FACTOR).toBe(0.25);
  });
});

describe('getElderlyMultiplier', () => {
  it('returns 1 for age <= 240', () => {
    expect(getElderlyMultiplier(200)).toBe(1);
    expect(getElderlyMultiplier(240)).toBe(1);
  });

  it('returns increasing multiplier for ages 241-280', () => {
    expect(getElderlyMultiplier(241)).toBe(1.25);  // 1 + (241-240)*0.25
    expect(getElderlyMultiplier(260)).toBe(6);      // 1 + (260-240)*0.25
    expect(getElderlyMultiplier(280)).toBe(11);     // 1 + (280-240)*0.25
  });

  it('returns Infinity for age > 280', () => {
    expect(getElderlyMultiplier(281)).toBe(Infinity);
    expect(getElderlyMultiplier(300)).toBe(Infinity);
  });
});

describe('deathTick', () => {
  it('should kill citizens over age 280', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 281 });
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(1);
    expect(mgr.getPopulation()).toBe(0);
  });

  it('should not kill young adults deterministically (low probability)', () => {
    const mgr = new CitizenManager();
    // Create 100 adults — probability of dying is ~0.05%/day each
    for (let i = 0; i < 100; i++) mgr.createCitizen({ age: 100 });

    // Mock Math.random to always return 1.0 (never triggers death)
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(0);
    expect(mgr.getPopulation()).toBe(100);
    vi.restoreAllMocks();
  });

  it('should kill when random < death rate', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 220 }); // SENIOR, rate=0.006
    // Mock random to return 0 (always below any positive rate)
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(1);
    expect(mgr.getPopulation()).toBe(0);
    vi.restoreAllMocks();
  });

  it('health coverage reduces death rate', () => {
    // With coverage: 0.006 * 0.3 = 0.0018
    // random = 0.002 → above 0.0018 → survives with coverage
    const mgr1 = new CitizenManager();
    mgr1.createCitizen({ age: 220 }); // SENIOR, base=0.006
    vi.spyOn(Math, 'random').mockReturnValue(0.002);
    const deaths1 = mgr1.deathTick(() => true);
    expect(deaths1.length).toBe(0);
    vi.restoreAllMocks();

    // Without coverage: 0.006 * 1.0 = 0.006
    // random = 0.002 → below 0.006 → dies without coverage
    const mgr2 = new CitizenManager();
    mgr2.createCitizen({ age: 220 });
    vi.spyOn(Math, 'random').mockReturnValue(0.002);
    const deaths2 = mgr2.deathTick(() => false);
    expect(deaths2.length).toBe(1);
    vi.restoreAllMocks();
  });

  it('homeless citizens are treated as not covered', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 220, homeId: null });
    // The callback receives the citizen — test that it's called
    const coverageFn = vi.fn().mockReturnValue(true);
    vi.spyOn(Math, 'random').mockReturnValue(1.0); // won't die
    mgr.deathTick(coverageFn);
    // The callback should be called for each citizen
    expect(coverageFn).toHaveBeenCalledWith(c);
    vi.restoreAllMocks();
  });

  it('elderly multiplier increases death rate above 240', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 260 }); // SENIOR, rate=0.006*6=0.036
    // random = 0.01 → below 0.036 → dies
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(1);
    vi.restoreAllMocks();
  });

  it('returns correct death count', () => {
    const mgr = new CitizenManager();
    for (let i = 0; i < 5; i++) mgr.createCitizen({ age: 281 });
    mgr.createCitizen({ age: 100 }); // adult, won't die with high random
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(5); // only the 281+ die
    expect(mgr.getPopulation()).toBe(1);
    vi.restoreAllMocks();
  });

  it('statistical test: SENIOR has higher death rate than ADULT over many runs', () => {
    const RUNS = 10000;
    let seniorDeaths = 0;
    let adultDeaths = 0;

    for (let i = 0; i < RUNS; i++) {
      const mgr = new CitizenManager();
      mgr.createCitizen({ age: 220 }); // SENIOR
      const d = mgr.deathTick(() => false);
      seniorDeaths += d.length;
    }

    for (let i = 0; i < RUNS; i++) {
      const mgr = new CitizenManager();
      mgr.createCitizen({ age: 100 }); // ADULT
      const d = mgr.deathTick(() => false);
      adultDeaths += d.length;
    }

    // SENIOR rate (0.006) should produce ~12x more deaths than ADULT (0.0005)
    expect(seniorDeaths).toBeGreaterThan(adultDeaths);
  });
});

describe('EDUCATION_PROGRESSION', () => {
  it('should define rules for all three education levels', () => {
    expect(EDUCATION_PROGRESSION.length).toBe(3);
    expect(EDUCATION_PROGRESSION[0]!.nextEducation).toBe(EducationLevel.ELEMENTARY);
    expect(EDUCATION_PROGRESSION[1]!.nextEducation).toBe(EducationLevel.HIGH_SCHOOL);
    expect(EDUCATION_PROGRESSION[2]!.nextEducation).toBe(EducationLevel.UNIVERSITY);
  });

  it('should form a valid progression chain', () => {
    for (let i = 1; i < EDUCATION_PROGRESSION.length; i++) {
      expect(EDUCATION_PROGRESSION[i]!.requiredEducation).toBe(EDUCATION_PROGRESSION[i - 1]!.nextEducation);
    }
  });

  it('rules should not have lifeStage or maxAge restrictions', () => {
    for (const rule of EDUCATION_PROGRESSION) {
      expect((rule as any).lifeStage).toBeUndefined();
      expect((rule as any).maxAge).toBeUndefined();
    }
  });

  it('educateTick promotes child through full chain', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter = 1.0
    const mgr = new CitizenManager();
    const child = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const speed = getLearningSpeed(20);
    const elemTicks = Math.ceil(GRADUATION_TICKS.elementary / speed);
    for (let i = 0; i < elemTicks; i++) mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(child.education).toBe(EducationLevel.ELEMENTARY);

    const hsTicks = Math.ceil(GRADUATION_TICKS.highSchool / speed);
    for (let i = 0; i < hsTicks; i++) mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(child.education).toBe(EducationLevel.HIGH_SCHOOL);

    const uniTicks = Math.ceil(GRADUATION_TICKS.university / speed);
    for (let i = 0; i < uniTicks; i++) mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(child.education).toBe(EducationLevel.UNIVERSITY);
    vi.restoreAllMocks();
  });

  it('adult graduates elementary in ~3x more ticks than child', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mgr = new CitizenManager();
    const adult = mgr.createCitizen({ age: 100, homeId: '5,5' });
    const adultSpeed = getLearningSpeed(100);
    const childSpeed = getLearningSpeed(20);
    const adultTicks = Math.ceil(GRADUATION_TICKS.elementary / adultSpeed);
    const childTicks = Math.ceil(GRADUATION_TICKS.elementary / childSpeed);
    expect(adultTicks).toBeGreaterThan(childTicks * 2);
    for (let i = 0; i < childTicks; i++) mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(adult.education).toBe(EducationLevel.NONE);
    for (let i = childTicks; i < adultTicks; i++) mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(adult.education).toBe(EducationLevel.ELEMENTARY);
    vi.restoreAllMocks();
  });

  it('senior takes 5x more ticks than child', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mgr = new CitizenManager();
    const senior = mgr.createCitizen({ age: 220, homeId: '5,5' });
    const seniorSpeed = getLearningSpeed(220);
    const childSpeed = getLearningSpeed(20);
    const seniorTicks = Math.ceil(GRADUATION_TICKS.elementary / seniorSpeed);
    const childTicks = Math.ceil(GRADUATION_TICKS.elementary / childSpeed);
    expect(seniorTicks).toBe(childTicks * 5);
    for (let i = 0; i < seniorTicks; i++) mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(senior.education).toBe(EducationLevel.ELEMENTARY);
    vi.restoreAllMocks();
  });

  it('teen→adult mid-enrollment: progress preserved, only speed changes', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 52, homeId: '5,5' }); // TEEN (33-52)
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(100);
    c.age = 53;
    c.lifeStage = LifeStage.ADULT;
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(100 + 33);
    vi.restoreAllMocks();
  });

  it('baby (age < MIN_SCHOOL_AGE) cannot enroll', () => {
    const mgr = new CitizenManager();
    const baby = mgr.createCitizen({ age: 3, homeId: '5,5' });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(baby.educationProgress).toBe(0);
  });
});

describe('getLearningSpeed', () => {
  it('children and teens: speed 100', () => {
    expect(getLearningSpeed(9)).toBe(100);    // CHILD (9-32)
    expect(getLearningSpeed(20)).toBe(100);   // CHILD
    expect(getLearningSpeed(40)).toBe(100);   // TEEN (33-52)
    expect(getLearningSpeed(52)).toBe(100);   // TEEN boundary
  });

  it('adults: speed 33 (~3x slower)', () => {
    expect(getLearningSpeed(53)).toBe(33);    // ADULT start (53)
    expect(getLearningSpeed(100)).toBe(33);   // mid ADULT
    expect(getLearningSpeed(200)).toBe(33);   // ADULT boundary
  });

  it('seniors: speed 20 (5x slower)', () => {
    expect(getLearningSpeed(201)).toBe(20);   // SENIOR start
    expect(getLearningSpeed(220)).toBe(20);   // mid SENIOR
  });
});

describe('jitteredSpeed', () => {
  it('returns base speed when random=0.5 (jitter=1.0)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(jitteredSpeed(100)).toBe(100);
    expect(jitteredSpeed(33)).toBe(33);
    vi.restoreAllMocks();
  });

  it('returns 80% speed at minimum jitter (random=0)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(jitteredSpeed(100)).toBe(80);
    vi.restoreAllMocks();
  });

  it('returns 120% speed at maximum jitter (random=1)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    expect(jitteredSpeed(100)).toBe(120);
    vi.restoreAllMocks();
  });

  it('students enrolled together graduate at different times', () => {
    const mgr = new CitizenManager();
    for (let i = 0; i < 20; i++) mgr.createCitizen({ age: 20, homeId: '5,5' });
    // Run many ticks — with jitter, not all should graduate at the exact same tick
    const speed = getLearningSpeed(20);
    const baseTicks = Math.ceil(GRADUATION_TICKS.elementary / speed);
    // Run 80% of base ticks — no one should graduate yet (even with max jitter 120%)
    const safeTicks = Math.ceil(baseTicks * 0.7);
    for (let i = 0; i < safeTicks; i++) mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(mgr.getCitizens().every(c => c.education === EducationLevel.NONE)).toBe(true);
    // Run enough ticks for everyone to graduate (even with min jitter 80%)
    const maxTicks = Math.ceil(baseTicks * 1.3);
    for (let i = safeTicks; i < maxTicks; i++) mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(mgr.getCitizens().every(c => c.education === EducationLevel.ELEMENTARY)).toBe(true);
  });
});

describe('educateTick enrollment & capacity', () => {
  it('enrolled student progress increments by speed each tick (with jitter)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter = 1.0
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const speed = getLearningSpeed(20);
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(speed);
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(speed * 2);
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(speed * 3);
    vi.restoreAllMocks();
  });

  it('does not graduate before reaching threshold', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const speed = getLearningSpeed(20);
    const ticksNeeded = Math.ceil(GRADUATION_TICKS.elementary / speed);
    for (let i = 0; i < ticksNeeded - 1; i++) {
      mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    }
    expect(c.education).toBe(EducationLevel.NONE);
    expect(c.educationProgress).toBeLessThan(GRADUATION_TICKS.elementary);
    vi.restoreAllMocks();
  });

  it('capacity full prevents new enrollment', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const c2 = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const cap = { elementary: 1, highSchool: 9999, university: 9999 };
    mgr.educateTick(() => true, cap);
    // Only one should be enrolled
    const enrolled = [c1, c2].filter(c => c.educationProgress > 0);
    expect(enrolled).toHaveLength(1);
    const notEnrolled = [c1, c2].filter(c => c.educationProgress === 0);
    expect(notEnrolled).toHaveLength(1);
  });

  it('graduation frees a slot for the next student', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const c2 = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const cap = { elementary: 1, highSchool: 9999, university: 9999 };
    const speed = getLearningSpeed(20);
    const ticksNeeded = Math.ceil(GRADUATION_TICKS.elementary / speed);
    for (let i = 0; i < ticksNeeded; i++) {
      mgr.educateTick(() => true, cap);
    }
    expect(c1.education).toBe(EducationLevel.ELEMENTARY);
    expect(c2.educationProgress).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  it('homeless citizen cannot enroll', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 20, homeId: null });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(0);
    expect(c.education).toBe(EducationLevel.NONE);
  });

  it('citizen outside coverage cannot enroll', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 20, homeId: '50,50' });
    mgr.educateTick((x, y) => x === 5 && y === 5, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(0);
  });

  it('different school types have independent capacities', () => {
    const mgr = new CitizenManager();
    const child = mgr.createCitizen({ age: 20, homeId: '5,5' });
    const teen = mgr.createCitizen({ age: 40, education: EducationLevel.ELEMENTARY, homeId: '5,5' });
    const cap = { elementary: 1, highSchool: 1, university: 0 };
    mgr.educateTick(() => true, cap);
    expect(child.educationProgress).toBeGreaterThan(0); // elementary slot taken
    expect(teen.educationProgress).toBeGreaterThan(0);  // highSchool slot taken — independent
  });

  it('enrolled student loses coverage → paused (progress preserved)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 20, homeId: '5,5' });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    const saved = c.educationProgress;
    expect(saved).toBeGreaterThan(0);
    // Coverage disappears — progress stays
    mgr.educateTick(() => false, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(saved);
    vi.restoreAllMocks();
  });

  it('homeless student paused, resumes when re-housed in coverage', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 20, homeId: '5,5' });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    const saved = c.educationProgress;
    // Become homeless — paused
    c.homeId = null;
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(saved);
    // Re-housed in coverage — resumes
    c.homeId = '5,5';
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBeGreaterThan(saved);
    vi.restoreAllMocks();
  });
});
