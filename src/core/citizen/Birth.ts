import { CitizenManager } from './CitizenManager';
import { LifeStage, EducationLevel } from './types';

export interface BirthContext {
  /** The base fertility rate per eligible citizen per month. Defaults to 0.04. */
  baseFertilityRate: number;
  /** The extra fertility above happiness 70. Defaults to 0.03. */
  happinessBonus: number;
  /** Looks up a building's residential capacity. Without one, a fixed limit of 2 is used. */
  getResidents?: (homeId: string) => number;
  /**
   * The multiplier on birth probability from the childcare subsidy. 1 means no ordinance.
   *
   * Applied to the **final** probability rather than to `baseFertilityRate`, which carries a
   * "different from the default means a test override" check that an ordinance multiplied in
   * would override as well.
   */
  fertilityMultiplier: number;
}

/** One BABY or CHILD per N of residential capacity, with a floor of 2. */
export const CHILDREN_PER_RESIDENTS = 4;

export const DEFAULT_CONTEXT: BirthContext = {
  baseFertilityRate: 0.04,  // per eligible citizen per month (called monthly)
  happinessBonus: 0.03,
  fertilityMultiplier: 1,
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

/** The BABY+CHILD limit for a building of this residential capacity. */
export function getMaxChildren(residents: number): number {
  return Math.max(2, Math.floor(residents / CHILDREN_PER_RESIDENTS));
}

/**
 * The natural birth tick, producing newborns from eligible adults' fertility.
 *
 * Eligible means:
 *  - lifeStage === ADULT and age <= MAX_FERTILITY_AGE
 *  - homeId !== null
 *  - the BABY + CHILD count under that homeId is below getMaxChildren(residents)
 *
 * Returns how many newborns this tick produced.
 */
export function birthTick(
  manager: CitizenManager,
  context?: Partial<BirthContext>,
  currentTick = 0,
): number {
  const ctx: BirthContext = { ...DEFAULT_CONTEXT, ...context };
  let births = 0;

  // The BABY+CHILD count and the total occupancy of each homeId are gathered first.
  //
  // The child limit alone is not enough: createCitizen's only capacity gate is the **city-wide**
  // residential total, so as long as empty housing exists elsewhere, a full 4-person house can
  // still produce 2 more children and stay 50% over capacity permanently
  // (computeOccupancyRatios clamps the ratio to 1.0 and the UI shows nothing). Actual occupancy
  // has to be compared against capacity per building (BUG-082).
  const childrenCount = new Map<string, number>();
  const occupancyCount = new Map<string, number>();
  for (const c of manager.getCitizens()) {
    if (c.homeId === null) continue;
    occupancyCount.set(c.homeId, (occupancyCount.get(c.homeId) ?? 0) + 1);
    if (c.lifeStage === LifeStage.BABY || c.lifeStage === LifeStage.CHILD) {
      childrenCount.set(c.homeId, (childrenCount.get(c.homeId) ?? 0) + 1);
    }
  }

  // Newborns are collected first, to avoid mutating the citizens array while iterating it.
  const newborns: { homeId: string }[] = [];

  // Walks the existing citizens and keeps the eligible ones.
  for (const c of manager.getCitizens()) {
    if (c.lifeStage !== LifeStage.ADULT) continue;
    if (c.age > BIRTH.MAX_FERTILITY_AGE) continue;
    if (c.homeId === null) continue;

    // Checks this building's child limit, proportional to capacity, and its remaining room.
    const currentChildren = (childrenCount.get(c.homeId) ?? 0);
    const residents = ctx.getResidents ? ctx.getResidents(c.homeId) : 8;
    if (currentChildren >= getMaxChildren(residents)) continue;
    if ((occupancyCount.get(c.homeId) ?? 0) >= residents) continue;

    // Fertility, adjusted for education level.
    const fertility = FERTILITY_BY_EDUCATION[c.education] ?? FERTILITY_BY_EDUCATION[EducationLevel.NONE];
    let rate = ctx.baseFertilityRate !== DEFAULT_CONTEXT.baseFertilityRate
      ? ctx.baseFertilityRate   // test override: use fixed rate
      : fertility.baseRate;
    if (c.happiness > fertility.happyThreshold) {
      rate += ctx.happinessBonus !== DEFAULT_CONTEXT.happinessBonus
        ? ctx.happinessBonus    // test override: use fixed bonus
        : fertility.happyBonus;
    }

    rate *= ctx.fertilityMultiplier;

    // The roll.
    if (Math.random() < rate) {
      newborns.push({ homeId: c.homeId });
      // The count is updated so one homeId cannot exceed its limit within this tick.
      childrenCount.set(c.homeId, currentChildren + 1);
      occupancyCount.set(c.homeId, (occupancyCount.get(c.homeId) ?? 0) + 1);
    }
  }

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
