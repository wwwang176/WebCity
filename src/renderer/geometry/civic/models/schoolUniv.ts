import {
  FACADE_CIVIC, PART_ROOF, PART_DETAIL, PART_LAMP,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * University — 3x3 cells = 36 x 36 m.
 *
 * Recognition features: a **quadrangle enclosed on all four sides**, a domed north range, and a
 * clock tower. The quadrangle is the strongest — it is the city's only building that is hollow in
 * the middle, and that is visible at a glance in an isometric view.
 *
 * ```
 *   z-  ┌───────────────────────────┐
 *       │   north range (dome at centre)  │
 *       ├────┬─────────────────┬────┤
 *       │west│  quad: grass     │east│
 *       │range│  + cross paths  │range│
 *       │    │  + central pool  │    │
 *       ├────┴─────────────────┴────┤
 *       │   south range (clock tower at centre) │
 *       └───────────▔▔▔─────────────┘
 *   z+       forecourt (buses and visitor parking)
 * ```
 */

const RANGE_N_TOP = M(14.0);
const RANGE_N_ROOF = M(14.5);
const RANGE_TOP = M(12.0);
const RANGE_ROOF = M(12.5);

/**
 * The north range's centre. The dome sits directly above it.
 *
 * The north range is deeper than the other three, 9 m against 7 m, because the dome has to land
 * **entirely on it**: an 8.4 m dome on a 7 m range overhangs 0.7 m front and back, and the back
 * side falls straight off the plot.
 */
const NORTH_Z = M(-12.5);
/** The south range's centre. The clock tower sits directly above it. */
const SOUTH_Z = M(9.5);

/**
 * The dome: **a drum plus a hemisphere**.
 *
 * The hemisphere uses `shape: 'dome'` with a drum beneath it. A hemisphere set straight on the
 * roof is too flat — a hemisphere's height is necessarily half its diameter, and the dome's
 * height is this building's silhouette. The drum is also how a real dome is built, with the
 * clerestory in that ring. A stack of octagonal prisms narrowing upward reads as a dome at range
 * and as sharply stepped tiers up close.
 *
 * Both parts take `PART_ROOF` rather than `PART_WALL`: the wall branch would paint window panes
 * across the dome, and a dome covered in windows is only a slightly odd tower.
 *
 * The diameter may not exceed the north range's depth of 9 m.
 *
 * Since a hemisphere's height is necessarily half its diameter, lowering the dome has exactly two
 * routes: a smaller diameter or a shorter drum. Half of the reduction goes to each — diameter
 * 8.4 to 6.4 and drum 3.5 to 2.2 m, taking drum plus hemisphere from 7.7 m to 5.4 m, exactly 30%.
 * The drum alone would drop too low to read as a drum, and the diameter alone would leave a dome
 * the size of a cap on the roof.
 */
const DOME_DIA = 6.4;
const DRUM_BASE = M(14.5);
const DRUM_TOP = M(16.7);
/** A hemisphere's height equals its radius. */
const DOME_TOP_M = 16.7 + DOME_DIA / 2;

const massing: CivicVolume[] = [
  // ── Four ranges enclosing the quadrangle ──────────────────
  // North range: x [-17, 17], z [-17, -8]. Deeper than the other three, to carry the dome.
  {
    tag: 'range',
    x: 0, z: NORTH_Z, w: M(34.0), d: M(9.0), y0: 0, y1: RANGE_N_TOP,
  },
  {
    // Overhangs to the north only: the quadrangle is to the south and the side ranges meet its
    // two ends.
    tag: 'rangeRoof', part: PART_ROOF,
    x: 0, z: M(-12.65), w: M(34.6), d: M(9.3), y0: RANGE_N_TOP, y1: RANGE_N_ROOF,
  },
  // South range: x [-17, 17], z [6, 13]
  {
    tag: 'range',
    x: 0, z: SOUTH_Z, w: M(34.0), d: M(7.0), y0: 0, y1: RANGE_TOP,
  },
  {
    tag: 'rangeRoof', part: PART_ROOF,
    x: 0, z: M(9.65), w: M(34.6), d: M(7.3), y0: RANGE_TOP, y1: RANGE_ROOF,
  },
  // East and west ranges: z [-8, 6], meeting the north and south ranges **exactly** at both ends.
  // With a gap, the quadrangle leaks out at a corner and the enclosure is wasted.
  ...([-13.5, 13.5] as const).map((x): CivicVolume => ({
    tag: 'range',
    x: M(x), z: M(-1.0), w: M(7.0), d: M(14.0), y0: 0, y1: RANGE_TOP,
  })),
  ...([-13.65, 13.65] as const).map((x): CivicVolume => ({
    // Overhangs outward only; inward, the eaves would cover a corner of the quadrangle.
    tag: 'rangeRoof', part: PART_ROOF,
    x: M(x), z: M(-1.0), w: M(7.3), d: M(14.0), y0: RANGE_TOP, y1: RANGE_ROOF,
  })),

  // ── The dome ──────────────────────────────────────────────
  {
    tag: 'domeDrum', part: PART_ROOF, shape: 'cylinder',
    x: 0, z: NORTH_Z, w: M(DOME_DIA), d: M(DOME_DIA),
    y0: DRUM_BASE, y1: DRUM_TOP,
  },
  {
    tag: 'dome', part: PART_ROOF, shape: 'dome',
    x: 0, z: NORTH_Z, w: M(DOME_DIA), d: M(DOME_DIA),
    y0: DRUM_TOP, y1: M(DOME_TOP_M),
  },
  {
    // The lantern at the apex. At night it is all that remains visible of the dome.
    tag: 'finial', part: PART_LAMP, shape: 'cylinder',
    x: 0, z: NORTH_Z, w: M(1.2), d: M(1.2),
    y0: M(DOME_TOP_M), y1: M(DOME_TOP_M + 1.1),
  },

  // ── Rooftop equipment ─────────────────────────────────────
  ...([-11, 11] as const).map((x): CivicVolume => ({
    tag: 'ac', part: PART_DETAIL,
    x: M(x), z: NORTH_Z, w: M(2.0), d: M(1.4), y0: RANGE_N_ROOF, y1: M(15.3),
  })),
];

/**
 * The ground.
 *
 * The quadrangle is four patches of grass plus a cross of paths. Base decals may not overlap, so
 * the paths cannot lie over the grass and the grass is cut into four instead. The east-west path
 * is therefore two pieces, with the middle square belonging to the north-south one.
 */
const PATH_HALF = 1.5;
const QUAD = { x: 10.0, z0: -8.0, z1: 6.0 };

const decals: CivicDecal[] = [
  // The north-south path, through the centre.
  {
    x: 0, z: M((QUAD.z0 + QUAD.z1) / 2),
    w: M(PATH_HALF * 2), d: M(QUAD.z1 - QUAD.z0), shade: 0.62,
  },
  // Forecourt, beyond the south range: z [13, 18]
  { x: 0, z: M(15.5), w: M(36.0), d: M(5.0), shade: 0.6 },
];

// The east-west path's two pieces.
for (const side of [-1, 1]) {
  const inner = PATH_HALF;
  const outer = QUAD.x;
  decals.push({
    x: M(side * (inner + outer) / 2), z: 0,
    w: M(outer - inner), d: M(PATH_HALF * 2), shade: 0.62,
  });
}

// The four patches of grass.
for (const sx of [-1, 1]) {
  for (const [za, zb] of [[QUAD.z0, -PATH_HALF], [PATH_HALF, QUAD.z1]] as const) {
    decals.push({
      x: M(sx * (PATH_HALF + QUAD.x) / 2), z: M((za + zb) / 2),
      w: M(QUAD.x - PATH_HALF), d: M(zb - za), shade: 0.0, lawn: true,
    });
  }
}

// The forecourt's parking bay separators.
for (let i = 0; i < 5; i++) {
  decals.push({
    x: M(4.0 + i * 2.8), z: M(15.6), w: M(0.15), d: M(4.6),
    shade: 1.0, layer: 'mark',
  });
}

/**
 * The pool at the quadrangle's centre: this building's cheapest "this is a university" signal.
 *
 * `geometry/props` has no pool, so it is a custom mass.
 */
const props: CivicVolume[] = [
  {
    tag: 'fountain', part: PART_DETAIL, shape: 'cylinder',
    x: 0, z: 0, w: M(3.0), d: M(3.0), y0: 0, y1: M(0.6),
  },
  {
    tag: 'fountain', part: PART_DETAIL, shape: 'cylinder',
    x: 0, z: 0, w: M(0.7), d: M(0.7), y0: M(0.6), y1: M(1.7),
  },
];

const overhead: CivicVolume[] = [
  // The main entrance porch, directly under the clock tower: seen from the forecourt, porch,
  // clock face and spire line up on one axis.
  {
    tag: 'portico',
    x: 0, z: M(13.7), w: M(9.0), d: M(2.6), y0: M(4.4), y1: M(4.9),
  },
];

const fixtures: PropSpec[] = [
  // ── Four large trees in the quadrangle, one per patch of grass. ──
  ...([-1, 1] as const).flatMap(sx => ([-5.2, 3.2] as const).map(z => ({
    kind: 'tree' as const,
    x: M(sx * 6.0), z: M(z), heightM: 8.0, crownRadius: M(1.8),
  }))),
  // Low hedges along the paths, separating grass from paving.
  ...([-1, 1] as const).map(sx => ({
    kind: 'hedge' as const,
    x: M(sx * 2.4), z: M(-1.0), axis: 'x' as const,
    length: M(13.0), depth: M(0.5), heightM: 0.8,
  })),
  { kind: 'shrub', x: M(-3.0), z: M(4.6), radius: M(0.7) },
  { kind: 'shrub', x: M(3.0), z: M(4.6), radius: M(0.7) },
  { kind: 'topiary', x: M(-3.0), z: M(-6.6), radius: M(0.7) },
  { kind: 'topiary', x: M(3.0), z: M(-6.6), radius: M(0.7) },
  { kind: 'flowerBed', x: M(-2.6), z: M(2.2), radius: M(0.7) },
  { kind: 'flowerBed', x: M(2.6), z: M(2.2), radius: M(0.7) },

  // ── Street furniture ──
  // The quadrangle's lamps run along the paths: a university at night is that lit axis.
  { kind: 'lamp', x: M(-2.2), z: M(-6.0), heightM: 4.0 },
  { kind: 'lamp', x: M(2.2), z: M(-6.0), heightM: 4.0 },
  { kind: 'lamp', x: M(-2.2), z: M(4.0), heightM: 4.0 },
  { kind: 'lamp', x: M(2.2), z: M(4.0), heightM: 4.0 },
  { kind: 'lamp', x: M(-14.0), z: M(15.0), heightM: 4.5 },
  { kind: 'lamp', x: M(17.0), z: M(15.0), heightM: 4.5 },

  { kind: 'flagpole', x: M(-6.0), z: M(14.0), axis: 'z' },
  { kind: 'signPost', x: M(6.0), z: M(14.0), axis: 'z' },
  { kind: 'bin', x: M(-2.2), z: M(13.8), radius: M(0.26) },
  // A university needs more bike racks.
  ...([-11.0, -10.2, -9.4] as const).map(x => ({
    kind: 'bikeRack' as const, x: M(x), z: M(14.4), axis: 'x' as const,
  })),
  ...([-16.0, -12.0, 12.0, 16.0] as const).map(x => ({
    kind: 'bollard' as const, x: M(x), z: M(13.6), radius: M(0.11),
  })),
];

const vehicles: CivicVehicle[] = [
  // Buses park along the forecourt's kerb, for the same reason as at the two schools.
  { kind: 'bus', x: M(-6.0), z: M(16.4) },
  { kind: 'car', x: M(5.4), z: M(15.6), rotationY: Math.PI / 2 },
  { kind: 'car', x: M(8.2), z: M(15.6), rotationY: Math.PI / 2 },
  { kind: 'van', x: M(11.0), z: M(15.6), rotationY: Math.PI / 2 },
];

/**
 * `aSeed`.
 *
 * `.x` = 0.42 gives 0.2536 cells = 3.04 m per storey; an old university building's floors are
 * taller than a school's. A 14 m north range carries 3.2 storeys of window panes above a 4.11 m
 * lobby.
 */
const SEED = [0.42, 0.29, 0.81] as const;

export const universityPlan: CivicPlan = {
  footprint: { w: 3, h: 3 },
  facade: FACADE_CIVIC,
  color: civicColorOf('school_univ'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
