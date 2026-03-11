import { IncomeLevel } from '../citizen/types';

/** Base income per citizen for residential income tax ($0.50 per tick). */
export const CITIZEN_BASE_INCOME = 0.5;

/** Road maintenance cost per tile per budget tick. */
export const ROAD_MAINTENANCE_PER_TILE = 0.1;

/** Data-driven income level multipliers for residential income tax. */
export const INCOME_LEVEL_MULTIPLIERS: Record<IncomeLevel, number> = {
  [IncomeLevel.LOW]: 1.0,
  [IncomeLevel.MEDIUM]: 1.5,
  [IncomeLevel.HIGH]: 2.0,
} as const;

/** Data-driven building density level multipliers for business tax. */
export const BUILDING_LEVEL_MULTIPLIERS: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 1.5,
  3: 2.0,
} as const;

/** Income level multiplier for residential income tax. */
export function getIncomeLevelMultiplier(level: IncomeLevel): number {
  return INCOME_LEVEL_MULTIPLIERS[level] ?? 1.0;
}

/** Building density level multiplier for business tax. */
export function getBuildingLevelMultiplier(level: 1 | 2 | 3): number {
  return BUILDING_LEVEL_MULTIPLIERS[level] ?? 1.0;
}
