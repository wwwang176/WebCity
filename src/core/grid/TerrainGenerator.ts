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

  /** Lake radius range */
  LAKE_RADIUS_MIN: 4,
  LAKE_RADIUS_MAX: 7,
  /** Lake placement margin (fraction of map size) */
  LAKE_MARGIN: 0.2,
  /** Lake ellipse stretch range (1.0 = circle, 2.0 = 2:1 ellipse) */
  LAKE_STRETCH_MIN: 1.0,
  LAKE_STRETCH_MAX: 1.8,

  /** Sea: how many rows/columns of water along the edge */
  SEA_DEPTH_MIN: 6,
  SEA_DEPTH_MAX: 10,
  /** Bay: radius of the concave water arc */
  BAY_RADIUS_MIN: 8,
  BAY_RADIUS_MAX: 14,
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
    const isPeninsula = rng() < 0.5;
    if (isPeninsula) {
      generatePeninsula(grid, rng, size, T);
    } else {
      generateBay(grid, rng, size, T);
    }
  } else {
    if (riverHalfWidth > 0) generateRiver(grid, rng, size, T, riverHalfWidth);
    generateLakes(grid, rng, size, T, lakeCount);
  }

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

/** Generate random elliptical lakes. */
function generateLakes(
  grid: Grid, rng: () => number, size: number,
  T: typeof TERRAIN_GEN, lakeCount: number,
): void {
  const lakeMargin = Math.floor(size * T.LAKE_MARGIN);
  const lakePlaceable = size - 2 * lakeMargin;
  for (let l = 0; l < lakeCount; l++) {
    const lx = lakeMargin + Math.floor(rng() * Math.max(lakePlaceable, 1));
    const ly = lakeMargin + Math.floor(rng() * Math.max(lakePlaceable, 1));
    const ra = T.LAKE_RADIUS_MIN + Math.floor(rng() * (T.LAKE_RADIUS_MAX - T.LAKE_RADIUS_MIN + 1));
    const stretch = T.LAKE_STRETCH_MIN + rng() * (T.LAKE_STRETCH_MAX - T.LAKE_STRETCH_MIN);
    const rb = Math.max(2, Math.round(ra / stretch));
    const angle = rng() * Math.PI; // random rotation
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const r = Math.max(ra, rb);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Rotate (dx, dy) into ellipse-local coords
        const lxr = dx * cosA + dy * sinA;
        const lyr = -dx * sinA + dy * cosA;
        if ((lxr * lxr) / (ra * ra) + (lyr * lyr) / (rb * rb) > 1) continue;
        const x = lx + dx;
        const y = ly + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          grid.setCell(x, y, { terrainType: TerrainType.WATER });
        }
      }
    }
  }
}

/** Generate 2 random sine wave parameters for a coastline edge. */
function randomCoastWaves(rng: () => number) {
  return {
    freq1: 0.08 + rng() * 0.06,
    freq2: 0.15 + rng() * 0.1,
    amp1: 2 + rng() * 3,
    amp2: 1 + rng() * 2,
    phase1: rng() * Math.PI * 2,
    phase2: rng() * Math.PI * 2,
  };
}

/** Compute wave offset for a coastline at a given position. */
function coastWaveOffset(along: number, w: ReturnType<typeof randomCoastWaves>): number {
  return Math.sin(along * w.freq1 + w.phase1) * w.amp1
       + Math.sin(along * w.freq2 + w.phase2) * w.amp2;
}

/**
 * Bay: sea on one edge with wavy coastline + a circular water arc pushed into land.
 */
function generateBay(
  grid: Grid, rng: () => number, size: number, T: typeof TERRAIN_GEN,
): void {
  const edge = Math.floor(rng() * 4);
  const seaDepth = T.SEA_DEPTH_MIN + Math.floor(rng() * (T.SEA_DEPTH_MAX - T.SEA_DEPTH_MIN + 1));
  const waves = randomCoastWaves(rng);

  // Wavy sea on one edge
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const along = (edge === 0 || edge === 2) ? x : y;
      if (distFromEdge(x, y, size, edge) < seaDepth + coastWaveOffset(along, waves)) {
        grid.setCell(x, y, { terrainType: TerrainType.WATER });
      }
    }
  }

  // Circular bay arc pushed into land
  const r = T.BAY_RADIUS_MIN + Math.floor(rng() * (T.BAY_RADIUS_MAX - T.BAY_RADIUS_MIN + 1));
  const featurePos = 0.3 + rng() * 0.4;
  const along = Math.floor(size * featurePos);
  const cx = (edge === 0 || edge === 2) ? along : (edge === 1 ? size - seaDepth : seaDepth);
  const cy = (edge === 0 || edge === 2) ? (edge === 0 ? seaDepth : size - seaDepth) : along;
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

/**
 * Peninsula: sea on 2 or 3 edges, land connects on the rest.
 * 50% → 3-side sea (1 mainland edge), 50% → 2-side sea (corner, 2 adjacent mainland edges).
 * Each sea edge has its own wavy coastline.
 */
function generatePeninsula(
  grid: Grid, rng: () => number, size: number, T: typeof TERRAIN_GEN,
): void {
  const threeEdges = rng() < 0.5;

  // Determine which edges are mainland (no sea)
  const mainlandEdges = new Set<number>();
  if (threeEdges) {
    // 3-side sea: 1 random mainland edge
    mainlandEdges.add(Math.floor(rng() * 4));
  } else {
    // 2-side sea: pick a corner (2 adjacent edges are mainland)
    // corners: top+left(0,3), top+right(0,1), bottom+left(2,3), bottom+right(1,2)
    const corners = [[0, 3], [0, 1], [2, 3], [1, 2]] as const;
    const corner = corners[Math.floor(rng() * 4)] ?? corners[0];
    mainlandEdges.add(corner[0]);
    mainlandEdges.add(corner[1]);
  }

  // Generate independent wave params for each edge
  const edgeWaves: ReturnType<typeof randomCoastWaves>[] = [];
  const edgeDepths: number[] = [];
  for (let e = 0; e < 4; e++) {
    edgeWaves.push(randomCoastWaves(rng));
    edgeDepths.push(T.SEA_DEPTH_MIN + Math.floor(rng() * (T.SEA_DEPTH_MAX - T.SEA_DEPTH_MIN + 1)));
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let e = 0; e < 4; e++) {
        if (mainlandEdges.has(e)) continue;
        const along = (e === 0 || e === 2) ? x : y;
        const depth = edgeDepths[e]! + coastWaveOffset(along, edgeWaves[e]!);
        if (distFromEdge(x, y, size, e) < depth) {
          grid.setCell(x, y, { terrainType: TerrainType.WATER });
          break;
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
