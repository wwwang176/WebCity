import { Grid } from './Grid';
import { TerrainType } from './types';

/** User-configurable terrain parameters resolved from MapConfig. */
export interface TerrainConfig {
  riverHalfWidth: number;
  lakeCount: number;
  /** Controls how far forest extends from edges toward center (0-1). Higher = deeper. */
  forestDepth: number;
  /** Manhattan distance from water within which forest probability drops to 0. */
  forestWaterGap: number;
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

  /** How far forest extends from edge toward center (fraction of half-size). 0.5 = halfway. */
  FOREST_DEPTH: 0.5,
  /** Manhattan distance from water within which forest is suppressed. */
  FOREST_WATER_GAP: 2,
  /** Base probability at the very edge of the map. */
  FOREST_EDGE_PROB: 0.95,
  /** Randomness jitter to break up uniform edges. */
  FOREST_JITTER: 0.15,

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
 * Generate terrain for a new map: river, lakes, and edge-based forest.
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
  const forestDepth = config?.forestDepth ?? T.FOREST_DEPTH;
  const forestWaterGap = config?.forestWaterGap ?? T.FOREST_WATER_GAP;

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

  // --- Forest (edge-based per-cell) ---
  // Forest is dense at map edges and fades toward center.
  // Suppressed near water bodies.
  const halfSize = size / 2;
  const maxForestDist = halfSize * forestDepth; // cells from edge where forest probability reaches 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = grid.getCell(x, y);
      if (!cell || cell.terrainType !== TerrainType.PLAIN) continue;

      // Distance from nearest edge
      const edgeDist = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (maxForestDist <= 0 || edgeDist >= maxForestDist) continue;

      // Check water proximity — suppress forest near rivers/lakes
      let nearWater = false;
      for (let dy = -forestWaterGap; dy <= forestWaterGap && !nearWater; dy++) {
        for (let dx = -forestWaterGap; dx <= forestWaterGap && !nearWater; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > forestWaterGap) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
            const nc = grid.getCell(nx, ny);
            if (nc && nc.terrainType === TerrainType.WATER) nearWater = true;
          }
        }
      }
      if (nearWater) continue;

      // Probability: high at edge (edgeDist=0), fades to 0 at maxForestDist
      const ratio = 1 - edgeDist / maxForestDist;
      const prob = T.FOREST_EDGE_PROB * ratio * ratio + rng() * T.FOREST_JITTER;
      if (rng() < prob) {
        grid.setCell(x, y, { terrainType: TerrainType.FOREST });
      }
    }
  }

}
