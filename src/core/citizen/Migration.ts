import { CitizenManager } from './CitizenManager';
import { EducationLevel, IncomeLevel } from './types';
import { randomElement, randomInt, pickWeighted } from '../utils/random';

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
  /** Population tier base for log scaling: tier = max(1, floor(log10(pop))) */
  POPULATION_TIER_BASE: 10,
  /** Base multiplier applied to immigration cap */
  IMMIGRATION_BASE_MULTIPLIER: 1.5,
  /** Random jitter range [min, max] applied to immigration count */
  IMMIGRATION_JITTER_MIN: 0.7,
  IMMIGRATION_JITTER_MAX: 1.5,
  EMIGRATION_HAPPINESS_THRESHOLD: 20,
  EMIGRATION_MIN_RATE: 0.01,
  EMIGRATION_MAX_RATE: 0.03,
  EMIGRATION_BASE_MAX: 10,
  /** Natural attrition rate: fraction of population that randomly leaves each tick */
  NATURAL_ATTRITION_RATE: 0.002,
  /** Hard cap on natural attrition per tick, so large cities don't bleed out */
  NATURAL_ATTRITION_CAP: 5,
  /** Income distribution weights by education level: [LOW, MEDIUM, HIGH] */
  INCOME_BY_EDUCATION: {
    [EducationLevel.NONE]:        [70, 25, 5],
    [EducationLevel.ELEMENTARY]:  [55, 35, 10],
    [EducationLevel.HIGH_SCHOOL]: [25, 50, 25],
    [EducationLevel.UNIVERSITY]:  [10, 35, 55],
  } as Record<EducationLevel, [number, number, number]>,
  IMMIGRANT_MIN_AGE: 20,
  IMMIGRANT_AGE_RANGE: 30,
} as const;

const INCOME_LEVELS = [IncomeLevel.LOW, IncomeLevel.MEDIUM, IncomeLevel.HIGH] as const;

/** Pick income level based on education-weighted distribution */
export function pickIncomeByEducation(education: EducationLevel): IncomeLevel {
  const weights = IMMIGRATION.INCOME_BY_EDUCATION[education];
  const total = weights[0] + weights[1] + weights[2];
  const pool = INCOME_LEVELS.map((level, i) => ({ level, weight: weights[i] }));
  return pickWeighted(pool, total, e => e.weight).level;
}

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
 * - baseDemand: 吸引力超過 50 的部分除以 10，向上取整
 * - populationTier: max(1, floor(log10(pop)))，讓中後期城市成長更快
 * - demandCap = baseDemand × populationTier
 * - 取三者最小值（popCap、vacantHomes、demandCap）
 * - 吸引力 ≤ 50 時回傳 0
 */
export function getImmigrationCap(population: number, vacantHomes: number, attractiveness: number): number {
  if (attractiveness <= IMMIGRATION.ATTRACTIVENESS_THRESHOLD) return 0;
  const popCap = Math.max(IMMIGRATION.POP_CAP_MIN, Math.floor(population * IMMIGRATION.POP_CAP_FACTOR));
  const baseDemand = Math.ceil((attractiveness - IMMIGRATION.ATTRACTIVENESS_THRESHOLD) / IMMIGRATION.DEMAND_CAP_DIVISOR);
  const populationTier = Math.max(1, Math.floor(Math.log10(Math.max(1, population))));
  const demandCap = baseDemand * populationTier;
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

  // Immigration — 使用動態縮放上限 × 1.5 基數 × 隨機 0.7~1.5
  if (attractiveness > IMMIGRATION.ATTRACTIVENESS_THRESHOLD && city.vacantHomes > 0 && city.jobOpenings > 0) {
    const baseCap = getImmigrationCap(pop, city.vacantHomes, attractiveness);
    const jitter = IMMIGRATION.IMMIGRATION_JITTER_MIN +
      Math.random() * (IMMIGRATION.IMMIGRATION_JITTER_MAX - IMMIGRATION.IMMIGRATION_JITTER_MIN);
    const count = Math.max(1, Math.floor(baseCap * IMMIGRATION.IMMIGRATION_BASE_MULTIPLIER * jitter));
    for (let i = 0; i < count; i++) {
      const age = IMMIGRATION.IMMIGRANT_MIN_AGE + randomInt(IMMIGRATION.IMMIGRANT_AGE_RANGE);
      const educations = [EducationLevel.NONE, EducationLevel.ELEMENTARY, EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY];
      const education = randomElement(educations);
      const income = pickIncomeByEducation(education);
      manager.createCitizen({ age, education, incomeLevel: income });
      immigrated++;
    }
  }

  // Emigration — citizens leave when happiness < personal emigrationTolerance
  const emigrationRate = IMMIGRATION.EMIGRATION_MIN_RATE +
    Math.random() * (IMMIGRATION.EMIGRATION_MAX_RATE - IMMIGRATION.EMIGRATION_MIN_RATE);
  const base = Math.floor(Math.random() * (IMMIGRATION.EMIGRATION_BASE_MAX + 1));
  const emigrationCap = base + Math.floor(pop * emigrationRate);
  for (const citizen of [...manager.getCitizens()]) {
    if (emigratedIds.length >= emigrationCap) break;
    const threshold = citizen.emigrationTolerance ?? IMMIGRATION.EMIGRATION_HAPPINESS_THRESHOLD;
    if (citizen.happiness < threshold) {
      emigratedIds.push(citizen.id);
      manager.removeCitizen(citizen.id);
    }
  }

  // Natural attrition — random citizens leave regardless of happiness
  const attritionCount = Math.min(
    IMMIGRATION.NATURAL_ATTRITION_CAP,
    Math.floor(pop * IMMIGRATION.NATURAL_ATTRITION_RATE),
  );
  if (attritionCount > 0) {
    const candidates = manager.getCitizens().filter(c => !emigratedIds.includes(c.id));
    for (let i = 0; i < attritionCount && candidates.length > 0; i++) {
      const idx = randomInt(candidates.length);
      const citizen = candidates[idx];
      emigratedIds.push(citizen.id);
      manager.removeCitizen(citizen.id);
      candidates.splice(idx, 1);
    }
  }

  return { immigrated, emigrated: emigratedIds.length, emigratedIds };
}
