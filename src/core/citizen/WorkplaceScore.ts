import { EducationLevel, IncomeLevel, type Citizen } from './types';
import { ZoneType, isCommercialZone } from '../grid/types';
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
  if (zoneType === ZoneType.OFFICE) return EDUCATION_ZONE_SCORE.office[education];
  if (zoneType === ZoneType.INDUSTRIAL) return EDUCATION_ZONE_SCORE.industrial[education];
  if (isCommercialZone(zoneType)) return EDUCATION_ZONE_SCORE.commercial[education];
  return 0;
}

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

/** Score commute based on Dijkstra road cost (used by job relocation). */
export function scoreCommuteByCost(cost: number | null): number {
  if (cost === null) return -20;
  if (cost <= 10) return 15;
  if (cost > 40) return -15;
  return Math.round(15 - (cost - 10) * (30 / 30));
}

/** Job relocation scoring: zone preference + education match + road-cost commute. */
export function scoreWorkplaceWithCost(
  citizen: Citizen,
  zoneType: ZoneType,
  roadCost: number | null,
): number {
  const prefs = ZONE_PREFERENCE[citizen.incomeLevel];
  return (prefs[zoneType] ?? 0) + scoreEducationMatch(citizen.education, zoneType) + scoreCommuteByCost(roadCost);
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

  // Education-zone match
  score += scoreEducationMatch(citizen.education, zoneType);

  // Commute distance from home
  score += scoreWorkplaceCommute(citizen.homeId, workplacePos);

  return score;
}
