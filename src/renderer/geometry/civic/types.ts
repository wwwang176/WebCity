import type { Volume } from '../buildings/massing/volume';
import type { CivicColor } from './colors';
import type { PropSpec } from '../props';

/**
 * Declarative description of a civic building.
 *
 * It differs from a zoned building in three ways only; everything else follows the
 * `buildings/` conventions:
 *
 * 1. **Multi-cell.** A zoned building is one building per cell, while civic buildings occupy
 *    2x2 up to 9x6. So the guards bound the plot, not the in-cell pedestrian envelope.
 * 2. **No variants.** Three identical primary schools in one city is acceptable: for civic
 *    buildings, recognisability matters more than variety. Hence no `variantIndex` and no
 *    `seedByte`.
 * 3. **No levels.** Civic buildings do not upgrade.
 *
 * Coordinates are in **cells** (1 cell = 12 m), with the origin at the plot's centre. A 2x2
 * plot spans x in [-1, 1] and z in [-1, 1]; a 2x3 spans x in [-1, 1] and z in [-1.5, 1.5].
 */

/** Footprint in cells. Must match `InfraConfig`'s width / height. */
export interface Footprint {
  w: number;
  h: number;
}

/**
 * A tagged mass.
 *
 * `tag` has no effect on geometry — `shapeOf` never looks at it. It exists so that **tests can
 * read the building**: "the watchtower has to rise above both wings" is one line as
 * `find(v => v.tag === 'tower')`, while "the third mass" copies the mass list's order into the
 * test, and reordering the list makes the test measure something else.
 *
 * Not added to the shared `Volume`: zoned building masses come from generators, are never
 * hand-written, and so have nothing to tag.
 */
export type CivicVolume = Volume & {
  tag?: string;
  /**
   * A colour for this mass alone, overriding `CivicPlan.color`.
   *
   * For accents: a hospital's red cross, a university's gold dome, a station's identity band.
   * With one colour per building these could only match the walls, and they are exactly what
   * makes a hospital recognisable at a glance.
   */
  color?: CivicColor;
  /**
   * Paving brightness 0..1 (0 = asphalt, 1 = brick), meaningful only when `part` is
   * `PART_GROUND`.
   *
   * `CivicDecal` always lies on the ground (`GROUND_LAYERS` sit at fixed heights), so **raised
   * paving** — a hospital's rooftop helipad, a station's platform surface — cannot be a decal
   * and has to be a mass.
   *
   * The brightness is written into the vertex colour's B channel, the same channel decals use,
   * through the shader's same `isGround` branch: on separate paths, concrete on a roof and
   * concrete on the ground would be two different colours.
   */
  shade?: number;
};

/**
 * A flat paved patch.
 *
 * **Not a `Volume`.** `Volume` produces a frustum, a frustum has sides, sides are walls, and
 * walls grow windows. `decals.ts` states the same rule: anything with thickness grows walls,
 * so these always use `PlaneGeometry`.
 */
export interface CivicDecal {
  /**
   * What this patch is. **For tests and readers only**; no effect on geometry.
   *
   * The same reason as `CivicVolume.tag`: in the data a decal is only a rectangle plus a
   * brightness, and "which one is the water" cannot be guessed from brightness — a water
   * plant's river is shade 0.02 while the asphalt at its gate is 0.0, darker still.
   */
  tag?: string;
  /** Centre. */
  x: number;
  z: number;
  /** Width and depth. */
  w: number;
  d: number;
  /**
   * Brightness, written into the vertex colour's B channel. 0 = asphalt, 1 = white paint.
   *
   * With `lawn` set it does not affect the colour: grass takes the `PART_FOLIAGE` branch.
   */
  shade: number;
  /**
   * Stacking layer. `mark` (line markings, entrance treads) sits above `base` (paving).
   *
   * **Base layers must not overlap each other**: two quads at the same height and position
   * z-fight, which a static screenshot does not show and any camera movement turns into a
   * flickering sheet. `assembleDecals` guards this.
   */
  layer?: 'base' | 'mark';
  /** Grass. Takes `PART_FOLIAGE` for green rather than `PART_GROUND`'s greyscale. */
  lawn?: boolean;
  /**
   * Water. Takes `PART_WATER` for moving blue rather than reading as very dark paving.
   *
   * `shade` still applies: 0 is deep water such as a river, higher is a harbour basin.
   */
  water?: boolean;
  /**
   * Rotation about the y axis, in radians. **Only the `mark` layer may rotate.**
   *
   * Runways are elliptical and taxiway hold lines are skewed; neither can be an axis-aligned
   * rectangle. Rotation lets a curve be approximated by a run of short straight pieces, which
   * is how low-poly works anyway.
   *
   * Base layers may not rotate because their overlap check intersects **axis-aligned**
   * rectangles: a rotated base makes that check wrong in silence, two genuinely overlapping
   * patches pass, and the result flickers on screen. When a rotated base layer is needed, the
   * fix is to replace the overlap check with SAT, not to loosen the guard.
   */
  rotationY?: number;
}

