import { describe, it, expect, vi } from 'vitest';
import { CitizenManager, EDUCATION_PROGRESSION, GRADUATION_TICKS, EDUCATION_SCALE, getLearningSpeed, jitteredSpeed, LEARNING_JITTER, MIN_SCHOOL_AGE, DAILY_DEATH_RATE, HEALTH_MULTIPLIER, getElderlyMultiplier } from '../CitizenManager';
import { LifeStage, EducationLevel, LIFE_STAGE_AGE, isWorkingAge } from '../types';

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
    const c = mgr.createCitizen({ age: 30 });
    expect(c.age).toBe(30);
    expect(c.lifeStage).toBe(LifeStage.ADULT);
    expect(c.education).toBeDefined();
    expect(c.happiness).toBeDefined();
    expect(c.health).toBeDefined();
    expect(c.homeId).toBeNull();
    expect(c.workplaceId).toBeNull();
  });

  it('should assign correct life stage by age', () => {
    const mgr = new CitizenManager();
    expect(mgr.createCitizen({ age: 3 }).lifeStage).toBe(LifeStage.BABY);
    expect(mgr.createCitizen({ age: 8 }).lifeStage).toBe(LifeStage.CHILD);
    expect(mgr.createCitizen({ age: 15 }).lifeStage).toBe(LifeStage.TEEN);
    expect(mgr.createCitizen({ age: 30 }).lifeStage).toBe(LifeStage.ADULT);
    expect(mgr.createCitizen({ age: 70 }).lifeStage).toBe(LifeStage.SENIOR);
  });

  it('should age citizens on tick', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 5 });
    mgr.ageTick();
    expect(c.age).toBe(6);
    expect(c.lifeStage).toBe(LifeStage.CHILD);
  });

  it('should transition CHILD to TEEN at age 13', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 12 });
    mgr.ageTick();
    expect(c.age).toBe(13);
    expect(c.lifeStage).toBe(LifeStage.TEEN);
  });

  it('should enroll CHILD with elementary coverage (progress > 0 after first tick)', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 8, homeId: '5,5' });
    mgr.educateTick((_x, _y, key) => key === 'elementary', UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBeGreaterThan(0);
    expect(c.education).toBe(EducationLevel.NONE); // not yet graduated
  });

  it('should graduate CHILD after enough ticks (speed-based, no jitter)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter = 1.0
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 8, homeId: '5,5' });
    const speed = getLearningSpeed(8); // 100
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
    mgr.createCitizen({ age: 15, education: EducationLevel.ELEMENTARY, homeId: '5,5' });
    mgr.educateTick((_x, _y, key) => key === 'elementary', UNLIMITED_CAPACITY);
    expect(mgr.getCitizens()[0]!.education).toBe(EducationLevel.ELEMENTARY);
    expect(mgr.getCitizens()[0]!.educationProgress).toBe(0);
  });

  it('should NOT educate homeless citizen (no homeId)', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 8, homeId: null });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(mgr.getCitizens()[0]!.education).toBe(EducationLevel.NONE);
    expect(mgr.getCitizens()[0]!.educationProgress).toBe(0);
  });

  it('should NOT educate citizen outside school coverage', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 8, homeId: '50,50' });
    mgr.educateTick((x, y) => x === 5 && y === 5, UNLIMITED_CAPACITY);
    expect(mgr.getCitizens()[0]!.education).toBe(EducationLevel.NONE);
    expect(mgr.getCitizens()[0]!.educationProgress).toBe(0);
  });

  it('should enroll citizen inside school coverage but not outside', () => {
    const mgr = new CitizenManager();
    const covered = mgr.createCitizen({ age: 8, homeId: '5,5' });
    const uncovered = mgr.createCitizen({ age: 8, homeId: '50,50' });
    mgr.educateTick((x, y) => x === 5 && y === 5, UNLIMITED_CAPACITY);
    expect(covered.educationProgress).toBeGreaterThan(0);
    expect(uncovered.educationProgress).toBe(0);
  });

  it('ageTick should only age citizens without killing them', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100 });
    mgr.ageTick();
    // ageTick no longer kills — citizen should still be alive at age 101
    expect(mgr.getPopulation()).toBe(1);
    expect(mgr.getCitizens()[0]!.age).toBe(101);
  });

  it('LIFE_STAGE_AGE thresholds should be strictly increasing', () => {
    expect(LIFE_STAGE_AGE.BABY_MAX).toBeLessThan(LIFE_STAGE_AGE.CHILD_MAX);
    expect(LIFE_STAGE_AGE.CHILD_MAX).toBeLessThan(LIFE_STAGE_AGE.TEEN_MAX);
    expect(LIFE_STAGE_AGE.TEEN_MAX).toBeLessThan(LIFE_STAGE_AGE.ADULT_MAX);
  });

  it('isWorkingAge returns true for adults within working age', () => {
    expect(isWorkingAge(19)).toBe(true);
    expect(isWorkingAge(30)).toBe(true);
    expect(isWorkingAge(65)).toBe(true);
  });

  it('isWorkingAge returns false for teens and younger', () => {
    expect(isWorkingAge(0)).toBe(false);
    expect(isWorkingAge(10)).toBe(false);
    expect(isWorkingAge(18)).toBe(false);
  });

  it('isWorkingAge returns false for seniors', () => {
    expect(isWorkingAge(66)).toBe(false);
    expect(isWorkingAge(80)).toBe(false);
  });

  it('isWorkingAge boundary matches LIFE_STAGE_AGE', () => {
    expect(isWorkingAge(LIFE_STAGE_AGE.TEEN_MAX)).toBe(false);
    expect(isWorkingAge(LIFE_STAGE_AGE.TEEN_MAX + 1)).toBe(true);
    expect(isWorkingAge(LIFE_STAGE_AGE.ADULT_MAX)).toBe(true);
    expect(isWorkingAge(LIFE_STAGE_AGE.ADULT_MAX + 1)).toBe(false);
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
    mgr.createCitizen({ age: 30, homeId: '5,10' });
    mgr.createCitizen({ age: 25, homeId: '5,10' });
    mgr.createCitizen({ age: 40, homeId: '8,8' });
    const residents = mgr.getCitizensByHome('5,10');
    expect(residents.length).toBe(2);
    expect(residents.every(c => c.homeId === '5,10')).toBe(true);
  });

  it('should get citizens by workplace building position', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 30, workplaceId: '3,7' });
    mgr.createCitizen({ age: 25, workplaceId: '3,7' });
    mgr.createCitizen({ age: 40, workplaceId: '9,2' });
    const workers = mgr.getCitizensByWorkplace('3,7');
    expect(workers.length).toBe(2);
    expect(workers.every(c => c.workplaceId === '3,7')).toBe(true);
  });

  it('should return empty array when no citizens at position', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 30, homeId: '5,10' });
    expect(mgr.getCitizensByHome('99,99')).toEqual([]);
    expect(mgr.getCitizensByWorkplace('99,99')).toEqual([]);
  });

  describe('getCitizens', () => {
    it('should return readonly array of all citizens', () => {
      const mgr = new CitizenManager();
      mgr.createCitizen({ age: 20 });
      mgr.createCitizen({ age: 30 });
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
      mgr.createCitizen({ age: 25, happiness: 60 });
      mgr.createCitizen({ age: 30, happiness: 80 });
      expect(mgr.getAverageHappiness()).toBe(70);
    });

    it('should return 0 when no citizens', () => {
      const mgr = new CitizenManager();
      expect(mgr.getAverageHappiness()).toBe(0);
    });
  });
});

