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
  /**
   * A commute within this many ticks counts as good and scores full marks.
   *
   * Measured: a mixed-use town's median is 11, and metro riders beside a station run 16-34. 15
   * gives a high score to a commute that can be walked or ridden.
   */
  COMMUTE_TIME_NEAR: 15,
  /**
   * Past this, the commute takes the full penalty. The same scale as the job-change threshold.
   *
   * Measured: a zoned city with no transit has a median of 70 and a gridlocked one 108, while
   * metro riders beside a station stay within 34 however far they live. So this line separates
   * bad city planning from living far away with good transport.
   */
  COMMUTE_TIME_FAR: 60,
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

/**
 * Scores by **commute time**.
 *
 * Time rather than distance: driving time rises with distance and congestion, transit time is
 * decided by the network, and both are on one scale. By straight-line distance, a house beside a
 * metro station scores the same as one in open country, and the transport the player builds has
 * no effect on where people want to live.
 *
 * `null` means the commute cannot be computed, as for someone with no job, and scores 0: neither
 * bonus nor penalty.
 */
export function scoreCommute(commuteTime: number | null): number {
  if (commuteTime === null) return 0;

  if (commuteTime <= HOUSING_SCORE.COMMUTE_TIME_NEAR) return HOUSING_SCORE.COMMUTE_BEST;
  if (commuteTime > HOUSING_SCORE.COMMUTE_TIME_FAR) return HOUSING_SCORE.COMMUTE_WORST;
  const range = HOUSING_SCORE.COMMUTE_BEST - HOUSING_SCORE.COMMUTE_WORST;
  const timeRange = HOUSING_SCORE.COMMUTE_TIME_FAR - HOUSING_SCORE.COMMUTE_TIME_NEAR;
  return Math.round(
    HOUSING_SCORE.COMMUTE_BEST - (commuteTime - HOUSING_SCORE.COMMUTE_TIME_NEAR) * (range / timeRange),
  );
}

/** Score based on service coverage and park access */
export function serviceScore(serviceCoverage: number, hasPark: boolean): number {
  const svc = Math.min(serviceCoverage, HOUSING_SCORE.SERVICE_MAX) * (HOUSING_SCORE.SERVICE_SCORE_MAX / HOUSING_SCORE.SERVICE_MAX);
  const parkBonus = hasPark ? HOUSING_SCORE.PARK_BONUS : 0;
  return Math.round(svc + parkBonus);
}

/**
 * How many ticks a commute from A to B takes. `null` when it cannot be computed.
 *
 * Injected by the caller, because the time depends on congestion and transit, which only the
 * simulation loop knows.
 */
export type CommuteTimeEstimator = (fromPos: string, toPos: string) => number | null;

/**
 * The fallback when no estimator is injected: straight-line distance as the commute time.
 *
 * Equivalent to a city with no congestion and no transit at all. For tests and callers not yet
 * wired up.
 */
export const straightLineCommuteTime: CommuteTimeEstimator = (fromPos, toPos) => {
  const a = parsePosKeyUnsafe(fromPos);
  const b = parsePosKeyUnsafe(toPos);
  return manhattanDistance(a.x, a.y, b.x, b.y);
};

/** Compute the total housing preference score for a citizen/candidate pair */
export function scoreHousing(
  citizen: Citizen,
  candidate: HousingCandidate,
  estimate: CommuteTimeEstimator = straightLineCommuteTime,
): number {
  let score = 0;
  score += scoreLevelMatch(citizen.education, candidate.level);
  score += scoreLandValue(citizen.education, candidate.landValue);
  score += scorePollution(citizen.education, candidate.groundPollution, candidate.noisePollution);
  score += scoreCommute(citizen.workplaceId ? estimate(citizen.workplaceId, candidate.pos) : null);
  score += serviceScore(candidate.serviceCoverage, candidate.hasPark);
  return score;
}
