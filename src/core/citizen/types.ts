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

export enum IncomeLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export interface Citizen {
  id: number;
  age: number;
  lifeStage: LifeStage;
  education: EducationLevel;
  incomeLevel: IncomeLevel;
  happiness: number;
  health: number;
  homeId: string | null;      // "x,y" grid position of home building
  workplaceId: string | null; // "x,y" grid position of workplace building
  unemployedSince: number | null; // tick when citizen became unemployed (working-age only)
  homelessSince: number | null;   // tick when citizen became homeless (evicted from building)
  emigrationTolerance: number; // personal happiness threshold below which citizen wants to leave
  educationProgress: number;   // 0=not enrolled, >0=enrolled (accumulated ticks)
}

/** Emigration tolerance: income base + education bonus + random jitter */
export const EMIGRATION_TOLERANCE = {
  INCOME_BASE: { LOW: 18, MEDIUM: 24, HIGH: 30 } as Record<string, number>,
  EDUCATION_BONUS: { NONE: 0, ELEMENTARY: 1, HIGH_SCHOOL: 3, UNIVERSITY: 5 } as Record<string, number>,
  JITTER: 5,  // ±5 random
  FALLBACK: 25,  // default for legacy saves
} as const;

export function calculateEmigrationTolerance(income: IncomeLevel, education: EducationLevel): number {
  const base = EMIGRATION_TOLERANCE.INCOME_BASE[income] ?? EMIGRATION_TOLERANCE.FALLBACK;
  const bonus = EMIGRATION_TOLERANCE.EDUCATION_BONUS[education] ?? 0;
  const jitter = Math.floor(Math.random() * (EMIGRATION_TOLERANCE.JITTER * 2 + 1)) - EMIGRATION_TOLERANCE.JITTER;
  return base + bonus + jitter;
}

/** Age thresholds for life stage transitions */
export const LIFE_STAGE_AGE = {
  BABY_MAX: 5,
  CHILD_MAX: 12,
  TEEN_MAX: 18,
  ADULT_MAX: 65,
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
