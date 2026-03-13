import { type Citizen, isWorkingAge } from './types';

export interface HappinessFactors {
  commuteDistance: number;
  hasPark: boolean;
  pollution: number;
  noiseLevel: number;
  crimeRate: number;
  isEmployed: boolean;
  taxRate: number;
  serviceCoverage: number;
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
  // Housing
  HOMELESS_PENALTY: -20,
} as const;

export function calculateHappiness(citizen: Citizen, factors: HappinessFactors): number {
  let happiness = HAPPINESS.BASE;

  // Commute: short-distance bonus, otherwise threshold penalties
  if (factors.commuteDistance < HAPPINESS.SHORT_COMMUTE) happiness += HAPPINESS.SHORT_COMMUTE_BONUS;
  else happiness += applyThresholdModifier(factors.commuteDistance, HAPPINESS.COMMUTE_MODIFIERS);

  // Boolean factors
  if (factors.hasPark) happiness += HAPPINESS.PARK_BONUS;
  if (!factors.isEmployed && isWorkingAge(citizen.age)) happiness += HAPPINESS.UNEMPLOYMENT_PENALTY;

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

  // Homeless penalty
  if (!citizen.homeId) {
    happiness += HAPPINESS.HOMELESS_PENALTY;
  }

  return Math.max(HAPPINESS.MIN, Math.min(HAPPINESS.MAX, happiness));
}
