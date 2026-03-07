export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export enum ClimateType {
  TEMPERATE = 'TEMPERATE',
  TROPICAL = 'TROPICAL',
  ARID = 'ARID',
  CONTINENTAL = 'CONTINENTAL',
}

export interface SeasonEffects {
  powerDemandMultiplier: number;
  waterDemandMultiplier: number;
  happinessModifier: number;
}

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export function getSeasonFromTick(tick: number, ticksPerYear: number): Season {
  const tickInYear = tick % ticksPerYear;
  const quarterLength = ticksPerYear / 4;
  const seasonIndex = Math.floor(tickInYear / quarterLength);
  return SEASONS[seasonIndex] ?? 'spring';
}

export function getSeasonEffects(season: Season, climateType: ClimateType): SeasonEffects {
  const effects: SeasonEffects = {
    powerDemandMultiplier: 1.0,
    waterDemandMultiplier: 1.0,
    happinessModifier: 0,
  };

  switch (season) {
    case 'spring':
      effects.happinessModifier = 5;
      break;
    case 'summer':
      if (climateType === ClimateType.TROPICAL) {
        effects.waterDemandMultiplier = 1.2;
      }
      if (climateType === ClimateType.ARID) {
        effects.waterDemandMultiplier = 1.3;
        effects.powerDemandMultiplier = 1.1;
      }
      break;
    case 'autumn':
      // Neutral effects
      break;
    case 'winter':
      effects.powerDemandMultiplier = 1.3;
      effects.happinessModifier = -5;
      if (climateType === ClimateType.CONTINENTAL) {
        effects.powerDemandMultiplier = 1.5;
        effects.happinessModifier = -8;
      }
      break;
  }

  return effects;
}
