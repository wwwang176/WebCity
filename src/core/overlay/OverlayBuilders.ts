/**
 * Data-driven mapping from overlay types to value-builder functions.
 * Eliminates the switch in Game.ts buildOverlayData (OCP + SRP).
 */
import { OVERLAY_SCALE } from './CoverageOverlay';
import { getGroundwaterLevel } from '../grid/Terrain';

/** Minimal cell shape needed by overlay builders. */
export interface OverlayCell {
  zoneType: number;
  pollution: number;
  landValue: number;
  buildingId: number;
}

/** Minimal service interface for overlay building (DIP). */
export interface OverlayBuildContext {
  power: { isPowered(x: number, y: number): boolean; isInCoverage(x: number, y: number): boolean; getSupplyRatio(): number };
  water: { isSupplied(x: number, y: number): boolean; isInCoverage(x: number, y: number): boolean; getSupplyRatio(): number };
  traffic: { getSegmentDensity(key: string): number };
  police: { getCrimeReduction(x: number, y: number): number; getCoverage(x: number, y: number): boolean };
  fire: { getCoverage(x: number, y: number): boolean };
  health: { getCoverage(x: number, y: number): boolean };
  education: { getCoverage(x: number, y: number): boolean };
  parks: { getCoverage(x: number, y: number): boolean };
  garbage: { getCoverage(x: number, y: number): boolean };
  districts: { getDistrictAt(x: number, y: number): { id: string } | null };
  /** 住宅格 → 住戶的平均通勤時間（tick）。查不到代表那一格沒有通勤人口。 */
  commuteByHome: ReadonlyMap<string, number>;
  /** 通勤時間超過這個值就是滿格的紅色。 */
  commuteMax: number;
  grid: { getCell(x: number, y: number): { terrainType: number } | null };
}

type OverlayBuilder = (ctx: OverlayBuildContext, cell: OverlayCell, x: number, y: number) => number;

const O = OVERLAY_SCALE;

/**
 * Data-driven overlay value builders. Adding a new overlay type only
 * requires adding an entry here (OCP).
 */
export const OVERLAY_BUILDERS: Record<string, OverlayBuilder> = {
  power: (ctx, cell, x, y) => {
    if (ctx.power.isPowered(x, y)) return O.DISPLAY_MAX; // green: powered (100)
    if (ctx.power.getSupplyRatio() < 1 && ctx.power.isInCoverage(x, y)) return O.DISPLAY_MAX * 0.5; // yellow: in range but underpowered (50)
    if (cell.buildingId > 0) return O.DISPLAY_MAX * 0.15; // red: has building but no coverage (15)
    return 0;
  },

  water: (ctx, cell, x, y) => {
    // Supply status takes priority over groundwater
    if (ctx.water.isSupplied(x, y)) return O.DISPLAY_MAX; // 100: supplied (bright blue)
    if (ctx.water.getSupplyRatio() < 1 && ctx.water.isInCoverage(x, y)) return O.DISPLAY_MAX * 0.5; // 50: undersupplied (yellow)
    if (cell.buildingId > 0) return O.DISPLAY_MAX * 0.15; // 15: no water (red)
    // Groundwater only: cap at 8 so it stays in the deep-blue band (0 < value < 0.1 normalized)
    const gw = getGroundwaterLevel(ctx.grid, x, y);
    return Math.min(8, gw * O.GROUNDWATER_FACTOR * 20);
  },

  zone: (_ctx, cell) =>
    cell.zoneType > 0 ? cell.zoneType * O.ZONE_TYPE_FACTOR : 0,

  traffic: (ctx, _cell, x, y) => {
    const flow = ctx.traffic.getSegmentDensity(`${x},${y}`);
    return flow > 0 ? Math.min(O.DISPLAY_MAX, Math.log2(1 + flow) * O.TRAFFIC_LOG_FACTOR) : 0;
  },

  pollution: (_ctx, cell) =>
    Math.min(O.DISPLAY_MAX, cell.pollution * O.DISPLAY_MAX / O.RAW_MAX),

  landValue: (_ctx, cell) =>
    cell.buildingId > 0 ? Math.min(O.DISPLAY_MAX, cell.landValue * O.DISPLAY_MAX / O.RAW_MAX) : 0,

  crime: (ctx, cell, x, y) => {
    if (cell.buildingId <= 0) return 0;
    const reduction = ctx.police.getCrimeReduction(x, y);
    return Math.max(0, O.CRIME_BASE + reduction);
  },

  district: (ctx, _cell, x, y) => {
    const d = ctx.districts.getDistrictAt(x, y);
    if (!d) return 0;
    let hash = 0;
    for (let i = 0; i < d.id.length; i++) hash = (hash * 31 + d.id.charCodeAt(i)) & 0xff;
    return Math.max(20, hash % 100);
  },

  // Coverage overlays (boolean getCoverage pattern)
  police: (ctx, _cell, x, y) =>
    ctx.police.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  fire: (ctx, _cell, x, y) =>
    ctx.fire.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  health: (ctx, _cell, x, y) =>
    ctx.health.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  education: (ctx, _cell, x, y) =>
    ctx.education.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  park: (ctx, _cell, x, y) =>
    ctx.parks.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,
  garbage: (ctx, _cell, x, y) =>
    ctx.garbage.getCoverage(x, y) ? O.COVERAGE_VALUE : 0,

  /**
   * 住在這一格的人，通勤平均要多久。
   *
   * 沒有通勤人口的格子回 0（不上色），而不是回滿格 —— 空地與「通勤很短」在
   * 視覺上必須分得開。
   */
  commute: (ctx, _cell, x, y) => {
    const avg = ctx.commuteByHome.get(`${x},${y}`);
    if (avg === undefined) return 0;
    return Math.min(O.DISPLAY_MAX, Math.max(1, (avg / ctx.commuteMax) * O.DISPLAY_MAX));
  },
};

/** Compute the overlay value for a single cell. Returns 0 for unknown/none types. */
export function buildOverlayValue(
  ctx: OverlayBuildContext,
  type: string,
  cell: OverlayCell,
  x: number,
  y: number,
): number {
  const builder = OVERLAY_BUILDERS[type];
  return builder ? builder(ctx, cell, x, y) : 0;
}
