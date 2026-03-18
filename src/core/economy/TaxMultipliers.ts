import { EducationLevel } from '../citizen/types';

export const ECONOMY = {
  /** Base income per citizen for residential income tax ($0.50 per tick). */
  CITIZEN_BASE_INCOME: 0.5,
  /** Road maintenance cost per tile per budget tick. */
  ROAD_MAINTENANCE_PER_TILE: 0.1,
} as const;

/** Building level multipliers for business tax (commercial/industrial/office). */
export const BUILDING_LEVEL_MULTIPLIERS: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 1.5,
  3: 2.0,
} as const;

/** Building level multipliers for residential tax (milder than business). */
export const RESIDENTIAL_LEVEL_MULTIPLIERS: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 1.15,
  3: 1.3,
} as const;

/** Education-based salary multipliers for residential tax. */
export const EDUCATION_SALARY_MULTIPLIERS: Record<EducationLevel, number> = {
  [EducationLevel.NONE]: 1.0,
  [EducationLevel.ELEMENTARY]: 1.1,
  [EducationLevel.HIGH_SCHOOL]: 1.3,
  [EducationLevel.UNIVERSITY]: 1.5,
} as const;

/** Building density level multiplier for business tax. */
export function getBuildingLevelMultiplier(level: 1 | 2 | 3): number {
  return BUILDING_LEVEL_MULTIPLIERS[level] ?? 1.0;
}

/** Building level multiplier for residential tax (milder scaling). */
export function getResidentialLevelMultiplier(level: 1 | 2 | 3): number {
  return RESIDENTIAL_LEVEL_MULTIPLIERS[level] ?? 1.0;
}

/** Education-based salary multiplier for residential tax. */
export function getEducationSalaryMultiplier(education: EducationLevel): number {
  return EDUCATION_SALARY_MULTIPLIERS[education] ?? 1.0;
}
