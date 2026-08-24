import { FACADE_CIVIC, PART_ROOF, PART_DETAIL } from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * High school — 2x3 cells = 24 x 36 m.
 *
 * Recognition features: a three-storey classroom block, a **running track**, and a review stand.
 * The track is the strongest — no other building in the city has a closed loop on the ground.
 *
 * ```
 *   z-  ┌──────────────────────┐
 *       │  classroom block (3 floors) │
 *       └──────────┬───────────┘
 *       │  hall    │ review stand │  forecourt (school buses park here)
 *       ├──────────┴───────────┤
 *       │      ╭──────────╮     │
 *       │      │  field   │     │  grass plus two track lanes
 *   z+  │      ╰──────────╯     │
 * ```
 */

const MAIN_TOP = M(13.6);
const MAIN_ROOF = M(14.0);
const ANNEX_TOP = M(9.0);
const ANNEX_ROOF = M(9.4);
/** The review stand roof's underside. The posts reach it. */
const PODIUM_EAVE = M(3.4);
const PODIUM_DECK = M(1.2);

/** One short straight segment of the track. Chained together they form the loop. */
export interface TrackSegment {
  x: number;
  z: number;
  /** Segment length. */
  w: number;
  /** This segment's direction. `assembleDecals` reads it directly. */
  rotationY: number;
}

/**
 * The outline points of one **rounded rectangle**.
 *
 * Not an ellipse: a real running track is four straights and four bends, not a curve that bends
 * everywhere. The difference is obvious on screen — an ellipse has no straight section at all
 * and reads as an egg.
 *
 * Each straight is cut into `STRAIGHT_SEGS` pieces so their lengths are close to the bends' arc
 * segments. Drawn as one piece, a straight would look a different width from the bends: the same
 * `d` over ten times the length.
 */
function roundedRectOutline(
  cx: number, cz: number, a: number, b: number, r: number,
): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  const ax = a - r;
  const bz = b - r;
  /** The four bends' centres and start angles, in order around the loop. */
  const corners = [
    { x: ax, z: bz, from: 0 },
    { x: -ax, z: bz, from: Math.PI / 2 },
    { x: -ax, z: -bz, from: Math.PI },
    { x: ax, z: -bz, from: (Math.PI * 3) / 2 },
  ];
  for (const c of corners) {
    // The straight before this bend. It starts at the previous bend's exit.
    for (let i = 0; i < STRAIGHT_SEGS; i++) {
      const t = i / STRAIGHT_SEGS;
      const prev = corners[(corners.indexOf(c) + 3) % 4]!;
      const from = {
        x: prev.x + r * Math.cos(prev.from + Math.PI / 2),
        z: prev.z + r * Math.sin(prev.from + Math.PI / 2),
      };
      const to = {
        x: c.x + r * Math.cos(c.from),
        z: c.z + r * Math.sin(c.from),
      };
      pts.push({
        x: cx + from.x + (to.x - from.x) * t,
        z: cz + from.z + (to.z - from.z) * t,
      });
    }
    // The bend's quarter circle.
    for (let i = 0; i < CORNER_SEGS; i++) {
      const t = c.from + (Math.PI / 2) * (i / CORNER_SEGS);
      pts.push({ x: cx + c.x + r * Math.cos(t), z: cz + c.z + r * Math.sin(t) });
    }
  }
  return pts;
}

/**
 * Chains a loop of outline points into short straight segments.
 *
 * Each segment's centre is the **chord's midpoint**, its length is the chord length, and its
 * direction follows the chord, so adjacent segments' endpoints coincide **exactly** (a test
 * checks this segment by segment). Using tangent length instead of chord length makes every
 * segment slightly too long, and around the loop that is a series of small crossings.
 *
 * `rotationY = atan2(-dz, dx)`: `rotateY(theta)` sends local +x to (cos theta, 0, -sin theta),
 * and aligning that with (dx, dz) takes this angle.
 */
function chain(pts: Array<{ x: number; z: number }>): TrackSegment[] {
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    return {
      x: (p.x + q.x) / 2,
      z: (p.z + q.z) / 2,
      w: Math.hypot(dx, dz),
      rotationY: Math.atan2(-dz, dx),
    };
  });
}

/** How many segments one straight is cut into. */
const STRAIGHT_SEGS = 4;
/** How many segments one bend's quarter circle is cut into. */
const CORNER_SEGS = 4;

/**
 * The track: an outer and an inner line. One line reads as an oval painted on the ground; two
 * read as a running track between them.
 *
 * `a` and `b` are the **outer** loop's semi-axes, which tests use to decide what has ended up
 * inside the loop.
 */
