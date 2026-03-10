import { CitizenManager } from './CitizenManager';
import { EducationLevel, IncomeLevel } from './types';

export interface CityAttractiveness {
  jobOpenings: number;
  vacantHomes: number;
  avgHappiness: number;
  taxRate: number;
  pollution: number;
  crimeRate: number;
}

export function calculateAttractiveness(city: CityAttractiveness): number {
  let score = 0;
  if (city.jobOpenings > 0) score += 20;
  if (city.vacantHomes > 0) score += 20;
  score += city.avgHappiness * 0.3;
  score -= city.taxRate * 0.5;
  score -= city.pollution * 0.2;
  score -= city.crimeRate * 0.3;
  return Math.max(0, Math.min(100, score));
}

/**
 * 計算移民上限，根據人口規模、空房數量、吸引力動態縮放。
 * - popCap: 人口的 1%，最低 3
 * - demandCap: 吸引力超過 50 的部分除以 10，向上取整
 * - 取三者最小值（popCap、vacantHomes、demandCap）
 * - 吸引力 ≤ 50 時回傳 0
 */
export function getImmigrationCap(population: number, vacantHomes: number, attractiveness: number): number {
  if (attractiveness <= 50) return 0;
  const popCap = Math.max(3, Math.floor(population * 0.01));
  const demandCap = Math.ceil((attractiveness - 50) / 10);
  return Math.min(popCap, vacantHomes, demandCap);
}

export function migrationTick(
  manager: CitizenManager,
  city: CityAttractiveness,
  population?: number,
): { immigrated: number; emigrated: number } {
  let immigrated = 0;
  let emigrated = 0;

  const attractiveness = calculateAttractiveness(city);
  // 使用傳入的 population，若未傳入則以 manager 現有人口為準
  const pop = population ?? manager.getPopulation();

  // Immigration — 使用動態縮放上限
  if (attractiveness > 50 && city.vacantHomes > 0 && city.jobOpenings > 0) {
    const count = getImmigrationCap(pop, city.vacantHomes, attractiveness);
    for (let i = 0; i < count; i++) {
      const age = 20 + Math.floor(Math.random() * 30);
      const educations = [EducationLevel.NONE, EducationLevel.ELEMENTARY, EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY];
      const education = educations[Math.floor(Math.random() * educations.length)]!;
      const incomes = [IncomeLevel.LOW, IncomeLevel.MEDIUM, IncomeLevel.HIGH];
      const income = incomes[Math.floor(Math.random() * incomes.length)]!;
      manager.createCitizen({ age, education, incomeLevel: income });
      immigrated++;
    }
  }

  // Emigration
  for (const citizen of [...manager.citizens]) {
    if (citizen.happiness < 20) {
      manager.removeCitizen(citizen.id);
      emigrated++;
    }
  }

  return { immigrated, emigrated };
}
