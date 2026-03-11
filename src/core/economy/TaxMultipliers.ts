import { IncomeLevel } from '../citizen/types';

/** Base income per citizen for residential income tax ($0.50 per tick). */
export const CITIZEN_BASE_INCOME = 0.5;

/** Road maintenance cost per tile per budget tick. */
export const ROAD_MAINTENANCE_PER_TILE = 0.1;

/** Income level multiplier for residential income tax. */
export function getIncomeLevelMultiplier(level: IncomeLevel): number {
  switch (level) {
    case IncomeLevel.LOW: return 1.0;
    case IncomeLevel.MEDIUM: return 1.5;
    case IncomeLevel.HIGH: return 2.0;
    default: return 1.0;
  }
}

/** Building density level multiplier for business tax. */
export function getBuildingLevelMultiplier(level: 1 | 2 | 3): number {
  switch (level) {
    case 1: return 1.0;
    case 2: return 1.5;
    case 3: return 2.0;
    default: return 1.0;
  }
}
