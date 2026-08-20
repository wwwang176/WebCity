export enum LifeStage {
  BABY = 'BABY',
  CHILD = 'CHILD',
  TEEN = 'TEEN',
  ADULT = 'ADULT',
  SENIOR = 'SENIOR',
}

export enum EducationLevel {
  NONE = 'NONE',
  ELEMENTARY = 'ELEMENTARY',
  HIGH_SCHOOL = 'HIGH_SCHOOL',
  UNIVERSITY = 'UNIVERSITY',
}


/** Aging rate: age (in life-weeks) gained per simulation tick.
 *  A full life (0→260 weeks) takes ~5 game years.
 *  @3x speed: ~1 hour real time for a full lifespan. */
export const AGE_PER_TICK = 0.006;

/** Hard death cap: citizens above this age die immediately. */
export const MAX_AGE = 280;

export interface Citizen {
  id: number;
  birthTick: number;   // simulation tick when citizen was born or immigrated
  age: number;         // cached age in life-weeks (recomputed daily from birthTick)
  lifeStage: LifeStage;
  education: EducationLevel;
  happiness: number;
  health: number;
  homeId: string | null;      // "x,y" grid position of home building
  workplaceId: string | null; // "x,y" grid position of workplace building
  unemployedSince: number | null; // tick when citizen became unemployed (working-age only)
  homelessSince: number | null;   // tick when citizen became homeless (evicted from building)
  emigrationTolerance: number; // personal happiness threshold below which citizen wants to leave
  educationProgress: number;   // 0=not enrolled, >0=enrolled (accumulated ticks)
}

/** Emigration tolerance: education base + random jitter */
export const EMIGRATION_TOLERANCE = {
  EDUCATION_BASE: { NONE: 18, ELEMENTARY: 22, HIGH_SCHOOL: 26, UNIVERSITY: 30 } as Record<string, number>,
  JITTER: 5,  // ±5 random
  FALLBACK: 25,  // default for legacy saves
} as const;

export function calculateEmigrationTolerance(education: EducationLevel): number {
  const base = EMIGRATION_TOLERANCE.EDUCATION_BASE[education] ?? EMIGRATION_TOLERANCE.FALLBACK;
  const jitter = Math.floor(Math.random() * (EMIGRATION_TOLERANCE.JITTER * 2 + 1)) - EMIGRATION_TOLERANCE.JITTER;
  return base + jitter;
}

/** Age thresholds for life stage transitions (in life-weeks) */
export const LIFE_STAGE_AGE = {
  BABY_MAX: 8,
  CHILD_MAX: 32,
  TEEN_MAX: 52,
  ADULT_MAX: 200,
} as const;

/** Check if age falls within working age range (adults only, excludes teens and seniors) */
export function isWorkingAge(age: number): boolean {
  return age > LIFE_STAGE_AGE.TEEN_MAX && age <= LIFE_STAGE_AGE.ADULT_MAX;
}

export function getLifeStage(age: number): LifeStage {
  if (age <= LIFE_STAGE_AGE.BABY_MAX) return LifeStage.BABY;
  if (age <= LIFE_STAGE_AGE.CHILD_MAX) return LifeStage.CHILD;
  if (age <= LIFE_STAGE_AGE.TEEN_MAX) return LifeStage.TEEN;
  if (age <= LIFE_STAGE_AGE.ADULT_MAX) return LifeStage.ADULT;
  return LifeStage.SENIOR;
}
