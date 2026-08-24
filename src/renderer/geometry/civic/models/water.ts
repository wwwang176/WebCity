import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_WATER, PART_SHELL,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * Water plant — 2x2 cells = 24 x 24 m.
 *
 * Recognition features: **four large white tanks** in a 2x2 arrangement with a cross-shaped
 * passage between them, and the pump house running along the south edge. The white cylinders are
 * the strongest of these — a power plant is a stack and a sewage plant is rectangular basins, and
 * only this one is white and round.
 *
 * A tank needs all three of: a white body (`PART_SHELL`), blue water, and **a level below the
 * rim**. With the water surface flush with the top of the wall, the four read as cylinders with
 * blue lids; without that ring of inner wall there is no depth. So the walls are open containers
 * (`shape: 'tub'`) rather than solid cylinders: solid, the surface pushed below the top face
 * disappears inside the mass.
 *
 * **There is no water on this cell.** A water plant is built on land and does not draw a river
 * into its plot — the same mistake as a train station drawing fake rails: the real water is drawn
 * by the **terrain** (`TERRAIN_COLORS[WATER]`), and a second version here is two descriptions of
 * the same thing.
 *
 * The river survives in the colour: the site's primary hue is taken from the terrain water's hue
 * (see `colors.ts`).
 *
 * The layout is orthogonal:
 *
 * ```
 *   z-  ○ ○      four tanks, 2x2, cross passage between them
 *       ○ ○
 *       ────────
 *       pump house      the whole south edge
 *   z+  ─── forecourt ───
 * ```
 */

const TANK_TOP = M(4.6);
/** The water surface, 0.98 m below the rim. That ring of inner wall is what says the tank holds water. */
const WATER_TOP = M(3.62);
const HOUSE_TOP = M(7.0);
const HOUSE_ROOF = M(7.4);

/**
 * The water's brightness (`PART_WATER`'s B channel: 0 is deepest, 1 is palest).
 *
 * On the water branch rather than the ground branch. The ground ramp runs from asphalt to brick
 * and is **entirely grey**, so at `PART_GROUND` with 0.1 the four tanks read as four black holes
 * — and those four circles are this building's recognisable silhouette.
 *
 * A basin of water is not drawing a river of one's own (BUG-244): a river belongs to the terrain,
 * and the water in a tank belongs to this plant. Kept **above** `WATER_MURK_MAX`: below it is
 * sludge, which is the sewage plant's colour. What leaves here is drinking water.
 */
const WATER_SHADE = 0.72;
/**
 * The tanks' white: clean water. They are the only masses on this plot that do not take the
 * site's colour.
 *
 * They use `PART_SHELL` with a colour of **pure white**. On a wall, `FACADE_UTILITY` compresses
 * it to 0.70-0.90 and adds a high window band; on `PART_GROUND`, the ramp tops out at brick,
 * `vec3(0.60, 0.58, 0.55)`, so even `shade: 0.95` is mid grey. Neither path reaches white and
 * neither reports anything — `PART_SHELL` is the only branch that draws a mass in its own
 * colour.
 */
const TANK_WHITE = [1.0, 1.0, 1.0] as const;

/** Tank diameter in metres and the four centres. 2x2, leaving a cross-shaped passage between them. */
const TANK_DIA = 6.6;
const TANKS = [
  [-4.0, -8.0], [4.0, -8.0],
  [-4.0, -0.8], [4.0, -0.8],
] as const;

const massing: CivicVolume[] = [
  ...TANKS.flatMap(([x, z]): CivicVolume[] => [
    {
      // The tank body: white and open. See `TANK_WHITE` and `shape: 'tub'`.
      tag: 'tankWall', part: PART_SHELL, color: TANK_WHITE, shape: 'tub',
      x: M(x), z: M(z), w: M(TANK_DIA), d: M(TANK_DIA), y0: 0, y1: TANK_TOP,
    },
    {
      // The water is slightly wider than the tank's inner wall so its sides bury into it;
      // narrower, there is a ring of gap around the surface showing the ground through.
      tag: 'tankWater', part: PART_WATER, shade: WATER_SHADE, shape: 'cylinder',
      x: M(x), z: M(z), w: M(5.8), d: M(5.8), y0: M(3.5), y1: WATER_TOP,
    },
  ]),

  // ── Pump house: the whole south edge, x [-10.6, 3.8], z [3.4, 8.0] ──
  // 14.4 m long rather than 11.2 m: a short building plus an empty strip reads as unfinished.
  {
    tag: 'pumpHouse',
    x: M(-3.4), z: M(5.7), w: M(14.4), d: M(4.6), y0: 0, y1: HOUSE_TOP,
  },
  {
    tag: 'pumpRoof', part: PART_ROOF,
    x: M(-3.4), z: M(5.7), w: M(15.0), d: M(5.2), y0: HOUSE_TOP, y1: HOUSE_ROOF,
  },
  // The obstruction light on the pump house roof: the site's only light of its own at night.
  // Without it the whole plot goes dark.
  {
    tag: 'beacon', part: PART_LAMP, shape: 'cylinder',
    x: M(2.0), z: M(5.7), w: M(0.5), d: M(0.5), y0: HOUSE_ROOF, y1: M(8.6),
  },
];

