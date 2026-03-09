export enum CitySpecType {
  NONE = 'NONE',
  MINING_CITY = 'MINING_CITY',
  OIL_CITY = 'OIL_CITY',
  TECH_CITY = 'TECH_CITY',
  TOURISM_CITY = 'TOURISM_CITY',
  GAMBLING_CITY = 'GAMBLING_CITY',
  TRADE_CITY = 'TRADE_CITY',
}

export interface CitySpecBonus {
  revenueMultiplier: number; // applied city-wide to all buildings
  happinessModifier: number; // added to citizen happiness
  crimeModifier: number; // added to crime rate
  requiredPopulation: number; // population needed to unlock
}

const CITY_SPEC_BONUSES: Record<CitySpecType, CitySpecBonus> = {
  [CitySpecType.NONE]: { revenueMultiplier: 1, happinessModifier: 0, crimeModifier: 0, requiredPopulation: 0 },
  [CitySpecType.MINING_CITY]: { revenueMultiplier: 1.15, happinessModifier: -5, crimeModifier: 5, requiredPopulation: 5000 },
  [CitySpecType.OIL_CITY]: { revenueMultiplier: 1.2, happinessModifier: -5, crimeModifier: 3, requiredPopulation: 5000 },
  [CitySpecType.TECH_CITY]: { revenueMultiplier: 1.25, happinessModifier: 5, crimeModifier: -5, requiredPopulation: 5000 },
  [CitySpecType.TOURISM_CITY]: { revenueMultiplier: 1.2, happinessModifier: 3, crimeModifier: 5, requiredPopulation: 5000 },
  [CitySpecType.GAMBLING_CITY]: { revenueMultiplier: 1.4, happinessModifier: -10, crimeModifier: 15, requiredPopulation: 5000 },
  [CitySpecType.TRADE_CITY]: { revenueMultiplier: 1.15, happinessModifier: 2, crimeModifier: 0, requiredPopulation: 5000 },
};

export class CitySpecialization {
  private current: CitySpecType = CitySpecType.NONE;

  getCurrent(): CitySpecType {
    return this.current;
  }

  canChoose(type: CitySpecType, population: number): boolean {
    if (type === CitySpecType.NONE) return true;
    const bonus = CITY_SPEC_BONUSES[type];
    return population >= bonus.requiredPopulation;
  }

  choose(type: CitySpecType, population: number): boolean {
    if (!this.canChoose(type, population)) return false;
    this.current = type;
    return true;
  }

  getBonus(): CitySpecBonus {
    return CITY_SPEC_BONUSES[this.current];
  }

  static getBonusForType(type: CitySpecType): CitySpecBonus {
    return CITY_SPEC_BONUSES[type];
  }
}
