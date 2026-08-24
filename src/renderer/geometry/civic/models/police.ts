import {
  FACADE_CIVIC, PART_ROOF, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicVehicle } from '../types';
import type { CivicPlan, CivicVolume, CivicDecal } from '../types';

/**
 * Police station — 2x2 cells = 24 x 24 m.
 *
 * Coordinates are in cells with the origin at the plot's centre and a usable range of +/-0.98
 * cells (+/-11.76 m after `CIVIC_INSET`). Every dimension is declared with `M(metres)`: written
 * in cells, "how wide is this wall" takes a mental x12, and nobody rechecks a number worked out
 * in their head.
 *
 * Layout: the building presses into the back half of the plot (negative z), leaving the front
 * half for the forecourt and car park. That is what a real police station looks like — patrol
 * cars have to drive straight in and out, so the car park faces the road.
 *
 * ```
 *   z-  ┌──────────────┬─────┐   long wing (duty hall, offices)
 *       │  long wing   │short│   the watchtower stands on the short wing
 *       └──────┬───────┴─────┘
 *          ▔▔canopy▔▔        forecourt (concrete)
 *       ┌──────────────┬─────┐
 *       │   car park   │lawn │
 *   z+  └──────────────┴─────┘
 * ```
 */

/** Wing height: three storeys plus a double-height lobby. See the `SEED` note below. */
const WING_TOP = M(11.0);
/** Roof slab thickness. */
const ROOF_TOP = M(11.4);

const massing: CivicVolume[] = [
  // ── The L-shaped body ─────────────────────────────────────
  // Long wing: x [-9, 5], z [-9.5, -2.5]
  {
    tag: 'wing',
    x: M(-2.0), z: M(-6.0), w: M(14.0), d: M(7.0), y0: 0, y1: WING_TOP,
  },
  {
    tag: 'wingRoof', part: PART_ROOF,
    x: M(-2.0), z: M(-6.0), w: M(14.6), d: M(7.6), y0: WING_TOP, y1: ROOF_TOP,
  },
  // Short wing: x [5, 11], z [-9.5, -0.5]. It **shares an edge with the long wing without
  // overlapping**: an overlap creates invisible interior faces that spend triangles for nothing
  // and show up nowhere on screen.
  {
    tag: 'wing',
    x: M(8.0), z: M(-5.0), w: M(6.0), d: M(9.0), y0: 0, y1: WING_TOP,
  },
  {
    // The short wing's roof shifts right so the two roofs also only share an edge: the long
    // wing's roof ends at 5.3.
    tag: 'wingRoof', part: PART_ROOF,
    x: M(8.3), z: M(-5.0), w: M(6.0), d: M(9.6), y0: WING_TOP, y1: ROOF_TOP,
  },

  // ── The watchtower ────────────────────────────────────────
  // Stacked on the short wing's roof rather than standing beside it: beside it, it would need
  // ground of its own, and the L already fills a 24 m plot.
  {
    tag: 'tower',
    x: M(8.0), z: M(-5.0), w: M(4.0), d: M(4.0), y0: ROOF_TOP, y1: M(17.0),
  },
  {
    // The cap has to be wider than the shaft to read as a cap.
    tag: 'cap', part: PART_ROOF,
    x: M(8.0), z: M(-5.0), w: M(4.6), d: M(4.6), y0: M(17.0), y1: M(17.5),
  },

  // ── Rooftop equipment ─────────────────────────────────────
  // PART_DETAIL: cold metal, no windows, no glow at night. Marked PART_WALL, the air handling
  // unit on the roof would grow a grid of windows.
  {
    tag: 'ac', part: PART_DETAIL,
    x: M(-5.5), z: M(-6.0), w: M(2.0), d: M(1.5), y0: ROOF_TOP, y1: M(12.2),
  },
  {
    tag: 'ac', part: PART_DETAIL,
    x: M(0.5), z: M(-6.0), w: M(2.0), d: M(1.5), y0: ROOF_TOP, y1: M(12.2),
  },
];

/**
 * The ground: three **non-overlapping** paved areas — forecourt, car park, lawn — sharing edges.
 *
 * Overlapping base decals z-fight: invisible while still, a flickering sheet as soon as the
 * camera moves. `assembleDecals` catches it, but the layout should partition cleanly anyway.
 */
