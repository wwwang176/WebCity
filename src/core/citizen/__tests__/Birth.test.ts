import { describe, it, expect, vi } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { birthTick, DEFAULT_CONTEXT, BIRTH, getMaxChildren, CHILDREN_PER_RESIDENTS, FERTILITY_BY_EDUCATION, type BirthContext } from '../Birth';
import { LifeStage, EducationLevel } from '../types';

/**
 * Natural births.
 *
 * The rules:
 *  - only an ADULT aged 53-200, at most 130, with a home (homeId !== null) can give birth
 *  - a base 4% probability per eligible citizen per month
 *  - +3% above happiness 70
 *  - the BABY+CHILD limit per home is max(2, floor(residents / 4))
 *  - a newborn is age 0, BABY, NONE education, the parent's homeId, workplaceId null
 */

// A context forcing a 100% fertility rate, so the behaviour is deterministic.
// getResidents returns 8, giving maxChildren = max(2, 8/4) = 2.
const alwaysBirth: Partial<BirthContext> = {
  baseFertilityRate: 1.0,
  happinessBonus: 0,
  getResidents: () => 8,
};

describe('birthTick — 自然出生機制', () => {
  it('基本出生：有符合條件的 ADULT → 應能產生新生兒', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100, homeId: '1,1', happiness: 60 })!;
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(1);
    // The newborn is added to the manager.
    expect(mgr.getPopulation()).toBe(2);
  });

  it('年齡限制：age > 130 的 ADULT 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 150, homeId: '1,1', happiness: 60 })!;
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
    expect(mgr.getPopulation()).toBe(1);
  });

  it('SENIOR 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 220, homeId: '1,1', happiness: 60 })!;
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('無家者不生育：homeId=null 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 100, homeId: null, happiness: 60 })!;
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('戶內上限：同一 homeId 已有 2 個 BABY/CHILD → 不再生育', () => {
    const mgr = new CitizenManager();
    // The parents.
    mgr.createCitizen({ age: 100, homeId: '2,2', happiness: 60 })!;
    // Two children already.
    mgr.createCitizen({ age: 3, homeId: '2,2', happiness: 50 })!; // BABY
    mgr.createCitizen({ age: 20, homeId: '2,2', happiness: 50 })!; // CHILD
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('幸福度加成：happiness > 70 生育率高於 ≤ 70', () => {
    // Statistically: across many runs, high happiness should average more births than low. A
    // fixed seed will not do for a probability, so a larger sample is made deterministic
    // instead.
    const mgr1 = new CitizenManager();
    const mgr2 = new CitizenManager();
    // 100 eligible adults per group.
    for (let i = 0; i < 100; i++) {
      mgr1.createCitizen({ age: 100, homeId: `${i},0`, happiness: 80 })!;
      mgr2.createCitizen({ age: 100, homeId: `${i},1`, happiness: 50 })!;
    }
    // A high but not certain base rate, so the difference is visible.
    const ctx: Partial<BirthContext> = { baseFertilityRate: 0.5, happinessBonus: 0.3 };
    // A fixed random, so the run repeats.
    vi.spyOn(Math, 'random').mockImplementation(() => {
      // 0.7 is below the high-happiness 0.5+0.3=0.8 and not below the low-happiness 0.5.
      return 0.7;
    });
    const births1 = birthTick(mgr1, ctx);
    // manager2 needs the mock reinstated.
    const births2 = birthTick(mgr2, ctx);
    vi.restoreAllMocks();
    // High happiness: rate 0.8 against random 0.7, so everyone gives birth.
    expect(births1).toBe(100);
    // Low happiness: rate 0.5 against random 0.7, so nobody does.
    expect(births2).toBe(0);
  });

  it('新生兒屬性：age=0, lifeStage=BABY, education=NONE, homeId=父母 homeId, workplaceId=null', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({
      age: 100,
      homeId: '5,5',
      happiness: 60,
      education: EducationLevel.UNIVERSITY,
    })!;
    birthTick(mgr, alwaysBirth);
    expect(mgr.getPopulation()).toBe(2);
    // Finds the newborn, which is not the original adult.
    const baby = mgr.getCitizens().find(c => c.age === 0);
    expect(baby).toBeDefined();
    expect(baby!.lifeStage).toBe(LifeStage.BABY);
    expect(baby!.education).toBe(EducationLevel.NONE);
    expect(baby!.homeId).toBe('5,5');
    expect(baby!.workplaceId).toBeNull();
  });

  it('空城市不生育', () => {
    const mgr = new CitizenManager();
    const births = birthTick(mgr);
    expect(births).toBe(0);
  });

  it('TEEN 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 40, homeId: '1,1', happiness: 60 })!;
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('CHILD 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 20, homeId: '1,1', happiness: 60 })!;
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('BIRTH.MAX_FERTILITY_AGE should be within adult age range', () => {
    expect(BIRTH.MAX_FERTILITY_AGE).toBeGreaterThan(52);
    expect(BIRTH.MAX_FERTILITY_AGE).toBeLessThanOrEqual(200);
  });

  it('FERTILITY_BY_EDUCATION should have valid thresholds for all levels', () => {
    for (const level of [EducationLevel.NONE, EducationLevel.ELEMENTARY, EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY]) {
      const f = FERTILITY_BY_EDUCATION[level];
      expect(f.baseRate).toBeGreaterThan(0);
      expect(f.baseRate).toBeLessThan(1);
      expect(f.happyThreshold).toBeGreaterThan(0);
      expect(f.happyThreshold).toBeLessThanOrEqual(100);
      expect(f.happyBonus).toBeGreaterThan(0);
    }
    // Higher education → lower base rate
    expect(FERTILITY_BY_EDUCATION[EducationLevel.UNIVERSITY].baseRate)
      .toBeLessThan(FERTILITY_BY_EDUCATION[EducationLevel.NONE].baseRate);
    // Higher education → higher happiness threshold
    expect(FERTILITY_BY_EDUCATION[EducationLevel.UNIVERSITY].happyThreshold)
      .toBeGreaterThan(FERTILITY_BY_EDUCATION[EducationLevel.NONE].happyThreshold);
  });

  it('DEFAULT_CONTEXT should have valid fertility rates', () => {
    expect(DEFAULT_CONTEXT.baseFertilityRate).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT.baseFertilityRate).toBeLessThan(1);
    expect(DEFAULT_CONTEXT.happinessBonus).toBeGreaterThan(0);
  });

  it('getMaxChildren scales with building capacity', () => {
    expect(getMaxChildren(4)).toBe(2);   // floor(4/4) = 1 → max(2,1) = 2
    expect(getMaxChildren(8)).toBe(2);   // floor(8/4) = 2 → max(2,2) = 2
    expect(getMaxChildren(16)).toBe(4);  // floor(16/4) = 4
    expect(getMaxChildren(32)).toBe(8);  // floor(32/4) = 8
    expect(getMaxChildren(1)).toBe(2);   // floor(1/4) = 0 → max(2,0) = 2
  });

  it('大樓允許更多幼兒：residents=16 → 最多 4 個 BABY+CHILD', () => {
    const mgr = new CitizenManager();
    // Four fertile adults in an apartment block.
    for (let i = 0; i < 4; i++) {
      mgr.createCitizen({ age: 100, homeId: '3,3', happiness: 60 })!;
    }
    // Two young children already.
    mgr.createCitizen({ age: 3, homeId: '3,3', happiness: 50 })!;
    mgr.createCitizen({ age: 20, homeId: '3,3', happiness: 50 })!;

    // residents=8 gives a limit of 2 young children, so no more births.
    const births8 = birthTick(mgr, { baseFertilityRate: 1.0, happinessBonus: 0, getResidents: () => 8 });
    expect(births8).toBe(0);

    // residents=16 gives a limit of 4, so two more births are possible.
    const births16 = birthTick(mgr, { baseFertilityRate: 1.0, happinessBonus: 0, getResidents: () => 16 });
    expect(births16).toBeGreaterThan(0);
    expect(births16).toBeLessThanOrEqual(2); // at most 2 more (4-2=2 slots)
  });
});
