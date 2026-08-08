import type { Grid } from '../grid/Grid';
import { getInfraConfigById, getRotatedSize, isZoneBuilding } from './InfraConfig';
import { MULTI_CELL_OCCUPIED, RESERVED_TO_ROTATION } from './InfraPlacement';
import { isActiveZoneCell } from './BuildingQueries';
import { isPowerExempt, isWaterExempt } from '../service/FacilityOperational';

/** A utility a finished building needs and is not getting. */
export type UtilityWarning = 'NO_POWER' | 'NO_WATER';

export interface UtilityWarningDeps {
  isPowered(x: number, y: number): boolean;
  isWatered(x: number, y: number): boolean;
}

/** Player-facing text, for the tooltip and the selection panel. */
export const UTILITY_WARNING_MESSAGES: Record<UtilityWarning, string> = {
  NO_POWER: 'No electricity',
  NO_WATER: 'No water',
};

/** Icon tint per warning, as 0xRRGGBB. */
export const UTILITY_WARNING_COLORS: Record<UtilityWarning, number> = {
  NO_POWER: 0xffd400,
  NO_WATER: 0x29b6f6,
};

/**
 * Why a FINISHED building has stopped working, or null if it has not.
 *
 * An empty zoned cell can already say why it is not developing. A building
 * that was built and then lost its power said nothing whatsoever: no renderer
 * file referenced power state at all, so a blackout looked exactly like a
 * normal night. The only symptom reached the player weeks later, when the
 * building abandoned itself and the cause was long off screen.
 *
 * The predicate has to be the one the simulation already applies, or the icon
 * lies in one of two directions — an icon over a power plant, which needs no
 * power, or silence over a bus depot that has genuinely stopped. So the
 * exemptions come from FacilityOperational rather than from a second list
 * maintained here, and ruins are excluded on the same grounds that make their
 * demand zero (BUG-131): they consume nothing, so there is nothing to restore.
 */
export function getBuildingUtilityWarning(
  grid: Grid, x: number, y: number, deps: UtilityWarningDeps,
): UtilityWarning | null {
  const cell = grid.getCell(x, y);
  if (!cell || cell.buildingId === 0) return null;

  // One icon per building, on the primary cell. A 3x3 university wearing nine
  // stacked icons is not a warning, it is a mess.
  if (cell.reserved === MULTI_CELL_OCCUPIED) return null;

  let needsPower: boolean;
  let needsWater: boolean;

  if (isZoneBuilding(cell.buildingId)) {
    // A ruin draws nothing, so it can lose nothing.
    if (!isActiveZoneCell(cell)) return null;
    needsPower = true;
    needsWater = true;
  } else {
    const infra = getInfraConfigById(cell.buildingId);
    if (!infra) return null;
    needsPower = !isPowerExempt(infra.type);
    needsWater = !isWaterExempt(infra.type);
  }

  if (needsPower && !deps.isPowered(x, y)) return 'NO_POWER';
  if (needsWater && !deps.isWatered(x, y)) return 'NO_WATER';
  return null;
}

/**
 * EVERY utility this building needs and is not getting, power first.
 *
 * Showing only the first one meant a player who restored the power was then
 * handed a second problem they were never told about — they fixed what the
 * badge asked for and a new badge appeared. Power still leads, because a water
 * plant needs power and restoring it often clears both.
 */
export function getBuildingUtilityWarnings(
  grid: Grid, x: number, y: number, deps: UtilityWarningDeps,
): UtilityWarning[] {
  const cell = grid.getCell(x, y);
  if (!cell || cell.buildingId === 0) return [];
  if (cell.reserved === MULTI_CELL_OCCUPIED) return [];

  let needsPower: boolean;
  let needsWater: boolean;
  if (isZoneBuilding(cell.buildingId)) {
    if (!isActiveZoneCell(cell)) return [];
    needsPower = true;
    needsWater = true;
  } else {
    const infra = getInfraConfigById(cell.buildingId);
    if (!infra) return [];
    needsPower = !isPowerExempt(infra.type);
    needsWater = !isWaterExempt(infra.type);
  }

  const out: UtilityWarning[] = [];
  if (needsPower && !deps.isPowered(x, y)) out.push('NO_POWER');
  if (needsWater && !deps.isWatered(x, y)) out.push('NO_WATER');
  return out;
}

export interface WarnedCell {
  /** The building's primary (top-left) cell. */
  x: number;
  y: number;
  /**
   * Where to DRAW, in grid units.
   *
   * A facility is recorded at its top-left cell, so a 3x3 university hung its
   * badge off the corner of the site rather than over it. This is the centre
   * of the whole rotated footprint — the same figure buildInfrastructure uses
   * to position the model itself.
   */
  drawX: number;
  drawY: number;
  warning: UtilityWarning;
  /** Which of this building's badges this is, left to right. */
  slot?: number;
  /** How many badges this building has, so they can be centred as a group. */
  slotCount?: number;
}

/** The centre of a building's footprint, for anything drawn over it. */
export function buildingCentre(
  cell: { buildingId: number; reserved: number }, x: number, y: number,
): { drawX: number; drawY: number } {
  if (isZoneBuilding(cell.buildingId)) return { drawX: x, drawY: y };
  const cfg = getInfraConfigById(cell.buildingId);
  if (!cfg) return { drawX: x, drawY: y };
  const { w, h } = getRotatedSize(cfg.width, cfg.height, RESERVED_TO_ROTATION[cell.reserved] ?? 0);
  return { drawX: x + (w - 1) / 2, drawY: y + (h - 1) / 2 };
}

/**
 * Every badge to draw: one entry per building per missing utility.
 *
 * A building can be missing both, so `slot` and `slotCount` let the renderer
 * lay them out side by side and centred rather than stacked on one another.
 */
export function collectBuildingUtilityWarnings(
  grid: Grid, deps: UtilityWarningDeps,
): WarnedCell[] {
  const out: WarnedCell[] = [];
  grid.forEachCell((cell, x, y) => {
    if (cell.buildingId === 0) return;
    const warnings = getBuildingUtilityWarnings(grid, x, y, deps);
    if (warnings.length === 0) return;
    const { drawX, drawY } = buildingCentre(cell, x, y);
    for (let i = 0; i < warnings.length; i++) {
      out.push({
        x, y, drawX, drawY,
        warning: warnings[i]!, slot: i, slotCount: warnings.length,
      });
    }
  });
  return out;
}