const decals: CivicDecal[] = [
  // Forecourt, directly in front of the building: z [-0.2, 3.5]
  { x: 0, z: M(1.65), w: M(23.0), d: M(3.7), shade: 0.58 },
  // Car park asphalt: x [-11.5, 5], z [3.5, 11.5]
  { x: M(-3.25), z: M(7.5), w: M(16.5), d: M(8.0), shade: 0.0 },
  // Lawn: x [5, 11.5], z [3.5, 11.5]
  { x: M(8.25), z: M(7.5), w: M(6.5), d: M(8.0), shade: 0.0, lawn: true },

  // The entrance tread, on the marking layer above the forecourt.
  { x: M(-2.0), z: M(0.8), w: M(6.0), d: M(2.0), shade: 0.75, layer: 'mark' },
];

/**
 * Parking bay separator lines.
 *
 * **Separators** rather than filling each bay white: a white rectangle per bay is not a parking
 * bay, it is white floor tiling.
 *
 * The 2.8 m spacing and 5.0 m depth are real parking bay dimensions. TODO.md records that the
 * industrial zone's "parking bays" do not hold up at that scale (1.6 x 1.67 m, a depth that in
 * reality marks a loading bay separator); this does not repeat it.
 */
for (let i = 0; i < 6; i++) {
  decals.push({
    x: M(-11.0 + i * 2.8), z: M(6.5), w: M(0.15), d: M(5.0),
    shade: 1.0, layer: 'mark',
  });
}

/**
 * This building's own box masses.
 *
 * **Only things the shared primitives do not have.** Lamps, flagpoles, bins and flower beds all
 * live in `geometry/props` and come from there; a second copy ends with two differently shaped
 * street lamps in one city, and a change to one not reaching the other.
 */
const props: CivicVolume[] = [
  // The porch light. The shared `lamp` is a pole standing on the ground; this one **hangs under
  // the canopy** with no pole, which the shared primitives do not have, so it stays here.
  {
    tag: 'porchLamp', part: PART_LAMP,
    x: M(-5.6), z: M(-1.5), w: M(0.4), d: M(0.4), y0: M(3.4), y1: M(3.75),
  },
  {
    tag: 'porchLamp', part: PART_LAMP,
    x: M(1.6), z: M(-1.5), w: M(0.4), d: M(0.4), y0: M(3.4), y1: M(3.75),
  },

  // The forecourt's two benches. The shared primitives have no bench, so they stay here.
  {
    tag: 'bench', part: PART_DETAIL,
    x: M(-8.6), z: M(2.4), w: M(1.8), d: M(0.6), y0: M(0.35), y1: M(0.5),
  },
  {
    tag: 'bench', part: PART_DETAIL,
    x: M(4.6), z: M(2.4), w: M(1.8), d: M(0.6), y0: M(0.35), y1: M(0.5),
  },
];

/**
 * Patrol cars in the car park.
 *
 * They use the **same geometry** as the one driving around the city (`geometry/policeCar`): a
 * parked patrol car that looks different from one on patrol is the most easily spotted
 * inconsistency there is.
 *
 * They face +z, rotated 90 degrees: the bays run along z, and unrotated the cars park sideways
 * across two or three separator lines.
 */
const vehicles: CivicVehicle[] = [
  { kind: 'policeCar', x: M(-9.6), z: M(6.5), rotationY: Math.PI / 2 },
  { kind: 'policeCar', x: M(-4.0), z: M(6.5), rotationY: Math.PI / 2 },
  // One patrol van, so the fleet does not read as copy-paste.
  { kind: 'van', x: M(-6.8), z: M(6.5), rotationY: Math.PI / 2 },
];

const overhead: CivicVolume[] = [
  // The entrance canopy. Its y0 clears 2.2 m of pedestrian headroom, or it hits people.
  // z [-2.6, -0.4]: it enters the building by 0.1 m so it reads as attached rather than
  // floating.
  {
    tag: 'canopy',
    x: M(-2.0), z: M(-1.5), w: M(8.0), d: M(2.2), y0: M(3.75), y1: M(4.1),
  },
];

