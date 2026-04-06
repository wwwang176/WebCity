import type { TerrainConfig } from '../grid/TerrainGenerator';

export type TerrainLevel = 'low' | 'medium' | 'high';
export type ForestDensity = 'sparse' | 'normal' | 'dense';
export type DifficultyFunding = 'easy' | 'normal' | 'hard';
export type DisasterFrequency = 'low' | 'medium' | 'high';

export interface MapConfig {
  seed: number;
  waterAmount: TerrainLevel;
  forestDensity: ForestDensity;
  mountainAmount: TerrainLevel;
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
    mountainAmount: 'medium',
    startingFunds: 'normal',
    disastersEnabled: true,
    disasterFrequency: 'medium',
  };
}

const WATER_MAP: Record<TerrainLevel, { riverHalfWidth: number; lakeCount: number }> = {
  low:    { riverHalfWidth: 1, lakeCount: 0 },
  medium: { riverHalfWidth: 1, lakeCount: 0 },
  high:   { riverHalfWidth: 2, lakeCount: 2 },
};

const FOREST_MAP: Record<ForestDensity, { forestPatchCount: number; forestFillChance: number }> = {
  sparse: { forestPatchCount: 4,  forestFillChance: 0.4 },
  normal: { forestPatchCount: 8,  forestFillChance: 0.7 },
  dense:  { forestPatchCount: 14, forestFillChance: 0.9 },
};

const MOUNTAIN_MAP: Record<TerrainLevel, number> = {
  low: 0,
  medium: 1,
  high: 3,
};

export function resolveTerrainConfig(config: MapConfig): TerrainConfig {
  const water = WATER_MAP[config.waterAmount];
  const forest = FOREST_MAP[config.forestDensity];
  return {
    riverHalfWidth: water.riverHalfWidth,
    lakeCount: water.lakeCount,
    forestPatchCount: forest.forestPatchCount,
    forestFillChance: forest.forestFillChance,
    mountainCount: MOUNTAIN_MAP[config.mountainAmount],
  };
}
