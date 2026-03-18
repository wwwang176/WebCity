import { type Citizen, LifeStage, EducationLevel, IncomeLevel, getLifeStage, calculateEmigrationTolerance, EMIGRATION_TOLERANCE, LIFE_STAGE_AGE, AGE_PER_TICK, MAX_AGE } from './types';
import { parsePosKeyUnsafe } from '../grid/GridHelpers';

/** Daily death rate per life stage (bathtub curve) — calibrated for compressed life-week aging. */
export const DAILY_DEATH_RATE: Record<LifeStage, number> = {
  [LifeStage.BABY]:   0.0016,    // 0-8 wk: ~91% survive without health
  [LifeStage.CHILD]:  0.00015,   // 9-32 wk: ~98% survive
  [LifeStage.TEEN]:   0.00015,   // 33-52 wk: ~98% survive
  [LifeStage.ADULT]:  0.0005,    // 53-200 wk: ~60% survive without health
  [LifeStage.SENIOR]: 0.006,     // 201-260 wk: ~8% survive without health
};

/** Health coverage multiplier on death rate */
export const HEALTH_MULTIPLIER = {
  COVERED: 0.3,      // 70% reduction with health coverage
  NOT_COVERED: 1.0,  // baseline
} as const;

/** Elderly multiplier: ramps up death rate above 240 life-weeks */
export function getElderlyMultiplier(age: number): number {
  if (age <= 240) return 1;
  if (age > MAX_AGE) return Infinity;
  return 1 + (age - 240) * 0.25;
}

/** Data-driven education progression rules — no age/lifeStage restriction, anyone can learn. */
export interface EducationRule {
  requiredEducation: EducationLevel;
  nextEducation: EducationLevel;
  schoolKey: 'elementary' | 'highSchool' | 'university';
}

/** Minimum age to enroll in school (babies excluded). */
export const MIN_SCHOOL_AGE = LIFE_STAGE_AGE.BABY_MAX + 1; // 9 life-weeks

/** Progress scale factor — all progress/thresholds use ×100 for integer math. */
export const EDUCATION_SCALE = 100;

/** Graduation thresholds (×100 scale) — scaled for compressed life-week aging.
 *  Child: 150 ticks, Teen: 120 ticks, Adult(uni): ~303 ticks. */
export const GRADUATION_TICKS: Record<EducationRule['schoolKey'], number> = {
  elementary: 150 * EDUCATION_SCALE,  // 15,000 → child 150, adult ~455, senior 750 ticks
  highSchool: 120 * EDUCATION_SCALE,  // 12,000 → child 120, adult ~364, senior 600 ticks
  university: 100 * EDUCATION_SCALE,  // 10,000 → child 100, adult ~303, senior 500 ticks
};

/** Base speed points per tick. Younger = faster, older = slower. */
export function getLearningSpeed(age: number): number {
  if (age <= LIFE_STAGE_AGE.TEEN_MAX) return 100;  // children & teens: full speed
  if (age <= LIFE_STAGE_AGE.ADULT_MAX) return 33;  // adults: ~3x slower
  return 20;                                         // seniors: 5x slower
}

/** Jitter range for per-tick learning speed (80%~120%) to stagger graduations. */
export const LEARNING_JITTER = { MIN: 0.8, MAX: 1.2 } as const;

/** Apply jitter to base speed: returns integer speed with 80%~120% random variation. */
export function jitteredSpeed(baseSpeed: number): number {
  const jitter = LEARNING_JITTER.MIN + Math.random() * (LEARNING_JITTER.MAX - LEARNING_JITTER.MIN);
  return Math.round(baseSpeed * jitter);
}

export const EDUCATION_PROGRESSION: readonly EducationRule[] = [
  { requiredEducation: EducationLevel.NONE, nextEducation: EducationLevel.ELEMENTARY, schoolKey: 'elementary' },
  { requiredEducation: EducationLevel.ELEMENTARY, nextEducation: EducationLevel.HIGH_SCHOOL, schoolKey: 'highSchool' },
  { requiredEducation: EducationLevel.HIGH_SCHOOL, nextEducation: EducationLevel.UNIVERSITY, schoolKey: 'university' },
];

export class CitizenManager {
  private citizens: Citizen[] = [];
  private nextId = 1;

  /** Hook called after citizens are evicted from a building. Subscribers handle cleanup (e.g. commute cache). */
  onEvicted?: (citizenIds: number[]) => void;

