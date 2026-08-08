import type { Grid } from '../grid/Grid';
import { getInfraConfigById, isZoneBuilding } from './InfraConfig';
import { MULTI_CELL_OCCUPIED } from './InfraPlacement';
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

  // Power first when both are out: it is one icon per building, and power is
  // also what stops the pump that would restore the water.
  if (needsPower && !deps.isPowered(x, y)) return 'NO_POWER';
  if (needsWater && !deps.isWatered(x, y)) return 'NO_WATER';
  return null;
}

export interface WarnedCell {
  x: number;
  y: number;
  warning: UtilityWarning;
}

/** Every building currently missing a utility it needs. */
export function collectBuildingUtilityWarnings(
  grid: Grid, deps: UtilityWarningDeps,
): WarnedCell[] {
  const out: WarnedCell[] = [];
  grid.forEachCell((cell, x, y) => {
    if (cell.buildingId === 0) return;
    const warning = getBuildingUtilityWarning(grid, x, y, deps);
    if (warning) out.push({ x, y, warning });
  });
  return out;
}
