import { type Citizen, LifeStage, EducationLevel, IncomeLevel, getLifeStage } from './types';

/** Mortality configuration constants */
export const MORTALITY = {
  /** Age at which death is certain */
  MAX_AGE: 100,
  /** Age at which random death chance begins */
  ELDERLY_AGE: 90,
  /** Probability of death per tick when age > ELDERLY_AGE */
  ELDERLY_DEATH_CHANCE: 0.1,
} as const;

/** Data-driven education progression rules (OCP: add new levels without modifying loop logic) */
export interface EducationRule {
  lifeStage: LifeStage;
  requiredEducation: EducationLevel;
  nextEducation: EducationLevel;
  schoolKey: 'elementary' | 'highSchool' | 'university';
  maxAge?: number;
}

export const EDUCATION_PROGRESSION: readonly EducationRule[] = [
  { lifeStage: LifeStage.CHILD, requiredEducation: EducationLevel.NONE, nextEducation: EducationLevel.ELEMENTARY, schoolKey: 'elementary' },
  { lifeStage: LifeStage.TEEN, requiredEducation: EducationLevel.ELEMENTARY, nextEducation: EducationLevel.HIGH_SCHOOL, schoolKey: 'highSchool' },
  { lifeStage: LifeStage.ADULT, requiredEducation: EducationLevel.HIGH_SCHOOL, nextEducation: EducationLevel.UNIVERSITY, schoolKey: 'university', maxAge: 25 },
];

export class CitizenManager {
  private citizens: Citizen[] = [];
  private nextId = 1;

  createCitizen(overrides: Partial<Citizen> = {}): Citizen {
    const age = overrides.age ?? 25;
    const citizen: Citizen = {
      id: this.nextId++,
      age,
      lifeStage: getLifeStage(age),
      education: EducationLevel.NONE,
      incomeLevel: IncomeLevel.LOW,
      happiness: 50,
      health: 80,
      homeId: null,
      workplaceId: null,
      ...overrides,
    };
    this.citizens.push(citizen);
    return citizen;
  }

  removeCitizen(id: number): void {
    this.citizens = this.citizens.filter((c) => c.id !== id);
  }

  getCitizen(id: number): Citizen | undefined {
    return this.citizens.find((c) => c.id === id);
  }

  getPopulation(): number {
    return this.citizens.length;
  }

  getCitizens(): readonly Citizen[] {
    return this.citizens;
  }

  getAverageHappiness(): number {
    if (this.citizens.length === 0) return 0;
    let sum = 0;
    for (const c of this.citizens) sum += c.happiness;
    return sum / this.citizens.length;
  }

  getCitizensByHome(buildingKey: string): Citizen[] {
    return this.citizens.filter((c) => c.homeId === buildingKey);
  }

  getCitizensByWorkplace(buildingKey: string): Citizen[] {
    return this.citizens.filter((c) => c.workplaceId === buildingKey);
  }

  ageTick(): number {
    const dead: number[] = [];
    for (const c of this.citizens) {
      c.age++;
      c.lifeStage = getLifeStage(c.age);
      if (c.age > MORTALITY.MAX_AGE) {
        dead.push(c.id);
      } else if (c.age > MORTALITY.ELDERLY_AGE && Math.random() < MORTALITY.ELDERLY_DEATH_CHANCE) {
        dead.push(c.id);
      }
    }
    for (const id of dead) {
      this.removeCitizen(id);
    }
    return dead.length;
  }

  educateTick(hasElementary: boolean, hasHighSchool: boolean, hasUniversity: boolean): void {
    const schools: Record<string, boolean> = { elementary: hasElementary, highSchool: hasHighSchool, university: hasUniversity };
    for (const c of this.citizens) {
      for (const rule of EDUCATION_PROGRESSION) {
        if (c.lifeStage === rule.lifeStage && schools[rule.schoolKey] && c.education === rule.requiredEducation) {
          if (rule.maxAge === undefined || c.age <= rule.maxAge) {
            c.education = rule.nextEducation;
          }
          break;
        }
      }
    }
  }
}
