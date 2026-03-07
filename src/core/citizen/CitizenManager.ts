import { type Citizen, LifeStage, EducationLevel, IncomeLevel, getLifeStage } from './types';

let nextId = 1;

export class CitizenManager {
  citizens: Citizen[] = [];

  createCitizen(overrides: Partial<Citizen> = {}): Citizen {
    const age = overrides.age ?? 25;
    const citizen: Citizen = {
      id: nextId++,
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

  ageTick(): void {
    const dead: number[] = [];
    for (const c of this.citizens) {
      c.age++;
      c.lifeStage = getLifeStage(c.age);
      if (c.age > 90 && Math.random() < 0.1) {
        dead.push(c.id);
      }
      if (c.age > 100) {
        dead.push(c.id);
      }
    }
    for (const id of dead) {
      this.removeCitizen(id);
    }
  }

  educateTick(hasElementary: boolean, hasHighSchool: boolean, hasUniversity: boolean): void {
    for (const c of this.citizens) {
      if (c.lifeStage === LifeStage.CHILD && hasElementary && c.education === EducationLevel.NONE) {
        c.education = EducationLevel.ELEMENTARY;
      }
      if (c.lifeStage === LifeStage.TEEN && hasHighSchool && c.education === EducationLevel.ELEMENTARY) {
        c.education = EducationLevel.HIGH_SCHOOL;
      }
      if (c.lifeStage === LifeStage.ADULT && hasUniversity && c.education === EducationLevel.HIGH_SCHOOL) {
        if (c.age <= 25) {
          c.education = EducationLevel.UNIVERSITY;
        }
      }
    }
  }
}
