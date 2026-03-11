import { Grid } from '../grid/Grid';
import { TerrainType } from '../grid/types';
import { RoadType } from '../road/types';
import {
  getInfraConfig,
  getInfraConfigById,
  getRotatedSize,
  type InfraType,
  type Rotation,
} from './InfraConfig';

/** Reserved value for secondary cells of multi-cell buildings. */
export const MULTI_CELL_OCCUPIED = 4;

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
  | { ok: false; reason: 'OUT_OF_BOUNDS' | 'WATER_TILE' | 'TILE_OCCUPIED' | 'UNKNOWN_TYPE' | 'NO_GROUNDWATER' };

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
): PlaceResult {
  const cfg = getInfraConfig(type);
  if (!cfg) return { ok: false, reason: 'UNKNOWN_TYPE' };

  const { w, h } = getRotatedSize(cfg.width, cfg.height, rotation);

  // Check all cells in the W×H footprint
  let hasGroundwater = type !== 'water'; // only matters for water

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      const cell = grid.getCell(cx, cy);
      if (!cell) return { ok: false, reason: 'OUT_OF_BOUNDS' };
      if (cell.terrainType === TerrainType.WATER) return { ok: false, reason: 'WATER_TILE' };
      if (cell.roadType !== RoadType.NONE || cell.buildingId !== 0) return { ok: false, reason: 'TILE_OCCUPIED' };

      if (type === 'water' && groundwaterFn && groundwaterFn(cx, cy) > 0) {
        hasGroundwater = true;
      }
    }
  }

  if (!hasGroundwater) return { ok: false, reason: 'NO_GROUNDWATER' };

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

  // Search for the primary cell in the maximum possible range
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
        if (x - px < maxSize && y - py < maxSize) {
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

  const maxDim = Math.max(cfg.width, cfg.height);
  for (let dy = 0; dy < maxDim; dy++) {
    for (let dx = 0; dx < maxDim; dx++) {
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