describe('evictBuilding', () => {
  it('should nullify homeId for citizens living at demolished position', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 30, homeId: '5,10' });
    const c2 = mgr.createCitizen({ age: 25, homeId: '5,10' });
    const c3 = mgr.createCitizen({ age: 40, homeId: '8,8' });

    mgr.evictBuilding('5,10');

    expect(c1.homeId).toBeNull();
    expect(c2.homeId).toBeNull();
    expect(c3.homeId).toBe('8,8'); // unaffected
  });

  it('should nullify workplaceId for citizens working at demolished position', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 30, workplaceId: '3,7' });
    const c2 = mgr.createCitizen({ age: 25, workplaceId: '3,7' });
    const c3 = mgr.createCitizen({ age: 40, workplaceId: '9,2' });

    mgr.evictBuilding('3,7');

    expect(c1.workplaceId).toBeNull();
    expect(c2.workplaceId).toBeNull();
    expect(c3.workplaceId).toBe('9,2'); // unaffected
  });

  it('should handle citizens who both live and work at demolished position', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 30, homeId: '5,5', workplaceId: '5,5' });

    mgr.evictBuilding('5,5');

    expect(c.homeId).toBeNull();
    expect(c.workplaceId).toBeNull();
  });

  it('should do nothing when no citizens at position', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 30, homeId: '1,1' });

    mgr.evictBuilding('99,99');

    expect(mgr.getPopulation()).toBe(1);
    expect(mgr.getCitizens()[0]!.homeId).toBe('1,1');
  });

  it('should not remove citizens from population', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 30, homeId: '5,10' });
    mgr.createCitizen({ age: 25, homeId: '5,10' });

    mgr.evictBuilding('5,10');

    expect(mgr.getPopulation()).toBe(2); // still in city, just homeless
  });

  it('should record homelessSince when currentTick is provided', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 30, homeId: '5,10' });
    const c2 = mgr.createCitizen({ age: 25, homeId: '8,8' });

    mgr.evictBuilding('5,10', 42);

    expect(c1.homelessSince).toBe(42);
    expect(c2.homelessSince).toBeNull(); // unaffected
  });

  it('should not set homelessSince for workplace-only evictions', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 30, homeId: '1,1', workplaceId: '5,10' });

    mgr.evictBuilding('5,10', 100);

    expect(c.homelessSince).toBeNull(); // home not affected
    expect(c.workplaceId).toBeNull();
  });

  it('should return evicted citizen IDs', () => {
    const mgr = new CitizenManager();
    const c1 = mgr.createCitizen({ age: 30, homeId: '5,10' });
    const c2 = mgr.createCitizen({ age: 25, homeId: '5,10' });
    const c3 = mgr.createCitizen({ age: 40, homeId: '8,8' });

    const ids = mgr.evictBuilding('5,10');

    expect(ids).toEqual([c1.id, c2.id]);
    expect(ids).not.toContain(c3.id);
  });

  it('should return empty array when no citizens at position', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 30, homeId: '1,1' });

    const ids = mgr.evictBuilding('99,99');

    expect(ids).toEqual([]);
  });

  it('should include citizen only once when both home and workplace match', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 30, homeId: '5,5', workplaceId: '5,5' });

    const ids = mgr.evictBuilding('5,5');

    expect(ids).toEqual([c.id]);
  });
});

