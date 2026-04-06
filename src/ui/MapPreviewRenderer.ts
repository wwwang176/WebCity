import { Grid } from '../core/grid/Grid';
import { TerrainType } from '../core/grid/types';
import { generateTerrain } from '../core/grid/TerrainGenerator';
import { resolveTerrainConfig, type MapConfig } from '../core/config/MapConfig';

const TERRAIN_COLORS: Record<number, string> = {
  [TerrainType.WATER]: '#1a3a5c',
  [TerrainType.MOUNTAIN]: '#2a4a2a',
  [TerrainType.FOREST]: '#1a2a1a',
};

const BG_COLOR = '#1c3a1c';

/**
 * Render a terrain preview to a canvas based on MapConfig.
 * Creates a temporary Grid, generates terrain, then paints it.
 * No Game instance needed — pure function.
 */
export function renderMapPreview(canvas: HTMLCanvasElement, config: MapConfig): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const gridSize = 60;
  const grid = new Grid(gridSize, gridSize);
  generateTerrain(grid, config.seed, resolveTerrainConfig(config));

  const cw = canvas.width;
  const ch = canvas.height;
  const sx = cw / gridSize;
  const sy = ch / gridSize;

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, cw, ch);

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const cell = grid.getCell(x, y);
      if (!cell) continue;
      const color = TERRAIN_COLORS[cell.terrainType];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(
          Math.floor(x * sx), Math.floor(y * sy),
          Math.max(1, Math.ceil(sx)), Math.max(1, Math.ceil(sy)),
        );
      }
    }
  }
}
