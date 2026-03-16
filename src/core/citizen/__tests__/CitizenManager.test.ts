import { describe, it, expect, vi } from 'vitest';
import { CitizenManager, EDUCATION_PROGRESSION, DAILY_DEATH_RATE, HEALTH_MULTIPLIER, getElderlyMultiplier } from '../CitizenManager';
import { LifeStage, EducationLevel, LIFE_STAGE_AGE, isWorkingAge } from '../types';

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

  it('should educate CHILD with elementary coverage', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 8 });
    mgr.educateTick(true, false, false);
    expect(mgr.getCitizens()[0]!.education).toBe(EducationLevel.ELEMENTARY);
  });

  it('should NOT educate TEEN without high school', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 15, education: EducationLevel.ELEMENTARY });
    mgr.educateTick(true, false, false);
    expect(mgr.getCitizens()[0]!.education).toBe(EducationLevel.ELEMENTARY);
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

  it('university rule should have maxAge cap', () => {
    const uniRule = EDUCATION_PROGRESSION.find(r => r.schoolKey === 'university');
    expect(uniRule).toBeDefined();
    expect(uniRule!.maxAge).toBe(25);
  });

  it('educateTick promotes through full chain with all schools', () => {
    const mgr = new CitizenManager();
    const child = mgr.createCitizen({ age: 8 });
    mgr.educateTick(true, true, true);
    expect(child.education).toBe(EducationLevel.ELEMENTARY);

    // Advance to teen
    child.age = 15;
    child.lifeStage = LifeStage.TEEN;
    mgr.educateTick(true, true, true);
    expect(child.education).toBe(EducationLevel.HIGH_SCHOOL);

    // Advance to young adult
    child.age = 20;
    child.lifeStage = LifeStage.ADULT;
    mgr.educateTick(true, true, true);
    expect(child.education).toBe(EducationLevel.UNIVERSITY);
  });

  it('educateTick respects university maxAge', () => {
    const mgr = new CitizenManager();
    const adult = mgr.createCitizen({ age: 30, education: EducationLevel.HIGH_SCHOOL });
    mgr.educateTick(true, true, true);
    expect(adult.education).toBe(EducationLevel.HIGH_SCHOOL); // too old
  });
});
