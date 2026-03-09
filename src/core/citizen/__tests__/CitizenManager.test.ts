import { describe, it, expect } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { LifeStage, EducationLevel } from '../types';

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
    expect(mgr.citizens[0]!.education).toBe(EducationLevel.ELEMENTARY);
  });

  it('should NOT educate TEEN without high school', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 15, education: EducationLevel.ELEMENTARY });
    mgr.educateTick(true, false, false);
    expect(mgr.citizens[0]!.education).toBe(EducationLevel.ELEMENTARY);
  });

  it('should remove citizen on death', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100 });
    mgr.ageTick();
    expect(mgr.getPopulation()).toBe(0);
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
});
