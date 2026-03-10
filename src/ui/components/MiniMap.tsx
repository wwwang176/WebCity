import { onMount, createEffect } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';

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

      ctx.fillStyle = '#1a2a1a';
      ctx.fillRect(0, 0, cw, ch);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cell = grid.getCell(x, y);
          if (!cell) continue;

          let color: string | null = null;

          if (cell.terrainType === 1) color = '#1a3a5c';
          else if (cell.terrainType === 2) color = '#5c5c4c';
          else if (cell.terrainType === 3) color = '#1c3a1c';

          if (cell.roadType > 0) color = '#555';

          if (cell.buildingId > 0 && cell.buildingId < 243) {
            if (cell.zoneType === 1 || cell.zoneType === 2) color = '#4caf50';
            else if (cell.zoneType === 3 || cell.zoneType === 4) color = '#42a5f5';
            else if (cell.zoneType === 5) color = '#ffa726';
            else if (cell.zoneType === 6) color = '#ab47bc';
          }
          if (cell.buildingId >= 243) color = '#ffeb3b';

          if (cell.buildingId === 0 && cell.zoneType > 0 && !color) {
            if (cell.zoneType === 1 || cell.zoneType === 2) color = '#2e5e2e';
            else if (cell.zoneType === 3 || cell.zoneType === 4) color = '#1e4a6e';
            else if (cell.zoneType === 5) color = '#5e3e1e';
            else if (cell.zoneType === 6) color = '#4e2e5e';
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
