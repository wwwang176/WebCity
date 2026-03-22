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

/** Housing scoring constants */
export const HOUSING_SCORE = {
  /** Score for exact level match */
  LEVEL_MATCH_EXACT: 30,
  /** Score for off-by-one level */
  LEVEL_MATCH_NEAR: 10,
  /** Score for mismatched level */
  LEVEL_MATCH_FAR: -10,
  /** Land value normalization midpoint (byte range 0-255) */
  LAND_VALUE_MIDPOINT: 128,
  /** Commute near threshold (manhattan distance) */
  COMMUTE_NEAR: 5,
  /** Commute far threshold */
  COMMUTE_FAR: 20,
  /** Commute best score */
  COMMUTE_BEST: 15,
  /** Commute worst score */
  COMMUTE_WORST: -15,
  /** Max service coverage input */
  SERVICE_MAX: 6,
  /** Max service score output */
  SERVICE_SCORE_MAX: 10,
  /** Park proximity bonus */
  PARK_BONUS: 5,
} as const;

/** Score how well the building level matches the citizen's education level */
export function scoreLevelMatch(education: EducationLevel, buildingLevel: number): number {
  const preferred = EDUCATION_TO_LEVEL[education];
  const diff = Math.abs(preferred - buildingLevel);
  if (diff === 0) return HOUSING_SCORE.LEVEL_MATCH_EXACT;
  if (diff === 1) return HOUSING_SCORE.LEVEL_MATCH_NEAR;
  return HOUSING_SCORE.LEVEL_MATCH_FAR;
}

/** Score based on land value — high education citizens prefer high land value areas */
export function scoreLandValue(education: EducationLevel, landValue: number): number {
  const weight = LAND_VALUE_WEIGHT[education];
  return (landValue - HOUSING_SCORE.LAND_VALUE_MIDPOINT) * weight;
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

  if (dist <= HOUSING_SCORE.COMMUTE_NEAR) return HOUSING_SCORE.COMMUTE_BEST;
  if (dist > HOUSING_SCORE.COMMUTE_FAR) return HOUSING_SCORE.COMMUTE_WORST;
  const range = HOUSING_SCORE.COMMUTE_BEST - HOUSING_SCORE.COMMUTE_WORST;
  const distRange = HOUSING_SCORE.COMMUTE_FAR - HOUSING_SCORE.COMMUTE_NEAR;
  return Math.round(HOUSING_SCORE.COMMUTE_BEST - (dist - HOUSING_SCORE.COMMUTE_NEAR) * (range / distRange));
}

/** Score based on service coverage and park access */
export function serviceScore(serviceCoverage: number, hasPark: boolean): number {
  const svc = Math.min(serviceCoverage, HOUSING_SCORE.SERVICE_MAX) * (HOUSING_SCORE.SERVICE_SCORE_MAX / HOUSING_SCORE.SERVICE_MAX);
  const parkBonus = hasPark ? HOUSING_SCORE.PARK_BONUS : 0;
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