export const TRACK = {
  x: 0,
  z: M(8.0),
  /** The outer loop's semi-length, along x. */
  a: M(10.0),
  /** The outer loop's semi-width, along z. */
  b: M(7.6),
  /** Bend radius. Smaller than the semi-width; equal to it, the four bends join into one curve and it is an ellipse again. */
  r: M(4.4),
  /** The distance between the two lines. */
  lane: M(1.2),
  lanes: [
    chain(roundedRectOutline(0, M(8.0), M(10.0), M(7.6), M(4.4))),
    chain(roundedRectOutline(0, M(8.0), M(8.8), M(6.4), M(3.4))),
  ],
};

const massing: CivicVolume[] = [
  // ── Classroom block, three storeys: x [-11, 11], z [-17, -8] ──
  {
    tag: 'main',
    x: 0, z: M(-12.5), w: M(22.0), d: M(9.0), y0: 0, y1: MAIN_TOP,
  },
  {
    tag: 'mainRoof', part: PART_ROOF,
    x: 0, z: M(-12.5), w: M(22.6), d: M(9.6), y0: MAIN_TOP, y1: MAIN_ROOF,
  },

  // ── Hall / gymnasium: low and wide, differing in height from the classroom block. ──
  {
    tag: 'annex',
    x: M(-6.0), z: M(-5.5), w: M(10.0), d: M(5.0), y0: 0, y1: ANNEX_TOP,
  },
  {
    // **No overhang at the rear**: the classroom block's wall sits on that line and an overhang
    // would bury into it. Eaves may only overhang the sides with nothing there, the same trap the
    // fire station's dorm block hit.
    tag: 'annexRoof', part: PART_ROOF,
    x: M(-6.0), z: M(-5.35), w: M(10.6), d: M(5.3), y0: ANNEX_TOP, y1: ANNEX_ROOF,
  },

  // ── The review stand: something to stand on and speak from. Flush with the ground it is only paving. ──
  {
    tag: 'podium',
    x: M(6.0), z: M(-3.2), w: M(6.0), d: M(2.4), y0: 0, y1: PODIUM_DECK,
  },

  // ── Rooftop equipment ─────────────────────────────────────
  ...([-7, 0, 7] as const).map((x): CivicVolume => ({
    tag: 'ac', part: PART_DETAIL,
    x: M(x), z: M(-12.5), w: M(2.0), d: M(1.4), y0: MAIN_ROOF, y1: M(14.8),
  })),
];

const decals: CivicDecal[] = [
  // Forecourt: z [-8, -1]. School buses and staff cars park here.
  { x: 0, z: M(-4.5), w: M(24.0), d: M(7.0), shade: 0.6 },
  // Field: z [-1, 17]
  { x: 0, z: M(8.0), w: M(24.0), d: M(18.0), shade: 0.0, lawn: true },
];

// The two track lines. Each segment is a short rotated marking.
for (const lane of TRACK.lanes) {
  for (const s of lane) {
    decals.push({
      x: s.x, z: s.z, w: s.w, d: M(0.18),
      shade: 1.0, layer: 'mark', rotationY: s.rotationY,
    });
  }
}

/**
 * The review stand's four posts.
 *
 * The roof rests on posts rather than four walls; with four walls it is a room, not a review
 * stand.
 */
const props: CivicVolume[] = ([
  [3.4, -4.0], [8.6, -4.0], [3.4, -2.4], [8.6, -2.4],
] as const).map(([x, z]): CivicVolume => ({
  tag: 'podiumPost', part: PART_DETAIL,
  x: M(x), z: M(z), w: M(0.18), d: M(0.18), y0: PODIUM_DECK, y1: PODIUM_EAVE,
}));

const overhead: CivicVolume[] = [
  {
    tag: 'podiumRoof',
    x: M(6.0), z: M(-3.2), w: M(6.4), d: M(2.8), y0: PODIUM_EAVE, y1: M(3.7),
  },
  // The classroom block's entrance canopy.
  {
    tag: 'canopy',
    x: M(-3.0), z: M(-7.2), w: M(6.0), d: M(2.2), y0: M(3.2), y1: M(3.6),
  },
];

/**
 * Shared low props. **All of them stand outside the track loop**: a tree planted on a running
 * track is the same joke as a tree planted on a fire station's apron. The safe areas are the
 * forecourt (z < -1) and the field's left and right margins (|x| > 10).
 */
