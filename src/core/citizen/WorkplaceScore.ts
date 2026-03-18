import { EducationLevel, type Citizen } from './types';
import { ZoneType, isCommercialZone } from '../grid/types';
import { scoreCommute } from './HousingScore';

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

/** Score commute based on Dijkstra road cost (used by job relocation). */
export function scoreCommuteByCost(cost: number | null): number {
  if (cost === null) return -20;
  if (cost <= 10) return 15;
  if (cost > 40) return -15;
  return Math.round(15 - (cost - 10) * (30 / 30));
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
): number {
  let score = 0;

  // Education-zone match
  score += scoreEducationMatch(citizen.education, zoneType);

  // Commute distance from home (shared scoring function from HousingScore)
  score += scoreCommute(citizen.homeId, workplacePos);

  return score;
}
