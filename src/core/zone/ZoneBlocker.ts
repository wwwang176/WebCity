import type { Grid } from '../grid/Grid';
import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { RailType } from '../rail/types';
import { isNearRoad } from '../grid/GridHelpers';
import { ZONE_ROAD_REACH } from '../grid/constants';
import { getGrowthDensity, getMaxDensity } from './DensityRules';
import { zoneToRCI } from '../grid/types';

/**
 * Why an empty zoned cell is not developing.
 *
 * Ordered by what the player should fix first: no road at all, then the
 * utilities, then demand. `null` means nothing is wrong and a building will
 * appear when the growth sampler next picks this cell.
 */
export type ZoneBlocker =
  | 'NO_ROAD'
  | 'ROAD_TOO_SMALL'
  | 'NO_POWER'
  | 'NO_WATER'
  | 'DISTRICT_POLICY'
  | 'NO_DEMAND'
  | 'RAIL_IN_THE_WAY'
  | 'UNDER_ELEVATED_ROAD';

export interface ZoneBlockerDeps {
  isPowered(x: number, y: number): boolean;
  isWatered(x: number, y: number): boolean;
  rciDemand: { residential: number; commercial: number; industrial: number };
  /** District policy gate, if the cell is in a district. */
  canBuildHere?(x: number, y: number, zoneType: ZoneType): boolean;
  /** 這一格頭上有沒有高架路段。沒填就等於頭上是天空。 */
  hasElevatedAbove?(x: number, y: number): boolean;
}

/**
 * Diagnose a single empty zoned cell.
 *
 * This mirrors BuildingGrowth.canGrow and the growth tick's district check
 * EXACTLY — it is the same set of conditions, asked so the answer can be shown
 * rather than silently acted on.
 *
 * Without it a zoned cell that will never develop is drawn identically to one
 * that is simply waiting its turn: during a play session twelve residential
 * cells sat empty with demand at 67, land zoned and a road adjacent, and
 * nothing on screen said the road was on a separate network from the power
 * plant. The information existed — isPowered(x, y) — and had no way to reach
 * the player.
 */
export function getZoneBlocker(
  grid: Grid, x: number, y: number, deps: ZoneBlockerDeps,
): ZoneBlocker | null {
  const cell = grid.getCell(x, y);
  if (!cell) return null;
  if (cell.zoneType === ZoneType.NONE) return null;
  if (cell.buildingId !== 0) return null;

  if (cell.railType !== RailType.NONE) return 'RAIL_IN_THE_WAY';
  // 跟鐵軌同一級的「這裡就是不能蓋」，而且同樣要拆掉別的東西才解得開。
  if (deps.hasElevatedAbove?.(x, y)) return 'UNDER_ELEVATED_ROAD';

  // Three separate road questions, and they call for three different actions.
  // isNearRoad accepts any road within the Chebyshev reach; getMaxDensity
  // additionally rejects a road with no frontage at all (a highway); and
  // getGrowthDensity rejects a road too small to carry this zone's density.
  // The last one is its own blocker because "no road access" beside a
  // perfectly visible two-lane street reads as a bug, and sends the player
  // building a second road instead of widening the one already there.
  if (!isNearRoad(grid, x, y, ZONE_ROAD_REACH)) return 'NO_ROAD';
  const roadDensity = getMaxDensity(grid, x, y);
  if (roadDensity === 'NONE') return 'NO_ROAD';
  if (!getGrowthDensity(cell.zoneType as ZoneType, roadDensity)) return 'ROAD_TOO_SMALL';

  if (!deps.isPowered(x, y)) return 'NO_POWER';
  if (!deps.isWatered(x, y)) return 'NO_WATER';

  if (deps.canBuildHere && !deps.canBuildHere(x, y, cell.zoneType as ZoneType)) {
    return 'DISTRICT_POLICY';
  }

  const rciType = zoneToRCI(cell.zoneType as ZoneType);
  if (!rciType || deps.rciDemand[rciType] <= 0) return 'NO_DEMAND';

  return null;
}

/** Player-facing text for each blocker. */
export const ZONE_BLOCKER_MESSAGES: Record<ZoneBlocker, string> = {
  NO_ROAD: 'No road access',
  ROAD_TOO_SMALL: 'Road too small for this density',
  NO_POWER: 'No electricity',
  NO_WATER: 'No water',
  DISTRICT_POLICY: 'Blocked by district policy',
  NO_DEMAND: 'No demand for this zone',
  RAIL_IN_THE_WAY: 'Rail track in the way',
  UNDER_ELEVATED_ROAD: 'Under an elevated road',
};

/**
 * Overlay tint per blocker, as 0xRRGGBB.
 *
 * Deliberately not the zone colours: an empty zoned cell already draws in its
 * zone colour, and the whole point is that a blocked one must not look the
 * same. Utility problems are the ones the player can fix immediately, so they
 * get the loud colours; NO_DEMAND is a normal, healthy state of a growing city
 * and stays muted.
 */
export const ZONE_BLOCKER_COLORS: Record<ZoneBlocker, number> = {
  NO_ROAD: 0xff6d00,
  ROAD_TOO_SMALL: 0xe040fb,
  NO_POWER: 0xffd400,
  NO_WATER: 0x29b6f6,
  DISTRICT_POLICY: 0xab47bc,
  RAIL_IN_THE_WAY: 0xff6d00,
  UNDER_ELEVATED_ROAD: 0xff6d00,
  NO_DEMAND: 0x555555,
};

/** Blockers worth drawing an icon for — a player can act on each of these. */
export const ACTIONABLE_BLOCKERS: ReadonlySet<ZoneBlocker> = new Set<ZoneBlocker>([
  'NO_ROAD', 'ROAD_TOO_SMALL', 'NO_POWER', 'NO_WATER', 'DISTRICT_POLICY',
  'RAIL_IN_THE_WAY', 'UNDER_ELEVATED_ROAD',
]);

/** Count each blocker across the map — for a city-wide "12 cells have no power" line. */
export function summariseZoneBlockers(
  grid: Grid, deps: ZoneBlockerDeps,
): Record<ZoneBlocker, number> {
  const out: Record<ZoneBlocker, number> = {
    NO_ROAD: 0, ROAD_TOO_SMALL: 0, NO_POWER: 0, NO_WATER: 0,
    DISTRICT_POLICY: 0, NO_DEMAND: 0, RAIL_IN_THE_WAY: 0, UNDER_ELEVATED_ROAD: 0,
  };
  grid.forEachCell((cell, x, y) => {
    if (cell.zoneType === ZoneType.NONE || cell.buildingId !== 0) return;
    const b = getZoneBlocker(grid, x, y, deps);
    if (b) out[b]++;
  });
  return out;
}

/** True when the zone is one the RCI panel tracks (all of them today). */
export function isTrackedZone(zoneType: ZoneType): boolean {
  return isResidentialZone(zoneType) || isCommercialZone(zoneType)
    || zoneType === ZoneType.INDUSTRIAL || zoneType === ZoneType.OFFICE;
}
