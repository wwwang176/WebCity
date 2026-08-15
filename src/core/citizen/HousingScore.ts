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
   * 通勤時間（tick）在這之內就算好通勤，拿滿分。
   *
   * 實測：住商混合的小鎮中位數 11，站旁邊的捷運族 16~34。15 讓「走得到、
   * 搭得到」的通勤拿到高分。
   */
  COMMUTE_TIME_NEAR: 15,
  /**
   * 通勤時間超過這個值就吃滿扣分，與換工作的門檻同一把尺。
   *
   * 實測：分區而沒有大眾運輸的城市中位數 70、塞爆的城市 108，而站旁邊的
   * 捷運族不管住多遠都在 34 以內 —— 所以這條線分得開「城市規劃很糟」與
   * 「住得遠但交通好」。
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
 * 依**通勤時間**評分。
 *
 * 時間而不是距離：開車時間隨距離與壅塞上升，搭車時間由路網決定，兩者是同一個
 * 尺度。用直線距離的話，一間就在捷運站旁的房子與荒郊野外的房子分數相同，玩家
 * 蓋的運輸建設對居住偏好完全沒有影響。
 *
 * `null` 代表算不出通勤（沒有工作），給 0 —— 不加分也不扣分。
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
 * 從 A 到 B 的通勤要花多久（tick）。`null` = 算不出來。
 *
 * 由呼叫端注入，因為時間取決於壅塞與大眾運輸，而那些只有模擬迴圈知道。
 */
export type CommuteTimeEstimator = (fromPos: string, toPos: string) => number | null;

/**
 * 沒有注入估計器時的退路：直線距離當作通勤時間。
 *
 * 等同於「完全不塞車、沒有任何大眾運輸」的城市。只給測試與尚未接線的呼叫端用。
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
