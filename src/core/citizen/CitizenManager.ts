import { type Citizen, LifeStage, EducationLevel, IncomeLevel, getLifeStage, calculateEmigrationTolerance, EMIGRATION_TOLERANCE } from './types';

/** Daily death rate per life stage (bathtub curve) */
export const DAILY_DEATH_RATE: Record<LifeStage, number> = {
  [LifeStage.BABY]:   0.00005,  // 0~5 yrs, slightly higher infant mortality
  [LifeStage.CHILD]:  0.00001,  // 6~12 yrs, lowest
  [LifeStage.TEEN]:   0.00001,  // 13~18 yrs, lowest
  [LifeStage.ADULT]:  0.00003,  // 19~65 yrs, low
  [LifeStage.SENIOR]: 0.0003,   // 66~90 yrs, significant increase
};

/** Health coverage multiplier on death rate */
export const HEALTH_MULTIPLIER = {
  COVERED: 0.3,      // 70% reduction with health coverage
  NOT_COVERED: 1.0,  // baseline
} as const;

/** Elderly multiplier: ramps up death rate above age 90 */
export function getElderlyMultiplier(age: number): number {
  if (age <= 90) return 1;
  if (age > 100) return Infinity;
  return 1 + (age - 90) * 1.0;
}

/** Data-driven education progression rules (OCP: add new levels without modifying loop logic) */
export interface EducationRule {
  lifeStage: LifeStage;
  requiredEducation: EducationLevel;
  nextEducation: EducationLevel;
  schoolKey: 'elementary' | 'highSchool' | 'university';
  maxAge?: number;
}

export const EDUCATION_PROGRESSION: readonly EducationRule[] = [
  { lifeStage: LifeStage.CHILD, requiredEducation: EducationLevel.NONE, nextEducation: EducationLevel.ELEMENTARY, schoolKey: 'elementary' },
  { lifeStage: LifeStage.TEEN, requiredEducation: EducationLevel.ELEMENTARY, nextEducation: EducationLevel.HIGH_SCHOOL, schoolKey: 'highSchool' },
  { lifeStage: LifeStage.ADULT, requiredEducation: EducationLevel.HIGH_SCHOOL, nextEducation: EducationLevel.UNIVERSITY, schoolKey: 'university', maxAge: 25 },
];

export class CitizenManager {
  private citizens: Citizen[] = [];
  private nextId = 1;

  /** Hook called after citizens are evicted from a building. Subscribers handle cleanup (e.g. commute cache). */
  onEvicted?: (citizenIds: number[]) => void;

  createCitizen(overrides: Partial<Citizen> = {}): Citizen {
    const age = overrides.age ?? 25;
    const income = overrides.incomeLevel ?? IncomeLevel.LOW;
    const education = overrides.education ?? EducationLevel.NONE;
    const citizen: Citizen = {
      id: this.nextId++,
      age,
      lifeStage: getLifeStage(age),
      education,
      incomeLevel: income,
      happiness: 50,
      health: 80,
      homeId: null,
      workplaceId: null,
      unemployedSince: null,
      homelessSince: null,
      emigrationTolerance: calculateEmigrationTolerance(income, education),
      ...overrides,
    };
    // Legacy saves may not have emigrationTolerance — assign fallback
    if (citizen.emigrationTolerance === undefined || citizen.emigrationTolerance === null) {
      citizen.emigrationTolerance = EMIGRATION_TOLERANCE.FALLBACK;
    }
    this.citizens.push(citizen);
    return citizen;
  }

  removeCitizen(id: number): void {
    this.citizens = this.citizens.filter((c) => c.id !== id);
  }

  getCitizen(id: number): Citizen | undefined {
    return this.citizens.find((c) => c.id === id);
  }

  getPopulation(): number {
    return this.citizens.length;
  }

  getCitizens(): readonly Citizen[] {
    return this.citizens;
  }

  getAverageHappiness(): number {
    if (this.citizens.length === 0) return 0;
    let sum = 0;
    for (const c of this.citizens) sum += c.happiness;
    return sum / this.citizens.length;
  }

  getCitizensByHome(buildingKey: string): Citizen[] {
    return this.citizens.filter((c) => c.homeId === buildingKey);
  }

  getCitizensByWorkplace(buildingKey: string): Citizen[] {
    return this.citizens.filter((c) => c.workplaceId === buildingKey);
  }

  /** Evict all citizens from a demolished building at the given position key.
   *  Nullifies homeId / workplaceId so citizens become homeless / unemployed.
   *  @param currentTick Current simulation tick — records homelessSince for duration tracking. */
  evictBuilding(posKey: string, currentTick?: number): number[] {
    const evictedIds: number[] = [];
    for (const c of this.citizens) {
      let affected = false;
      if (c.homeId === posKey) {
        c.homeId = null;
        c.homelessSince = currentTick ?? null;
        affected = true;
      }
      if (c.workplaceId === posKey) {
        c.workplaceId = null;
        affected = true;
      }
      if (affected) evictedIds.push(c.id);
    }
    if (evictedIds.length > 0) this.onEvicted?.(evictedIds);
    return evictedIds;
  }

  /** Called once per game year: age all citizens and update lifeStage */
  ageTick(): void {
    for (const c of this.citizens) {
      c.age++;
      c.lifeStage = getLifeStage(c.age);
    }
  }

  /** Called once per game day: bathtub-curve death check with health coverage.
   *  Returns array of dead citizen IDs (for cache cleanup). */
  deathTick(isHealthCovered: (citizen: Citizen) => boolean): number[] {
    const dead: number[] = [];
    for (const c of this.citizens) {
      if (c.age > 100) {
        dead.push(c.id);
        continue;
      }
      const baseRate = DAILY_DEATH_RATE[c.lifeStage];
      const elderlyMult = getElderlyMultiplier(c.age);
      const healthMult = isHealthCovered(c) ? HEALTH_MULTIPLIER.COVERED : HEALTH_MULTIPLIER.NOT_COVERED;
      const finalRate = baseRate * elderlyMult * healthMult;
      if (Math.random() < finalRate) {
        dead.push(c.id);
      }
    }
    for (const id of dead) this.removeCitizen(id);
    return dead;
  }

  educateTick(hasElementary: boolean, hasHighSchool: boolean, hasUniversity: boolean): void {
    const schools: Record<string, boolean> = { elementary: hasElementary, highSchool: hasHighSchool, university: hasUniversity };
    for (const c of this.citizens) {
      for (const rule of EDUCATION_PROGRESSION) {
        if (c.lifeStage === rule.lifeStage && schools[rule.schoolKey] && c.education === rule.requiredEducation) {
          if (rule.maxAge === undefined || c.age <= rule.maxAge) {
            c.education = rule.nextEducation;
          }
          break;
        }
      }
    }
  }
}
