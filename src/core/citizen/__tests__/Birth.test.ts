import { describe, it, expect, vi } from 'vitest';
import { CitizenManager } from '../CitizenManager';
import { birthTick, MAX_FERTILITY_AGE, HAPPINESS_FERTILITY_THRESHOLD, DEFAULT_CONTEXT, BIRTH, type BirthContext } from '../Birth';
import { LifeStage, EducationLevel, IncomeLevel } from '../types';

/**
 * Phase B: 自然出生機制測試
 * 規則：
 *  - 只有 ADULT (age 19-65)、age ≤ 45、有家（homeId !== null）才能生育
 *  - 基礎 3% 機率 / eligible citizen / year
 *  - happiness > 70 時 +2%
 *  - 每個 homeId 最多 2 個 BABY+CHILD
 *  - 新生兒：age=0, BABY, NONE education, 父母 incomeLevel, 父母 homeId, workplaceId=null
 */

// 強制 100% 生育率的 context，方便測試確定性行為
const alwaysBirth: Partial<BirthContext> = {
  baseFertilityRate: 1.0,
  happinessBonus: 0,
  maxChildrenPerHome: 2,
};

describe('birthTick — 自然出生機制', () => {
  it('基本出生：有符合條件的 ADULT → 應能產生新生兒', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 30, homeId: '1,1', happiness: 60, incomeLevel: IncomeLevel.MEDIUM });
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(1);
    // 新生兒應被加入 manager
    expect(mgr.getPopulation()).toBe(2);
  });

  it('年齡限制：age > 45 的 ADULT 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 50, homeId: '1,1', happiness: 60 });
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
    expect(mgr.getPopulation()).toBe(1);
  });

  it('SENIOR 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 70, homeId: '1,1', happiness: 60 });
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('無家者不生育：homeId=null 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 30, homeId: null, happiness: 60 });
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('戶內上限：同一 homeId 已有 2 個 BABY/CHILD → 不再生育', () => {
    const mgr = new CitizenManager();
    // 父母
    mgr.createCitizen({ age: 30, homeId: '2,2', happiness: 60 });
    // 已有 2 個小孩
    mgr.createCitizen({ age: 3, homeId: '2,2', happiness: 50 }); // BABY
    mgr.createCitizen({ age: 8, homeId: '2,2', happiness: 50 }); // CHILD
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
      mgr1.createCitizen({ age: 30, homeId: `${i},0`, happiness: 80 });
      mgr2.createCitizen({ age: 30, homeId: `${i},1`, happiness: 50 });
    }
    // 用較高但非 100% 的基礎率來觀察差異
    const ctx: Partial<BirthContext> = { baseFertilityRate: 0.5, happinessBonus: 0.3 };
    // 固定 random 確保可重複
    let callCount = 0;
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
      age: 30,
      homeId: '5,5',
      happiness: 60,
      incomeLevel: IncomeLevel.HIGH,
      education: EducationLevel.UNIVERSITY,
    });
    birthTick(mgr, alwaysBirth);
    expect(mgr.getPopulation()).toBe(2);
    // 找到新生兒（非原本的 adult）
    const baby = mgr.citizens.find(c => c.age === 0);
    expect(baby).toBeDefined();
    expect(baby!.lifeStage).toBe(LifeStage.BABY);
    expect(baby!.education).toBe(EducationLevel.NONE);
    expect(baby!.homeId).toBe('5,5');
    expect(baby!.incomeLevel).toBe(IncomeLevel.HIGH);
    expect(baby!.workplaceId).toBeNull();
  });

  it('空城市不生育', () => {
    const mgr = new CitizenManager();
    const births = birthTick(mgr);
    expect(births).toBe(0);
  });

  it('TEEN 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 16, homeId: '1,1', happiness: 60 });
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('CHILD 不生育', () => {
    const mgr = new CitizenManager();
    mgr.createCitizen({ age: 10, homeId: '1,1', happiness: 60 });
    const births = birthTick(mgr, alwaysBirth);
    expect(births).toBe(0);
  });

  it('MAX_FERTILITY_AGE should be within adult age range', () => {
    expect(MAX_FERTILITY_AGE).toBeGreaterThan(18);
    expect(MAX_FERTILITY_AGE).toBeLessThanOrEqual(65);
  });

  it('HAPPINESS_FERTILITY_THRESHOLD should be between 0 and 100', () => {
    expect(HAPPINESS_FERTILITY_THRESHOLD).toBeGreaterThan(0);
    expect(HAPPINESS_FERTILITY_THRESHOLD).toBeLessThanOrEqual(100);
  });

  it('DEFAULT_CONTEXT should have valid fertility rates', () => {
    expect(DEFAULT_CONTEXT.baseFertilityRate).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT.baseFertilityRate).toBeLessThan(1);
    expect(DEFAULT_CONTEXT.happinessBonus).toBeGreaterThan(0);
  });

  it('backward-compatible exports should match BIRTH config', () => {
    expect(MAX_FERTILITY_AGE).toBe(BIRTH.MAX_FERTILITY_AGE);
    expect(HAPPINESS_FERTILITY_THRESHOLD).toBe(BIRTH.HAPPINESS_FERTILITY_THRESHOLD);
  });
});
