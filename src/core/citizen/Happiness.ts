import { type Citizen, EducationLevel, isWorkingAge } from './types';
import { ZoneType } from '../grid/types';

export interface HappinessFactors {
  commuteDistance: number;
  hasPark: boolean;
  pollution: number;
  noiseLevel: number;
  crimeRate: number;
  isEmployed: boolean;
  taxRate: number;
  serviceCoverage: number;
  currentTick?: number;
  homePowered?: boolean;
  homeWatered?: boolean;
  workplaceZoneType?: ZoneType;
  /** Shopping access ratio (0~1) for this citizen's home. undefined = skip. */
  shoppingAccess?: number;
}

/** Threshold entry for data-driven modifier evaluation (sorted descending by threshold). */
export interface ThresholdModifier {
  threshold: number;
  modifier: number;
}

/**
 * Apply the first matching threshold modifier (descending order, first match wins).
 * Returns 0 if no threshold is exceeded.
 */
export function applyThresholdModifier(
  value: number,
  thresholds: readonly ThresholdModifier[],
  comparison: 'above' | 'atOrAbove' = 'above',
): number {
  for (const t of thresholds) {
    if (comparison === 'above' ? value > t.threshold : value >= t.threshold) {
      return t.modifier;
    }
  }
  return 0;
}

export const HAPPINESS = {
  BASE: 50,
  MIN: 0,
  MAX: 100,
  // Commute
  SHORT_COMMUTE: 5,
  SHORT_COMMUTE_BONUS: 10,
  COMMUTE_MODIFIERS: [
    { threshold: 20, modifier: -15 },
    { threshold: 10, modifier: -5 },
  ] as readonly ThresholdModifier[],
  // Environment
  PARK_BONUS: 5,
  POLLUTION_MODIFIERS: [
    { threshold: 50, modifier: -10 },
    { threshold: 25, modifier: -5 },
  ] as readonly ThresholdModifier[],
  NOISE_MODIFIERS: [
    { threshold: 50, modifier: -8 },
  ] as readonly ThresholdModifier[],
  CRIME_MODIFIERS: [
    { threshold: 50, modifier: -10 },
    { threshold: 25, modifier: -5 },
  ] as readonly ThresholdModifier[],
  // Employment
  UNEMPLOYMENT_PENALTY: -15,
  UNEMPLOYMENT_MEDIUM_PENALTY: -25,
  UNEMPLOYMENT_FORCED_PENALTY: -100,
  UNEMPLOYMENT_MEDIUM_TICKS: 30,
  UNEMPLOYMENT_BASE_TOLERANCE: 90,
  UNEMPLOYMENT_EDUCATION_BONUS: { NONE: 0, ELEMENTARY: 5, HIGH_SCHOOL: 15, UNIVERSITY: 30 } as Record<string, number>,
  UNEMPLOYMENT_ID_SPREAD: 30,
  // Tax brackets (descending order)
  TAX_BRACKETS: [
    { threshold: 20, modifier: -35 },
    { threshold: 18, modifier: -25 },
    { threshold: 15, modifier: -15 },
    { threshold: 12, modifier: -5 },
  ] as readonly ThresholdModifier[],
  LOW_TAX_THRESHOLD: 8,
  LOW_TAX_BONUS: 5,
  // Services
  SERVICE_MODIFIERS: [
    { threshold: 8, modifier: 10 },
    { threshold: 5, modifier: 5 },
  ] as readonly ThresholdModifier[],
  // Power & Water
  NO_POWER_PENALTY: -20,
  NO_WATER_PENALTY: -25,
  // Housing
  HOMELESS_PENALTY: -20,
  HOMELESS_FORCED_PENALTY: -100,
  HOMELESS_FORCED_TICKS: 20,
  // Job mismatch: education vs workplace zone type
  JOB_MISMATCH_SEVERE: -10,  // UNI in INDUSTRIAL
  JOB_MISMATCH_MILD: -5,     // HS in INDUSTRIAL, or NONE/ELEM in OFFICE
  // Shopping access
  SHOPPING_GOOD_BONUS: 8,       // ratio >= 0.8
  SHOPPING_PARTIAL_BONUS: 3,    // ratio 0.3~0.8
  SHOPPING_NONE_PENALTY: -12,   // ratio < 0.1
} as const;

/**
 * Calculate unemployment penalty based on duration.
 * Short: -15, Medium: -25, Long (past personal tolerance): -100 (forced emigration).
 * Tolerance varies by income level and citizen ID for natural spread.
 */
export function getUnemploymentPenalty(citizen: Citizen, currentTick: number): number {
  if (citizen.unemployedSince === null || citizen.unemployedSince === undefined) {
    return HAPPINESS.UNEMPLOYMENT_PENALTY;
  }
  const duration = currentTick - citizen.unemployedSince;
  const eduBonus = HAPPINESS.UNEMPLOYMENT_EDUCATION_BONUS[citizen.education] ?? 0;
  const tolerance = HAPPINESS.UNEMPLOYMENT_BASE_TOLERANCE + eduBonus + (citizen.id % HAPPINESS.UNEMPLOYMENT_ID_SPREAD);

  if (duration >= tolerance) return HAPPINESS.UNEMPLOYMENT_FORCED_PENALTY;
  if (duration >= HAPPINESS.UNEMPLOYMENT_MEDIUM_TICKS) return HAPPINESS.UNEMPLOYMENT_MEDIUM_PENALTY;
  return HAPPINESS.UNEMPLOYMENT_PENALTY;
}

