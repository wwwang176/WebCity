import { IncomeLevel, type Citizen } from './types';
import { parsePosKeyUnsafe, manhattanDistance } from '../grid/GridHelpers';

export interface HousingCandidate {
  pos: string;
  capacity: number;
  level: number;
  landValue: number;        // 0-255
  groundPollution: number;  // 0-255
  noisePollution: number;   // 0-255
  serviceCoverage: number;  // 0-6
  hasPark: boolean;
}

/** Which income levels can afford each building level */
const AFFORDABILITY: Record<number, IncomeLevel[]> = {
  1: [IncomeLevel.LOW, IncomeLevel.MEDIUM, IncomeLevel.HIGH],
  2: [IncomeLevel.LOW, IncomeLevel.MEDIUM, IncomeLevel.HIGH],
  3: [IncomeLevel.MEDIUM, IncomeLevel.HIGH],
};

/** Map income level to a preferred building level (1-3) */
const INCOME_TO_LEVEL: Record<IncomeLevel, number> = {
  [IncomeLevel.LOW]: 1,
  [IncomeLevel.MEDIUM]: 2,
  [IncomeLevel.HIGH]: 3,
};

/** Weight multiplier for land value sensitivity by income */
const LAND_VALUE_WEIGHT: Record<IncomeLevel, number> = {
  [IncomeLevel.LOW]: 0.02,
  [IncomeLevel.MEDIUM]: 0.05,
  [IncomeLevel.HIGH]: 0.1,
};

/** Weight multiplier for pollution sensitivity by income */
const POLLUTION_WEIGHT: Record<IncomeLevel, number> = {
  [IncomeLevel.LOW]: 0.03,
  [IncomeLevel.MEDIUM]: 0.05,
  [IncomeLevel.HIGH]: 0.1,
};

/** Check if a citizen of the given income level can afford a building of the given level */
export function canAfford(income: IncomeLevel, buildingLevel: number): boolean {
  const allowed = AFFORDABILITY[buildingLevel];
  return allowed !== undefined && allowed.includes(income);
}

/** Score how well the building level matches the citizen's income level */
export function scoreLevelMatch(income: IncomeLevel, buildingLevel: number): number {
  const preferred = INCOME_TO_LEVEL[income];
  const diff = Math.abs(preferred - buildingLevel);
  if (diff === 0) return 30;
  if (diff === 1) return 10;
  return -10;
}

/** Score based on land value — high income citizens prefer high land value areas */
export function scoreLandValue(income: IncomeLevel, landValue: number): number {
  const weight = LAND_VALUE_WEIGHT[income];
  // Normalize around midpoint (128): positive for above, negative for below
  return (landValue - 128) * weight;
}

/** Score based on pollution — penalizes all citizens, but HIGH income more */
export function scorePollution(
  income: IncomeLevel,
  groundPollution: number,
  noisePollution: number,
): number {
  if (groundPollution === 0 && noisePollution === 0) return 0;
  const weight = POLLUTION_WEIGHT[income];
  const combined = groundPollution * 0.7 + noisePollution * 0.3;
  return -combined * weight;
}

/** Score based on commute distance (manhattan) from workplace to candidate */
export function scoreCommute(
  workplacePos: string | null,
  candidatePos: string,
): number {
  if (workplacePos === null) return 0;

  const wp = parsePosKeyUnsafe(workplacePos);
  const cp = parsePosKeyUnsafe(candidatePos);
  const dist = manhattanDistance(wp.x, wp.y, cp.x, cp.y);

  if (dist <= 5) return 15;
  if (dist > 20) return -15;
  // Linear interpolation between 5 and 20: 15 → -15
  return Math.round(15 - (dist - 5) * (30 / 15));
}

/** Score based on service coverage and park access */
export function serviceScore(serviceCoverage: number, hasPark: boolean): number {
  // serviceCoverage 0-6 maps to 0-10
  const svc = Math.min(serviceCoverage, 6) * (10 / 6);
  const parkBonus = hasPark ? 5 : 0;
  return Math.round(svc + parkBonus);
}

/** Compute the total housing preference score for a citizen/candidate pair */
export function scoreHousing(citizen: Citizen, candidate: HousingCandidate): number {
  let score = 0;
  score += scoreLevelMatch(citizen.incomeLevel, candidate.level);
  score += scoreLandValue(citizen.incomeLevel, candidate.landValue);
  score += scorePollution(citizen.incomeLevel, candidate.groundPollution, candidate.noisePollution);
  score += scoreCommute(citizen.workplaceId, candidate.pos);
  score += serviceScore(candidate.serviceCoverage, candidate.hasPark);
  return score;
}
