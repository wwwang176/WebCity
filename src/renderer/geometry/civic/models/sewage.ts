import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_WATER,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * Sewage plant — 2x2 cells = 24 x 24 m.
 *
 * Recognition features: **four rectangular aeration basins in a row**, a circular clarifier, and
 * the control building. The rectangular basins are the strongest — the water plant is a row of
 * round vessels and this is a row of rectangular ones, and the two separate immediately in an
 * isometric view.
 *
 * The basins take `PART_WATER` plus `shade`: they are **water**, neither wall nor paving.
 */

const BASIN_TOP = M(2.4);
const CTRL_TOP = M(6.6);
const CTRL_ROOF = M(7.0);

/**
 * The sewage's brightness (`PART_WATER`'s B channel: 0 is deepest, 1 is palest).
 *
 * On the water branch rather than the ground branch: the ground ramp runs from asphalt to brick
 * and is entirely grey, so a basin on that path can only be a black hole.
 *
 * Kept below `WATER_MURK_MAX`, the sludge segment; above it is water. Side by side, the basins'
 * colour is the one thing the two plants do not share — earth here, blue at the water plant.
 */
const WATER_SHADE = 0.05;
/**
 * The water surface's width as a fraction of the basin's.
 *
 * Slightly wider than the basin's inner wall (`TUB.INNER`) so its sides bury into it; narrower,
 * there is a ring of gap around the surface showing the ground through, visible only from
 * directly above.
 */
const WATER_SPAN = 0.86;

/** The four aeration basins' centres: in a row and evenly spaced. That rhythm is the recognition signal. */
const BASINS = [-8.4, -3.0, 2.4, 7.8];
const BASIN_W = 4.8;
const BASIN_D = 10.0;
const BASIN_Z = -5.6;

const massing: CivicVolume[] = [
  ...BASINS.flatMap((x): CivicVolume[] => [
    {
      // An open rectangular basin: four walls enclosing a rectangle. A solid box cannot put the
      // water surface below the rim — its top is a solid face, and the surface pushed beneath it
      // disappears inside the mass.
      tag: 'basinWall', part: PART_DETAIL, shape: 'basin',
      x: M(x), z: M(BASIN_Z), w: M(BASIN_W), d: M(BASIN_D), y0: 0, y1: BASIN_TOP,
    },
    {
      tag: 'basinWater', part: PART_WATER, shade: WATER_SHADE,
      x: M(x), z: M(BASIN_Z),
      w: M(BASIN_W * WATER_SPAN), d: M(BASIN_D * WATER_SPAN),
      y0: M(1.85), y1: M(1.97),
    },
  ]),

  // ── The circular clarifier. One round vessel among a row of rectangular ones reads as a
  // different stage of the process. ──
  {
    tag: 'clarifierWall', part: PART_DETAIL, shape: 'tub',
    x: M(-6.0), z: M(5.4), w: M(9.0), d: M(9.0), y0: 0, y1: M(2.8),
  },
  {
    tag: 'clarifierWater', part: PART_WATER, shade: WATER_SHADE, shape: 'cylinder',
    x: M(-6.0), z: M(5.4), w: M(9.0 * WATER_SPAN), d: M(9.0 * WATER_SPAN),
    y0: M(2.15), y1: M(2.27),
  },

  // ── Control building: x [2, 11], z [1.5, 9.5] ─────────────
  {
    tag: 'control',
    x: M(6.5), z: M(5.5), w: M(9.0), d: M(8.0), y0: 0, y1: CTRL_TOP,
  },
  {
    tag: 'controlRoof', part: PART_ROOF,
    x: M(6.5), z: M(5.5), w: M(9.6), d: M(8.6), y0: CTRL_TOP, y1: CTRL_ROOF,
  },
  {
    tag: 'beacon', part: PART_LAMP,
    x: M(6.5), z: M(5.5), w: M(0.6), d: M(0.6), y0: CTRL_ROOF, y1: M(7.5),
  },
];

