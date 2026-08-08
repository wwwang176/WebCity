import { CitizenManager } from './CitizenManager';
import { LifeStage, EducationLevel } from './types';

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
} as const;

/** Per-education fertility parameters: base rate, happiness threshold, happiness bonus */
export const FERTILITY_BY_EDUCATION: Record<EducationLevel, { baseRate: number; happyThreshold: number; happyBonus: number }> = {
  [EducationLevel.NONE]:        { baseRate: 0.05,  happyThreshold: 60, happyBonus: 0.04 },
  [EducationLevel.ELEMENTARY]:  { baseRate: 0.04,  happyThreshold: 65, happyBonus: 0.03 },
  [EducationLevel.HIGH_SCHOOL]: { baseRate: 0.035, happyThreshold: 70, happyBonus: 0.025 },
  [EducationLevel.UNIVERSITY]:  { baseRate: 0.03,  happyThreshold: 75, happyBonus: 0.02 },
};

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

  // 先統計每個 homeId 已有的 BABY+CHILD 數量，以及總入住人數。
  //
  // 只看幼兒上限是不夠的：createCitizen 唯一的容量閘門是**全城**住宅總量，
  // 所以只要城裡別處還有空屋，一棟已住滿 4 人的 4 人房仍可再生 2 個小孩，
  // 永久超載 50%（computeOccupancyRatios 把比例夾在 1.0，UI 也看不出來）。
  // 需要逐棟比對實際入住數與容量（BUG-082）。
  const childrenCount = new Map<string, number>();
  const occupancyCount = new Map<string, number>();
  for (const c of manager.getCitizens()) {
    if (c.homeId === null) continue;
    occupancyCount.set(c.homeId, (occupancyCount.get(c.homeId) ?? 0) + 1);
    if (c.lifeStage === LifeStage.BABY || c.lifeStage === LifeStage.CHILD) {
      childrenCount.set(c.homeId, (childrenCount.get(c.homeId) ?? 0) + 1);
    }
  }

  // 收集所有新生兒（避免在遍歷中修改 citizens 陣列）
  const newborns: { homeId: string }[] = [];

  // 遍歷現有市民，篩選合格者
  for (const c of manager.getCitizens()) {
    if (c.lifeStage !== LifeStage.ADULT) continue;
    if (c.age > BIRTH.MAX_FERTILITY_AGE) continue;
    if (c.homeId === null) continue;

    // 檢查該棟建築的幼兒上限（按容量比例）與剩餘空位
    const currentChildren = (childrenCount.get(c.homeId) ?? 0);
    const residents = ctx.getResidents ? ctx.getResidents(c.homeId) : 8;
    if (currentChildren >= getMaxChildren(residents)) continue;
    if ((occupancyCount.get(c.homeId) ?? 0) >= residents) continue;

    // 計算生育機率（按教育等級調整）
    const fertility = FERTILITY_BY_EDUCATION[c.education] ?? FERTILITY_BY_EDUCATION[EducationLevel.NONE];
    let rate = ctx.baseFertilityRate !== DEFAULT_CONTEXT.baseFertilityRate
      ? ctx.baseFertilityRate   // test override: use fixed rate
      : fertility.baseRate;
    if (c.happiness > fertility.happyThreshold) {
      rate += ctx.happinessBonus !== DEFAULT_CONTEXT.happinessBonus
        ? ctx.happinessBonus    // test override: use fixed bonus
        : fertility.happyBonus;
    }

    // 隨機判定
    if (Math.random() < rate) {
      newborns.push({ homeId: c.homeId });
      // 更新計數，避免同一 homeId 本 tick 超生
      childrenCount.set(c.homeId, currentChildren + 1);
      occupancyCount.set(c.homeId, (occupancyCount.get(c.homeId) ?? 0) + 1);
    }
  }

  // 產生新生兒。
  //
  // Every newborn here has already passed a per-building check: its home's
  // occupancy is strictly below that building's own `residents` capacity, and
  // occupancyCount was incremented as each newborn was queued so one house
  // cannot over-fill within a single tick.
  //
  // Deliberately NOT createCitizen: that gate compares the whole citizen list
  // against total residential capacity, and the list includes citizens with no
  // home at all. Any homeless population made the city report itself full while
  // real rooms stood empty — and since births run once a MONTH against
  // migration's once every 6 ticks, births were always the ones turned away.
  for (const nb of newborns) {
    manager.createCitizenInKnownVacancy({
      age: 0,
      education: EducationLevel.NONE,
      homeId: nb.homeId,
      workplaceId: null,
    }, currentTick);
    births++;
  }

  return births;
}