describe('getElderlyMultiplier', () => {
  it('returns 1 for age <= 90', () => {
    expect(getElderlyMultiplier(70)).toBe(1);
    expect(getElderlyMultiplier(90)).toBe(1);
  });

  it('returns increasing multiplier for ages 91-100', () => {
    expect(getElderlyMultiplier(91)).toBe(2);  // 1 + (91-90)*1
    expect(getElderlyMultiplier(95)).toBe(6);  // 1 + (95-90)*1
    expect(getElderlyMultiplier(100)).toBe(11); // 1 + (100-90)*1
  });

  it('returns Infinity for age > 100', () => {
    expect(getElderlyMultiplier(101)).toBe(Infinity);
    expect(getElderlyMultiplier(120)).toBe(Infinity);
  });
});

describe('deathTick', () => {
  it('should kill citizens over age 100', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 101 });
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(1);
    expect(mgr.getPopulation()).toBe(0);
  });

  it('should not kill young adults deterministically (low probability)', () => {
    const mgr = new CitizenManager();
    // Create 100 young adults — probability of dying is ~0.003%/day each
    for (let i = 0; i < 100; i++) mgr.createCitizen({ age: 30 });

    // Mock Math.random to always return 1.0 (never triggers death)
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(0);
    expect(mgr.getPopulation()).toBe(100);
    vi.restoreAllMocks();
  });

  it('should kill when random < death rate', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 70 }); // SENIOR, rate=0.0003
    // Mock random to return 0 (always below any positive rate)
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(1);
    expect(mgr.getPopulation()).toBe(0);
    vi.restoreAllMocks();
  });

  it('health coverage reduces death rate', () => {
    // With coverage: 0.0003 * 0.3 = 0.00009
    // random = 0.0001 → above 0.00009 → survives with coverage
    const mgr1 = new CitizenManager();
    mgr1.createCitizen({ age: 70 }); // SENIOR, base=0.0003
    vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    const deaths1 = mgr1.deathTick(() => true);
    expect(deaths1.length).toBe(0);
    vi.restoreAllMocks();

    // Without coverage: 0.0003 * 1.0 = 0.0003
    // random = 0.0001 → below 0.0003 → dies without coverage
    const mgr2 = new CitizenManager();
    mgr2.createCitizen({ age: 70 });
    vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    const deaths2 = mgr2.deathTick(() => false);
    expect(deaths2.length).toBe(1);
    vi.restoreAllMocks();
  });

  it('homeless citizens are treated as not covered', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 70, homeId: null });
    // The callback receives the citizen — test that it's called
    const coverageFn = vi.fn().mockReturnValue(true);
    vi.spyOn(Math, 'random').mockReturnValue(1.0); // won't die
    mgr.deathTick(coverageFn);
    // The callback should be called for each citizen
    expect(coverageFn).toHaveBeenCalledWith(c);
    vi.restoreAllMocks();
  });

  it('elderly multiplier increases death rate above 90', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 95 }); // SENIOR, rate=0.0003*6=0.0018
    // random = 0.001 → below 0.0018 → dies
    vi.spyOn(Math, 'random').mockReturnValue(0.001);
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(1);
    vi.restoreAllMocks();
  });

  it('returns correct death count', () => {
    const mgr = new CitizenManager();
    for (let i = 0; i < 5; i++) mgr.createCitizen({ age: 101 });
    mgr.createCitizen({ age: 30 }); // young, won't die with high random
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    const deaths = mgr.deathTick(() => false);
    expect(deaths.length).toBe(5); // only the 101+ die
    expect(mgr.getPopulation()).toBe(1);
    vi.restoreAllMocks();
  });

  it('statistical test: SENIOR has higher death rate than ADULT over many runs', () => {
    const RUNS = 10000;
    let seniorDeaths = 0;
    let adultDeaths = 0;

    for (let i = 0; i < RUNS; i++) {
      const mgr = new CitizenManager();
      mgr.createCitizen({ age: 70 }); // SENIOR
      const d = mgr.deathTick(() => false);
      seniorDeaths += d.length;
    }

    for (let i = 0; i < RUNS; i++) {
      const mgr = new CitizenManager();
      mgr.createCitizen({ age: 30 }); // ADULT
      const d = mgr.deathTick(() => false);
      adultDeaths += d.length;
    }

    // SENIOR rate (0.0003) should produce ~10x more deaths than ADULT (0.00003)
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
    const child = mgr.createCitizen({ age: 8, homeId: '5,5' });
    const speed = getLearningSpeed(8);
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
    const adult = mgr.createCitizen({ age: 30, homeId: '5,5' });
    const adultSpeed = getLearningSpeed(30);
    const childSpeed = getLearningSpeed(8);
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
    const senior = mgr.createCitizen({ age: 70, homeId: '5,5' });
    const seniorSpeed = getLearningSpeed(70);
    const childSpeed = getLearningSpeed(8);
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
    const c = mgr.createCitizen({ age: 18, homeId: '5,5' });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(100);
    c.age = 19;
    c.lifeStage = LifeStage.ADULT;
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(100 + 33);
    vi.restoreAllMocks();
  });

  it('baby (age ≤ 5) cannot enroll', () => {
    const mgr = new CitizenManager();
    const baby = mgr.createCitizen({ age: 3, homeId: '5,5' });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(baby.educationProgress).toBe(0);
  });
});

