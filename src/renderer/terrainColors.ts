import { TerrainType } from '../core/grid/types';

/**
 * The terrain colours.
 *
 * A module of their own rather than part of `TerrainRenderer`, because the showcase's floor has to
 * match the game's terrain or **the ground decals' contrast differs between the two**: industrial
 * asphalt is shade 0, near black, obvious against bright green terrain and nearly lost against a
 * dark green floor — and the showcase's only value is showing what actually ships.
 *
 * The showcase imports this table rather than copying it, so the two cannot drift. Importing from
 * `TerrainRenderer` would drag Grid and ViewMode into the showcase's dependency graph, and the
 * showcase deliberately does not load the game so that it still opens when the game is broken.
 */
export const TERRAIN_COLORS: Record<number, number> = {
  [TerrainType.PLAIN]: 0x4caf50,
  [TerrainType.WATER]: 0x2196f3,
  [TerrainType.MOUNTAIN]: 0x4caf50,
  [TerrainType.FOREST]: 0x4caf50,
};

export const STONE_COLOR = 0x9e9e9e;
