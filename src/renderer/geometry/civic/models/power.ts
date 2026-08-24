import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_SHELL,
} from '../../buildings/parts';
import { M, COOL } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * Power plant — 2x2 cells = 24 x 24 m.
 *
 * Recognition features: **one thick, waisted tower**, a sawtooth-roofed turbine hall, and a
 * switchyard strung together with black conductors.
 *
 * Two cylindrical stacks give almost the same silhouette as the water plant next door — a post
 * and a shed — and posts are everywhere. Two cooling towers are close to 10 m across at the
 * base and take the whole north half of a 24 m plot, reading in an isometric view as two drums
 * covering the hall.
 *
 * One tower works: no other building in the city is a **waisted surface of revolution**
 * (`shape: 'cooling'`), so the shape itself says "power plant", and one leaves room for the
 * whole switchyard.
 *
 * The switchyard is the other half of this building. Transformers and gantries alone are a few
 * boxes on the ground with nothing saying they are connected to each other. The conductors
 * supply that, and they are the only element spanning the whole site in an isometric view.
 *
 * The four utilities share `FACADE_UTILITY` (a galvanised corrugated palette plus a high window
 * band), so they read as one family. They differ in **silhouette**: waisted tower, white drum,
 * earth mound, rectangular basin.
 */

/**
 * Hall height.
 *
 * The hall, the tower and the outgoing gantries carry the silhouette and scale together.
 * Transformers and the canopy do not: they are human-scale objects, and scaling them makes the
 * switchyard look like a model.
 */
const HALL_TOP = M(7.7);
const HALL_ROOF = M(8.8);

/** The tower, in metres. A height-to-diameter ratio of 1.7; past 2.2 it reads as a post. */
const STACK_DIA = 11.0;
const STACK_TOP = 19.0;
const STACK_X = -4.0;
const STACK_Z = -5.9;

/** The pole line: a full row along the east edge, from the north end to the switchyard. */
const PYLON_X = 9.6;
const PYLON_Z = [-10.0, -3.5, 3.0, 9.8] as const;
const PYLON_TOP = 9.0;
/** Underside heights of the two crossarm tiers, in metres. Conductors rest on the crossarms' tops. */
const ARM_Y = [7.4, 8.5] as const;
/** Crossarm length and conductor hanging points, measured from the pole's centre. */
const ARM_HALF = 1.7;
const HANG = [-1.4, 0, 1.4] as const;
/** Height of the switchyard tier, in metres. It carries from the gantries to the pole line. */
const YARD_Y = 5.0;

/**
 * Fair-faced concrete. The tower's shell.
 *
 * Not `PART_DETAIL`: that branch removes windows but hard-codes a bluish metal grey
 * (m ~ 0.42-0.58) and never reads `vBldgColor`, while real concrete is bright, and that
 * brightness is what makes the tower visible from a distance. `PART_SHELL` is the branch that
 * draws this colour.
 */
const CONCRETE = [0.80, 0.79, 0.76] as const;

/**
 * Soot black on the inside of the tower mouth.
 *
 * The recess itself is geometry — the profile folds back at the top and the inner wall's
 * normals point toward the axis — and it is genuinely deep enough. Depth alone is not enough:
 * the inner wall follows the shaft's concrete colour and its normals are horizontal, so it
 * catches almost the same light as the outside, and looking down shows a **bright** cream ring
 * that still reads as a groove around the top.
 *
 * This engine has no ambient occlusion, so the mouth's interior does not darken by itself.
 * Hence a dark lining inside it, slightly narrower than the mouth and running from the recess's
 * floor up to the rim: looking down, it is the nearest face.
 */
const SOOT = [0.09, 0.09, 0.10] as const;

/** The conductors' black, and their thickness in metres. */
const WIRE = [0.05, 0.05, 0.06] as const;
const WIRE_T = 0.09;

/** One conductor along x. Both ends land on a pole or a crossarm, or it is a rod starting in mid-air. */
const wireX = (x0: number, x1: number, z: number, y: number): CivicVolume => ({
  tag: 'wire', part: PART_SHELL, color: WIRE,
  x: M((x0 + x1) / 2), z: M(z), w: M(x1 - x0), d: M(WIRE_T),
  y0: M(y), y1: M(y + WIRE_T),
});

/** One conductor along z. */
const wireZ = (x: number, z0: number, z1: number, y: number): CivicVolume => ({
  tag: 'wire', part: PART_SHELL, color: WIRE,
  x: M(x), z: M((z0 + z1) / 2), w: M(WIRE_T), d: M(z1 - z0),
  y0: M(y), y1: M(y + WIRE_T),
});