const decals: CivicDecal[] = [
  // Concrete around the basins.
  { x: 0, z: M(-6.0), w: M(24.0), d: M(12.0), shade: 0.55 },
  // Asphalt across the front yard.
  { x: 0, z: M(6.0), w: M(24.0), d: M(12.0), shade: 0.0 },
];

// Walkway markings between the basins.
for (const x of [-5.7, -0.3, 5.1]) {
  decals.push({
    x: M(x), z: M(BASIN_Z), w: M(0.4), d: M(BASIN_D),
    shade: 0.85, layer: 'mark',
  });
}

/**
 * The walkway over the basins. Without it a sewage plant's silhouette is a few puddles.
 *
 * Its posts stand in the three gaps **between** basins plus the open ground at the east end,
 * never at a basin's centre. With solid basins a post at `BASINS`'s centres is buried inside the
 * wall and invisible; hollowed out, it stands in the water.
 */
const POSTS = [-5.7, -0.3, 5.1, 10.45];

const props: CivicVolume[] = [
  {
    tag: 'walkway', part: PART_DETAIL,
    x: M(0.15), z: M(-1.4), w: M(20.9), d: M(0.8), y0: M(2.6), y1: M(2.9),
  },
  ...POSTS.map((x): CivicVolume => ({
    tag: 'walkwayPost', part: PART_DETAIL,
    x: M(x), z: M(-1.4), w: M(0.3), d: M(0.3), y0: 0, y1: M(2.6),
  })),
];

const overhead: CivicVolume[] = [
  {
    tag: 'canopy',
    x: M(6.5), z: M(1.0), w: M(4.0), d: M(1.6), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  { kind: 'pipeRack', x: M(-11.0), z: M(-5.6), axis: 'x', span: M(8.0) },
  { kind: 'pipeRack', x: M(0.6), z: M(9.6), axis: 'z', span: M(4.0) },
  { kind: 'gasBottles', x: M(1.4), z: M(2.4), axis: 'x', radius: M(0.24) },
  { kind: 'drum', x: M(-11.0), z: M(1.0), radius: M(0.42) },
  { kind: 'drum', x: M(-10.0), z: M(1.0), radius: M(0.42) },

  { kind: 'lamp', x: M(-10.8), z: M(-10.2), heightM: 5.5 },
  { kind: 'lamp', x: M(10.8), z: M(-10.2), heightM: 5.5 },
  { kind: 'lamp', x: M(-2.0), z: M(10.6), heightM: 5.5 },

  { kind: 'hedge', x: M(-6.0), z: M(11.4), axis: 'z', length: M(9.0), depth: M(0.6), heightM: 1.2 },
  { kind: 'tree', x: M(-11.0), z: M(9.0), heightM: 6.0, crownRadius: M(0.7) },
  { kind: 'tree', x: M(-11.0), z: M(4.0), heightM: 6.0, crownRadius: M(0.7) },
  { kind: 'shrub', x: M(-0.6), z: M(-0.2), radius: M(0.8) },

  { kind: 'signPost', x: M(2.2), z: M(10.6), axis: 'z' },
  { kind: 'hydrant', x: M(11.0), z: M(-0.4) },
  { kind: 'bollard', x: M(4.0), z: M(10.8), radius: M(0.12) },
  { kind: 'bollard', x: M(9.0), z: M(10.8), radius: M(0.12) },
];

/**
 * One collection truck, on the 3.5 m passage between the clarifier and the control building.
 *
 * At x = -3 a vehicle lands inside the clarifier, whose radius is 4.5 m about a centre at
 * (-6, 5.4): a van sits entirely **inside** the basin and a truck presses on its rim.
 *
 * There is one vehicle because the site has exactly one place a 6.7 m body fits: lengthwise
 * along that passage. Forcing a second returns to parking on a basin.
 */
const vehicles: CivicVehicle[] = [
  { kind: 'truck', x: 0, z: M(6.0), rotationY: Math.PI / 2 },
];

const SEED = [0.48, 0.9, 0.52] as const;

export const sewagePlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_UTILITY,
  color: civicColorOf('sewage'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
