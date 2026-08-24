import * as THREE from 'three';
import { ZoneType } from '../../../core/grid/types';

/**
 * The part type is written into the vertex colour's R channel and the zone category into its G
 * channel; B is reserved.
 *
 * Thresholds and tag values live in one file because the shader's conditions are composed from
 * these numbers (see BuildingMaterial.ts). Split apart, changing one reports nothing.
 */
export const PART_WALL = 0.0;
/** Metal and dark details: water tanks, air handling units, antennas, pipe racks, stacks. No windows and no glow. */
export const PART_DETAIL = 0.2;
/**
 * Things that emit light: street and garden lamp heads, shop projecting signs, billboards.
 *
 * Separating it from `PART_DETAIL` is necessary. Sharing one tag, water tanks and pipe racks
 * would light up at night, and with a single tag the only alternative is that neither lights.
 *
 * It reads `aOccupancy`: in an empty building, signage and entrance lights are dark.
 */
export const PART_LAMP = 0.3;
export const PART_FOLIAGE = 0.5;
/**
 * Water: rivers, a ferry terminal's basin, a water plant's intake.
 *
 * Separating it from `PART_GROUND` is necessary. As very dark paving (`shade` 0.02), water falls
 * on the ground branch's ramp from asphalt to brick, which is entirely grey, so a body of water
 * can only be a patch of dark grey ground.
 */
export const PART_WATER = 0.6;
/** Ground decals: asphalt, paving, markings. Perfectly flat, and pedestrians walk on them. */
export const PART_GROUND = 0.7;
/**
 * Painted shells: water tanks, stacks, storage vessels, cooling towers.
 *
 * The only tag that **draws a mass in its own colour**. Every other path eats the colour:
 *
 * - Walls follow the zone's facade rules. `FACADE_UTILITY` compresses the colour to 0.70-0.90
 *   and adds a high window band and a row of red warning lights, giving a stack windows.
 * - `PART_DETAIL` hard-codes a metal grey and never reads `vBldgColor`, so specifying a colour
 *   on it **does nothing**, with nothing reported.
 * - `PART_GROUND`'s ramp tops out at brick, `vec3(0.60, 0.58, 0.55)`.
 *
 * So a white water tank cannot be drawn: none of the three paths reaches white.
 */
export const PART_SHELL = 0.9;
export const PART_ROOF = 1.0;

/**
 * Brightness factors for a painted shell: `BASE` on the sides, plus `TOP` on upward faces.
 *
 * **`BASE` has to be >= 1.** This factor is exactly the mechanism that turns white into grey:
 * walls are `vBldgColor * 0.70-0.90` and `PART_DETAIL` is a hard-coded 0.42-0.58. With a shell
 * factor below 1, `PART_SHELL` merely swaps one grey for another, and at 0.90 a white water tank
 * renders beige-grey.
 *
 * Upward faces are lifted further because an octagonal shell shows little contrast between its
 * sides in an isometric view, and without the lift the whole thing reads as a flat panel with no
 * thickness.
 */
export const SHELL_LIFT = { BASE: 1.06, TOP: 0.14 } as const;

/**
 * The water ramp's first turning point: below it is **sludge**, above it is water.
 *
 * With the water branch running only from deep to pale blue, sewage's earth colour does not exist
 * on the ramp and `shade` at 0 is still very dark blue. So the ramp has three segments — sludge,
 * deep water, shallow water — and this constant is the first segment's upper bound.
 *
 * It is exported so the two plants' `shade` values can be tested for which segment they fall in:
 * the sewage plant has to be on the sludge side and the water plant on the water side, which is
 * what "can you tell them apart side by side" amounts to.
 */
export const WATER_MURK_MAX = 0.35;

/**
 * Water motion: amplitude in metres, and speed.
 *
 * The fragment shader's shimmer is only **colour**; the plane itself does not move, which reads
 * as patterned flooring. Making the water level actually rise and fall takes displacement in the
 * **vertex** stage, so `BUILDING_VERT` takes `uTime` too.
 *
 * The amplitude may not exceed half the water layer's thickness (guarded by `Utility.test.ts`):
 * larger, the surface punches through below the floor and above the wall in turn, which looks
 * like the basin leaking.
 */
