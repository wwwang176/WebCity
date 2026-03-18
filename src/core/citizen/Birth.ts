import { CitizenManager } from './CitizenManager';
import { LifeStage, EducationLevel, IncomeLevel } from './types';

export interface BirthContext {
  /** 基礎生育率（每位合格市民每月），預設 0.04 (4%) */
  baseFertilityRate: number;
  /** 幸福度 > 70 時的額外生育率加成，預設 0.03 (3%) */
  happinessBonus: number;
  /** 查詢住宅容量的回調；未提供時使用固定上限 2 */
  getResidents?: (homeId: string) => number;
}

/** 每 N 個住宅容量允許 1 個 BABY+CHILD，最低 2 */
export const CHILDREN_PER_RESIDENTS = 4;

export const DEFAULT_CONTEXT: BirthContext = {
  baseFertilityRate: 0.04,  // per eligible citizen per month (called monthly)
  happinessBonus: 0.03,
};

export const BIRTH = {
  MAX_FERTILITY_AGE: 130,   // life-weeks (~first 52% of adult period)
  HAPPINESS_FERTILITY_THRESHOLD: 70,
} as const;

/** 根據住宅容量計算該棟建築的 BABY+CHILD 上限 */
export function getMaxChildren(residents: number): number {
  return Math.max(2, Math.floor(residents / CHILDREN_PER_RESIDENTS));
}

/**
 * 自然出生 tick — 根據合格成人的生育機率產生新生兒。
 *
 * 合格條件：
 *  - lifeStage === ADULT 且 age ≤ MAX_FERTILITY_AGE
 *  - homeId !== null
 *  - 同一 homeId 下的 BABY + CHILD 數量 < getMaxChildren(residents)
 *
 * 回傳本 tick 產生的新生兒數量。
 */
export function birthTick(
  manager: CitizenManager,
  context?: Partial<BirthContext>,
  currentTick = 0,
): number {
  const ctx: BirthContext = { ...DEFAULT_CONTEXT, ...context };
  let births = 0;

  // 先統計每個 homeId 已有的 BABY+CHILD 數量
  const childrenCount = new Map<string, number>();
  for (const c of manager.getCitizens()) {
    if (c.homeId !== null && (c.lifeStage === LifeStage.BABY || c.lifeStage === LifeStage.CHILD)) {
      childrenCount.set(c.homeId, (childrenCount.get(c.homeId) ?? 0) + 1);
    }
  }

  // 收集所有新生兒（避免在遍歷中修改 citizens 陣列）
  const newborns: { homeId: string; incomeLevel: IncomeLevel }[] = [];

  // 遍歷現有市民，篩選合格者
  for (const c of manager.getCitizens()) {
    if (c.lifeStage !== LifeStage.ADULT) continue;
    if (c.age > BIRTH.MAX_FERTILITY_AGE) continue;
    if (c.homeId === null) continue;

    // 檢查該棟建築的幼兒上限（按容量比例）
    const currentChildren = (childrenCount.get(c.homeId) ?? 0);
    const residents = ctx.getResidents ? ctx.getResidents(c.homeId) : 8;
    if (currentChildren >= getMaxChildren(residents)) continue;

    // 計算生育機率
    let rate = ctx.baseFertilityRate;
    if (c.happiness > BIRTH.HAPPINESS_FERTILITY_THRESHOLD) {
      rate += ctx.happinessBonus;
    }

    // 隨機判定
    if (Math.random() < rate) {
      newborns.push({ homeId: c.homeId, incomeLevel: c.incomeLevel });
      // 更新計數，避免同一 homeId 本 tick 超生
      childrenCount.set(c.homeId, currentChildren + 1);
    }
  }

  // 產生新生兒
  for (const nb of newborns) {
    manager.createCitizen({
      age: 0,
      education: EducationLevel.NONE,
      incomeLevel: nb.incomeLevel,
      homeId: nb.homeId,
      workplaceId: null,
    }, currentTick);
    births++;
  }

  return births;
}