const decals: CivicDecal[] = [
  // Site concrete: z [-12, 8.4]
  { tag: 'yard', x: 0, z: M(-1.8), w: M(24.0), d: M(20.4), shade: 0.55 },
  // Asphalt in front of the gate: z [8.4, 12]
  { x: 0, z: M(10.2), w: M(24.0), d: M(3.6), shade: 0.0 },
  // The cross passage. The two gaps between tanks have to read as a **passage** rather than a
  // gap.
  //
  // On the marking layer rather than the base layer: base layers may not overlap each other,
  // being at the same height and z-fighting, and these two are circulation painted **on** the
  // site's concrete, which is exactly how a real plant marks its walkways.
  { x: 0, z: M(-4.0), w: M(1.4), d: M(15.6), shade: 0.3, layer: 'mark' },
  { x: 0, z: M(-4.4), w: M(22.0), d: M(1.4), shade: 0.3, layer: 'mark' },
];

// Lane markings at the gate.
for (let i = 0; i < 3; i++) {
  decals.push({
    x: M(-8.0 + i * 8.0), z: M(10.2), w: M(0.15), d: M(2.6),
    shade: 1.0, layer: 'mark',
  });
}

/**
 * The pipe walkway between tanks. `geometry/props`'s `pipeRack` is too low; this one is raised.
 *
 * It only works with the tanks in a 2x2 arrangement: the walkway has to **cross the passage and
 * land on the opposite tank's rim**, and in a triangular arrangement no two tanks face each
 * other.
 */
const props: CivicVolume[] = [
  ...([-8.0, -0.8] as const).map((z): CivicVolume => ({
    tag: 'walkway', part: PART_DETAIL,
    x: 0, z: M(z), w: M(2.0), d: M(0.5), y0: M(4.4), y1: M(4.7),
  })),
  ...([-4.0, 4.0] as const).map((x): CivicVolume => ({
    tag: 'walkway', part: PART_DETAIL,
    x: M(x), z: M(-4.4), w: M(0.5), d: M(2.0), y0: M(4.4), y1: M(4.7),
  })),
];

const overhead: CivicVolume[] = [
  // The canopy over the pump house's main door.
  {
    tag: 'canopy',
    x: M(-3.4), z: M(8.6), w: M(4.0), d: M(1.6), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  { kind: 'fence', x: 0, z: M(-11.5), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.5), z: 0, axis: 'x', length: M(22.0) },
  { kind: 'fence', x: M(11.5), z: 0, axis: 'x', length: M(22.0) },

  // Industrial clutter goes in the three bands outside the tank group: the central passage, the
  // east side and the west side. Squeezed between tanks, a pipe rack grows out of a tank wall.
  // `axis: 'x'` is the one that extends along z (see the convention in `props.ts`); written as
  // `'z'` the rack spreads four metres along x and straight into the west tank's wall.
  { kind: 'pipeRack', x: 0, z: M(-8.0), axis: 'x', span: M(4.0) },
  { kind: 'pipeRack', x: M(10.2), z: M(-2.0), axis: 'x', span: M(4.0) },
  { kind: 'drum', x: M(10.2), z: M(1.4), radius: M(0.42) },
  { kind: 'drum', x: M(10.2), z: M(2.6), radius: M(0.42) },
  // A small patch left over beside the lengthened pump house. Stacked material beats leaving it
  // empty.
  { kind: 'palletStack', x: M(7.2), z: M(5.6), axis: 'z', depth: M(1.0) },
  { kind: 'gasBottles', x: M(-9.6), z: M(-1.0), axis: 'z', radius: M(0.24) },

  { kind: 'lamp', x: M(-9.6), z: M(-8.0), heightM: 5.5 },
  { kind: 'lamp', x: M(9.8), z: M(-8.0), heightM: 5.5 },
  { kind: 'lamp', x: M(11.0), z: M(6.0), heightM: 5.5 },

  { kind: 'hedge', x: M(-6.0), z: M(11.5), axis: 'z', length: M(9.0), depth: M(0.5), heightM: 1.2 },
  { kind: 'tree', x: M(-10.6), z: M(10.2), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(9.4), z: M(10.2), heightM: 5.4, crownRadius: M(0.9) },
  { kind: 'shrub', x: M(-1.0), z: M(10.6), radius: M(0.8) },

  { kind: 'signPost', x: M(2.6), z: M(11.2), axis: 'z' },
  { kind: 'hydrant', x: M(11.0), z: M(2.0) },
  { kind: 'bollard', x: M(1.0), z: M(11.4), radius: M(0.12) },
  { kind: 'bollard', x: M(4.4), z: M(11.4), radius: M(0.12) },
];

/**
 * The two site vehicles in front of the gate.
 *
 * They park on the forecourt's asphalt: the rest of the plot is taken by the four tanks and the
 * pump house, and on the lane beside the pump house half the truck ends up inside the wall, which
 * `CivicPlans`'s "no vehicle embedded in anything" case catches.
 */
const vehicles: CivicVehicle[] = [
  { kind: 'truck', x: M(-6.4), z: M(9.9) },
  { kind: 'van', x: M(6.0), z: M(9.9) },
];

const SEED = [0.55, 0.72, 0.3] as const;

export const waterPlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_UTILITY,
  color: civicColorOf('water'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
