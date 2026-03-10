import { CitizenManager } from './CitizenManager';
import { LifeStage, EducationLevel, IncomeLevel } from './types';

export interface BirthContext {
  /** 每個家庭最多允許的 BABY+CHILD 數量，預設 2 */
  maxChildrenPerHome: number;
  /** 基礎生育率（每位合格市民每年），預設 0.03 (3%) */
  baseFertilityRate: number;
  /** 幸福度 > 70 時的額外生育率加成，預設 0.02 (2%) */
  happinessBonus: number;
}

const DEFAULT_CONTEXT: BirthContext = {
  maxChildrenPerHome: 2,
  baseFertilityRate: 0.03,
  happinessBonus: 0.02,
};

/**
 * 自然出生 tick — 根據合格成人的生育機率產生新生兒。
 *
 * 合格條件：
 *  - lifeStage === ADULT 且 age ≤ 45
 *  - homeId !== null
 *  - 同一 homeId 下的 BABY + CHILD 數量 < maxChildrenPerHome
 *
 * 回傳本 tick 產生的新生兒數量。
 */
export function birthTick(
  manager: CitizenManager,
  context?: Partial<BirthContext>,
): number {
  const ctx: BirthContext = { ...DEFAULT_CONTEXT, ...context };
  let births = 0;

  // 先統計每個 homeId 已有的 BABY+CHILD 數量
  const childrenCount = new Map<string, number>();
  for (const c of manager.citizens) {
    if (c.homeId !== null && (c.lifeStage === LifeStage.BABY || c.lifeStage === LifeStage.CHILD)) {
      childrenCount.set(c.homeId, (childrenCount.get(c.homeId) ?? 0) + 1);
    }
  }

  // 收集所有新生兒（避免在遍歷中修改 citizens 陣列）
  const newborns: { homeId: string; incomeLevel: IncomeLevel }[] = [];

  // 遍歷現有市民，篩選合格者
  for (const c of manager.citizens) {
    // 只有 ADULT、age ≤ 45、有家的市民才能生育
    if (c.lifeStage !== LifeStage.ADULT) continue;
    if (c.age > 45) continue;
    if (c.homeId === null) continue;

    // 檢查戶內上限（包含本 tick 新增的）
    const currentChildren = (childrenCount.get(c.homeId) ?? 0);
    if (currentChildren >= ctx.maxChildrenPerHome) continue;

    // 計算生育機率
    let rate = ctx.baseFertilityRate;
    if (c.happiness > 70) {
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
    });
    births++;
  }

  return births;
}