/** The complete description of one civic building. Its four layers correspond one for one to a zoned building's attachment layers. */
export interface CivicPlan {
  footprint: Footprint;
  /** Facade class. One of `parts.ts`'s `FACADE_*`, selecting the shader's facade branch. */
  facade: number;
  /**
   * The representative colour, used as the walls' base.
   *
   * In an isometric view colour is recognised before silhouette, so police stations are blue
   * and fire stations red. The values live in `colors.ts` and are only referenced here; a
   * second copy lets a change to the colour table miss one building, showing up only as "that
   * one looks slightly off".
   */
  color: CivicColor;
  /**
   * The `aSeed` handed to the shader: floor rhythm, window phase, material variation.
   *
   * Zoned buildings hash it from coordinates, so one building type looks different across the
   * city. Civic buildings are the opposite — three primary schools have to look alike — so the
   * plan states the value directly.
   */
  seed: readonly [number, number, number];
  /** Masses. castShadow, kept at distant LOD. */
  massing: CivicVolume[];
  /** Ground decals. Perfectly flat, no shadow, **kept** at distant LOD; dropping them empties the ground at range. */
  decals: CivicDecal[];
  /** Low props: trees, lamps, flagpoles, bins, vehicles. castShadow, dropped wholesale at distant LOD. */
  props: CivicVolume[];
  /** Overhangs: canopies, signage, platform roofs. castShadow, dropped wholesale at distant LOD. */
  overhead: CivicVolume[];
  /**
   * Shared low props: trees, shrubs, flower beds, lamps, bins, bike racks, flagpoles,
   * hydrants, drums, pipe racks and the rest (`geometry/props`'s `PropSpec`).
   *
   * The difference from `props` above is **who draws them**: these are primitives shared with
   * residential yards, while those are this building's own box masses — vehicles, benches and
   * other one-offs. Prefer these; drawing a tree by hand ends with two differently shaped trees
   * in one city.
   *
   * The split into two layers is **necessary**, not taxonomic tidiness: these primitives use
   * THREE's cones, spheres and toruses, carry uvs and are indexed geometry, while `props` goes
   * through `shapeOf` and produces non-indexed frusta with no uvs. `mergeGeometries` requires a
   * matching attribute set, so the two cannot be merged.
   *
   * Their triangles still count against the `prop` budget — they are low props.
   */
  fixtures: PropSpec[];
  /**
   * Vehicles parked on the plot.
   *
   * They use the **same geometry** as the vehicles driving around the city
   * (`geometry/policeCar` and the rest): a patrol car in a station's car park that looks
   * different from one on patrol is the most easily spotted inconsistency there is.
   *
   * They form their own layer with a **different material**: vehicles use
   * `MeshLambertMaterial({ vertexColors })` with RGB written straight into the `color`
   * attribute, while the building shader reads `color` as (part tag, zone, ground brightness).
   * Mixed together, a white-and-blue patrol car reads as `partType = 0.102`, falls into the
   * metal-detail branch, and turns into a grey block.
   *
   * Their triangles count against no building budget — they are vehicles, not part of the
   * building.
   */
  vehicles: CivicVehicle[];
}

/** One vehicle parked on the plot. */
export interface CivicVehicle {
  kind: CivicVehicleKind;
  /**
   * This vehicle's role in this building. Exactly the same reasoning as `CivicVolume.tag`:
   * **tests have to be able to read the plan**.
   *
   * "The airport's ground crew vehicle must not foul the jet bridge" is one line as
   * `v.tag === 'groundCrew'`. Identified by whether a `tint` is set, the landside vehicle has
   * one too, and the test ends up checking a truck parked behind the terminal with nothing to
   * do with the jet bridge.
   */
  tag?: string;
  /** The vehicle's centre, in cells. */
  x: number;
  z: number;
  /** Heading in radians. 0 is +x, the geometry's own orientation. */
  rotationY?: number;
  /**
   * Body colour, overriding `civicVehicleTint(kind)`'s default.
   *
   * The default comes from `VEHICLE_CONFIG`: a parked vehicle and a driving one of the same
   * type have to share a colour. This field is for a type playing a different role here — an
   * airport's ground crew truck is pale, while trucks on the street draw from a random palette.
   */
  tint?: number;
}