const massing: CivicVolume[] = [
  // ── The tower. It is this building's silhouette. ───────────
  {
    tag: 'stack', part: PART_SHELL, color: CONCRETE, shape: 'cooling',
    x: M(STACK_X), z: M(STACK_Z),
    w: M(STACK_DIA), d: M(STACK_DIA), y0: 0, y1: M(STACK_TOP),
  },
  {
    // The lining is open too (`tub`): a solid cylinder's top is a disc, which becomes a dark
    // plate under the mouth, and the opening is only that deep.
    tag: 'throatLining', part: PART_SHELL, color: SOOT, shape: 'tub',
    x: M(STACK_X), z: M(STACK_Z),
    w: M(STACK_DIA * COOL.THROAT * 0.94), d: M(STACK_DIA * COOL.THROAT * 0.94),
    y0: M(STACK_TOP * (1 - COOL.DEPTH)), y1: M(STACK_TOP),
  },
  {
    // The obstruction light: at night a power plant is that red point in the sky. It stands on
    // the mouth's **rim** — inside `COOL.THROAT` it falls in, outside `COOL.RIM` it hangs off
    // the tower. The top is narrower than the declared width, so both are computed from the
    // profile; with a copied number, changing the waist drops the light into the mouth and
    // nothing reports it.
    tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
    x: M(STACK_X + STACK_DIA * (COOL.THROAT + COOL.RIM) / 4), z: M(STACK_Z),
    w: M(0.6), d: M(0.6), y0: M(STACK_TOP), y1: M(STACK_TOP + 0.7),
  },

  // ── The turbine hall, the row in front of the tower. ──────
  {
    tag: 'hall',
    x: M(-2.0), z: M(2.8), w: M(18.0), d: M(6.0), y0: 0, y1: HALL_TOP,
  },
  {
    // A sawtooth roof, the most recognisable roof a plant has; flat, it is indistinguishable
    // from a warehouse. No overhang in z: the tower's south edge is only 0.1 m away, and an
    // overhang would overlap their bounding boxes.
    tag: 'hallRoof', part: PART_ROOF, shape: 'sawtooth', facing: 0,
    x: M(-2.0), z: M(2.8), w: M(18.6), d: M(6.0), y0: HALL_TOP, y1: HALL_ROOF,
  },

  // ── Poles: a full row along the east edge, carrying conductors above the hall. ──
  // In `massing` rather than `props`: a 9 m pole is part of the silhouette, and low props are
  // dropped at distant LOD. Crossarms and conductors stay in `props`; those details only hold
  // up close.
  ...PYLON_Z.map((z): CivicVolume => ({
    tag: 'pylon', part: PART_DETAIL,
    x: M(PYLON_X), z: M(z), w: M(0.5), d: M(0.5), y0: 0, y1: M(PYLON_TOP),
  })),
];

const decals: CivicDecal[] = [
  // Concrete around the tower: z [-12, -0.4]
  { x: 0, z: M(-6.2), w: M(24.0), d: M(11.6), shade: 0.55 },
  // Asphalt for the hall and the switchyard: z [-0.4, 12]
  { x: 0, z: M(5.8), w: M(24.0), d: M(12.4), shade: 0.0 },
];

// The crossing and lane edge lines at the gate.
for (let i = 0; i < 5; i++) {
  decals.push({
    x: M(-9.0 + i * 2.2), z: M(10.6), w: M(0.5), d: M(2.0),
    shade: 1.0, layer: 'mark',
  });
}

/**
 * The switchyard: four transformers, two outgoing gantries, the pole row's crossarms, and the
 * black conductors tying them together.
 *
 * A gantry — two posts and a beam — is the signal that power leaves from here; without it those
 * boxes are just boxes on the ground. The conductors are the only thing saying they are
 * connected to each other.
 */