/**
 * Shared low props.
 *
 * **All from `geometry/props`**, the same primitives as residential yards: one city's trees
 * should be one kind of tree and its lamps one lamp, and a change to one has to reach the other.
 * Only position and size are given here.
 *
 * They form their own layer and do not merge with `props`: those primitives are cones, spheres
 * and toruses (indexed, with uvs) while `props` goes through `shapeOf` (non-indexed, no uvs),
 * and `mergeGeometries` cannot combine them.
 *
 * A city holds a few dozen civic buildings, so the extra triangles one spends are barely
 * measurable; the same instinct in a residential district, with thousands of buildings, blows
 * the budget outright. See `CIVIC_TRIANGLE_BUDGET`.
 *
 * Trees go on the lawn side, never on the car park: a tree growing out of a parking bay is the
 * most easily spotted kind of mistake.
 */
const fixtures: PropSpec[] = [
  // ── Greenery ──
  { kind: 'tree', x: M(7.0), z: M(5.5), heightM: 6.5, crownRadius: M(1.5) },
  { kind: 'tree', x: M(9.6), z: M(8.5), heightM: 5.5, crownRadius: M(1.3) },
  { kind: 'tree', x: M(7.0), z: M(9.8), heightM: 6.0, crownRadius: M(1.4) },
  // Street trees flanking the forecourt. They frame the entrance so the porch reads as the main
  // entrance rather than a side door.
  { kind: 'tree', x: M(-10.4), z: M(1.6), heightM: 5.0, crownRadius: M(1.2) },
  { kind: 'tree', x: M(10.4), z: M(1.6), heightM: 5.0, crownRadius: M(1.2) },

  // Shrubs on the lawn-to-car-park boundary, hiding the hard edge between the two surfaces.
  { kind: 'shrub', x: M(5.8), z: M(4.4), radius: M(0.8) },
  { kind: 'shrub', x: M(5.8), z: M(7.2), radius: M(0.8) },
  { kind: 'shrub', x: M(5.8), z: M(10.0), radius: M(0.8) },

  // Flower beds flanking the entrance: low, against the wall, the signal that someone maintains
  // this.
  { kind: 'flowerBed', x: M(-6.6), z: M(-0.4), radius: M(0.7) },
  { kind: 'flowerBed', x: M(2.6), z: M(-0.4), radius: M(0.7) },

  // ── Street furniture ──
  // Car park lamps. Lighting only the entrance leaves the whole car park black at night, and it
  // takes half the plot. They stand in the row **in front of** the bays (z = 4.0); the bays are
  // z in [4.9, 8.1]. At z = 5.0 they stand inside a bay, a lamp growing out of a patrol car's
  // roof.
  { kind: 'lamp', x: M(-7.0), z: M(4.0), heightM: 4.5 },
  { kind: 'lamp', x: M(1.0), z: M(4.0), heightM: 4.5 },
  { kind: 'lamp', x: M(-7.0), z: M(10.5), heightM: 4.5 },

  // The flagpole. Outside a public building it is the cheapest recognition signal there is.
  { kind: 'flagpole', x: M(-10.0), z: M(-0.5), axis: 'z' },

  // Bin and bike rack at the entrance, plus bollards keeping vehicles off the sidewalk.
  { kind: 'bin', x: M(-8.0), z: M(-0.6), radius: M(0.28) },
  { kind: 'bikeRack', x: M(4.0), z: M(0.6), axis: 'z' },
  { kind: 'bollard', x: M(-3.0), z: M(3.2), radius: M(0.11) },
  { kind: 'bollard', x: M(-1.0), z: M(3.2), radius: M(0.11) },
  { kind: 'bollard', x: M(1.0), z: M(3.2), radius: M(0.11) },

  // A hydrant: emergency services have one outside anyway.
  { kind: 'hydrant', x: M(-11.0), z: M(-0.6) },
];

/**
 * `aSeed`.
 *
 * `.x` is the floor rhythm, which the shader reads as `mix(0.22, 0.30, aSeed.x)`; 0.25 gives
 * 0.24 cells = 2.88 m per storey. The CIVIC facade's lobby height is `floorHeight * 1.35` =
 * 3.89 m, so an 11 m wing carries 2.5 storeys of window panes above the lobby.
 *
 * Any lower and the whole building is lobby with no window visible at all. That is a real
 * coupling between the two numbers rather than a coincidence, so a test pins it.
 *
 * `.y` is the window phase and `.z` the material variation. Fixed values: civic buildings have
 * no variants, and three police stations have to look alike.
 */
const SEED = [0.25, 0.37, 0.6] as const;

export const policePlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_CIVIC,
  // Indigo. The value lives in `colors.ts`; a literal here would let a change to the colour
  // table miss the police station, showing up only as "the police station's colour looks off".
  color: civicColorOf('police'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
