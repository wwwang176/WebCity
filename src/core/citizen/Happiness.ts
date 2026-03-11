import { type Citizen } from './types';

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

export const HAPPINESS = {
  BASE: 50,
  MIN: 0,
  MAX: 100,
  // Commute thresholds
  SHORT_COMMUTE: 5,
  SHORT_COMMUTE_BONUS: 10,
  MEDIUM_COMMUTE: 10,
  MEDIUM_COMMUTE_PENALTY: -5,
  LONG_COMMUTE: 20,
  LONG_COMMUTE_PENALTY: -15,
  // Environment
  PARK_BONUS: 5,
  HIGH_POLLUTION: 50,
  HIGH_POLLUTION_PENALTY: -10,
  MODERATE_POLLUTION: 25,
  MODERATE_POLLUTION_PENALTY: -5,
  HIGH_NOISE: 50,
  HIGH_NOISE_PENALTY: -8,
  HIGH_CRIME: 50,
  HIGH_CRIME_PENALTY: -10,
  MODERATE_CRIME: 25,
  MODERATE_CRIME_PENALTY: -5,
  // Employment
  UNEMPLOYMENT_PENALTY: -15,
  WORKING_AGE_MIN: 18,
  WORKING_AGE_MAX: 65,
  // Tax brackets (descending order for if-else chain)
  TAX_BRACKETS: [
    { threshold: 20, modifier: -35 },
    { threshold: 18, modifier: -25 },
    { threshold: 15, modifier: -15 },
    { threshold: 12, modifier: -5 },
  ] as readonly { threshold: number; modifier: number }[],
  LOW_TAX_THRESHOLD: 8,
  LOW_TAX_BONUS: 5,
  // Services
  HIGH_SERVICE: 5,
  HIGH_SERVICE_BONUS: 10,
  MODERATE_SERVICE: 3,
  MODERATE_SERVICE_BONUS: 5,
} as const;

export function calculateHappiness(citizen: Citizen, factors: HappinessFactors): number {
  let happiness = HAPPINESS.BASE;

  // Commute
  if (factors.commuteDistance < HAPPINESS.SHORT_COMMUTE) happiness += HAPPINESS.SHORT_COMMUTE_BONUS;
  else if (factors.commuteDistance > HAPPINESS.LONG_COMMUTE) happiness += HAPPINESS.LONG_COMMUTE_PENALTY;
  else if (factors.commuteDistance > HAPPINESS.MEDIUM_COMMUTE) happiness += HAPPINESS.MEDIUM_COMMUTE_PENALTY;

  // Park
  if (factors.hasPark) happiness += HAPPINESS.PARK_BONUS;

  // Pollution
  if (factors.pollution > HAPPINESS.HIGH_POLLUTION) happiness += HAPPINESS.HIGH_POLLUTION_PENALTY;
  else if (factors.pollution > HAPPINESS.MODERATE_POLLUTION) happiness += HAPPINESS.MODERATE_POLLUTION_PENALTY;

  // Noise
  if (factors.noiseLevel > HAPPINESS.HIGH_NOISE) happiness += HAPPINESS.HIGH_NOISE_PENALTY;

  // Crime
  if (factors.crimeRate > HAPPINESS.HIGH_CRIME) happiness += HAPPINESS.HIGH_CRIME_PENALTY;
  else if (factors.crimeRate > HAPPINESS.MODERATE_CRIME) happiness += HAPPINESS.MODERATE_CRIME_PENALTY;

  // Employment
  if (!factors.isEmployed && citizen.age > HAPPINESS.WORKING_AGE_MIN && citizen.age <= HAPPINESS.WORKING_AGE_MAX) {
    happiness += HAPPINESS.UNEMPLOYMENT_PENALTY;
  }

  // Tax (graduated penalty for high rates)
  let taxApplied = false;
  for (const bracket of HAPPINESS.TAX_BRACKETS) {
    if (factors.taxRate >= bracket.threshold) {
      happiness += bracket.modifier;
      taxApplied = true;
      break;
    }
  }
  if (!taxApplied && factors.taxRate < HAPPINESS.LOW_TAX_THRESHOLD) {
    happiness += HAPPINESS.LOW_TAX_BONUS;
  }

  // Services
  if (factors.serviceCoverage >= HAPPINESS.HIGH_SERVICE) happiness += HAPPINESS.HIGH_SERVICE_BONUS;
  else if (factors.serviceCoverage >= HAPPINESS.MODERATE_SERVICE) happiness += HAPPINESS.MODERATE_SERVICE_BONUS;

  return Math.max(HAPPINESS.MIN, Math.min(HAPPINESS.MAX, happiness));
}
