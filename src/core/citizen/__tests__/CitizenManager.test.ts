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
});
