/**
 * The single source of randomness for building appearance.
 *
 * A pure logic module: it imports no Three.js, so the showcase and the game share one copy and it
 * is fully unit-testable.
 *
 * It replaces `hash(x, y)` with offset inputs: `hash(x+100, y+100)` at (0,0) equals `hash(x, y)` at
 * (100,100), so two buildings 100 cells apart share the same numbers across several random streams
 * with only their roles swapped. Mixing the stream number into the hash keeps any number of streams
 * from contaminating each other.
 */

/** Random stream numbers: one per purpose, independent of each other. */
export const STREAM = {
  VARIANT: 0,
  HEIGHT: 1,
  WIDTH: 2,
  DEPTH: 3,
  ROTATION: 4,
  PALETTE: 5,
  HUE: 6,
  SATURATION: 7,
  LIGHTNESS: 8,
  FACADE_RHYTHM: 9,
  FACADE_PHASE: 10,
  FACADE_MATERIAL: 11,
  /** The yard recipe. Separate from the massing variant, so one house type is not always paired with one yard. */
  GROUND_PROP: 12,
  /** The re-pick used when a variant collides with a neighbour's. See `variantIndexOf`. */
  VARIANT_RETRY: 13,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

/**
 * A four-input hash returning a value in [0, 1).
 *
 * It uses Math.imul rather than `*`: JavaScript's `*` loses precision once a product exceeds 2^53,
 * and `(a * b) | 0` is not the correct 32-bit multiply.
 */
export function hashCell(x: number, y: number, seedByte: number, stream: number): number {
  let h = (Math.imul(x, 374761393)
    + Math.imul(y, 668265263)
    + Math.imul(seedByte, 1442695041)
    + Math.imul(stream, 2246822519)
    + 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 11), 2246822519) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Which variant this cell uses. Returns 0 rather than NaN when `variantCount` is 0.
 *
 * A plain per-cell hash has an adjacent-repeat rate of exactly `1/variantCount`: at eight variants
 * that is 12.5%, and one building in eight matching its neighbour along a street is visible.
 * Reaching under 5% through variant count alone takes twenty variants, which pushes draw calls up
 * with it.
 *
 * So it picks a value the **raw** hashes of the west and north neighbours do not use. Comparing raw
 * values rather than final ones: a final value depends on its own neighbours and would recurse. So
 * this **reduces** rather than eliminates — a neighbour may itself have been re-picked, and a
 * collision can survive that.
 */
export function variantIndexOf(
  x: number, y: number, seedByte: number, variantCount: number,
): number {
  if (variantCount <= 0) return 0;
  const raw = (px: number, py: number) =>
    Math.floor(hashCell(px, py, seedByte, STREAM.VARIANT) * variantCount) % variantCount;

  const v = raw(x, y);
  if (variantCount < 3) return v;   // with two variants there is nothing to avoid to

  const west = raw(x - 1, y);
  const north = raw(x, y - 1);
  if (v !== west && v !== north) return v;

  // Picked from the values neither neighbour uses, rather than by shifting +1: a shift can land
  // exactly on the other neighbour.
  const allowed: number[] = [];
  for (let k = 0; k < variantCount; k++) if (k !== west && k !== north) allowed.push(k);
  if (allowed.length === 0) return v;
  const r = hashCell(x, y, seedByte, STREAM.VARIANT_RETRY);
  return allowed[Math.floor(r * allowed.length) % allowed.length]!;
}

export interface AppearanceInput {
  x: number;
  y: number;
  zoneType: number;
  level: number;
  /** The building's identity byte. Always 0 for now. */
  seedByte: number;
  /** How many variants this (zone, level) bucket has. */
  variantCount: number;
  /** This zone's palette length. */
  paletteSize: number;
}

export interface Appearance {
  variantIndex: number;
  /**
   * A raw value in [0, 1), handed to `footprintScaleFor` to become a scale.
   *
   * With the range written here as 0.85 to 1.15, it lives in a different file from the footprint
   * width limit, and widening the target leaves nobody remembering that the jitter multiplies on
   * top — which put more than half the buildings across the pedestrian envelope (BUG-222). Whether
   * the jitter fits is now decided in one place, the registry.
   */
  width01: number;
  depth01: number;
  /**
   * 0.9 to 1.1: natural variation applied to the target height.
   *
   * At +/-17.5% the spread is a full storey, and two houses at the same level read as different
   * levels. With the target height table in charge, this should only be variation within one
   * building type: +/-10% is half a metre on a 5 m house and five metres on a 50 m tower, and both
   * still read as the same building type.
   */
  heightScale: number;
  /** 0 to 3, in quarter turns. */
  rotationQuarter: number;
  paletteIndex: number;
  /** -0.015 ~ 0.015 */
  hueShift: number;
  /** -0.05 ~ 0.05 */
  satShift: number;
  /** -0.05 ~ 0.05 */
  lightShift: number;
  /** The aSeed handed to the shader: rhythm, phase, material preference. */
  facadeSeed: readonly [number, number, number];
  /** A value in [0, 1) selecting the yard recipe. The caller decides how many buckets there are. */
  propVariant01: number;
}

/**
 * These ranges deliberately match BuildingRenderer.setInstanceData's, so extracting this changed
 * where the code lives without changing how anything looks.
 */
export function appearanceOf(input: AppearanceInput): Appearance {
  const { x, y, seedByte, variantCount, paletteSize } = input;
  const at = (s: number) => hashCell(x, y, seedByte, s);

  return {
    variantIndex: variantIndexOf(x, y, seedByte, variantCount),
    width01: at(STREAM.WIDTH),
    depth01: at(STREAM.DEPTH),
    heightScale: 1.0 + (at(STREAM.HEIGHT) - 0.5) * 0.2,
    rotationQuarter: Math.floor(at(STREAM.ROTATION) * 4) % 4,
    paletteIndex: paletteSize > 0
      ? Math.floor(at(STREAM.PALETTE) * paletteSize) % paletteSize
      : 0,
    hueShift: (at(STREAM.HUE) - 0.5) * 0.03,
    satShift: (at(STREAM.SATURATION) - 0.5) * 0.1,
    lightShift: (at(STREAM.LIGHTNESS) - 0.5) * 0.1,
    facadeSeed: [
      at(STREAM.FACADE_RHYTHM),
      at(STREAM.FACADE_PHASE),
      at(STREAM.FACADE_MATERIAL),
    ],
    propVariant01: at(STREAM.GROUND_PROP),
  };
}
