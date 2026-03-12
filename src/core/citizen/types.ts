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
