import { FACADE_CIVIC, PART_ROOF, PART_DETAIL } from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * Primary school — 2x2 cells = 24 x 24 m.
 *
 * Recognition features: **low height**, two parallel classroom wings, a playground, and play
 * equipment. The height matters most — it is the only difference between a primary school and a
 * high school or university that separates them at range — so the whole building is kept under
 * 9 m.
 *
 * ```
 *   z-  ┌────────────────────────┐
 *       │   classroom wing (north) │
 *       └──────┐ light gap ┌──────┘
 *              │  lobby   │
 *       ┌──────┘         └────────┐
 *       │   classroom wing (south) │
 *       └──────────▔▔────────────┘
 *        drop-off (buses park along the kerb)
 *       ┌──────────────────┬─────┐
 *   z+  │  playground (grass) │ play │
 * ```
 */

const WING_TOP = M(8.0);
const WING_ROOF = M(8.4);

/** The play area's surface centre and extent, sand or rubber matting. Every piece of play equipment stands on it. */
const PLAY = { x: M(9.0), z: M(9.25), w: M(6.0), d: M(5.5) };

const massing: CivicVolume[] = [
  // ── The two classroom wings: x [-11, 11], z [-11.5, -6] and [-3, 2.5] ──
  ...([-8.75, -0.25] as const).map((z): CivicVolume => ({
    tag: 'wing',
    x: 0, z: M(z), w: M(22.0), d: M(5.5), y0: 0, y1: WING_TOP,
  })),
  ...([-8.75, -0.25] as const).map((z): CivicVolume => ({
    tag: 'wingRoof', part: PART_ROOF,
    x: 0, z: M(z), w: M(22.6), d: M(5.9), y0: WING_TOP, y1: WING_ROOF,
  })),

  // ── The lobby: it joins the two wings but **does not fill** the gap ──
  // Filled, it is one deep building, and two parallel classroom wings are exactly why this reads
  // as a school.
  {
    tag: 'link',
    x: 0, z: M(-4.5), w: M(8.0), d: M(3.0), y0: 0, y1: M(5.0),
  },
  {
    tag: 'linkRoof', part: PART_ROOF,
    x: 0, z: M(-4.5), w: M(8.4), d: M(3.0), y0: M(5.0), y1: M(5.3),
  },

  // ── Rooftop equipment ─────────────────────────────────────
  ...([-7, 7] as const).map((x): CivicVolume => ({
    tag: 'ac', part: PART_DETAIL,
    x: M(x), z: M(-8.75), w: M(1.8), d: M(1.2), y0: WING_ROOF, y1: M(9.0),
  })),
];

/**
 * The ground. **The largest area on the plot has to be the playground**: a primary school's land
 * taken over by parking is a mistake visible at a glance.
 */
const decals: CivicDecal[] = [
  // Drop-off: z [2.5, 6.5]. Buses park along it, so it is 4 m deep.
  { x: 0, z: M(4.5), w: M(24.0), d: M(4.0), shade: 0.6 },
  // Playground: x [-12, 6], z [6.5, 12]
  { x: M(-3.0), z: M(9.25), w: M(18.0), d: M(5.5), shade: 0.0, lawn: true },
  // Play area: sand or rubber matting.
  { x: PLAY.x, z: PLAY.z, w: PLAY.w, d: PLAY.d, shade: 0.78 },
];

/**
 * Court markings. A plain green field does not read as a playground; the lines do.
 *
 * An outline plus a centre line: that is what a primary school's court is, and it does not have
 * to be drawn to the millimetre.
 */
const COURT = { x0: -10.0, x1: 2.0, z0: 7.2, z1: 11.5 };
const courtMid = (COURT.z0 + COURT.z1) / 2;
for (const z of [COURT.z0, COURT.z1, courtMid]) {
  decals.push({
    x: M((COURT.x0 + COURT.x1) / 2), z: M(z),
    w: M(COURT.x1 - COURT.x0), d: M(0.15), shade: 1.0, layer: 'mark',
  });
}
for (const x of [COURT.x0, COURT.x1]) {
  decals.push({
    x: M(x), z: M(courtMid),
    w: M(0.15), d: M(COURT.z1 - COURT.z0), shade: 1.0, layer: 'mark',
  });
}

/**
 * Play equipment: the one thing here that genuinely needs custom masses.
 *
 * `geometry/props` has no slide, climbing frame or swings, and they are exactly what says "this
 * is a primary school". All of it is kept under 2.6 m: a three-metre swing set is not play
 * equipment but a tower.
 */
