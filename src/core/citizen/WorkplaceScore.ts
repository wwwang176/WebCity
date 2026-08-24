import { EducationLevel, type Citizen } from './types';
import { ZoneType, isCommercialZone } from '../grid/types';
import { scoreCommute, straightLineCommuteTime, type CommuteTimeEstimator } from './HousingScore';

export interface WorkplaceCandidate {
  pos: string;
  capacity: number;
  zoneType: ZoneType;
}

/**
 * Education-zone match scores.
 * Office wants high education, Industrial wants low, Commercial is mild.
 */
const EDUCATION_ZONE_SCORE: Record<string, Record<EducationLevel, number>> = {
  office:     { [EducationLevel.NONE]: -10, [EducationLevel.ELEMENTARY]: -5, [EducationLevel.HIGH_SCHOOL]: 5, [EducationLevel.UNIVERSITY]: 15 },
  industrial: { [EducationLevel.NONE]: 10,  [EducationLevel.ELEMENTARY]: 5,  [EducationLevel.HIGH_SCHOOL]: 0, [EducationLevel.UNIVERSITY]: -10 },
  commercial: { [EducationLevel.NONE]: 0,   [EducationLevel.ELEMENTARY]: 5,  [EducationLevel.HIGH_SCHOOL]: 5, [EducationLevel.UNIVERSITY]: 0 },
};

export function scoreEducationMatch(education: EducationLevel, zoneType: ZoneType): number {
  if (zoneType === ZoneType.OFFICE) return EDUCATION_ZONE_SCORE.office![education];
  if (zoneType === ZoneType.INDUSTRIAL) return EDUCATION_ZONE_SCORE.industrial![education];
  if (isCommercialZone(zoneType)) return EDUCATION_ZONE_SCORE.commercial![education];
  return 0;
}

// scoreWorkplaceCommute removed — shared scoreCommute from HousingScore.ts (DRY)

/**
 * Commute scoring constants for job relocation.
 *
 * `SHORT_DISTANCE` and `LONG_DISTANCE` are in road cost units (see `core/road/roadCost.ts`), on
 * the same scale as `roadTileCost`: 10 and 40 on the old scale became 180 and 720 as integers.
 * The bonus and penalty are not distances and keep their values.
 */
export const COMMUTE_SCORE = {
  NO_PATH_PENALTY: -20,
  SHORT_DISTANCE: 180,
  SHORT_BONUS: 15,
  LONG_DISTANCE: 720,
  LONG_PENALTY: -15,
} as const;

/** Score commute based on Dijkstra road cost (used by job relocation). */
export function scoreCommuteByCost(cost: number | null): number {
  if (cost === null) return COMMUTE_SCORE.NO_PATH_PENALTY;
  if (cost <= COMMUTE_SCORE.SHORT_DISTANCE) return COMMUTE_SCORE.SHORT_BONUS;
  if (cost > COMMUTE_SCORE.LONG_DISTANCE) return COMMUTE_SCORE.LONG_PENALTY;
  return Math.round(COMMUTE_SCORE.SHORT_BONUS - (cost - COMMUTE_SCORE.SHORT_DISTANCE) * ((COMMUTE_SCORE.SHORT_BONUS - COMMUTE_SCORE.LONG_PENALTY) / (COMMUTE_SCORE.LONG_DISTANCE - COMMUTE_SCORE.SHORT_DISTANCE)));
}

/** Job relocation scoring: education match + road-cost commute. */
export function scoreWorkplaceWithCost(
  citizen: Citizen,
  zoneType: ZoneType,
  roadCost: number | null,
): number {
  return scoreEducationMatch(citizen.education, zoneType) + scoreCommuteByCost(roadCost);
}

/** Compute total workplace preference score */
export function scoreWorkplace(
  citizen: Citizen,
  workplacePos: string,
  zoneType: ZoneType,
  estimate: CommuteTimeEstimator = straightLineCommuteTime,
): number {
  let score = 0;

  // Education-zone match
  score += scoreEducationMatch(citizen.education, zoneType);

  // Commute time, on the same scale as the housing score.
  score += scoreCommute(citizen.homeId ? estimate(citizen.homeId, workplacePos) : null);

  return score;
}
