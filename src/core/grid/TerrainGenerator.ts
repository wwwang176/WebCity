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
  /** If true, generate sea + bay or peninsula instead of river. */
  coastalFeature: boolean;
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

  /** Sea: how many rows/columns of water along the edge */
  SEA_DEPTH_MIN: 6,
  SEA_DEPTH_MAX: 10,
  /** Bay: radius of the concave water arc */
  BAY_RADIUS_MIN: 8,
  BAY_RADIUS_MAX: 14,
  /** Peninsula: radius of the convex land arc pushed into the sea */
  PENINSULA_RADIUS_MIN: 6,
  PENINSULA_RADIUS_MAX: 10,
  /** Peninsula: width of the land bridge connecting to mainland */
  PENINSULA_BRIDGE_HALF_WIDTH: 3,
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
 * Generate terrain for a new map.
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
  const coastalFeature = config?.coastalFeature ?? false;

  if (coastalFeature) {
    generateSeaCoast(grid, rng, size, T);
  } else {
    generateRiver(grid, rng, size, T, riverHalfWidth);
    generateLakes(grid, rng, size, T, lakeCount);
  }

  // --- Forest (edge-based per-cell) ---
  generateForest(grid, rng, size, T, forestDepth, forestWaterGap);
}

/** Generate a meandering river (north-south or east-west). */
function generateRiver(
  grid: Grid, rng: () => number, size: number,
  T: typeof TERRAIN_GEN, riverHalfWidth: number,
): void {
  const riverPos = T.RIVER_POSITION_MIN + rng() * (T.RIVER_POSITION_MAX - T.RIVER_POSITION_MIN);
  const waveFreq = T.RIVER_WAVE_FREQ_MIN + rng() * (T.RIVER_WAVE_FREQ_MAX - T.RIVER_WAVE_FREQ_MIN);
  const waveAmp = T.RIVER_WAVE_AMP_MIN + rng() * (T.RIVER_WAVE_AMP_MAX - T.RIVER_WAVE_AMP_MIN);
  const wavePhase = rng() * Math.PI * 2;
  const horizontal = rng() < 0.5;

  for (let t = 0; t < size; t++) {
    const center = Math.floor(
      size * riverPos + Math.sin(t * waveFreq + wavePhase) * waveAmp,
    );
    for (let d = -riverHalfWidth; d <= riverHalfWidth; d++) {
      const c = center + d;
      if (c >= 0 && c < size) {
        const x = horizontal ? t : c;
        const y = horizontal ? c : t;
        grid.setCell(x, y, { terrainType: TerrainType.WATER });
      }
    }
  }
}

/** Generate random circular lakes. */
function generateLakes(
  grid: Grid, rng: () => number, size: number,
  T: typeof TERRAIN_GEN, lakeCount: number,
): void {
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
}

/**
 * Generate sea on one edge + either a bay (concave) or peninsula (convex).
 * Bay: sea edge + circular water arc pushed into land.
 * Peninsula: sea edge + circular land arc pushed into sea, with land bridge to mainland.
 */