  createCitizen(overrides: Partial<Citizen> = {}, currentTick = 0): Citizen {
    const age = overrides.age ?? 100; // default mid-ADULT (life-weeks)
    const income = overrides.incomeLevel ?? IncomeLevel.LOW;
    const education = overrides.education ?? EducationLevel.NONE;
    const citizen: Citizen = {
      id: this.nextId++,
      birthTick: overrides.birthTick ?? Math.round(currentTick - age / AGE_PER_TICK),
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
      educationProgress: 0,
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

  /** Count currently enrolled students per school type. */
  getEnrolledCounts(): Record<EducationRule['schoolKey'], number> {
    const counts: Record<EducationRule['schoolKey'], number> = { elementary: 0, highSchool: 0, university: 0 };
    for (const c of this.citizens) {
      if (c.educationProgress <= 0) continue;
      for (const r of EDUCATION_PROGRESSION) {
        if (c.education === r.requiredEducation) {
          counts[r.schoolKey]++;
          break;
        }
      }
    }
    return counts;
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

  /** Called once per game day: recompute all citizen ages from birthTick.
   *  Using birthTick avoids float accumulation errors. */
  updateAges(currentTick: number): void {
    for (const c of this.citizens) {
      c.age = (currentTick - c.birthTick) * AGE_PER_TICK;
      c.lifeStage = getLifeStage(c.age);
    }
  }

  /** Called once per game day: bathtub-curve death check with health coverage.
   *  Returns array of dead citizen IDs (for cache cleanup). */
  deathTick(isHealthCovered: (citizen: Citizen) => boolean): number[] {
    const dead: number[] = [];
    for (const c of this.citizens) {
      if (c.age > MAX_AGE) {
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

  /**
   * Two-phase education tick with capacity limits and graduation time.
   * Phase 1: advance enrolled students, graduate those who reach the threshold, drop those who lost coverage.
   * Phase 2: enroll new students up to remaining capacity.
   */
  educateTick(
    isSchoolCovered: (x: number, y: number, schoolKey: EducationRule['schoolKey']) => boolean,
    capacityBySchoolKey: Record<EducationRule['schoolKey'], number>,
  ): void {
    const enrolledCount: Record<EducationRule['schoolKey'], number> = { elementary: 0, highSchool: 0, university: 0 };

    // Phase 1 — advance enrolled students, pause if homeless/uncovered (never reset progress)
    for (const c of this.citizens) {
      if (c.educationProgress <= 0) continue;
      const matched = EDUCATION_PROGRESSION.find(r => c.education === r.requiredEducation);
      if (!matched) continue;
      // Graduate immediately if already past threshold (handles save migration threshold changes)
      if (c.educationProgress >= GRADUATION_TICKS[matched.schoolKey]) {
        c.education = matched.nextEducation;
        c.educationProgress = 0;
        continue;
      }
      if (c.age < MIN_SCHOOL_AGE || !c.homeId) continue; // paused, keep progress
      const pos = parsePosKeyUnsafe(c.homeId);
      if (!isSchoolCovered(pos.x, pos.y, matched.schoolKey)) continue; // paused, keep progress
      c.educationProgress += jitteredSpeed(getLearningSpeed(c.age));
      if (c.educationProgress >= GRADUATION_TICKS[matched.schoolKey]) {
        c.education = matched.nextEducation;
        c.educationProgress = 0; // only graduation resets progress
      } else {
        enrolledCount[matched.schoolKey]++;
      }
    }

    // Phase 2 — enroll new students (remaining capacity)
    const remaining: Record<EducationRule['schoolKey'], number> = {
      elementary: capacityBySchoolKey.elementary - enrolledCount.elementary,
      highSchool: capacityBySchoolKey.highSchool - enrolledCount.highSchool,
      university: capacityBySchoolKey.university - enrolledCount.university,
    };

    for (const c of this.citizens) {
      if (!c.homeId || c.educationProgress > 0 || c.age < MIN_SCHOOL_AGE) continue;
      const rule = EDUCATION_PROGRESSION.find(r => c.education === r.requiredEducation);
      if (rule && remaining[rule.schoolKey] > 0) {
        const pos = parsePosKeyUnsafe(c.homeId);
        if (isSchoolCovered(pos.x, pos.y, rule.schoolKey)) {
          c.educationProgress = jitteredSpeed(getLearningSpeed(c.age));
          remaining[rule.schoolKey]--;
        }
      }
    }
  }
}
