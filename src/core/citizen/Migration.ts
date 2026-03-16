import { CitizenManager } from './CitizenManager';
import { EducationLevel, IncomeLevel } from './types';
import { randomElement, randomInt } from '../utils/random';

export interface CityAttractiveness {
  jobOpenings: number;
  vacantHomes: number;
  avgHappiness: number;
  taxRate: number;
  pollution: number;
  crimeRate: number;
  unemploymentRate?: number;  // 0.0–1.0, fraction of working-age citizens without a job
}

export const ATTRACTIVENESS = {
  JOB_SCORE: 20,
  VACANT_SCORE: 20,
  HAPPINESS_WEIGHT: 0.3,
  TAX_WEIGHT: 0.5,
  POLLUTION_WEIGHT: 0.2,
  CRIME_WEIGHT: 0.3,
  UNEMPLOYMENT_WEIGHT: 60,
  MIN: 0,
  MAX: 100,
} as const;

export const IMMIGRATION = {
  ATTRACTIVENESS_THRESHOLD: 50,
  POP_CAP_FACTOR: 0.01,
  POP_CAP_MIN: 3,
  DEMAND_CAP_DIVISOR: 10,
  EMIGRATION_HAPPINESS_THRESHOLD: 20,
  EMIGRATION_MIN_RATE: 0.01,
  EMIGRATION_MAX_RATE: 0.03,
  IMMIGRANT_MIN_AGE: 20,
  IMMIGRANT_AGE_RANGE: 30,
} as const;

export function calculateAttractiveness(city: CityAttractiveness): number {
  let score = 0;
  if (city.jobOpenings > 0) score += ATTRACTIVENESS.JOB_SCORE;
  if (city.vacantHomes > 0) score += ATTRACTIVENESS.VACANT_SCORE;
  score += city.avgHappiness * ATTRACTIVENESS.HAPPINESS_WEIGHT;
  score -= city.taxRate * ATTRACTIVENESS.TAX_WEIGHT;
  score -= city.pollution * ATTRACTIVENESS.POLLUTION_WEIGHT;
  score -= city.crimeRate * ATTRACTIVENESS.CRIME_WEIGHT;
  if (city.unemploymentRate !== undefined) {
    score -= city.unemploymentRate * ATTRACTIVENESS.UNEMPLOYMENT_WEIGHT;
  }
  return Math.max(ATTRACTIVENESS.MIN, Math.min(ATTRACTIVENESS.MAX, score));
}

/**
 * 計算移民上限，根據人口規模、空房數量、吸引力動態縮放。
 * - popCap: 人口的 1%，最低 3
 * - demandCap: 吸引力超過 50 的部分除以 10，向上取整
 * - 取三者最小值（popCap、vacantHomes、demandCap）
 * - 吸引力 ≤ 50 時回傳 0
 */
export function getImmigrationCap(population: number, vacantHomes: number, attractiveness: number): number {
  if (attractiveness <= IMMIGRATION.ATTRACTIVENESS_THRESHOLD) return 0;
  const popCap = Math.max(IMMIGRATION.POP_CAP_MIN, Math.floor(population * IMMIGRATION.POP_CAP_FACTOR));
  const demandCap = Math.ceil((attractiveness - IMMIGRATION.ATTRACTIVENESS_THRESHOLD) / IMMIGRATION.DEMAND_CAP_DIVISOR);
  return Math.min(popCap, vacantHomes, demandCap);
}

export function migrationTick(
  manager: CitizenManager,
  city: CityAttractiveness,
  population?: number,
): { immigrated: number; emigrated: number; emigratedIds: number[] } {
  let immigrated = 0;
  const emigratedIds: number[] = [];

  const attractiveness = calculateAttractiveness(city);
  // 使用傳入的 population，若未傳入則以 manager 現有人口為準
  const pop = population ?? manager.getPopulation();

  // Immigration — 使用動態縮放上限
  if (attractiveness > IMMIGRATION.ATTRACTIVENESS_THRESHOLD && city.vacantHomes > 0 && city.jobOpenings > 0) {
    const count = getImmigrationCap(pop, city.vacantHomes, attractiveness);
    for (let i = 0; i < count; i++) {
      const age = IMMIGRATION.IMMIGRANT_MIN_AGE + randomInt(IMMIGRATION.IMMIGRANT_AGE_RANGE);
      const educations = [EducationLevel.NONE, EducationLevel.ELEMENTARY, EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY];
      const education = randomElement(educations);
      const incomes = [IncomeLevel.LOW, IncomeLevel.MEDIUM, IncomeLevel.HIGH];
      const income = randomElement(incomes);
      manager.createCitizen({ age, education, incomeLevel: income });
      immigrated++;
    }
  }

  // Emigration — capped at random 1-3% of population per tick
  const emigrationRate = IMMIGRATION.EMIGRATION_MIN_RATE +
    Math.random() * (IMMIGRATION.EMIGRATION_MAX_RATE - IMMIGRATION.EMIGRATION_MIN_RATE);
  const emigrationCap = Math.max(1, Math.floor(pop * emigrationRate));
  for (const citizen of [...manager.getCitizens()]) {
    if (emigratedIds.length >= emigrationCap) break;
    if (citizen.happiness < IMMIGRATION.EMIGRATION_HAPPINESS_THRESHOLD) {
      emigratedIds.push(citizen.id);
      manager.removeCitizen(citizen.id);
    }
  }

  return { immigrated, emigrated: emigratedIds.length, emigratedIds };
}
