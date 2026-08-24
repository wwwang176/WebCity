import {
  FACADE_GREEN, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal } from '../types';

/**
 * Cemetery — 2x2 cells = 24 x 24 m.
 *
 * Recognition features: **aligned rows of headstones**, a memorial with a glowing cross on top,
 * and the entrance piers. The headstones are the strongest — a tidy array of low blocks has no
 * counterpart anywhere in the city.
 *
 * **There is no building here.** A chapel of 8 x 6 m with a gabled roof and a bell tower takes
 * the whole north end of a 24 m plot and contributes nothing to recognition: what says cemetery
 * is the array of headstones, and the small building is only one more gabled box. A 5.5 m
 * memorial replaces it, the cross stays at the same height, and the cemetery reads as ground
 * rather than as a building plot.
 *
 * Alignment is the point. Scattered low blocks read as clutter on the ground; laid out on a grid
 * they read as a cemetery. So the row and column coordinates are computed rather than written
 * one by one.
 *
 * ```
 *   z-  ┌────────────────────────┐
 *       │       memorial (cross)  │
 *       ├────────┬──┬────────────┤
 *       │ stones │pa│  stones     │
 *       │ ▪ ▪ ▪  │th│  ▪ ▪ ▪      │
 *       │ ▪ ▪ ▪  │  │  ▪ ▪ ▪      │
 *   z+  └────────┴╥╨┴────────────┘
 *                 piers
 * ```
 */

/** The memorial's centre, at the end of the path. */
const MEMORIAL_Z = -8.5;
/** The top of the stone shaft, where the cross begins. */
const SHAFT_TOP = M(4.2);
/** The path's half-width. Headstones may not encroach on it. */
const PATH_HALF = 2.0;

/** The headstones' rows and columns. Computed rather than written out: among thirty written by hand, one is always misaligned. */
const STONE_COLS = [-9.4, -6.6, -3.8, 3.8, 6.6, 9.4];
const STONE_ROWS = [-3.4, -0.6, 2.2, 5.0, 7.8];

const massing: CivicVolume[] = [
  // ── The memorial: a three-step base, a shaft, and a cross. ──
  // It steps inward as it rises; a bare shaft in the ground reads as a utility pole.
  {
    tag: 'plinth',
    x: 0, z: M(MEMORIAL_Z), w: M(3.2), d: M(3.2), y0: 0, y1: M(0.45),
  },
  {
    tag: 'plinth',
    x: 0, z: M(MEMORIAL_Z), w: M(2.2), d: M(2.2), y0: M(0.45), y1: M(0.9),
  },
  {
    tag: 'shaft',
    x: 0, z: M(MEMORIAL_Z), w: M(0.9), d: M(0.9), y0: M(0.9), y1: SHAFT_TOP,
  },

  // ── The cross: three pieces sharing edges without overlapping. An upright and a bar simply
  // stacked leave an invisible interior face where they cross. ──
  // All of it takes `PART_LAMP`: at night the cross is all that remains of the cemetery, which is
  // exactly how it should be.
  {
    tag: 'cross', part: PART_LAMP,
    x: 0, z: M(MEMORIAL_Z), w: M(0.26), d: M(0.26), y0: SHAFT_TOP, y1: M(4.7),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: 0, z: M(MEMORIAL_Z), w: M(1.3), d: M(0.26), y0: M(4.7), y1: M(5.0),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: 0, z: M(MEMORIAL_Z), w: M(0.26), d: M(0.26), y0: M(5.0), y1: M(5.5),
  },

  // ── The entrance piers: two piers, with the lintel in `overhead`. ──
  ...([-3.2, 3.2] as const).map((x): CivicVolume => ({
    tag: 'gatePier',
    x: M(x), z: M(10.6), w: M(1.0), d: M(1.0), y0: 0, y1: M(3.2),
  })),
];

/**
 * The ground. The central path runs from the gate all the way to the memorial; a path that stops
 * short is a decorative line.
 *
 * Only two paved areas remain: the path and the small plaza in front of the memorial. A full
 * 24 m of paving there is a large area of concrete with no reason for it.
 */
const decals: CivicDecal[] = [
  // The central path: x [-2, 2], z [-5.5, 12]
  { x: 0, z: M(3.25), w: M(PATH_HALF * 2), d: M(17.5), shade: 0.62 },
  // The plaza in front of the memorial: x [-5, 5], z [-12, -5.5]
  { x: 0, z: M(-8.75), w: M(10.0), d: M(6.5), shade: 0.55 },
];