const fixtures: PropSpec[] = [
  // ── Forecourt greenery ──
  { kind: 'tree', x: M(-10.6), z: M(-2.4), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(10.6), z: M(-6.6), heightM: 6.0, crownRadius: M(1.0) },
  { kind: 'tree', x: M(1.2), z: M(-2.2), heightM: 5.0, crownRadius: M(0.8) },
  // Street trees flanking the field. x = +/-11 lies outside the outer loop at a = 10 m.
  { kind: 'tree', x: M(-11.0), z: M(4.0), heightM: 5.6, crownRadius: M(0.7) },
  { kind: 'tree', x: M(-11.0), z: M(12.0), heightM: 5.6, crownRadius: M(0.7) },
  { kind: 'tree', x: M(11.0), z: M(4.0), heightM: 5.6, crownRadius: M(0.7) },
  { kind: 'tree', x: M(11.0), z: M(12.0), heightM: 5.6, crownRadius: M(0.7) },

  // **Behind** the bollards, at z = -0.6. At -1.6 it stands inside a parking bay.
  { kind: 'shrub', x: M(-1.4), z: M(-0.6), radius: M(0.6) },
  { kind: 'shrub', x: M(-3.4), z: M(-0.6), radius: M(0.6) },
  { kind: 'hedge', x: 0, z: M(16.9), axis: 'z', length: M(14.0), depth: M(0.6), heightM: 1.1 },

  { kind: 'flowerBed', x: M(-6.6), z: M(-8.6), radius: M(0.6) },
  { kind: 'flowerBed', x: M(0.6), z: M(-8.6), radius: M(0.6) },
  { kind: 'topiary', x: M(-3.0), z: M(-8.6), radius: M(0.6) },

  // ── Street furniture ──
  { kind: 'lamp', x: M(-11.2), z: M(-3.0), heightM: 4.5 },
  { kind: 'lamp', x: M(11.2), z: M(-3.0), heightM: 4.5 },
  { kind: 'lamp', x: M(-11.2), z: M(8.0), heightM: 4.5 },
  { kind: 'lamp', x: M(11.2), z: M(8.0), heightM: 4.5 },
  { kind: 'lamp', x: M(-11.2), z: M(15.6), heightM: 4.5 },
  { kind: 'lamp', x: M(11.2), z: M(15.6), heightM: 4.5 },

  { kind: 'flagpole', x: M(10.4), z: M(-1.8), axis: 'z' },
  { kind: 'signPost', x: M(-9.0), z: M(-1.6), axis: 'z' },
  { kind: 'bin', x: M(2.6), z: M(-1.6), radius: M(0.26) },
  // **Outside** the school building, on the open strip at x > 1, z in [-8, -3]. At (-8, -9.2) it
  // sits inside the classroom block's wall.
  { kind: 'bikeRack', x: M(10.4), z: M(-5.4), axis: 'z' },
  { kind: 'bikeRack', x: M(10.4), z: M(-6.1), axis: 'z' },
  { kind: 'mailbox', x: M(-10.2), z: M(-9.4) },
  ...([-6.0, -2.0, 2.0, 6.0] as const).map((x) => ({
    kind: 'bollard' as const, x: M(x), z: M(-1.4), radius: M(0.11),
  })),
];

/**
 * School buses park along the kerb, for the same reason as at the primary school: a 7.2 m bus
 * parked across enters the building.
 *
 * They use the forecourt's right half (x > -1); the left half is taken by the hall.
 */
const vehicles: CivicVehicle[] = [
  { kind: 'bus', x: M(5.5), z: M(-6.5) },
  // z = -2.25: the bays fit in the 1.6 m between the wing's front wall at z = -3.0 and the
  // bollards at z = -1.4, and a car body is 1.32 m, so this gap holds exactly this one z. At -1.8
  // the whole row straddles the bollards and the shrubs by the entrance.
  { kind: 'car', x: M(-6.0), z: M(-2.25) },
  { kind: 'van', x: M(-2.0), z: M(-2.25) },
];

/**
 * `aSeed`.
 *
 * `.x` = 0.24 gives 0.2392 cells = 2.87 m per storey. A 13.6 m classroom block carries 3.4
 * storeys of window panes above a 3.87 m lobby, reading as three floors plus a roof structure.
 */
const SEED = [0.24, 0.47, 0.58] as const;

export const highSchoolPlan: CivicPlan = {
  footprint: { w: 2, h: 3 },
  facade: FACADE_CIVIC,
  color: civicColorOf('school_high'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
