import { TerrainType } from '../grid/types';
import { type ElevatedPosition } from './types';
import { type ElevationManager } from './ElevationManager';
import { RoadType } from '../road/types';

interface CellLike {
  terrainType: number;
  roadType: number;
}

interface GridLike {
  readonly width: number;
  readonly height: number;
  getCell(x: number, y: number): CellLike | null;
}

/**
 * Find the index of the L-shaped bend in a path (where direction changes).
 * Returns null for straight paths.
 */
function findBendIndex(path: ElevatedPosition[]): number | null {
  if (path.length < 3) return null;
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]!;
    const curr = path[i]!;
    const next = path[i + 1]!;
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    if (dx1 !== dx2 || dy1 !== dy2) return i;
  }
  return null;
}

/**
 * Validate an elevated path for terrain, water crossing, and level conflicts.
 * Returns null if valid, or a reason string if invalid.
 *
 * Rules:
 * - Water cells at level 0 → 'WATER_TILE'
 * - Ramp cells on water → 'RAMP_ON_WATER'
 * - L-shaped bend on water → 'WATER_CROSSING_NO_TURN'
 * - Mountain cells at any level → 'MOUNTAIN_TILE'
 * - Out of bounds → 'OUT_OF_BOUNDS'
 * - Existing elevated segment at same level → 'LEVEL_OCCUPIED'
 */
export function validateElevatedPath(
  grid: GridLike,
  elevationManager: ElevationManager,
  path: ElevatedPosition[],
  /** Path indices to skip for level-collision checks (e.g. start/end cells being extended). */
  excludeCollisionIndices?: Set<number>,
): string | null {
  const bendIndex = findBendIndex(path);
  let hasWaterCell = false;

  for (let i = 0; i < path.length; i++) {
    const pos = path[i]!;
    const cell = grid.getCell(pos.x, pos.y);

    // Out of bounds
    if (!cell) return 'OUT_OF_BOUNDS';

    const isWater = cell.terrainType === TerrainType.WATER;
    const isMountain = cell.terrainType === TerrainType.MOUNTAIN;

    // Mountain blocked at all levels
    if (isMountain) return 'MOUNTAIN_TILE';

    if (isWater) {
      hasWaterCell = true;

      // Water at level 0 → blocked
      if (pos.level === 0 && !pos.isRamp) return 'WATER_TILE';

      // Ramp on water → blocked (ramps need solid ground)
      if (pos.isRamp) return 'RAMP_ON_WATER';
    }

    // Check level collision with existing elevated segments.
    // Gate on the level actually WRITTEN, not on pos.level: an ascending ramp has
    // level 0 / targetLevel 1 but is stored at level 1, so `pos.level > 0` let it
    // skip this whole block and silently overwrite an existing viaduct (BUG-059).
    const storeLevel = pos.isRamp ? Math.max(pos.level, pos.targetLevel) : pos.level;
    if (storeLevel > 0 && !excludeCollisionIndices?.has(i)) {
      const existing = elevationManager.get(pos.x, pos.y, storeLevel);
      // Flat-on-flat is allowed (merge flags, like ground roads); any ramp involvement blocks
      if (existing && (existing.isRamp || pos.isRamp)) return 'LEVEL_OCCUPIED';
      // Flat elevated cell blocked by ramp occupying the same level (stored at a different level)
      if (!pos.isRamp && elevationManager.hasRampAtLevel(pos.x, pos.y, pos.level)) {
        return 'LEVEL_OCCUPIED';
      }
    }

    // Ramp cells cannot be placed over existing ground roads or other-level elevated segments
    if (pos.isRamp) {
      const lowLevel = Math.min(pos.level, pos.targetLevel);
      // Ground road under ramp (only when ramp's low side is level 0)
      if (lowLevel === 0 && cell.roadType !== RoadType.NONE) return 'RAMP_OVER_ROAD';
      // Elevated segment at ramp's low side level
      if (lowLevel > 0) {
        const below = elevationManager.get(pos.x, pos.y, lowLevel);
        if (below) return 'RAMP_OVER_ELEVATED';
      }
    }
  }

  // Water crossing turn check: if any water cell exists and path has a bend,
  // check if the bend region overlaps with water
  if (hasWaterCell && bendIndex !== null) {
    // Check if any water cell is at or adjacent to the bend
    for (let i = 0; i < path.length; i++) {
      const pos = path[i]!;
      const cell = grid.getCell(pos.x, pos.y);
      if (cell && cell.terrainType === TerrainType.WATER) {
        // Any L-shaped path that has water cells is rejected
        // (safe rule: if you cross water, the entire path must be straight)
        return 'WATER_CROSSING_NO_TURN';
      }
    }
  }

  return null;
}