const props: CivicVolume[] = [
  ...([-10.0, -6.6, -3.2, 0.2] as const).map((x): CivicVolume => ({
    tag: 'transformer', part: PART_DETAIL,
    x: M(x), z: M(9.8), w: M(2.6), d: M(2.2), y0: 0, y1: M(2.4),
  })),
  ...([3.6, 6.6] as const).flatMap((x): CivicVolume[] => [
    ...([-1.6, 1.6] as const).map((dz): CivicVolume => ({
      tag: 'gantryPost', part: PART_DETAIL,
      x: M(x), z: M(9.8 + dz), w: M(0.4), d: M(0.4), y0: 0, y1: M(YARD_Y),
    })),
    {
      tag: 'gantryBeam', part: PART_DETAIL,
      x: M(x), z: M(9.8), w: M(0.4), d: M(3.6), y0: M(YARD_Y), y1: M(YARD_Y + 0.3),
    },
  ]),

  // Two crossarm tiers per pole, three conductors each.
  ...PYLON_Z.flatMap((z): CivicVolume[] => ARM_Y.map((y): CivicVolume => ({
    tag: 'crossarm', part: PART_DETAIL,
    x: M(PYLON_X), z: M(z), w: M(ARM_HALF * 2), d: M(0.25),
    y0: M(y), y1: M(y + 0.3),
  }))),
  // One extra transverse crossarm at the switchyard end: the three conductors from the gantry
  // need somewhere to land.
  {
    tag: 'crossarm', part: PART_DETAIL,
    x: M(PYLON_X), z: M(9.8), w: M(0.25), d: M(3.4),
    y0: M(YARD_Y), y1: M(YARD_Y + 0.3),
  },

  // Six transmission conductors along the east edge, three per tier.
  ...ARM_Y.flatMap((y): CivicVolume[] => HANG.map((dx): CivicVolume =>
    wireZ(PYLON_X + dx, PYLON_Z[0]!, PYLON_Z[PYLON_Z.length - 1]!, y + 0.3))),
  // Three downleads joining the gantry to the pole line.
  ...([-1.2, 0, 1.2] as const).map((dz): CivicVolume =>
    wireX(3.6, PYLON_X, 9.8 + dz, YARD_Y + 0.3)),
];

const overhead: CivicVolume[] = [
  // The canopy over the hall's side door.
  {
    tag: 'canopy',
    x: M(-8.0), z: M(6.4), w: M(4.0), d: M(1.6), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  // The site fence, on three sides. The fourth (+z) is the gate and is left open.
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  // Industrial clutter: the signal that a process runs here. Laid along the passage between
  // tower, hall and switchyard, and clear of the pole row on the east edge (x = 9.6).
  //
  // Fewer than on the other industrial sites: conductors and crossarms take up the prop
  // allowance, and they are worth more than a fifth drum — a field of equipment with nothing
  // connecting it reads as a warehouse, not a switchyard.
  { kind: 'pipeRack', x: M(5.6), z: M(-4.0), axis: 'x', span: M(4.0) },
  { kind: 'pipeRack', x: M(6.0), z: M(-10.6), axis: 'z', span: M(5.0) },
  { kind: 'drum', x: M(6.4), z: M(-8.6), radius: M(0.42) },
  { kind: 'palletStack', x: M(-10.6), z: M(-2.0), axis: 'z', depth: M(1.0) },

  // Site high masts. Without them the whole asphalt area is one black patch at night.
  { kind: 'lamp', x: M(-10.4), z: M(0.0), heightM: 6.0 },
  { kind: 'lamp', x: M(-1.0), z: M(11.0), heightM: 6.0 },
  { kind: 'lamp', x: M(6.0), z: M(11.0), heightM: 6.0 },

  // Hedge and trees along the street side; a plant needs some screening from outside.
  { kind: 'hedge', x: M(-7.0), z: M(11.4), axis: 'z', length: M(6.0), depth: M(0.6), heightM: 1.2 },
  { kind: 'tree', x: M(-10.6), z: M(10.6), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(-10.6), z: M(-8.0), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'shrub', x: M(-1.0), z: M(-1.4), radius: M(0.8) },

  { kind: 'signPost', x: M(7.8), z: M(6.6), axis: 'z' },
  { kind: 'hydrant', x: M(11.0), z: M(7.0) },
  { kind: 'bollard', x: M(-0.6), z: M(11.4), radius: M(0.12) },
  { kind: 'bollard', x: M(0.6), z: M(11.4), radius: M(0.12) },
];

/**
 * The site's two vehicles, parked in the passage between the hall and the switchyard.
 *
 * The hall crosses the middle of the plot and the switchyard — transformers plus outgoing
 * gantries — takes the south edge, leaving that passage as the only open space in the south half
 * wide enough for a vehicle body.
 */
const vehicles: CivicVehicle[] = [
  { kind: 'truck', x: M(-6.0), z: M(7.0) },
  { kind: 'van', x: M(1.0), z: M(7.0) },
];

/**
 * `aSeed`.
 *
 * `FACADE_UTILITY` draws a **high window band** rather than per-floor panes, so `.x` sets the
 * band's height rather than a floor count. 0.62 gives a 12 m hall one daylight band near the
 * eaves, which is what a turbine hall looks like.
 */
const SEED = [0.62, 0.18, 0.44] as const;

export const powerPlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_UTILITY,
  color: civicColorOf('power'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
