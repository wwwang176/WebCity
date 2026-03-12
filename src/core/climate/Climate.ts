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

/** Seasonal effect parameters */
export const SEASON_EFFECTS = {
  SPRING_HAPPINESS: 5,
  SUMMER_TROPICAL_WATER: 1.2,
  SUMMER_ARID_WATER: 1.3,
  SUMMER_ARID_POWER: 1.1,
  WINTER_POWER: 1.3,
  WINTER_HAPPINESS: -5,
  WINTER_CONTINENTAL_POWER: 1.5,
  WINTER_CONTINENTAL_HAPPINESS: -8,
} as const;

export function getSeasonFromTick(tick: number, ticksPerYear: number): Season {
  const tickInYear = tick % ticksPerYear;
  const quarterLength = ticksPerYear / 4;
  const seasonIndex = Math.floor(tickInYear / quarterLength);
  return SEASONS[seasonIndex] ?? 'spring';
}

const DEFAULT_EFFECTS: SeasonEffects = { powerDemandMultiplier: 1.0, waterDemandMultiplier: 1.0, happinessModifier: 0 };

type SeasonOverride = (base: SeasonEffects, climate: ClimateType) => void;

/** Data-driven season effect overrides (OCP). */
export const SEASON_EFFECT_OVERRIDES: Record<Season, SeasonOverride> = {
  spring(effects) {
    effects.happinessModifier = SEASON_EFFECTS.SPRING_HAPPINESS;
  },
  summer(effects, climate) {
    if (climate === ClimateType.TROPICAL) {
      effects.waterDemandMultiplier = SEASON_EFFECTS.SUMMER_TROPICAL_WATER;
    }
    if (climate === ClimateType.ARID) {
      effects.waterDemandMultiplier = SEASON_EFFECTS.SUMMER_ARID_WATER;
      effects.powerDemandMultiplier = SEASON_EFFECTS.SUMMER_ARID_POWER;
    }
  },
  autumn() { /* no overrides */ },
  winter(effects, climate) {
    effects.powerDemandMultiplier = SEASON_EFFECTS.WINTER_POWER;
    effects.happinessModifier = SEASON_EFFECTS.WINTER_HAPPINESS;
    if (climate === ClimateType.CONTINENTAL) {
      effects.powerDemandMultiplier = SEASON_EFFECTS.WINTER_CONTINENTAL_POWER;
      effects.happinessModifier = SEASON_EFFECTS.WINTER_CONTINENTAL_HAPPINESS;
    }
  },
};

export function getSeasonEffects(season: Season, climateType: ClimateType): SeasonEffects {
  const effects: SeasonEffects = { ...DEFAULT_EFFECTS };
  SEASON_EFFECT_OVERRIDES[season](effects, climateType);
  return effects;
}
