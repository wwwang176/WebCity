import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../../../core/grid/constants';

/**
 * Scalar constants shared by the massing generators and the ground-prop layer.
 *
 * This module **imports nothing from within the package**, which is why it exists: `propBands`
 * measures the masses `massing` produces while `massing` needs `SHOPFRONT_CEILING`, and leaving
 * the constants in `propBands` is an import cycle.
 */

/** Metres to cells. 1 cell = 12 m. */
export function M(metres: number): number {
  return metres / METRES_PER_CELL;
}

/**
 * Half-width of the pedestrian envelope.
 *
 * `SidewalkGraph`'s door nodes sit outside it, so a building crossing it means pedestrians walk
 * into walls (BUG-221). The value is `MAX_BUILDING_WIDTH_M` and this only converts units; a
 * number written here would drift, and drift reports nothing.
 */
export const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/** The cell boundary. Past it is a neighbour's plot or the road. */
export const CELL_EDGE = 0.5;

/** 2.2 m of pedestrian headroom. Anything overhanging below it hits people. */
export const OVERHEAD_CLEARANCE = M(2.2);

/**
 * The facade shader's storey height range, in cells: 2.64 m to 3.6 m.
 *
 * The value lives here rather than in the GLSL because the massing's floor count needs it, and
 * with geometry and shader disagreeing a canopy hangs across the middle of a window, which
 * nothing reports.
 */
export const FLOOR_HEIGHT_UNITS = { MIN: 0.22, MAX: 0.30 } as const;

/**
 * The first-floor line: nothing attached to a shopfront may rise above it.
 *
 * It takes the **lowest** storey height. Each building's storey height comes from its variant,
 * while an overhang's geometry is one copy shared across the bucket and does not know which
 * variant it hangs on. Only the lowest value guarantees it never crosses the first floor.
 */
export const SHOPFRONT_CEILING = FLOOR_HEIGHT_UNITS.MIN;

/**
 * A pitched roof's height as a fraction of one storey.
 *
 * Kept within half a storey, or a building's total height stops being floor count times storey
 * height and the level ladder drifts.
 *
 * It lives here rather than in `roofForms` because the composers need it to leave room for the
 * ridge: an industrial stack has to rise above the ridge, and when a composer computes heights
 * the roof does not exist yet. Written as 0.45 on both sides, a change to the roof buries the
 * stack with nothing reporting it.
 */
export const ROOF_PITCH_FRAC = 0.45;

/**
 * Open containers' proportions, shared by `tub` (round) and `basin` (rectangular).
 *
 * These numbers have to be shared, because **the mass data places the water surface while the
 * geometry hollows the vessel**. Written on both sides, the surface floats above the rim or sinks
 * below the floor, and neither reports anything: the excess hides inside the solid wall and reads
 * only as a slightly wrong water level.
 */
export const TUB = {
  /** The inner wall as a fraction of the declared width. The remaining 16% is wall thickness, 8% per side. */
  INNER: 0.84,
  /** The depth from rim to floor, as a fraction of the total height. */
  DEPTH: 0.28,
} as const;

/**
 * A stack's proportions.
 *
 * `DEPTH` is almost the full height: the mouth's diameter is half the shaft's, so an oblique
 * isometric view sees only a small part of it, and a shallow recess leaves that part lit, reading
 * as a shadow on the cap rather than an opening. Recessed nearly to the bottom, everything
 * visible inside is shadowed inner wall.
 */
export const STACK = {
  /** The mouth's inner radius, as a fraction of half the declared width. */
  BORE: 0.26,
  /** How much of the shaft remains at the top; real stacks taper slightly. */
  COLLAR: 0.44,
  /** The recess's depth as a fraction of the total height. */
  DEPTH: 0.86,
} as const;

/** Where a cooling tower's waist sits, as a fraction of its height. 0.65 is close to a real tower's proportion. */
const COOL_WAIST = 0.65;
/** The hyperbola's rate of convergence. Smaller values give a narrower waist. */
const COOL_C = 0.85;
const COOL_RINGS = 6;
/** The mouth's inner edge after the profile folds back, as a fraction of the top's outer edge. */
const COOL_LIP = 0.86;

/** The side profile's radius: r(t) = sqrt(1 + ((t - waist) / c)^2). */
function coolRadius(t: number): number {
  return Math.sqrt(1 + ((t - COOL_WAIST) / COOL_C) ** 2);
}

/** The widest ring, the base, is normalised to radius 0.5 so that after scaling it exactly fills the declared box. */
const COOL_NORM = 0.5 / Math.max(
  ...Array.from({ length: COOL_RINGS + 1 }, (_, i) => coolRadius(i / COOL_RINGS)));

/**
 * A cooling tower's proportions.
 *
 * `RIM` and `THROAT` are **computed**, not copied: they follow from the hyperbola and `COOL_LIP`,
 * and the obstruction light stands on the ring between them. With hand-written numbers, changing
 * the waist drops the light into the mouth or hangs it off the tower, with nothing reporting it.
 */
export const COOL = {
  /** The mouth recess's depth as a fraction of the total height. */
  DEPTH: 0.22,
  /** The top's outer diameter as a fraction of the declared width. */
  RIM: coolRadius(1) * COOL_NORM * 2,
  /** The mouth's diameter as a fraction of the same. */
  THROAT: coolRadius(1) * COOL_NORM * COOL_LIP * 2,
} as const;

/**
 * A cooling tower's side profile: `[radius, height]`, both normalised.
 *
 * The mouth folds inward and runs back down, which is what closes the hole seen from above. A
 * profile that stops at the top caps neither end and is an open tube; the building material is
 * `FrontSide`, so as soon as the angle is high enough to see into the mouth, the far inner wall
 * is back-face culled and the background shows through.
 *
 * A flat cap is the wrong answer: a real cooling tower is open at the top, and capping it makes
 * it a silo. The folded-back section's normals point toward the axis, so looking down shows the
 * **inner wall**, which is what a recess is.
 */
export function coolingProfile(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= COOL_RINGS; i++) {
    const t = i / COOL_RINGS;
    pts.push([coolRadius(t) * COOL_NORM, t]);
  }
  const lip = pts[pts.length - 1]![0] * COOL_LIP;
  pts.push([lip, 1]);
  pts.push([lip, 1 - COOL.DEPTH]);
  pts.push([0, 1 - COOL.DEPTH]);
  return pts;
}

/**
 * How high things that hug the ground sit, in cells.
 *
 * This table exists because of BUG-224: zoned buildings sat at y = 0.05, which is the **road**
 * height rather than the ground height, floating every one of them 0.6 m up. These numbers are
 * ordered relative to each other — markings stack above paving — and spread across four files,
 * changing one presses on another.
 */
export const GROUND_LAYERS = {
  /** The underside of buildings and ground props. 2.4 cm is enough to avoid z-fighting with coplanar terrain. */
  BUILDING: 0.002,
  /** Paving decals, at the same height as buildings, which they never overlap in plan. */
  DECAL: 0.002,
  /** Parking bay lines and entrance treads, stacked above the paving. */
  MARKING: 0.003,
  /** The night-time ground glow, stacked above the markings. */
  LIGHT_SPOT: 0.004,
} as const;
