import { describe, it, expect } from 'vitest';
import { CitizenManager, EDUCATION_PROGRESSION, MORTALITY } from '../CitizenManager';
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

  it('should remove citizen on death', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: MORTALITY.MAX_AGE });
    mgr.ageTick();
    expect(mgr.getPopulation()).toBe(0);
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

  it('MORTALITY constants should have valid age thresholds', () => {
    expect(MORTALITY.ELDERLY_AGE).toBeLessThan(MORTALITY.MAX_AGE);
    expect(MORTALITY.ELDERLY_DEATH_CHANCE).toBeGreaterThan(0);
    expect(MORTALITY.ELDERLY_DEATH_CHANCE).toBeLessThanOrEqual(1);
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
