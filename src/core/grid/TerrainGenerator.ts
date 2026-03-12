import { Grid } from './Grid';
import { TerrainType } from './types';

/** Terrain generation parameters for initial map setup. */
export const TERRAIN_GEN = {
  /** River center position as fraction of map size */
  RIVER_POSITION_RATIO: 0.7,
  /** Sine wave frequency for river meandering */
  RIVER_WAVE_FREQUENCY: 0.1,
  /** Sine wave amplitude (cells) for river meandering */
  RIVER_WAVE_AMPLITUDE: 3,
  /** Half-width of the river (river extends ±RIVER_HALF_WIDTH from center) */
  RIVER_HALF_WIDTH: 1,

  /** Number of random forest patches */
  FOREST_PATCH_COUNT: 8,
  /** Radius (cells) of each forest patch */
  FOREST_PATCH_RADIUS: 3,
  /** Probability a cell within a patch becomes forest */
  FOREST_FILL_CHANCE: 0.7,

  /** Mountain center X as fraction of map size */
  MOUNTAIN_X_RATIO: 0.15,
  /** Mountain center Y as fraction of map size */
  MOUNTAIN_Y_RATIO: 0.85,
  /** Radius (cells) of the mountain area */
  MOUNTAIN_RADIUS: 4,
  /** Base elevation at mountain center */
  MOUNTAIN_PEAK_ELEVATION: 3,
  /** Elevation decay rate per unit distance from center */
  MOUNTAIN_ELEVATION_DECAY: 0.5,
} as const;

/**
 * Generate terrain for a new map: river, forest patches, and mountains.
 * Extracted from Game.ts for SRP — terrain generation is pure grid logic.
 */
export function generateTerrain(grid: Grid): void {
  const size = grid.width;
  const T = TERRAIN_GEN;

  // Create a river
  for (let y = 0; y < size; y++) {
    const riverX = Math.floor(size * T.RIVER_POSITION_RATIO + Math.sin(y * T.RIVER_WAVE_FREQUENCY) * T.RIVER_WAVE_AMPLITUDE);
    for (let dx = -T.RIVER_HALF_WIDTH; dx <= T.RIVER_HALF_WIDTH; dx++) {
      const x = riverX + dx;
      if (x >= 0 && x < size) {
        grid.setCell(x, y, { terrainType: TerrainType.WATER });
      }
    }
  }

  // Create some forest patches
  const fr = T.FOREST_PATCH_RADIUS;
  for (let i = 0; i < T.FOREST_PATCH_COUNT; i++) {
    const cx = Math.floor(Math.random() * size);
    const cy = Math.floor(Math.random() * size);
    for (let dy = -fr; dy <= fr; dy++) {
      for (let dx = -fr; dx <= fr; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          const cell = grid.getCell(x, y);
          if (cell && cell.terrainType === TerrainType.PLAIN && Math.random() < T.FOREST_FILL_CHANCE) {
            grid.setCell(x, y, { terrainType: TerrainType.FOREST });
          }
        }
      }
    }
  }

  // Small mountain area
  const mr = T.MOUNTAIN_RADIUS;
  const mx = Math.floor(size * T.MOUNTAIN_X_RATIO);
  const my = Math.floor(size * T.MOUNTAIN_Y_RATIO);
  const mr2 = mr * mr;
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
