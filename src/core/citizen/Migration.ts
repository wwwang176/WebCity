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

export function migrationTick(
  manager: CitizenManager,
  city: CityAttractiveness,
): { immigrated: number; emigrated: number } {
  let immigrated = 0;
  let emigrated = 0;

  const attractiveness = calculateAttractiveness(city);

  // Immigration
  if (attractiveness > 50 && city.vacantHomes > 0 && city.jobOpenings > 0) {
    const count = Math.min(3, city.vacantHomes, Math.ceil((attractiveness - 50) / 20));
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