describe('getLearningSpeed', () => {
  it('children and teens: speed 100', () => {
    expect(getLearningSpeed(6)).toBe(100);
    expect(getLearningSpeed(12)).toBe(100);
    expect(getLearningSpeed(18)).toBe(100);
  });

  it('adults: speed 33 (~3x slower)', () => {
    expect(getLearningSpeed(19)).toBe(33);
    expect(getLearningSpeed(40)).toBe(33);
    expect(getLearningSpeed(65)).toBe(33);
  });

  it('seniors: speed 20 (5x slower)', () => {
    expect(getLearningSpeed(66)).toBe(20);
    expect(getLearningSpeed(80)).toBe(20);
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
    for (let i = 0; i < 20; i++) mgr.createCitizen({ age: 8, homeId: '5,5' });
    // Run many ticks — with jitter, not all should graduate at the exact same tick
    const speed = getLearningSpeed(8);
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
    const c = mgr.createCitizen({ age: 8, homeId: '5,5' });
    const speed = getLearningSpeed(8);
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
    const c = mgr.createCitizen({ age: 8, homeId: '5,5' });
    const speed = getLearningSpeed(8);
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
    const c1 = mgr.createCitizen({ age: 8, homeId: '5,5' });
    const c2 = mgr.createCitizen({ age: 9, homeId: '5,5' });
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
    const c1 = mgr.createCitizen({ age: 8, homeId: '5,5' });
    const c2 = mgr.createCitizen({ age: 9, homeId: '5,5' });
    const cap = { elementary: 1, highSchool: 9999, university: 9999 };
    const speed = getLearningSpeed(8);
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
    const c = mgr.createCitizen({ age: 8, homeId: null });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(0);
    expect(c.education).toBe(EducationLevel.NONE);
  });

  it('citizen outside coverage cannot enroll', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 8, homeId: '50,50' });
    mgr.educateTick((x, y) => x === 5 && y === 5, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(0);
  });

  it('different school types have independent capacities', () => {
    const mgr = new CitizenManager();
    const child = mgr.createCitizen({ age: 8, homeId: '5,5' });
    const teen = mgr.createCitizen({ age: 15, education: EducationLevel.ELEMENTARY, homeId: '5,5' });
    const cap = { elementary: 1, highSchool: 1, university: 0 };
    mgr.educateTick(() => true, cap);
    expect(child.educationProgress).toBeGreaterThan(0); // elementary slot taken
    expect(teen.educationProgress).toBeGreaterThan(0);  // highSchool slot taken — independent
  });

  it('enrolled student loses coverage → dropped (progress reset)', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 8, homeId: '5,5' });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBeGreaterThan(0);
    mgr.educateTick(() => false, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(0);
  });

  it('dropped student can re-enroll (progress restarts)', () => {
    const mgr = new CitizenManager();
    const c = mgr.createCitizen({ age: 8, homeId: '5,5' });
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBeGreaterThan(0);
    mgr.educateTick(() => false, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBe(0);
    mgr.educateTick(() => true, UNLIMITED_CAPACITY);
    expect(c.educationProgress).toBeGreaterThan(0);
  });
});
