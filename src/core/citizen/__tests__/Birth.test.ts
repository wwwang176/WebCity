import { describe, it, expect, vi } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { birthTick, DEFAULT_CONTEXT, BIRTH, getMaxChildren, CHILDREN_PER_RESIDENTS, FERTILITY_BY_EDUCATION, type BirthContext } from '../Birth';
import { LifeStage, EducationLevel } from '../types';

/**
 * Phase B: 自然出生機制測試
 * 規則：
 *  - 只有 ADULT (age 53-200)、age ≤ 130、有家（homeId !== null）才能生育
 *  - 基礎 4% 機率 / eligible citizen / month
 *  - happiness > 70 時 +3%
 *  - 每棟住宅 BABY+CHILD 上限 = max(2, floor(residents / 4))
 *  - 新生兒：age=0, BABY, NONE education, 父母 homeId, workplaceId=null
 */

// 強制 100% 生育率的 context，方便測試確定性行為
// getResidents 回傳 8 → maxChildren = max(2, 8/4) = 2
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
    // 新生兒應被加入 manager
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
    // 父母
    mgr.createCitizen({ age: 100, homeId: '2,2', happiness: 60 })!;
    // 已有 2 個小孩
    mgr.createCitizen({ age: 3, homeId: '2,2', happiness: 50 })!; // BABY
    mgr.createCitizen({ age: 20, homeId: '2,2', happiness: 50 })!; // CHILD
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('幸福度加成：happiness > 70 生育率高於 ≤ 70', () => {
    // 用統計方法：跑多次，高幸福度的平均生育數應大於低幸福度
    // 用固定 seed 概率不行，改用較大樣本的確定性測試
    const mgr1 = new CitizenManager();
    const mgr2 = new CitizenManager();
    // 每組 100 位合資格成人
    for (let i = 0; i < 100; i++) {
      mgr1.createCitizen({ age: 100, homeId: `${i},0`, happiness: 80 })!;
      mgr2.createCitizen({ age: 100, homeId: `${i},1`, happiness: 50 })!;
    }
    // 用較高但非 100% 的基礎率來觀察差異
    const ctx: Partial<BirthContext> = { baseFertilityRate: 0.5, happinessBonus: 0.3 };
    // 固定 random 確保可重複
    vi.spyOn(Math, 'random').mockImplementation(() => {
      // 回傳 0.7，低於 0.5+0.3=0.8 (高幸福) 但不低於 0.5 (低幸福)
      return 0.7;
    });
    const births1 = birthTick(mgr1, ctx);
    // 重設 manager2 需要重新 mock
    const births2 = birthTick(mgr2, ctx);
    vi.restoreAllMocks();
    // 高幸福度 (rate=0.8, random=0.7 < 0.8) → 全部生育
    expect(births1).toBe(100);
    // 低幸福度 (rate=0.5, random=0.7 >= 0.5) → 全部不生育
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
    // 找到新生兒（非原本的 adult）
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
    // 4 位可生育成人住在大樓
    for (let i = 0; i < 4; i++) {
      mgr.createCitizen({ age: 100, homeId: '3,3', happiness: 60 })!;
    }
    // 已有 2 個幼兒
    mgr.createCitizen({ age: 3, homeId: '3,3', happiness: 50 })!;
    mgr.createCitizen({ age: 20, homeId: '3,3', happiness: 50 })!;

    // residents=8 → max 2 幼兒 → 不能再生
    const births8 = birthTick(mgr, { baseFertilityRate: 1.0, happinessBonus: 0, getResidents: () => 8 });
    expect(births8).toBe(0);

    // residents=16 → max 4 幼兒 → 可以再生 2 個
    const births16 = birthTick(mgr, { baseFertilityRate: 1.0, happinessBonus: 0, getResidents: () => 16 });
    expect(births16).toBeGreaterThan(0);
    expect(births16).toBeLessThanOrEqual(2); // 最多再生 2 個 (4-2=2 slots)
  });
});
