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

export function calculateHappiness(citizen: Citizen, factors: HappinessFactors): number {
  let happiness = 50;

  // Commute
  if (factors.commuteDistance < 5) happiness += 10;
  else if (factors.commuteDistance > 20) happiness -= 15;
  else if (factors.commuteDistance > 10) happiness -= 5;

  // Park
  if (factors.hasPark) happiness += 5;

  // Pollution
  if (factors.pollution > 50) happiness -= 10;
  else if (factors.pollution > 25) happiness -= 5;

  // Noise
  if (factors.noiseLevel > 50) happiness -= 8;

  // Crime
  if (factors.crimeRate > 50) happiness -= 10;
  else if (factors.crimeRate > 25) happiness -= 5;

  // Employment
  if (!factors.isEmployed && citizen.age > 18 && citizen.age <= 65) {
    happiness -= 15;
  }

  // Tax
  if (factors.taxRate > 15) happiness -= 10;
  else if (factors.taxRate < 8) happiness += 5;

  // Services
  if (factors.serviceCoverage >= 5) happiness += 10;
  else if (factors.serviceCoverage >= 3) happiness += 5;

  return Math.max(0, Math.min(100, happiness));
}
