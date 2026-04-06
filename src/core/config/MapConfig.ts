import type { TerrainConfig } from '../grid/TerrainGenerator';

export type TerrainLevel = 'low' | 'medium' | 'high' | 'very_high';
export type ForestDensity = 'sparse' | 'normal' | 'dense';
export type DifficultyFunding = 'easy' | 'normal' | 'hard';
export type DisasterFrequency = 'low' | 'medium' | 'high';

export interface MapConfig {
  seed: number;
  waterAmount: TerrainLevel;
  forestDensity: ForestDensity;
  startingFunds: DifficultyFunding;
  disastersEnabled: boolean;
  disasterFrequency: DisasterFrequency;
}

export const STARTING_FUNDS_MAP: Record<DifficultyFunding, number> = {
  easy: 75000,
  normal: 50000,
  hard: 25000,
};

export const DISASTER_CHANCE_MAP: Record<DisasterFrequency, number> = {
  low: 0.0005,
  medium: 0.001,
  high: 0.003,
};

export function getDefaultMapConfig(): MapConfig {
  return {
    seed: Math.floor(Math.random() * 2147483646) + 1,
    waterAmount: 'medium',
    forestDensity: 'normal',
    startingFunds: 'normal',
    disastersEnabled: true,
    disasterFrequency: 'medium',
  };
}

const WATER_MAP: Record<TerrainLevel, { riverHalfWidth: number; lakeCount: number; coastalFeature: boolean }> = {
  low:       { riverHalfWidth: 1, lakeCount: 0, coastalFeature: false },
  medium:    { riverHalfWidth: 1, lakeCount: 0, coastalFeature: false },
  high:      { riverHalfWidth: 2, lakeCount: 2, coastalFeature: false },
  very_high: { riverHalfWidth: 2, lakeCount: 1, coastalFeature: true },
};

const FOREST_MAP: Record<ForestDensity, { forestDepth: number; forestWaterGap: number }> = {
  sparse: { forestDepth: 0.15, forestWaterGap: 3 },
  normal: { forestDepth: 0.5,  forestWaterGap: 2 },
  dense:  { forestDepth: 0.85, forestWaterGap: 1 },
};

export function resolveTerrainConfig(config: MapConfig): TerrainConfig {
  const water = WATER_MAP[config.waterAmount];
  const forest = FOREST_MAP[config.forestDensity];
  return {
    riverHalfWidth: water.riverHalfWidth,
    lakeCount: water.lakeCount,
    coastalFeature: water.coastalFeature,
    forestDepth: forest.forestDepth,
    forestWaterGap: forest.forestWaterGap,
  };
}
