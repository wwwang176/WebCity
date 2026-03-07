export enum GreatWorkType {
  INTERNATIONAL_AIRPORT = 'INTERNATIONAL_AIRPORT',
  SOLAR_FARM = 'SOLAR_FARM',
  SPACE_CENTER = 'SPACE_CENTER',
  MEGA_STADIUM = 'MEGA_STADIUM',
}

export interface GreatWork {
  type: GreatWorkType;
  requiredFunds: number;
  requiredPopulation: number;
  buildTicks: number;
  currentBuildTicks: number;
  status: 'locked' | 'available' | 'building' | 'completed';
  buff: CompletionBuff;
}

export interface CompletionBuff {
  happinessBonus: number;
  touristBonus: number;
  revenueBonus: number;
}

interface GreatWorkConfig {
  requiredFunds: number;
  requiredPopulation: number;
  buildTicks: number;
  buff: CompletionBuff;
}

const GREAT_WORK_CONFIGS: Record<GreatWorkType, GreatWorkConfig> = {
  [GreatWorkType.INTERNATIONAL_AIRPORT]: {
    requiredFunds: 40000,
    requiredPopulation: 10000,
    buildTicks: 80,
    buff: { happinessBonus: 5, touristBonus: 0.3, revenueBonus: 0.1 },
  },
  [GreatWorkType.SOLAR_FARM]: {
    requiredFunds: 25000,
    requiredPopulation: 5000,
    buildTicks: 60,
    buff: { happinessBonus: 3, touristBonus: 0, revenueBonus: 0.15 },
  },
  [GreatWorkType.SPACE_CENTER]: {
    requiredFunds: 50000,
    requiredPopulation: 10000,
    buildTicks: 100,
    buff: { happinessBonus: 10, touristBonus: 0.2, revenueBonus: 0.05 },
  },
  [GreatWorkType.MEGA_STADIUM]: {
    requiredFunds: 30000,
    requiredPopulation: 5000,
    buildTicks: 50,
    buff: { happinessBonus: 5, touristBonus: 0.5, revenueBonus: 0.1 },
  },
};

export function canStart(
  type: GreatWorkType,
  population: number,
  funds: number,
): boolean {
  const config = GREAT_WORK_CONFIGS[type];
  return population >= config.requiredPopulation && funds >= config.requiredFunds;
}

export function startConstruction(type: GreatWorkType): GreatWork {
  const config = GREAT_WORK_CONFIGS[type];
  return {
    type,
    requiredFunds: config.requiredFunds,
    requiredPopulation: config.requiredPopulation,
    buildTicks: config.buildTicks,
    currentBuildTicks: 0,
    status: 'building',
    buff: config.buff,
  };
}

export function tickConstruction(work: GreatWork): GreatWork {
  if (work.status === 'completed') {
    return work;
  }

  const newTicks = Math.min(work.currentBuildTicks + 1, work.buildTicks);
  const completed = newTicks >= work.buildTicks;

  return {
    ...work,
    currentBuildTicks: newTicks,
    status: completed ? 'completed' : 'building',
  };
}

export function getCompletionBuff(type: GreatWorkType): CompletionBuff {
  return { ...GREAT_WORK_CONFIGS[type].buff };
}
