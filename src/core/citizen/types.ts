export enum LifeStage {
  BABY = 'BABY',
  CHILD = 'CHILD',
  TEEN = 'TEEN',
  ADULT = 'ADULT',
  SENIOR = 'SENIOR',
}

export enum EducationLevel {
  NONE = 'NONE',
  ELEMENTARY = 'ELEMENTARY',
  HIGH_SCHOOL = 'HIGH_SCHOOL',
  UNIVERSITY = 'UNIVERSITY',
}

export enum IncomeLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export interface Citizen {
  id: number;
  age: number;
  lifeStage: LifeStage;
  education: EducationLevel;
  incomeLevel: IncomeLevel;
  happiness: number;
  health: number;
  homeId: string | null;      // "x,y" grid position of home building
  workplaceId: string | null; // "x,y" grid position of workplace building
}

export function getLifeStage(age: number): LifeStage {
  if (age <= 5) return LifeStage.BABY;
  if (age <= 12) return LifeStage.CHILD;
  if (age <= 18) return LifeStage.TEEN;
  if (age <= 65) return LifeStage.ADULT;
  return LifeStage.SENIOR;
}
