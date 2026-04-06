import { Grid } from './Grid';
import { TerrainType } from './types';

/** User-configurable terrain parameters resolved from MapConfig. */
export interface TerrainConfig {
  riverHalfWidth: number;
  lakeCount: number;
  forestPatchCount: number;
  forestFillChance: number;
  mountainCount: number;
}

/** Terrain generation parameters for initial map setup. */
export const TERRAIN_GEN = {
  /** River center position range as fraction of map size [min, max] */
  RIVER_POSITION_MIN: 0.25,
  RIVER_POSITION_MAX: 0.75,
  /** Sine wave frequency range for river meandering */
  RIVER_WAVE_FREQ_MIN: 0.06,
  RIVER_WAVE_FREQ_MAX: 0.15,
  /** Sine wave amplitude range (cells) for river meandering */
  RIVER_WAVE_AMP_MIN: 2,
  RIVER_WAVE_AMP_MAX: 5,
  /** Half-width of the river (river extends ±RIVER_HALF_WIDTH from center) */
  RIVER_HALF_WIDTH: 1,

  /** Number of random forest patches */
  FOREST_PATCH_COUNT: 8,
  /** Radius (cells) of each forest patch */
  FOREST_PATCH_RADIUS: 3,
  /** Probability a cell within a patch becomes forest */
  FOREST_FILL_CHANCE: 0.7,

  /** Number of mountain areas */
  MOUNTAIN_COUNT: 1,
  /** Radius (cells) of the mountain area */
  MOUNTAIN_RADIUS: 4,
  /** Base elevation at mountain center */
  MOUNTAIN_PEAK_ELEVATION: 3,
  /** Elevation decay rate per unit distance from center */
  MOUNTAIN_ELEVATION_DECAY: 0.5,
  /** Margin from edge (fraction of map size) for mountain placement */
  MOUNTAIN_MARGIN: 0.1,

  /** Lake radius range for water=high */
  LAKE_RADIUS_MIN: 2,
  LAKE_RADIUS_MAX: 3,
  /** Lake placement margin (fraction of map size) */
  LAKE_MARGIN: 0.15,
} as const;

/** Simple seeded pseudo-random number generator (LCG). */
function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Generate terrain for a new map: river, lakes, forest patches, and mountains.
 * Pass a numeric seed for deterministic results; omit for a random map.
 * Pass a TerrainConfig to override default generation parameters.
 */
export function generateTerrain(grid: Grid, seed?: number, config?: TerrainConfig): void {
  const actualSeed = seed ?? Math.floor(Math.random() * 2147483646) + 1;
  const rng = seededRandom(actualSeed);
  const size = grid.width;
  const T = TERRAIN_GEN;

  const riverHalfWidth = config?.riverHalfWidth ?? T.RIVER_HALF_WIDTH;
  const lakeCount = config?.lakeCount ?? 0;
  const forestPatchCount = config?.forestPatchCount ?? T.FOREST_PATCH_COUNT;
  const forestFillChance = config?.forestFillChance ?? T.FOREST_FILL_CHANCE;
  const mountainCount = config?.mountainCount ?? T.MOUNTAIN_COUNT;

  // --- River ---
  const riverPos = T.RIVER_POSITION_MIN + rng() * (T.RIVER_POSITION_MAX - T.RIVER_POSITION_MIN);
  const waveFreq = T.RIVER_WAVE_FREQ_MIN + rng() * (T.RIVER_WAVE_FREQ_MAX - T.RIVER_WAVE_FREQ_MIN);
  const waveAmp = T.RIVER_WAVE_AMP_MIN + rng() * (T.RIVER_WAVE_AMP_MAX - T.RIVER_WAVE_AMP_MIN);
  const wavePhase = rng() * Math.PI * 2;

  for (let y = 0; y < size; y++) {
    const riverX = Math.floor(
      size * riverPos + Math.sin(y * waveFreq + wavePhase) * waveAmp,
    );
    for (let dx = -riverHalfWidth; dx <= riverHalfWidth; dx++) {
      const x = riverX + dx;
      if (x >= 0 && x < size) {
        grid.setCell(x, y, { terrainType: TerrainType.WATER });
      }
    }
  }

  // --- Lakes ---
  const lakeMargin = Math.floor(size * T.LAKE_MARGIN);
  const lakePlaceable = size - 2 * lakeMargin;
  for (let l = 0; l < lakeCount; l++) {
    const lx = lakeMargin + Math.floor(rng() * Math.max(lakePlaceable, 1));
    const ly = lakeMargin + Math.floor(rng() * Math.max(lakePlaceable, 1));
    const lr = T.LAKE_RADIUS_MIN + Math.floor(rng() * (T.LAKE_RADIUS_MAX - T.LAKE_RADIUS_MIN + 1));
    const lr2 = lr * lr;
    for (let dy = -lr; dy <= lr; dy++) {
      for (let dx = -lr; dx <= lr; dx++) {
        if (dx * dx + dy * dy <= lr2) {
          const x = lx + dx;
          const y = ly + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            grid.setCell(x, y, { terrainType: TerrainType.WATER });
          }
        }
      }
    }
  }

  // --- Forest patches ---
  const fr = T.FOREST_PATCH_RADIUS;
  for (let i = 0; i < forestPatchCount; i++) {
    const cx = Math.floor(rng() * size);
    const cy = Math.floor(rng() * size);
    for (let dy = -fr; dy <= fr; dy++) {
      for (let dx = -fr; dx <= fr; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          const cell = grid.getCell(x, y);
          if (cell && cell.terrainType === TerrainType.PLAIN && rng() < forestFillChance) {
            grid.setCell(x, y, { terrainType: TerrainType.FOREST });
          }
        }
      }
    }
  }

  // --- Mountains ---
  const margin = Math.floor(size * T.MOUNTAIN_MARGIN) + T.MOUNTAIN_RADIUS;
  const placeable = size - 2 * margin;
  const mr = T.MOUNTAIN_RADIUS;
  const mr2 = mr * mr;

  for (let m = 0; m < mountainCount; m++) {
    const mx = margin + Math.floor(rng() * Math.max(placeable, 1));
    const my = margin + Math.floor(rng() * Math.max(placeable, 1));
    for (let dy = -mr; dy <= mr; dy++) {
      for (let dx = -mr; dx <= mr; dx++) {
        if (dx * dx + dy * dy <= mr2) {
          const x = mx + dx;
          const y = my + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            grid.setCell(x, y, {
              terrainType: TerrainType.MOUNTAIN,
              elevation: T.MOUNTAIN_PEAK_ELEVATION - Math.sqrt(dx * dx + dy * dy) * T.MOUNTAIN_ELEVATION_DECAY,
            });
          }
        }
      }
    }
  }
}