// The two grave-plot lawns.
for (const side of [-1, 1]) {
  decals.push({
    x: M(side * (PATH_HALF + 12.0) / 2), z: M(3.25),
    w: M(12.0 - PATH_HALF), d: M(17.5), shade: 0.0, lawn: true,
  });
  // Grass flanking the plaza. Without it, those two corners are bare ground.
  decals.push({
    x: M(side * (5.0 + 12.0) / 2), z: M(-8.75),
    w: M(7.0), d: M(6.5), shade: 0.0, lawn: true,
  });
}

/**
 * The headstones: the one thing here that genuinely needs custom masses.
 *
 * They live in `props`, which distant LOD drops wholesale, and thirty 0.9 m blocks are invisible
 * at that range anyway.
 */
const props: CivicVolume[] = STONE_COLS.flatMap(x => STONE_ROWS.map((z): CivicVolume => ({
  tag: 'headstone', part: PART_DETAIL,
  x: M(x), z: M(z), w: M(0.7), d: M(0.25), y0: 0, y1: M(0.9),
})));

const overhead: CivicVolume[] = [
  // The lintel between the piers, above the 2.2 m pedestrian clearance.
  {
    tag: 'gateLintel',
    x: 0, z: M(10.6), w: M(7.4), d: M(0.8), y0: M(3.2), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  // ── Boundary trees. A cemetery's trees are the line that marks it as somewhere else. ──
  ...([-1, 1] as const).flatMap(sx => ([-2.0, 3.4, 8.8] as const).map(z => ({
    kind: 'tree' as const,
    x: M(sx * 11.0), z: M(z), heightM: 7.5, crownRadius: M(0.7),
  }))),
  { kind: 'tree', x: M(-6.0), z: M(11.0), heightM: 6.0, crownRadius: M(0.7) },
  { kind: 'tree', x: M(6.0), z: M(11.0), heightM: 6.0, crownRadius: M(0.7) },

  // Low hedges along the path.
  ...([-1, 1] as const).map(sx => ({
    kind: 'hedge' as const,
    x: M(sx * 2.4), z: M(3.0), axis: 'x' as const,
    length: M(16.0), depth: M(0.5), heightM: 0.8,
  })),
  // Flanking the memorial. Six items — a pair of topiaries, a pair of flower beds and a pair of
  // shrubs — suit a building; a memorial is far smaller and the same six would bury it.
  { kind: 'flowerBed', x: M(-2.6), z: M(-8.5), radius: M(0.7) },
  { kind: 'flowerBed', x: M(2.6), z: M(-8.5), radius: M(0.7) },
  { kind: 'topiary', x: M(-4.0), z: M(-5.4), radius: M(0.7) },
  { kind: 'topiary', x: M(4.0), z: M(-5.4), radius: M(0.7) },

  // ── Street furniture: few and dim. A cemetery does not need to be lively. ──
  { kind: 'lamp', x: M(-2.6), z: M(9.0), heightM: 3.6 },
  { kind: 'lamp', x: M(2.6), z: M(9.0), heightM: 3.6 },
  { kind: 'lamp', x: M(-2.6), z: M(-3.0), heightM: 3.6 },
  { kind: 'lamp', x: M(2.6), z: M(-3.0), heightM: 3.6 },
  { kind: 'flagpole', x: M(-10.0), z: M(-7.4), axis: 'z' },
  { kind: 'signPost', x: M(4.6), z: M(11.2), axis: 'z' },
  { kind: 'bin', x: M(-4.6), z: M(11.2), radius: M(0.26) },
  ...([-8.0, 8.0] as const).map(x => ({
    kind: 'bollard' as const, x: M(x), z: M(11.4), radius: M(0.11),
  })),
];

/**
 * **No vehicles.**
 *
 * With no chapel there is no entrance to park in front of, and the plaza before the memorial is
 * only 10 m wide, where two vehicles would turn it into a car park.
 */
const vehicles: CivicPlan['vehicles'] = [];

/**
 * `aSeed`.
 *
 * `FACADE_GREEN`'s walls carry no window panes, so `.x`, the floor rhythm, has no effect here:
 * this plot is read from its headstones and its cross, not from windows.
 */
const SEED = [0.5, 0.21, 0.38] as const;

export const cemeteryPlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_GREEN,
  color: civicColorOf('cemetery'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
