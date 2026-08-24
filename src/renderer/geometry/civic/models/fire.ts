import {
  FACADE_CIVIC, PART_ROOF, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * Fire station — 2x2 cells = 24 x 24 m.
 *
 * Coordinates are in cells with the origin at the plot's centre and a usable range of +/-0.98
 * cells (+/-11.76 m after `CIVIC_INSET`). Every dimension is declared with `M(metres)`.
 *
 * Three recognition features, and without any one of them it is mistaken for another civic
 * building: **a row of roller doors**, **a training tower standing on the ground**, and **a red
 * body**.
 *
 * The tower standing on the ground is deliberate: a police station's watchtower is stacked on a
 * wing's roof, and with both towers on roofs the silhouettes stop separating. A training tower
 * belongs on the ground anyway — it is climbed from the ground floor.
 *
 * ```
 *   z-  ┌────────────────┬────────┐
 *       │ appliance bay  │ dorm   │
 *       └──┬──┬──┬───────┴────────┘
 *          3 roller doors  ┌──────┐
 *       ═══════════════════│ tower│═══   forecourt (concrete)
 *      engines park in front└──────┘
 *       ┌────────────────┬────────┐
 *       │  staff parking │  lawn  │
 *   z+  └────────────────┴────────┘
 * ```
 */

/** Clear height of the appliance bay. An engine is 1.9 m tall, but the bay has to hold a turntable ladder; 7.4 m is the real scale. */
const BAY_TOP = M(7.4);
const BAY_ROOF = M(7.8);
/** The dorm block is taller than the bay so the masses differ in height; level with it, the whole building is one box. */
const DORM_TOP = M(9.4);
const DORM_ROOF = M(9.8);
const TOWER_TOP = M(19.6);

/** The face the roller doors front onto: the bay's leading edge. Each door stands entirely outside it rather than sunk into the wall. */
const BAY_FRONT = M(-2.0);
/** Centres of the three roller doors, 5.2 m apart. Equal spacing is what makes them read as a row. */
const DOOR_X = [M(-8.6), M(-3.4), M(1.8)];

const massing: CivicVolume[] = [
  // ── Appliance bay ─────────────────────────────────────────
  // x [-11, 4], z [-11, -2]
  {
    tag: 'bay',
    x: M(-3.5), z: M(-6.5), w: M(15.0), d: M(9.0), y0: 0, y1: BAY_TOP,
  },
  {
    // The eaves overhang 0.5 m to the left, front and back but **not to the right**: the dorm
    // block's wall is there, and overhanging into it is an interior face buried in a wall.
    tag: 'bayRoof', part: PART_ROOF,
    x: M(-3.75), z: M(-6.5), w: M(15.5), d: M(9.6), y0: BAY_TOP, y1: BAY_ROOF,
  },

  // ── Dorm block ────────────────────────────────────────────
  // x [4, 11.6], **sharing an edge with the bay without overlapping**.
  {
    tag: 'dorm',
    x: M(7.8), z: M(-6.5), w: M(7.6), d: M(9.0), y0: 0, y1: DORM_TOP,
  },
  {
    // **No overhang at the front**: the training tower stands just outside that line, and an
    // overhang would enter it.
    tag: 'dormRoof', part: PART_ROOF,
    x: M(7.85), z: M(-6.65), w: M(7.7), d: M(9.3), y0: DORM_TOP, y1: DORM_ROOF,
  },

  // ── Training tower ────────────────────────────────────────
  // Standing on the ground outside the dorm block's leading edge (z = -2).
  {
    tag: 'tower',
    x: M(8.0), z: M(-0.2), w: M(4.4), d: M(3.6), y0: 0, y1: TOWER_TOP,
  },
  {
    tag: 'towerCap', part: PART_ROOF,
    x: M(8.0), z: M(-0.2), w: M(5.0), d: M(4.2), y0: TOWER_TOP, y1: M(20.2),
  },

  // ── Roller doors ──────────────────────────────────────────
  // In the massing layer rather than the low-prop layer: they are this building's strongest
  // recognition signal, and dropped at distant LOD it is no longer identifiable. `PART_DETAIL`
  // sends them to the metal-grey branch; tagged PART_WALL, the doors grow a grid of windows.
  ...DOOR_X.map((x): CivicVolume => ({
    tag: 'door', part: PART_DETAIL,
    x, z: BAY_FRONT + M(0.15), w: M(4.0), d: M(0.3), y0: 0, y1: M(4.6),
  })),

  // ── Rooftop equipment ─────────────────────────────────────
  {
    tag: 'ac', part: PART_DETAIL,
    x: M(-8.0), z: M(-8.5), w: M(2.0), d: M(1.5), y0: BAY_ROOF, y1: M(8.6),
  },
  {
    tag: 'ac', part: PART_DETAIL,
    x: M(-1.0), z: M(-8.5), w: M(2.0), d: M(1.5), y0: BAY_ROOF, y1: M(8.6),
  },
];

/**
 * The ground.
 *
 * **The forecourt is paved all the way to the plot boundary.** Staff parking at z in [6, 12]
 * sits directly in front of the roller doors, and an engine turning out would have to wait for
 * someone to move a car. The apron has to be clear from the doors to the kerb, so staff parking
 * and greenery go to the side.
 *
 * Four non-overlapping base areas: forecourt, the small plaza in front of the tower, side
 * asphalt, lawn.
 */
const decals: CivicDecal[] = [
  // Forecourt: from the doors to the kerb, x [-12, 4], z [-2, 12].
  { x: M(-4.0), z: M(5.0), w: M(16.0), d: M(14.0), shade: 0.6 },
  // The small plaza in front of the training tower, x [4, 12], z [-2, 2].
  { x: M(8.0), z: 0, w: M(8.0), d: M(4.0), shade: 0.6 },
  // Staff parking to the side, x [4, 12], z [2, 7].
  { x: M(8.0), z: M(4.5), w: M(8.0), d: M(5.0), shade: 0.0 },
  // Lawn, x [4, 12], z [7, 12].
  { x: M(8.0), z: M(9.5), w: M(8.0), d: M(5.0), shade: 0.0, lawn: true },
];

/**
 * Apron markings: two edge lines in front of each door, running to the kerb.
 *
 * **Edge lines** rather than filling the lane white: filled, it is not a lane but white floor
 * tiling, the same reasoning as the police station's parking bays.
 */
for (const x of DOOR_X) {
  for (const side of [-1, 1]) {
    decals.push({
      x: x + side * M(2.1), z: M(5.0), w: M(0.15), d: M(14.0),
      shade: 1.0, layer: 'mark',
    });
  }
}
// The kerb line. It marks where the plot ends and visually closes all three lanes on one line.
decals.push({ x: M(-4.0), z: M(11.6), w: M(16.0), d: M(0.15), shade: 0.85, layer: 'mark' });

/**
 * This building's own box masses: only things the shared primitives do not have.
 *
 * The roller doors are custom too, but they live in `massing` so distant LOD keeps them.
 */
const props: CivicVolume[] = DOOR_X.map((x): CivicVolume => ({
  // Warning lights above the doors. At night they are a fire station's most recognisable signal:
  // a row of evenly spaced red points.
  tag: 'beacon', part: PART_LAMP,
  x, z: BAY_FRONT + M(0.2), w: M(0.5), d: M(0.3), y0: M(4.8), y1: M(5.1),
}));

const overhead: CivicVolume[] = [
  // A small canopy over the crew entrance, at the left end of the dorm block's leading edge; the
  // right end is taken by the training tower.
  {
    tag: 'canopy',
    x: M(4.9), z: M(-1.3), w: M(1.7), d: M(1.4), y0: M(2.9), y1: M(3.2),
  },
];

/**
 * Shared low props. **The apron in front of the doors stays clear**: a tree planted in a roller
 * door's mouth is the first thing anyone would laugh at, and it is entirely legal in the data
 * table — no overrun, no budget exceeded.
 *
 * A lane is x within the door's width and z from the doors to the plot boundary. The x bands
 * that can hold anything are therefore the gaps between doors, the far left end, and x > 3.8, the
 * dorm and training tower side.
 */
const fixtures: PropSpec[] = [
  // ── Greenery, all on the side lawn (x > 4, z > 7). ──
  { kind: 'tree', x: M(6.0), z: M(8.6), heightM: 6.0, crownRadius: M(1.3) },
  { kind: 'tree', x: M(10.0), z: M(8.2), heightM: 5.2, crownRadius: M(1.2) },
  { kind: 'tree', x: M(7.6), z: M(10.6), heightM: 6.5, crownRadius: M(1.1) },

  // Shrubs on the lawn-to-asphalt boundary, hiding the hard edge between the two surfaces.
  { kind: 'shrub', x: M(4.8), z: M(7.0), radius: M(0.7) },
  { kind: 'shrub', x: M(7.2), z: M(7.0), radius: M(0.7) },
  { kind: 'shrub', x: M(9.6), z: M(7.0), radius: M(0.7) },

  // Flower beds by the crew entrance and the flagpole.
  { kind: 'flowerBed', x: M(4.8), z: M(0.4), radius: M(0.7) },
  { kind: 'flowerBed', x: M(11.0), z: M(0.4), radius: M(0.7) },

  // ── Street furniture ──
  // Forecourt lamps can only stand in the gaps between doors (x in [-6.6, -5.4] and
  // [-1.4, -0.2]): the only two bands left outside the apron.
  { kind: 'lamp', x: M(-6.0), z: M(4.4), heightM: 4.5 },
  { kind: 'lamp', x: M(-0.8), z: M(4.4), heightM: 4.5 },
  { kind: 'lamp', x: M(-6.0), z: M(9.6), heightM: 4.5 },
  // **Between** the staff bays: x in [6.7, 8.5] is the gap between the two. At 6.0 it stands
  // inside the left bay.
  { kind: 'lamp', x: M(7.6), z: M(4.5), heightM: 4.5 },

  { kind: 'flagpole', x: M(11.2), z: M(4.0), axis: 'z' },
  { kind: 'signPost', x: M(4.6), z: M(5.0), axis: 'z' },

  // A fire station with no hydrant outside it is the least convincing thing there is. One on each
  // side, both clear of the apron.
  { kind: 'hydrant', x: M(-11.4), z: M(5.0) },
  { kind: 'hydrant', x: M(11.4), z: M(8.0) },

  { kind: 'bin', x: M(4.4), z: M(2.6), radius: M(0.28) },
  // In front of the bays, which start at z = 3.8. At 3.6 it sits under a staff car.
  { kind: 'bikeRack', x: M(5.4), z: M(2.2), axis: 'z' },
  { kind: 'bollard', x: M(-11.4), z: M(1.0), radius: M(0.11) },
  { kind: 'bollard', x: M(4.2), z: M(6.6), radius: M(0.11) },
  { kind: 'bollard', x: M(11.4), z: M(1.0), radius: M(0.11) },
];

/**
 * Fire engines on the forecourt, each in front of its own door and facing out (+z).
 *
 * Parking them **on** the apron is deliberate: it reads as an engine that has just turned out,
 * which is the intended picture. What may not stand in front of the doors is anything rooted to
 * the ground, such as trees and lamps.
 */
const vehicles: CivicVehicle[] = [
  // z = 1.9: the tail has to clear the roller door **entirely**, and the door face is at z =
  // -1.7. At 1.6 the tail enters the door panel by 7 cm, which on screen is an engine stuck in the
  // doorway.
  { kind: 'firetruck', x: DOOR_X[0]!, z: M(1.9), rotationY: Math.PI / 2 },
  { kind: 'firetruck', x: DOOR_X[1]!, z: M(1.9), rotationY: Math.PI / 2 },
  // The officer's car and the duty van park in the **side** staff bays: three identical fire
  // engines read as copy-paste, and parking them on the apron turns them into obstructions.
  { kind: 'car', x: M(6.0), z: M(4.5), rotationY: Math.PI / 2 },
  { kind: 'van', x: M(9.2), z: M(4.5), rotationY: Math.PI / 2 },
];

/**
 * `aSeed`.
 *
 * `.x` = 0.28 gives 0.2424 cells = 2.91 m per storey. A 9.4 m dorm block carries 1.9 storeys of
 * window panes above a 3.93 m lobby; the appliance bay is a double-height garage and has only a
 * high row of daylight windows anyway.
 *
 * Fixed values: civic buildings have no variants, and three fire stations have to look alike.
 */
const SEED = [0.28, 0.61, 0.35] as const;

export const firePlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_CIVIC,
  color: civicColorOf('fire'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
