import { IncomeLevel, type Citizen } from './types';
import { ZoneType } from '../grid/types';
import { parsePosKeyUnsafe, manhattanDistance } from '../grid/GridHelpers';

export interface WorkplaceCandidate {
  pos: string;
  capacity: number;
  zoneType: ZoneType;
}

/**
 * Zone-type preference scores by income level.
 * HIGH income prefers OFFICE, LOW income prefers INDUSTRIAL,
 * MEDIUM income prefers COMMERCIAL.
 */
const ZONE_PREFERENCE: Record<IncomeLevel, Partial<Record<ZoneType, number>>> = {
  [IncomeLevel.LOW]: {
    [ZoneType.INDUSTRIAL]: 20,
    [ZoneType.COMMERCIAL_LOW]: 10,
    [ZoneType.COMMERCIAL_HIGH]: 10,
    [ZoneType.OFFICE]: 0,
  },
  [IncomeLevel.MEDIUM]: {
    [ZoneType.COMMERCIAL_LOW]: 20,
    [ZoneType.COMMERCIAL_HIGH]: 20,
    [ZoneType.OFFICE]: 10,
    [ZoneType.INDUSTRIAL]: 5,
  },
  [IncomeLevel.HIGH]: {
    [ZoneType.OFFICE]: 20,
    [ZoneType.COMMERCIAL_HIGH]: 10,
    [ZoneType.COMMERCIAL_LOW]: 5,
    [ZoneType.INDUSTRIAL]: 0,
  },
};

/** Score commute from home to workplace candidate */
function scoreWorkplaceCommute(homePos: string | null, candidatePos: string): number {
  if (homePos === null) return 0;

  const hp = parsePosKeyUnsafe(homePos);
  const cp = parsePosKeyUnsafe(candidatePos);
  const dist = manhattanDistance(hp.x, hp.y, cp.x, cp.y);

  if (dist <= 5) return 15;
  if (dist > 20) return -15;
  // Linear interpolation between 5 and 20: 15 → -15
  return Math.round(15 - (dist - 5) * (30 / 15));
}

/** Compute total workplace preference score */
export function scoreWorkplace(
  citizen: Citizen,
  workplacePos: string,
  zoneType: ZoneType,
): number {
  let score = 0;

  // Zone-type preference based on income level
  const prefs = ZONE_PREFERENCE[citizen.incomeLevel];
  score += prefs[zoneType] ?? 0;

  // Commute distance from home
  score += scoreWorkplaceCommute(citizen.homeId, workplacePos);

  return score;
}
