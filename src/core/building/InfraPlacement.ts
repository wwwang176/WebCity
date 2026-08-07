import { Grid } from '../grid/Grid';
import { isFootprintAdjacentToRoad, isFootprintNearRoad } from '../grid/GridHelpers';
import { TerrainType } from '../grid/types';
import { RoadType } from '../road/types';
import {
  DEFAULT_INFRA_ROAD_REACH,
  getInfraConfig,
  getInfraConfigById,
  getRotatedSize,
  isInfrastructureBuilding,
  type InfraType,
  type Rotation,
} from './InfraConfig';

/** Check if any of the 4 cardinal neighbors is a water tile. */
function hasAdjacentWater(grid: Grid, x: number, y: number): boolean {
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const cell = grid.getCell(x + dx, y + dy);
    if (cell && cell.terrainType === TerrainType.WATER) return true;
  }
  return false;
}

/** Reserved value for secondary cells of multi-cell buildings. */
export const MULTI_CELL_OCCUPIED = 4;

/** Reserved value for abandoned buildings. */
export const ABANDONED = 1;

/** Reserved value for burned/charred buildings. */
export const BURNED = 3;

/**
 * Reserved values for primary cell rotation encoding.
 * 0 = 0° (default), 5 = 90°, 6 = 180°, 7 = 270°
 */
export const ROTATION_RESERVED: Record<Rotation, number> = { 0: 0, 90: 5, 180: 6, 270: 7 };
export const RESERVED_TO_ROTATION: Record<number, Rotation> = { 0: 0, 5: 90, 6: 180, 7: 270 };

const ROTATION_VALUES = new Set(Object.values(ROTATION_RESERVED));

/** Check if a reserved value represents a primary cell (not secondary, not burned). */
export function isPrimaryCellReserved(reserved: number): boolean {
  return ROTATION_VALUES.has(reserved);
}

export type PlaceResult =
  | { ok: true }
  | { ok: false; reason: 'OUT_OF_BOUNDS' | 'WATER_TILE' | 'TILE_OCCUPIED' | 'UNKNOWN_TYPE' | 'NO_GROUNDWATER' | 'NEED_RAIL_TRACK' | 'NEED_ADJACENT_WATER' | 'NOT_ADJACENT_TO_ROAD' | 'INFRASTRUCTURE_EXISTS' };

/**
 * Check whether an infrastructure building can be placed at (x, y) with given rotation.
 * (x, y) is the top-left (primary) cell.
 * groundwaterFn is optional — only needed for water plants.
 */
export function canPlaceInfra(
  grid: Grid,
  x: number,
  y: number,
  type: InfraType,
  rotation: Rotation,
  groundwaterFn?: (x: number, y: number) => number,
  overrideSize?: { width: number; height: number },
): PlaceResult {
  const cfg = getInfraConfig(type);
  if (!cfg) return { ok: false, reason: 'UNKNOWN_TYPE' };

  const baseW = overrideSize?.width ?? cfg.width;
  const baseH = overrideSize?.height ?? cfg.height;
  const { w, h } = getRotatedSize(baseW, baseH, rotation);

  // Check all cells in the W×H footprint
  let hasGroundwater = type !== 'water'; // only matters for water

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      const cell = grid.getCell(cx, cy);
      if (!cell) return { ok: false, reason: 'OUT_OF_BOUNDS' };
      if (cell.terrainType === TerrainType.WATER) return { ok: false, reason: 'WATER_TILE' };
      if (cell.roadType !== RoadType.NONE) return { ok: false, reason: 'TILE_OCCUPIED' };
      if (cell.buildingId !== 0 && isInfrastructureBuilding(cell.buildingId)) {
        return { ok: false, reason: 'INFRASTRUCTURE_EXISTS' };
      }
      // Zone buildings (non-infrastructure) are allowed — they will be auto-demolished
      if (cell.railType !== 0 && type !== 'train_station') return { ok: false, reason: 'TILE_OCCUPIED' };

      if (type === 'water' && groundwaterFn && groundwaterFn(cx, cy) > 0) {
        hasGroundwater = true;
      }
    }
  }

  if (!hasGroundwater) return { ok: false, reason: 'NO_GROUNDWATER' };

  // Train station requires rail track on the cell
  if (type === 'train_station') {
    const cell = grid.getCell(x, y)!;
    if (cell.railType === 0) return { ok: false, reason: 'NEED_RAIL_TRACK' };
  }

  // Ferry dock requires at least one adjacent water tile
  if (type === 'ferry_dock') {
    if (!hasAdjacentWater(grid, x, y)) return { ok: false, reason: 'NEED_ADJACENT_WATER' };
  }

  // Civic services (roadReach: 2) may sit one empty tile away (Chebyshev box);
  // utilities/transit (roadReach: 1) must be strictly orthogonally adjacent to
  // preserve pre-existing behavior.
  const reach = cfg.roadReach ?? DEFAULT_INFRA_ROAD_REACH;
  const connected = reach >= 2
    ? isFootprintNearRoad(grid, x, y, w, h, reach)
    : isFootprintAdjacentToRoad(grid, x, y, w, h);
  if (!connected) {
    return { ok: false, reason: 'NOT_ADJACENT_TO_ROAD' };
  }

  return { ok: true };
}

/**
 * Place infrastructure on the grid. Sets buildingId on all cells,
 * and marks secondary cells with reserved = MULTI_CELL_OCCUPIED.
 * Does NOT handle service registration or budget — caller must do that.
 */