/**
 * Calculate homeless penalty based on duration.
 * < 20 ticks: -20, >= 20 ticks: -100 (forced emigration).
 */
export function getHomelessPenalty(citizen: Citizen, currentTick: number): number {
  if (citizen.homelessSince === null || citizen.homelessSince === undefined) {
    return HAPPINESS.HOMELESS_PENALTY;
  }
  const duration = currentTick - citizen.homelessSince;
  if (duration >= HAPPINESS.HOMELESS_FORCED_TICKS) return HAPPINESS.HOMELESS_FORCED_PENALTY;
  return HAPPINESS.HOMELESS_PENALTY;
}

/**
 * Data-driven job mismatch table: `"education:zoneType"` → penalty.
 * Adding new mismatch rules only requires a new table entry (OCP).
 */
export const JOB_MISMATCH_TABLE: Record<string, number> = {
  [`${EducationLevel.UNIVERSITY}:${ZoneType.INDUSTRIAL}`]: HAPPINESS.JOB_MISMATCH_SEVERE,
  [`${EducationLevel.HIGH_SCHOOL}:${ZoneType.INDUSTRIAL}`]: HAPPINESS.JOB_MISMATCH_MILD,
  [`${EducationLevel.NONE}:${ZoneType.OFFICE}`]: HAPPINESS.JOB_MISMATCH_MILD,
  [`${EducationLevel.ELEMENTARY}:${ZoneType.OFFICE}`]: HAPPINESS.JOB_MISMATCH_MILD,
};

/** Calculate job mismatch penalty based on education vs workplace zone type (data-driven). */
export function getJobMismatchPenalty(education: EducationLevel, zoneType?: ZoneType): number {
  if (zoneType === undefined) return 0;
  return JOB_MISMATCH_TABLE[`${education}:${zoneType}`] ?? 0;
}

export function calculateHappiness(citizen: Citizen, factors: HappinessFactors): number {
  let happiness = HAPPINESS.BASE;

  // Commute: short-distance bonus, otherwise threshold penalties
  if (factors.commuteDistance < HAPPINESS.SHORT_COMMUTE) happiness += HAPPINESS.SHORT_COMMUTE_BONUS;
  else happiness += applyThresholdModifier(factors.commuteDistance, HAPPINESS.COMMUTE_MODIFIERS);

  // Boolean factors
  if (factors.hasPark) happiness += HAPPINESS.PARK_BONUS;
  if (!factors.isEmployed && isWorkingAge(citizen.age)) {
    happiness += factors.currentTick !== undefined
      ? getUnemploymentPenalty(citizen, factors.currentTick)
      : HAPPINESS.UNEMPLOYMENT_PENALTY;
  }

  // Threshold-based environmental factors (descending, first match wins)
  happiness += applyThresholdModifier(factors.pollution, HAPPINESS.POLLUTION_MODIFIERS);
  happiness += applyThresholdModifier(factors.noiseLevel, HAPPINESS.NOISE_MODIFIERS);
  happiness += applyThresholdModifier(factors.crimeRate, HAPPINESS.CRIME_MODIFIERS);

  // Tax brackets
  const taxMod = applyThresholdModifier(factors.taxRate, HAPPINESS.TAX_BRACKETS, 'atOrAbove');
  if (taxMod !== 0) happiness += taxMod;
  else if (factors.taxRate < HAPPINESS.LOW_TAX_THRESHOLD) happiness += HAPPINESS.LOW_TAX_BONUS;

  // Service coverage
  happiness += applyThresholdModifier(factors.serviceCoverage, HAPPINESS.SERVICE_MODIFIERS, 'atOrAbove');

  // No power / no water at home penalty
  if (factors.homePowered === false) {
    happiness += HAPPINESS.NO_POWER_PENALTY;
  }
  if (factors.homeWatered === false) {
    happiness += HAPPINESS.NO_WATER_PENALTY;
  }

  // Homeless penalty (escalating with duration)
  if (!citizen.homeId) {
    happiness += factors.currentTick !== undefined
      ? getHomelessPenalty(citizen, factors.currentTick)
      : HAPPINESS.HOMELESS_PENALTY;
  }

  // Job mismatch penalty
  happiness += getJobMismatchPenalty(citizen.education, factors.workplaceZoneType);

  // Shopping access
  if (factors.shoppingAccess !== undefined) {
    if (factors.shoppingAccess >= 0.8) happiness += HAPPINESS.SHOPPING_GOOD_BONUS;
    else if (factors.shoppingAccess >= 0.3) happiness += HAPPINESS.SHOPPING_PARTIAL_BONUS;
    else if (factors.shoppingAccess < 0.1) happiness += HAPPINESS.SHOPPING_NONE_PENALTY;
  }

  return Math.max(HAPPINESS.MIN, Math.min(HAPPINESS.MAX, happiness));
}
