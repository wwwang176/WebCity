/**
 * Data-driven mapping from overlay types to value-builder functions.
 * Eliminates the switch in Game.ts buildOverlayData (OCP + SRP).
 */
import { OVERLAY_SCALE } from './CoverageOverlay';
import { getGroundwaterLevel } from '../grid/Terrain';
import { DISTRICT_SWATCHES, isValidSwatchIndex } from '../district/DistrictPalette';
import { parsePosKeyUnsafe } from '../grid/GridHelpers';

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
  districts: {
    getDistrictAt(x: number, y: number): { id: string; colorIndex?: number } | null;
  };
  policies: { getCrimeBonus(districtId: string | null): number };
  ordinances: { getCrimeBonus(): number };
  /** Residential cell to its residents' average commute in ticks. A miss means the cell has no commuters. */
  commuteByHome: ReadonlyMap<string, number>;
  /** Commutes at or above this render as full red. */
  commuteMax: number;
  grid: { getCell(x: number, y: number): { terrainType: number } | null };
}

type OverlayBuilder = (ctx: OverlayBuildContext, cell: OverlayCell, x: number, y: number) => number;

const O = OVERLAY_SCALE;

/** The golden ratio conjugate. Multiplying and taking the fractional part gives the low-discrepancy sequence whose first N terms are always the most widely spread. */
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

/**
 * A district's value on the overlay. The renderer uses it as a **hue** (value / 100).
 *
 * The sequence number is expanded through the golden ratio rather than hashed. District ids
 * have the form `district_${nextId++}` (which is also how `recoverNextId` reads them), so
 * districts the player draws in a row carry consecutive numbers. A uniform hash turns
 * consecutive numbers into random ones, and random ones collide: across eight districts there
 * is close to a 30% chance that two hues are indistinguishable. The golden-ratio sequence has
 * no such problem — its first N terms are the most widely spread N.
 *
 * The result lies in [1, 100): `buildOverlayData` reads 0 as "nothing on this cell", and 100
 * wraps `setHSL`'s hue back to 0, colliding with the lower bound.
 */
export function districtOverlayValue(
  district: { id: string; colorIndex?: number },
): number {
  // A colour the player picked wins. The swatch stores the overlay value itself, so nothing
  // is converted; a conversion missing on one side leaves the panel's swatch and the map's
  // colour different.
  if (isValidSwatchIndex(district.colorIndex)) {
    return DISTRICT_SWATCHES[district.colorIndex!]!.value;
  }
  const id = district.id;
  const cached = DISTRICT_VALUE_CACHE.get(id);
  if (cached !== undefined) return cached;

  const seq = /(\d+)$/.exec(id);
  let n: number;
  if (seq) {
    n = Number(seq[1]);
  } else {
    // Ids with no sequence number — test fixtures, possible custom ids later — fall back to a
    // hash: poorly separated beats all one colour.
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
    n = h;
  }
  const value = 1 + ((n * GOLDEN_RATIO_CONJUGATE) % 1) * 99;
  DISTRICT_VALUE_CACHE.set(id, value);
  return value;
}

/**
 * id to colour value. A memo table for a pure function, holding one key per district seen this
 * session.
 *
 * The builder is called per cell: a 200x200 map covered entirely by districts is 40,000 regex
 * runs, measured at about 4.8 ms. That happens only when the overlay is switched or a district
 * changes, never on the per-frame path, but it is time added to the rebuilding frame. Cached,
 * the regex runs once per district.
 */
const DISTRICT_VALUE_CACHE = new Map<string, number>();

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
    // Ordinances are included. With Crime +12 written on an ordinance and the overlay drawing
    // only police coverage, the player cannot see the cost they just bought.
    const districtId = ctx.districts.getDistrictAt(x, y)?.id ?? null;
    const policy = ctx.policies.getCrimeBonus(districtId) + ctx.ordinances.getCrimeBonus();
    return Math.max(0, O.CRIME_BASE + reduction + policy);
  },

  district: (ctx, _cell, x, y) => {
    const d = ctx.districts.getDistrictAt(x, y);
    return d ? districtOverlayValue(d) : 0;
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
   * How long residents of this cell commute on average.
   *
   * Cells with no commuters return 0 and stay uncoloured rather than reading full: empty land
   * and "a very short commute" have to look different.
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

/**
 * Where each district's name sits on the overlay.
 *
 * The mean of its cell coordinates. A district with no cells gets no label; averaging nothing
 * gives NaN and sends the label off screen.
 */
export function districtLabelAnchors(
  districts: readonly { id: string; name: string; cells: ReadonlySet<string> }[],
): { id: string; name: string; x: number; y: number }[] {
  const out: { id: string; name: string; x: number; y: number }[] = [];
  for (const d of districts) {
    if (d.cells.size === 0) continue;
    let sx = 0, sy = 0;
    for (const key of d.cells) {
      const { x, y } = parsePosKeyUnsafe(key);
      sx += x; sy += y;
    }
    out.push({
      id: d.id, name: d.name,
      x: Math.round(sx / d.cells.size),
      y: Math.round(sy / d.cells.size),
    });
  }
  return out;
}