export const WATER_BOB = { AMP_M: 0.05, SPEED: 0.6 } as const;

/** The thresholds the shader uses to segment the R channel. */
export const PART_THRESHOLDS = {
  /** Below this value, an upward-facing normal counts as roof, so a flat roof needs no tag of its own. */
  ROOF_BY_NORMAL: 0.1,
  /** The boundary between detail and lamp. Below it is cold metal; above it glows. */
  LAMP_MIN: 0.25,
  FOLIAGE_MIN: 0.35,
  FOLIAGE_MAX: 0.55,
  /** Water: the segment between foliage and ground. */
  WATER_MIN: 0.55,
  WATER_MAX: 0.65,
  GROUND_MIN: 0.65,
  GROUND_MAX: 0.8,
  /**
   * The painted shell, between ground and roof, a segment that was otherwise unused.
   *
   * Placed here rather than squeezed between 0.1 and 0.25: the widest gap there is 0.025, while
   * vertex colours are Float32 and GLSL's highp carries only about 7 significant digits. This
   * leaves 0.05 on each side, as wide as every other segment.
   */
  SHELL_MIN: 0.85,
  SHELL_MAX: 0.95,
  ROOF_MIN: 0.95,
} as const;

export function tagPart(geo: THREE.BufferGeometry, part: number): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = part;
    arr[i * 3 + 1] = 0; // zone is filled in later by stampZoneCategory
    arr[i * 3 + 2] = 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/**
 * Civic buildings' facade categories.
 *
 * They share the `ZONE_CAT` table with `ZoneType`, so **the numbers must not collide**:
 * `ZoneType` is 0-6 and these start at 101. On a collision the later entry silently overwrites
 * the earlier one, showing up only as "one district's roof colour looks off".
 *
 * Civic buildings have no `ZoneType` — their cells are infrastructure, not zones — so these
 * numbers correspond to no game state; they are only an encoding in the vertex colour's G
 * channel.
 */
export const FACADE_CIVIC = 101;
export const FACADE_UTILITY = 102;
export const FACADE_TRANSIT = 103;
export const FACADE_GREEN = 104;

/**
 * Zone category constants, written into the vertex colour's G channel.
 *
 * The shader's facade if-chain and roof palette chain are **both generated from this table** (see
 * `BuildingMaterial`'s `catChainGlsl`). Adding a row grows a branch, so `FACADE_BODY` has to gain
 * a matching entry: missing, it throws at module load rather than silently drawing a flat wall.
 */
export const ZONE_CAT: Record<number, number> = {
  [ZoneType.RESIDENTIAL_LOW]:  0.0,
  [ZoneType.RESIDENTIAL_HIGH]: 0.2,
  [ZoneType.COMMERCIAL_LOW]:   0.4,
  [ZoneType.COMMERCIAL_HIGH]:  0.6,
  [ZoneType.INDUSTRIAL]:       0.8,
  [ZoneType.OFFICE]:           1.0,
  [FACADE_CIVIC]:              1.2,
  [FACADE_UTILITY]:            1.4,
  [FACADE_TRANSIT]:            1.6,
  [FACADE_GREEN]:              1.8,
};

/**
 * How many triangles a geometry has.
 *
 * `position.count / 3` is correct only on non-indexed geometry. All building geometry goes
 * through `mergeGeometries` over Box, Sphere, Cylinder and Cone inputs, all of which are indexed
 * and share vertices between faces, so that formula under-reports by 30 to 50% (BUG-223).
 */
export function triangleCount(geo: THREE.BufferGeometry): number {
  return geo.index
    ? geo.index.count / 3
    : geo.getAttribute('position').count / 3;
}

export function stampZoneCategory(geo: THREE.BufferGeometry, cat: number): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3 + 1] = cat;
  }
}

/**
 * Ground brightness, written into the vertex colour's previously reserved B channel. 0 = asphalt,
 * 1 = brick.
 *
 * Per vertex rather than through `aSeed`: one decal geometry has to carry both a dark asphalt
 * driveway and a pale sidewalk, and `aSeed` is per instance and cannot tell two ground patches
 * within one mesh apart.
 */
export function setGroundShade(geo: THREE.BufferGeometry, shade01: number): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3 + 2] = shade01;
  }
}