function generateSeaCoast(
  grid: Grid, rng: () => number, size: number, T: typeof TERRAIN_GEN,
): void {
  // Pick a random edge: 0=top, 1=right, 2=bottom, 3=left
  const edge = Math.floor(rng() * 4);
  const seaDepth = T.SEA_DEPTH_MIN + Math.floor(rng() * (T.SEA_DEPTH_MAX - T.SEA_DEPTH_MIN + 1));
  const isPeninsula = rng() < 0.5;

  // Fill sea with wavy coastline
  const coastFreq1 = 0.08 + rng() * 0.06;
  const coastFreq2 = 0.15 + rng() * 0.1;
  const coastAmp1 = 2 + rng() * 3;
  const coastAmp2 = 1 + rng() * 2;
  const coastPhase1 = rng() * Math.PI * 2;
  const coastPhase2 = rng() * Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const along = (edge === 0 || edge === 2) ? x : y;
      const waveOffset = Math.sin(along * coastFreq1 + coastPhase1) * coastAmp1
                       + Math.sin(along * coastFreq2 + coastPhase2) * coastAmp2;
      if (distFromEdge(x, y, size, edge) < seaDepth + waveOffset) {
        grid.setCell(x, y, { terrainType: TerrainType.WATER });
      }
    }
  }

  // Feature center position along the edge (avoid corners)
  const featurePos = 0.3 + rng() * 0.4; // 30%~70% along the edge
  const alongCoord = Math.floor(size * featurePos);

  if (isPeninsula) {
    // Peninsula: push a circle of land from coastline into the sea
    const r = T.PENINSULA_RADIUS_MIN + Math.floor(rng() * (T.PENINSULA_RADIUS_MAX - T.PENINSULA_RADIUS_MIN + 1));
    // Center of the land circle: positioned so it overlaps into the sea
    const cx = peninsulaCenterX(edge, size, seaDepth, r, alongCoord);
    const cy = peninsulaCenterY(edge, size, seaDepth, r, alongCoord);
    const r2 = r * r;

    // Place land circle
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          grid.setCell(px, py, { terrainType: TerrainType.PLAIN });
        }
      }
    }

    // Ensure land bridge connecting peninsula to mainland
    const bw = T.PENINSULA_BRIDGE_HALF_WIDTH;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || px >= size || py < 0 || py >= size) continue;
        // Check if this cell is within the bridge strip (along-edge direction)
        const alongDist = edgeAlongDist(px, py, edge, alongCoord);
        const perpDist = distFromEdge(px, py, size, edge);
        if (alongDist <= bw && perpDist >= seaDepth - 1) {
          // Bridge: connect from coastline to peninsula
          grid.setCell(px, py, { terrainType: TerrainType.PLAIN });
        }
      }
    }
  } else {
    // Bay: push a circle of water from sea further into land
    const r = T.BAY_RADIUS_MIN + Math.floor(rng() * (T.BAY_RADIUS_MAX - T.BAY_RADIUS_MIN + 1));
    // Center of the water circle: at the coastline boundary, so it extends into land
    const cx = bayCenterX(edge, size, seaDepth, alongCoord);
    const cy = bayCenterY(edge, size, seaDepth, alongCoord);
    const r2 = r * r;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          grid.setCell(px, py, { terrainType: TerrainType.WATER });
        }
      }
    }
  }
}

/** Distance from grid cell to the given map edge. */
function distFromEdge(x: number, y: number, size: number, edge: number): number {
  switch (edge) {
    case 0: return y;              // top
    case 1: return size - 1 - x;  // right
    case 2: return size - 1 - y;  // bottom
    default: return x;            // left
  }
}

/** Distance along the edge axis from a reference point. */
function edgeAlongDist(x: number, y: number, edge: number, ref: number): number {
  // For top/bottom edges, "along" is X axis; for left/right, "along" is Y axis
  const coord = (edge === 0 || edge === 2) ? x : y;
  return Math.abs(coord - ref);
}

// --- Peninsula center calculation: place circle center so it overlaps into the sea ---
function peninsulaCenterX(edge: number, size: number, seaDepth: number, r: number, along: number): number {
  switch (edge) {
    case 0: return along;                           // top: along X
    case 1: return size - seaDepth + r * 0.7;      // right: push into sea
    case 2: return along;                           // bottom: along X
    default: return seaDepth - r * 0.7;             // left: push into sea
  }
}
function peninsulaCenterY(edge: number, size: number, seaDepth: number, r: number, along: number): number {
  switch (edge) {
    case 0: return seaDepth - r * 0.7;              // top: push into sea
    case 1: return along;                           // right: along Y
    case 2: return size - seaDepth + r * 0.7;       // bottom: push into sea
    default: return along;                          // left: along Y
  }
}

// --- Bay center calculation: place circle center at coastline boundary ---
function bayCenterX(edge: number, size: number, seaDepth: number, along: number): number {
  switch (edge) {
    case 0: return along;
    case 1: return size - seaDepth;
    case 2: return along;
    default: return seaDepth;
  }
}
function bayCenterY(edge: number, size: number, seaDepth: number, along: number): number {
  switch (edge) {
    case 0: return seaDepth;
    case 1: return along;
    case 2: return size - seaDepth;
    default: return along;
  }
}

/** Generate edge-based per-cell forest. */
function generateForest(
  grid: Grid, rng: () => number, size: number,
  T: typeof TERRAIN_GEN, forestDepth: number, forestWaterGap: number,
): void {
  const halfSize = size / 2;
  const maxForestDist = halfSize * forestDepth;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = grid.getCell(x, y);
      if (!cell || cell.terrainType !== TerrainType.PLAIN) continue;

      const edgeDist = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (maxForestDist <= 0 || edgeDist >= maxForestDist) continue;

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

      const ratio = 1 - edgeDist / maxForestDist;
      const prob = T.FOREST_EDGE_PROB * ratio * ratio + rng() * T.FOREST_JITTER;
      if (rng() < prob) {
        grid.setCell(x, y, { terrainType: TerrainType.FOREST });
      }
    }
  }
}