export function placeInfraOnGrid(
  grid: Grid,
  x: number,
  y: number,
  type: InfraType,
  rotation: Rotation,
): void {
  const cfg = getInfraConfig(type);
  if (!cfg) return;

  const { w, h } = getRotatedSize(cfg.width, cfg.height, rotation);

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      const isPrimary = dx === 0 && dy === 0;
      grid.setCell(cx, cy, {
        buildingId: cfg.buildingId,
        reserved: isPrimary ? ROTATION_RESERVED[rotation] : MULTI_CELL_OCCUPIED,
        // Clearing zoneType is what removeInfraFromGrid already does; placement
        // did not, so a facility dropped on zoned-but-empty land kept its zone.
        // Game.ts only clears zoneType where a zone *building* stood, which
        // misses exactly this case. The consequence: every footprint cell of a
        // facility on industrial land emitted factory-grade ground pollution and
        // noise, and counted toward zone supply (BUG-074).
        zoneType: 0,
      });
    }
  }
}

/**
 * Find the primary (top-left) cell of a multi-cell building.
 * Given any cell that is part of the building, searches nearby to find
 * the cell with the same buildingId but reserved !== MULTI_CELL_OCCUPIED.
 */
export function findPrimaryCell(
  grid: Grid,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const cell = grid.getCell(x, y);
  if (!cell || cell.buildingId === 0) return null;

  const cfg = getInfraConfigById(cell.buildingId);
  if (!cfg) return null;

  // If this cell is the primary (reserved encodes rotation: 0/5/6/7), return it directly
  if (isPrimaryCellReserved(cell.reserved)) {
    return { x, y };
  }

  // Search for the primary cell in the maximum possible range. A candidate only
  // counts when its own rotated WxH footprint actually contains (x, y) — a plain
  // maxSize box can otherwise claim a *different* instance of the same type that
  // happens to sit up-left of this cell (BUG-052).
  const maxSize = Math.max(cfg.width, cfg.height);
  for (let dy = 0; dy < maxSize; dy++) {
    for (let dx = 0; dx < maxSize; dx++) {
      const px = x - dx;
      const py = y - dy;
      const candidate = grid.getCell(px, py);
      if (
        candidate &&
        candidate.buildingId === cell.buildingId &&
        isPrimaryCellReserved(candidate.reserved)
      ) {
        const { w, h } = getRotatedSize(
          cfg.width,
          cfg.height,
          RESERVED_TO_ROTATION[candidate.reserved] ?? 0,
        );
        if (dx < w && dy < h) {
          return { x: px, y: py };
        }
      }
    }
  }

  return null;
}

/**
 * Iterate all cells of a multi-cell building, given any cell coordinate that
 * belongs to it. Finds the primary cell automatically, then scans the footprint.
 */
export function forEachMultiCell(
  grid: Grid,
  x: number,
  y: number,
  callback: (cx: number, cy: number) => void,
): void {
  const cell = grid.getCell(x, y);
  if (!cell || cell.buildingId === 0) return;

  const cfg = getInfraConfigById(cell.buildingId);
  if (!cfg) return;

  const primary = findPrimaryCell(grid, x, y);
  if (!primary) return;

  // Decode the rotation stored on the primary cell and walk exactly that WxH
  // rectangle. Scanning a max(width, height) square instead would overreach for
  // every non-square config (hospital/high school 2x3, airports up to 9x6) and
  // clear a neighbouring instance of the same type (BUG-052).
  const primaryCell = grid.getCell(primary.x, primary.y)!;
  const { w, h } = getRotatedSize(
    cfg.width,
    cfg.height,
    RESERVED_TO_ROTATION[primaryCell.reserved] ?? 0,
  );

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = primary.x + dx;
      const cy = primary.y + dy;
      const c = grid.getCell(cx, cy);
      if (c && c.buildingId === cell.buildingId) {
        callback(cx, cy);
      }
    }
  }
}

/**
 * Compute the center cell of a multi-cell building given its primary (top-left) cell.
 * Used for service coverage distance calculations so coverage radiates from building center.
 */
export function getInfraCenter(
  primaryX: number,
  primaryY: number,
  type: InfraType,
  rotation: Rotation,
): { cx: number; cy: number } {
  const cfg = getInfraConfig(type);
  if (!cfg) return { cx: primaryX, cy: primaryY };
  const { w, h } = getRotatedSize(cfg.width, cfg.height, rotation);
  return {
    cx: primaryX + Math.floor(w / 2),
    cy: primaryY + Math.floor(h / 2),
  };
}

/**
 * Compute center cell from primary cell and buildingId (for removal, when type/rotation are unknown).
 * Since floor(w/2) == floor(h/2) for all current building sizes, rotation doesn't matter.
 */
export function getInfraCenterById(
  primaryX: number,
  primaryY: number,
  buildingId: number,
): { cx: number; cy: number } {
  const cfg = getInfraConfigById(buildingId);
  if (!cfg) return { cx: primaryX, cy: primaryY };
  return {
    cx: primaryX + Math.floor(cfg.width / 2),
    cy: primaryY + Math.floor(cfg.height / 2),
  };
}

/**
 * Remove a multi-cell infrastructure building from the grid.
 * Given any cell of the building, finds the primary cell and clears all cells.
 * Returns the primary cell coordinates, or null if nothing to remove.
 */
export function removeInfraFromGrid(
  grid: Grid,
  x: number,
  y: number,
): { primaryX: number; primaryY: number } | null {
  const cell = grid.getCell(x, y);
  if (!cell || cell.buildingId === 0) return null;

  const primary = findPrimaryCell(grid, x, y);
  if (!primary) return null;

  forEachMultiCell(grid, x, y, (cx, cy) => {
    grid.setCell(cx, cy, {
      buildingId: 0,
      reserved: 0,
      roadType: 0,
      roadFlags: 0,
      zoneType: 0,
    });
  });

  return { primaryX: primary.x, primaryY: primary.y };
}
