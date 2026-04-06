import { onMount, createEffect } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { ZoneType, TerrainType } from '../../core/grid/types';
import { PALETTE, toCSS } from '../../ColorPalette';

export function MiniMap() {
  let canvas: HTMLCanvasElement | undefined;
  let tickCount = 0;

  onMount(() => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    createEffect(() => {
      // Read signals to create dependency
      gameSignals.population();
      gameSignals.funds();

      // Throttle: only redraw every 10th signal update (first draw is immediate)
      tickCount++;
      if (tickCount > 1 && tickCount % 10 !== 0) return;

      const state = getGame().getState();
      const grid = state.grid;
      const w = grid.width;
      const h = grid.height;
      const cw = canvas!.width;
      const ch = canvas!.height;
      const sx = cw / w;
      const sy = ch / h;

      ctx.fillStyle = '#1c3a1c';
      ctx.fillRect(0, 0, cw, ch);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cell = grid.getCell(x, y);
          if (!cell) continue;

          let color: string | null = null;

          if (cell.terrainType === TerrainType.WATER) color = '#1a3a5c';
          else if (cell.terrainType === TerrainType.MOUNTAIN) color = '#2a4a2a';
          else if (cell.terrainType === TerrainType.FOREST) color = '#1a2a1a';

          if (cell.roadType > 0) color = '#555';

          if (cell.buildingId > 0 && cell.buildingId < 243) {
            if (cell.zoneType === ZoneType.RESIDENTIAL_LOW || cell.zoneType === ZoneType.RESIDENTIAL_HIGH) color = toCSS(PALETTE.ZONE.RES_LOW);
            else if (cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH) color = toCSS(PALETTE.ZONE.COM_LOW_LIGHT);
            else if (cell.zoneType === ZoneType.INDUSTRIAL) color = toCSS(PALETTE.ZONE.IND);
            else if (cell.zoneType === ZoneType.OFFICE) color = toCSS(PALETTE.ZONE.OFFICE);
          }
          if (cell.buildingId >= 243) color = '#ffeb3b';

          if (cell.buildingId === 0 && cell.zoneType > 0 && !color) {
            if (cell.zoneType === ZoneType.RESIDENTIAL_LOW || cell.zoneType === ZoneType.RESIDENTIAL_HIGH) color = '#2e5e2e';
            else if (cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH) color = '#1e4a6e';
            else if (cell.zoneType === ZoneType.INDUSTRIAL) color = '#5e3e1e';
            else if (cell.zoneType === ZoneType.OFFICE) color = '#4e2e5e';
          }

          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(
              Math.floor(x * sx), Math.floor(y * sy),
              Math.max(1, Math.ceil(sx)), Math.max(1, Math.ceil(sy))
            );
          }
        }
      }
    });
  });

  return (
    <div id="minimap-container" role="img" aria-label="City minimap">
      <canvas ref={canvas} id="minimap-canvas" width={120} height={120} />
    </div>
  );
}