/** Vehicle kinds with existing geometry. */
export type CivicVehicleKind =
  | 'car' | 'policeCar' | 'ambulance' | 'firetruck'
  | 'bus' | 'garbageTruck' | 'van' | 'truck'
  // An aircraft on an airport apron. The same geometry as the ones in the air
  // (`geometry/airplane`): 11.7 x 10.8 m, the scale of a regional airliner on a 60 m airfield.
  | 'airplane'
  // A ferry at a terminal. The same geometry as the ones on routes (`geometry/ferry`):
  // 9 x 2.6 m, a small ferry coming alongside a 12 m quay.
  | 'ferry';

/**
 * How far masses are inset from the plot boundary, in cells. 0.02 cells = 24 cm.
 *
 * Flush with the boundary, two adjacent civic buildings become coplanar; the z-fighting does
 * not show in a static screenshot and turns into a flickering sheet as soon as the camera
 * moves.
 *
 * **Decals do not take this.** They are flat paving, and paving to the cell boundary is
 * correct: a sidewalk runs all the way to the kerb.
 */
export const CIVIC_INSET = 0.02;

/**
 * Triangle limits per **cell**.
 *
 * Zoned buildings are budgeted per building (`HOUSE: 400`, `TOWER: 800`) because they occupy
 * one cell each. Civic buildings occupy 4 to 54 cells, where the same line means nothing.
 *
 * **The prop and greenery allowances are deliberately more generous than a zoned building's.**
 * Zoned buildings cover the whole map, so ten extra triangles each multiply by thousands;
 * civic buildings number a few dozen per city, and the extra cost of one is barely measurable.
 * So "plant a few more trees here" pays off, while the same instinct in a residential district
 * blows the budget outright. The trade-offs differ, and one set of numbers for both would be
 * the mistake.
 *
 * For comparison, a zoned building's low-prop limit is 320 per building
 * (`TRIANGLE_BUDGET.PROP`).
 *
 * **These numbers are measured, not reasoned.** With all nineteen types finished, each layer's
 * measured per-cell maximum was taken and multiplied by roughly 1.5 for headroom:
 *
 * | Layer | Measured max (per cell) | From | Limit |
 * |---|---|---|---|
 * | Massing | 128 | Park (1 cell; the whole plot is one pavilion) | 200 |
 * | Decals | 14 | Park / high school (a running track is 40 marking segments) | 30 |
 * | Overhead | 12 | The four 1x1 stations (one canopy is 12) | 20 |
 * | Props | see below | | base 750 + 140 per cell |
 *
 * The two tightest points for props are the **park** (1 cell using 800 against an allowance of
 * 890) and the **power plant** (4 cells using 1094 against 1310). The park is deliberately left
 * tight: it is the cheapest facility in the game at 200 and gets placed in bulk, while other
 * civic buildings appear a handful of times per city.
 *
 * A large airport (54 cells) uses 27% of its allowance: prop counts grow far more slowly than
 * area, so a base-plus-slope model is necessarily generous on large plots. That is acceptable
 * — the limit is a ceiling, not a target.
 */
export const CIVIC_TRIANGLE_BUDGET = {
  MASSING_PER_CELL: 200,
  DECAL_PER_CELL: 30,
  /**
   * The **base** prop allowance, independent of footprint. Trees, shrubs, lamps, benches,
   * planters and bike racks all count against it.
   *
   * It exists because of the 1x1 park: its whole plot **is** props — a pavilion, four patches
   * of grass, eight trees — and a per-cell line does not hold there. A one-cell park measures
   * 800, while the same line gives a 2x2 police station 1600 against the 664 it uses.
   *
   * A purely per-cell model assumes prop count is proportional to area, but every plot carries
   * a fixed overhead independent of size: the entrance lamp, a bin, a sign, the two trees at
   * the gate. Base plus slope is the shape it actually has.
   */
  PROP_BASE: 750,
  /** The part of the prop allowance that grows with area. */
  PROP_PER_CELL: 140,
  /**
   * The overhead layer: porches, canopies, jet bridges.
   *
   * 20 covers exactly one. A train station needs two — a track running through can be boarded
   * from both sides, so each of the two platforms needs a canopy, and that is independent of
   * plot size: the same happens on 1x1. 30 lets one cell hold two, and 2x2 and larger never run
   * it out (the largest currently is a 2x2 school, with one).
   */
  OVERHEAD_PER_CELL: 30,
} as const;
