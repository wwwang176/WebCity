import {
  FACADE_CIVIC, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * Hospital — 2x3 cells = 24 x 36 m.
 *
 * Usable range +/-11.76 m in x and +/-17.76 m in z. Every dimension is declared with
 * `M(metres)`.
 *
 * Recognition features: a main block with two wings and a link, a **rooftop helipad**, and the
 * emergency canopy with its red band. The helipad is the strongest — no other building in the
 * city has one on its roof.
 *
 * ```
 *   z-  ┌──────────────────────┐
 *       │ main block (8 floors, helipad on top) │
 *       └──────────┬───────────┘
 *                 │ link │
 *       ┌─────────┘  └─────────┐
 *       │ wing (outpatient) │ (emergency) │  <- the emergency arm carries the red
 *       └────▔▔──────┴──▔▔▔───┘              band and the glowing cross
 *        main canopy    emergency canopy
 *       ┌──────────────┬───────┐
 *   z+  │ staff parking │ lawn  │
 * ```
 */

const MAIN_TOP = M(24.0);
const MAIN_ROOF = M(24.5);
/** The helipad deck surface. The H marking and the perimeter lights stack above it. */
const PAD_DECK = M(24.62);
const WING_TOP = M(11.0);
const WING_ROOF = M(11.4);

/**
 * The roof deck's brightness.
 *
 * The walls are already medical white (0xe8e8e8); what does not read as white is the **roof**.
 * `PART_ROOF`'s colour comes from the shared per-zone roof palette, and the civic group is dark
 * asphalt (0.26-0.38) — and an isometric view shows more roof than wall, so the whole building
 * reads dark grey.
 *
 * A hospital's roof is pale insulation, so this takes `PART_GROUND` with a high brightness: it
 * is the shader's only horizontal branch where a face's colour is decided by the building
 * itself, and the helipad deck above is drawn that way already.
 */
const ROOF_SHADE = 0.95;

/** The helipad deck's brightness. Dark asphalt, so the H has something to contrast against. */
const PAD_SHADE = 0.18;
/** The H marking's brightness. Its distance from the deck's is the whole of whether it is visible. */
const MARK_SHADE = 1.0;

/** Which side emergency is on. +1 is the right, +x. The wing, the red band, the cross and the ambulance all follow it. */
const ER = 1;
/** Emergency red, deliberately different from fire-service red so the two are distinguishable side by side. */
const ER_RED = [0.85, 0.16, 0.20] as const;

/** The wings' leading edge. The emergency band, the cross and the canopies all stack outward from it. */
const WING_FRONT = M(4.5);

const massing: CivicVolume[] = [
  // ── Main block: x [-11, 11], z [-17, -6.5] ────────────────
  {
    tag: 'main',
    x: 0, z: M(-11.75), w: M(22.0), d: M(10.5), y0: 0, y1: MAIN_TOP,
  },
  {
    tag: 'mainRoof', part: PART_GROUND, shade: ROOF_SHADE,
    x: 0, z: M(-11.75), w: M(22.6), d: M(11.1), y0: MAIN_TOP, y1: MAIN_ROOF,
  },

  // ── Rooftop helipad ───────────────────────────────────────
  // The deck takes `PART_GROUND` plus `shade`, the same shader branch as ground asphalt: on
  // separate paths, concrete on a roof and concrete on the ground would be two colours.
  {
    tag: 'helipad', part: PART_GROUND, shade: PAD_SHADE,
    x: 0, z: M(-11.75), w: M(12.0), d: M(10.0), y0: MAIN_ROOF, y1: PAD_DECK,
  },
  // The H's three strokes: two uprights and a bar, sharing edges.
  {
    tag: 'helipadH', part: PART_GROUND, shade: MARK_SHADE,
    x: M(-2.0), z: M(-11.75), w: M(0.7), d: M(5.0), y0: PAD_DECK, y1: M(24.68),
  },
  {
    tag: 'helipadH', part: PART_GROUND, shade: MARK_SHADE,
    x: M(2.0), z: M(-11.75), w: M(0.7), d: M(5.0), y0: PAD_DECK, y1: M(24.68),
  },
  {
    tag: 'helipadH', part: PART_GROUND, shade: MARK_SHADE,
    x: 0, z: M(-11.75), w: M(3.3), d: M(0.9), y0: PAD_DECK, y1: M(24.68),
  },
  // Six perimeter lights along the edges; in the middle, a helicopter would land on them.
  ...([
    [-5.4, -15.75], [5.4, -15.75], [-5.4, -7.75], [5.4, -7.75],
    [0, -16.4], [0, -7.1],
  ] as const).map(([x, z]): CivicVolume => ({
    tag: 'padLight', part: PART_LAMP,
    x: M(x), z: M(z), w: M(0.4), d: M(0.4), y0: PAD_DECK, y1: M(24.9),
  })),

  // ── Link: z [-6.5, -3], meeting the main block and the wings **exactly** ──
  // A few centimetres short and it is a corridor floating with neither end attached, which is
  // entirely legal in the data table: no overrun, no overlap, no budget exceeded.
  {
    tag: 'corridor',
    x: 0, z: M(-4.75), w: M(4.0), d: M(3.5), y0: 0, y1: M(5.0),
  },
  {
    tag: 'corridorRoof', part: PART_GROUND, shade: ROOF_SHADE,
    x: 0, z: M(-4.75), w: M(4.4), d: M(3.5), y0: M(5.0), y1: M(5.3),
  },

  // ── The two wings: x [-11, -1] and [1, 11], z [-3, 4.5] ───
  ...([-6, 6] as const).map((x): CivicVolume => ({
    tag: 'wing',
    x: M(x), z: M(0.75), w: M(10.0), d: M(7.5), y0: 0, y1: WING_TOP,
  })),
  ...([-6, 6] as const).map((x): CivicVolume => ({
    tag: 'wingRoof', part: PART_GROUND, shade: ROOF_SHADE,
    x: M(x), z: M(0.75), w: M(10.6), d: M(8.1), y0: WING_TOP, y1: WING_ROOF,
  })),

  // ── The emergency red band ────────────────────────────────
  // An emergency entrance cannot be found on a medical-white box. This band says "this way", and
  // it is a **wall**: only the wall branch reads `aBldgColor`, while roof and metal detail do
  // not.
  {
    tag: 'erBand', color: ER_RED,
    x: M(6 * ER), z: WING_FRONT + M(0.175), w: M(10.0), d: M(0.35),
    y0: M(8.6), y1: M(10.6),
  },
  // The glowing cross: a bar and two short uprights sharing edges without overlapping, since an
  // overlap is an invisible interior face.
  {
    tag: 'cross', part: PART_LAMP,
    x: M(6 * ER), z: WING_FRONT + M(0.475), w: M(1.7), d: M(0.25),
    y0: M(9.4), y1: M(9.8),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: M(6 * ER), z: WING_FRONT + M(0.475), w: M(0.5), d: M(0.25),
    y0: M(9.8), y1: M(10.3),
  },
  {
    tag: 'cross', part: PART_LAMP,
    x: M(6 * ER), z: WING_FRONT + M(0.475), w: M(0.5), d: M(0.25),
    y0: M(8.9), y1: M(9.4),
  },

  // ── Plant on the wings' roofs ─────────────────────────────
  ...([-8, -4, 4, 8] as const).map((x): CivicVolume => ({
    tag: 'ac', part: PART_DETAIL,
    x: M(x), z: 0, w: M(2.0), d: M(1.5), y0: WING_ROOF, y1: M(12.2),
  })),
];

/**
 * The ground. Four non-overlapping base areas: emergency forecourt, main forecourt, staff
 * parking, lawn.
 *
 * Emergency and the main entrance are paved separately at different brightnesses: in an
 * isometric view, paving colour is all that is left to say where the ambulances go and where the
 * people go.
 */
const decals: CivicDecal[] = [
  // Emergency forecourt: x [1, 12], z [4.5, 12]
  { x: M(6.5), z: M(8.25), w: M(11.0), d: M(7.5), shade: 0.5 },
  // Main forecourt: x [-12, 1], z [4.5, 12]
  { x: M(-5.5), z: M(8.25), w: M(13.0), d: M(7.5), shade: 0.62 },
  // Staff parking: x [-12, 4], z [12, 18]
  { x: M(-4.0), z: M(15.0), w: M(16.0), d: M(6.0), shade: 0.0 },
  // Lawn: x [4, 12], z [12, 18]
  { x: M(8.0), z: M(15.0), w: M(8.0), d: M(6.0), shade: 0.0, lawn: true },
];

// The two edge lines of the ambulance bay.
for (const side of [-1, 1]) {
  decals.push({
    x: M(6.5) + side * M(2.6), z: M(8.25), w: M(0.15), d: M(7.5),
    shade: 1.0, layer: 'mark',
  });
}
// Staff parking bay separators, 2.8 m apart and 5 m deep: real parking bay dimensions.
for (let i = 0; i < 5; i++) {
  decals.push({
    x: M(-11.0 + i * 2.8), z: M(14.5), w: M(0.15), d: M(5.0),
    shade: 1.0, layer: 'mark',
  });
}

/** Two lights under the emergency canopy. The shared `lamp` is a pole on the ground; these hang beneath the canopy. */
const props: CivicVolume[] = ([-2.6, 2.6] as const).map((dx): CivicVolume => ({
  tag: 'bayLamp', part: PART_LAMP,
  x: M(6 * ER + dx), z: M(6.6), w: M(0.4), d: M(0.4), y0: M(3.9), y1: M(4.2),
}));

const overhead: CivicVolume[] = [
  // The emergency canopy. An ambulance is 3.7 x 1.5 x 1.6 m; unable to cover one, the canopy is
  // only decoration.
  {
    tag: 'erCanopy',
    x: M(6 * ER), z: M(6.4), w: M(8.0), d: M(3.8), y0: M(4.2), y1: M(4.6),
  },
  // The outpatient entrance canopy, smaller than the emergency one: people arrive on foot.
  {
    tag: 'canopy',
    x: M(-6.0), z: M(6.0), w: M(6.0), d: M(3.0), y0: M(3.4), y1: M(3.8),
  },
];

const fixtures: PropSpec[] = [
  // ── Greenery. A hospital's grounds are part of it, not decoration. ──
  { kind: 'tree', x: M(6.4), z: M(14.0), heightM: 6.5, crownRadius: M(1.5) },
  { kind: 'tree', x: M(10.0), z: M(13.2), heightM: 5.4, crownRadius: M(1.2) },
  { kind: 'tree', x: M(8.4), z: M(16.4), heightM: 6.0, crownRadius: M(1.3) },
  // The courtyard between the wings (x in [-1, 1], z in [-3, 4.5]), the view from the link.
  { kind: 'tree', x: 0, z: M(2.4), heightM: 5.0, crownRadius: M(0.9) },
  // Street trees flanking the main forecourt.
  { kind: 'tree', x: M(-11.0), z: M(6.4), heightM: 5.2, crownRadius: M(0.7) },
  { kind: 'tree', x: M(-11.0), z: M(10.4), heightM: 5.2, crownRadius: M(0.7) },

  { kind: 'shrub', x: M(4.6), z: M(12.8), radius: M(0.7) },
  { kind: 'shrub', x: M(4.6), z: M(15.0), radius: M(0.7) },
  { kind: 'shrub', x: M(4.6), z: M(17.0), radius: M(0.7) },
  { kind: 'shrub', x: 0, z: M(-1.0), radius: M(0.8) },

  // Flower beds flanking the main entrance.
  { kind: 'flowerBed', x: M(-9.4), z: M(5.4), radius: M(0.7) },
  { kind: 'flowerBed', x: M(-2.6), z: M(5.4), radius: M(0.7) },
  { kind: 'topiary', x: M(-6.0), z: M(11.0), radius: M(0.8) },

  // ── Street furniture ──
  { kind: 'lamp', x: M(-1.4), z: M(9.6), heightM: 4.5 },
  { kind: 'lamp', x: M(-9.6), z: M(9.6), heightM: 4.5 },
  { kind: 'lamp', x: M(11.0), z: M(9.6), heightM: 4.5 },
  { kind: 'lamp', x: M(-8.0), z: M(16.6), heightM: 4.5 },
  { kind: 'lamp', x: M(1.6), z: M(16.6), heightM: 4.5 },

  { kind: 'flagpole', x: M(-11.2), z: M(6.4), axis: 'z' },
  { kind: 'signPost', x: M(1.2), z: M(6.2), axis: 'z' },
  { kind: 'hydrant', x: M(11.4), z: M(5.2) },
  { kind: 'bin', x: M(-3.6), z: M(6.0), radius: M(0.28) },
  { kind: 'bikeRack', x: M(-8.0), z: M(6.4), axis: 'z' },
  { kind: 'mailbox', x: M(-1.2), z: M(5.6) },
  ...([-9.6, -6.0, -2.4] as const).map((x) => ({
    kind: 'bollard' as const, x: M(x), z: M(11.6), radius: M(0.11),
  })),
];

/**
 * The ambulance parks on the emergency side and the staff cars in the staff bays.
 *
 * With the ambulance on the main entrance side, the red band and the glowing cross are wasted:
 * the player finds emergency by following the vehicle rather than the colour.
 */
const vehicles: CivicVehicle[] = [
  { kind: 'ambulance', x: M(6 * ER - 2.1), z: M(7.4), rotationY: Math.PI / 2 },
  { kind: 'ambulance', x: M(6 * ER + 2.1), z: M(7.4), rotationY: Math.PI / 2 },
  { kind: 'car', x: M(-9.6), z: M(15.0), rotationY: Math.PI / 2 },
  { kind: 'car', x: M(-6.8), z: M(15.0), rotationY: Math.PI / 2 },
  { kind: 'van', x: M(-4.0), z: M(15.0), rotationY: Math.PI / 2 },
];

/**
 * `aSeed`.
 *
 * `.x` = 0.34 gives 0.2472 cells = 2.97 m per storey; a hospital's floors are taller than a
 * house's. A 24 m main block carries 6.7 storeys of window panes above a 4.0 m lobby.
 */
const SEED = [0.34, 0.12, 0.72] as const;

export const hospitalPlan: CivicPlan = {
  footprint: { w: 2, h: 3 },
  facade: FACADE_CIVIC,
  color: civicColorOf('hospital'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
