import { IncomeLevel } from '../citizen/types';

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