const props: CivicVolume[] = [
  // The slide: a platform and a sloped panel.
  {
    tag: 'slide', part: PART_DETAIL,
    x: M(8.0), z: M(8.0), w: M(1.4), d: M(1.4), y0: 0, y1: M(1.8),
  },
  {
    tag: 'slide', part: PART_DETAIL, shape: 'shed', facing: 0,
    x: M(8.0), z: M(9.4), w: M(1.2), d: M(1.6), y0: 0, y1: M(1.7),
  },

  // The climbing frame: four posts and two top bars. A solid block reads as a box rather than
  // something to climb.
  ...([[9.4, 7.6], [11.0, 7.6], [9.4, 9.4], [11.0, 9.4]] as const)
    .map(([x, z]): CivicVolume => ({
      tag: 'climber', part: PART_DETAIL,
      x: M(x), z: M(z), w: M(0.16), d: M(0.16), y0: 0, y1: M(2.0),
    })),
  ...([7.6, 9.4] as const).map((z): CivicVolume => ({
    tag: 'climber', part: PART_DETAIL,
    x: M(10.2), z: M(z), w: M(1.76), d: M(0.14), y0: M(1.9), y1: M(2.04),
  })),

  // The swings: two posts, a beam, and two seats.
  ...([7.4, 10.4] as const).map((x): CivicVolume => ({
    tag: 'swing', part: PART_DETAIL,
    x: M(x), z: M(11.2), w: M(0.18), d: M(0.18), y0: 0, y1: M(2.3),
  })),
  {
    tag: 'swing', part: PART_DETAIL,
    x: M(8.9), z: M(11.2), w: M(3.0), d: M(0.16), y0: M(2.2), y1: M(2.36),
  },
  ...([8.2, 9.6] as const).map((x): CivicVolume => ({
    tag: 'swing', part: PART_DETAIL,
    x: M(x), z: M(11.2), w: M(0.5), d: M(0.16), y0: M(0.5), y1: M(0.58),
  })),
];

const overhead: CivicVolume[] = [
  // The entrance canopy. It enters the wing by 0.1 m so it reads as attached rather than
  // floating.
  {
    tag: 'canopy',
    x: 0, z: M(3.4), w: M(7.0), d: M(2.0), y0: M(3.0), y1: M(3.4),
  },
];

const fixtures: PropSpec[] = [
  // ── Planting: street trees along the playground's edge. Inside the court markings, the ball
  // hits them. ──
  { kind: 'tree', x: M(-10.6), z: M(7.4), heightM: 5.5, crownRadius: M(1.0) },
  { kind: 'tree', x: M(-10.6), z: M(10.4), heightM: 6.0, crownRadius: M(1.1) },
  { kind: 'tree', x: M(-6.0), z: M(3.6), heightM: 5.0, crownRadius: M(0.9) },
  { kind: 'tree', x: M(6.0), z: M(3.6), heightM: 5.0, crownRadius: M(0.9) },

  { kind: 'shrub', x: M(-1.6), z: M(3.4), radius: M(0.7) },
  { kind: 'shrub', x: M(1.6), z: M(3.4), radius: M(0.7) },
  { kind: 'shrub', x: M(5.4), z: M(7.2), radius: M(0.6) },
  { kind: 'topiary', x: M(-4.0), z: M(3.4), radius: M(0.6) },

  // Flower beds flanking the entrance. Someone tends a primary school's gate, and that is this
  // building's character.
  { kind: 'flowerBed', x: M(-4.4), z: M(2.9), radius: M(0.6) },
  { kind: 'flowerBed', x: M(4.4), z: M(2.9), radius: M(0.6) },

  // ── Street furniture ──
  { kind: 'lamp', x: M(-11.0), z: M(5.0), heightM: 4.0 },
  { kind: 'lamp', x: M(11.0), z: M(5.0), heightM: 4.0 },
  { kind: 'lamp', x: M(-11.2), z: M(11.0), heightM: 4.0 },

  { kind: 'flagpole', x: M(-8.6), z: M(3.4), axis: 'z' },
  { kind: 'signPost', x: M(8.6), z: M(3.4), axis: 'z' },

  // One bike rack is not enough for a primary school.
  { kind: 'bikeRack', x: M(-9.0), z: M(5.6), axis: 'z' },
  { kind: 'bikeRack', x: M(-9.0), z: M(6.2), axis: 'z' },
  { kind: 'bin', x: M(2.6), z: M(3.0), radius: M(0.26) },
  // Bollards between the drop-off and the playground: vehicles may not drive onto it.
  ...([-8.0, -4.0, 0, 4.0] as const).map((x) => ({
    kind: 'bollard' as const, x: M(x), z: M(6.4), radius: M(0.11),
  })),
];

/**
 * School buses park along the kerb, **unrotated**.
 *
 * A school bus is 7.2 m long. Parked across a 4 m deep drop-off, half of it is inside the
 * building, and `assembleVehicles` only guards the plot boundary and cannot catch that.
 */
const vehicles: CivicVehicle[] = [
  // z = 5.2, the middle of the drop-off. At 4.8 the bus's front edge presses into the shrubs by
  // the entrance (z in [2.7, 4.1]) and reads as parked in the bushes. This is the centre of the
  // 2.2 m gap in front of the bollards at z = 6.4.
  { kind: 'bus', x: M(-3.0), z: M(5.2) },
  { kind: 'van', x: M(5.4), z: M(5.2) },
];

/**
 * `aSeed`.
 *
 * `.x` = 0.18 gives 0.2344 cells = 2.81 m per storey; a primary school's floors are lower than a
 * hospital's. An 8 m classroom wing carries 1.5 storeys of window panes above a 3.79 m lobby: a
 * two-storey school building.
 */
const SEED = [0.18, 0.83, 0.44] as const;

export const schoolPlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_CIVIC,
  color: civicColorOf('school'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
