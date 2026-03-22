import { EducationLevel, type Citizen } from './types';
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

/** Map education level to a preferred building level (1-3) */
const EDUCATION_TO_LEVEL: Record<EducationLevel, number> = {
  [EducationLevel.NONE]: 1,
  [EducationLevel.ELEMENTARY]: 1,
  [EducationLevel.HIGH_SCHOOL]: 2,
  [EducationLevel.UNIVERSITY]: 3,
};

/** Weight multiplier for land value sensitivity by education */
const LAND_VALUE_WEIGHT: Record<EducationLevel, number> = {
  [EducationLevel.NONE]: 0.02,
  [EducationLevel.ELEMENTARY]: 0.03,
  [EducationLevel.HIGH_SCHOOL]: 0.05,
  [EducationLevel.UNIVERSITY]: 0.1,
};

/** Weight multiplier for pollution sensitivity by education */
const POLLUTION_WEIGHT: Record<EducationLevel, number> = {
  [EducationLevel.NONE]: 0.03,
  [EducationLevel.ELEMENTARY]: 0.04,
  [EducationLevel.HIGH_SCHOOL]: 0.05,
  [EducationLevel.UNIVERSITY]: 0.1,
};

/** Score how well the building level matches the citizen's education level */
export function scoreLevelMatch(education: EducationLevel, buildingLevel: number): number {
  const preferred = EDUCATION_TO_LEVEL[education];
  const diff = Math.abs(preferred - buildingLevel);
  if (diff === 0) return 30;
  if (diff === 1) return 10;
  return -10;
}

/** Score based on land value — high education citizens prefer high land value areas */
export function scoreLandValue(education: EducationLevel, landValue: number): number {
  const weight = LAND_VALUE_WEIGHT[education];
  // Normalize around midpoint (128): positive for above, negative for below
  return (landValue - 128) * weight;
}

/** Pollution combination weights for housing score */
export const POLLUTION_COMBO = {
  GROUND_WEIGHT: 0.7,
  NOISE_WEIGHT: 0.3,
} as const;

/** Score based on pollution — penalizes all citizens, but higher education more */
export function scorePollution(
  education: EducationLevel,
  groundPollution: number,
  noisePollution: number,
): number {
  if (groundPollution === 0 && noisePollution === 0) return 0;
  const weight = POLLUTION_WEIGHT[education];
  const combined = groundPollution * POLLUTION_COMBO.GROUND_WEIGHT + noisePollution * POLLUTION_COMBO.NOISE_WEIGHT;
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
  score += scoreLevelMatch(citizen.education, candidate.level);
  score += scoreLandValue(citizen.education, candidate.landValue);
  score += scorePollution(citizen.education, candidate.groundPollution, candidate.noisePollution);
  score += scoreCommute(citizen.workplaceId, candidate.pos);
  score += serviceScore(candidate.serviceCoverage, candidate.hasPark);
  return score;
}
