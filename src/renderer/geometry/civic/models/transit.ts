import {
  FACADE_TRANSIT, PART_ROOF, PART_DETAIL, PART_LAMP, PART_GROUND, PART_SHELL,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { CivicPlan, CivicVolume } from '../types';

/**
 * The four transit stops, all 1x1 cells = 12 x 12 m.
 *
 * Four buildings in one file, unlike the one-per-file batches elsewhere: each is about 30
 * lines, and split apart a reader would open four files to see that they are one set — and
 * they **have** to be read together, sharing `FACADE_TRANSIT`, the same 12 m plot, and the
 * glowing-totem vocabulary.
 *
 * A 1x1 plot leaves only +/-5.76 m of usable range after `CIVIC_INSET`, with decals at
 * +/-6.0 m. It is the tightest scale in the project, so each building is one mass plus one
 * totem; anything more does not fit.
 *
 * Night vocabulary: the **glowing totem** (`PART_LAMP`). Stations are the brightest thing in
 * the city at night, and on a 12 m plot the totem is the only "bright" that fits.
 */

/** Height of the totem's light box in metres. Under 1.5 m; taller reads as a post glowing from the ground to the top. */
const TOTEM_PANEL = 1.0;

/**
 * One glowing totem: a metal post plus a light box.
 *
 * Marking the whole thing as glowing gives a post lit from the ground to the top at night
 * (BUG-230). The light box goes into `massing`, which distant LOD never drops, because it is
 * this building's only identifier; the post goes into `props`.
 */
function totem(x: number, z: number, postTop: number, base = 0) {
  return {
    panel: {
      tag: 'totem', part: PART_LAMP,
      x, z, w: M(0.6), d: M(0.2),
      y0: M(postTop), y1: M(postTop + TOTEM_PANEL),
    } satisfies CivicVolume,
    post: {
      // `base` is the foot height in metres. With both sides of the train station paved as
      // platform there is no ground left on the cell, so a post starting at 0 buries 0.9 m of
      // itself in the platform.
      tag: 'totemPost', part: PART_DETAIL,
      x, z, w: M(0.16), d: M(0.16), y0: M(base), y1: M(postTop),
    } satisfies CivicVolume,
  };
}

// ===== Bus stop =====

const busTotem = totem(M(2.9), M(0.4), 2.0);

/**
 * Bus stop — a shelter.
 *
 * The back panel is a **wall** and takes `FACADE_TRANSIT`'s glass facade rather than a metal
 * detail: a shelter's back panel is glass, which is exactly what that branch draws.
 */
export const busStopPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('bus_stop'),
  seed: [0.3, 0.44, 0.6],
  massing: [
    {
      tag: 'backPanel',
      x: 0, z: M(-2.2), w: M(5.0), d: M(0.25), y0: 0, y1: M(2.6),
    },
    busTotem.panel,
  ],
  decals: [
    // Sidewalk: z [-6, 3]
    { x: 0, z: M(-1.5), w: M(12.0), d: M(9.0), shade: 0.62 },
    // Bus bay: z [3, 6]
    { x: 0, z: M(4.5), w: M(12.0), d: M(3.0), shade: 0.0 },
    // The bay's yellow line.
    { x: 0, z: M(3.3), w: M(11.0), d: M(0.2), shade: 0.9, layer: 'mark' },
  ],
  props: [
    busTotem.post,
    // The shelter's two front posts.
    ...([-2.3, 2.3] as const).map((x): CivicVolume => ({
      tag: 'post', part: PART_DETAIL,
      x: M(x), z: M(-0.1), w: M(0.16), d: M(0.16), y0: 0, y1: M(2.6),
    })),
    {
      tag: 'bench', part: PART_DETAIL,
      x: 0, z: M(-1.9), w: M(3.6), d: M(0.45), y0: M(0.4), y1: M(0.5),
    },
  ],
  overhead: [
    {
      tag: 'shelterRoof',
      x: 0, z: M(-1.15), w: M(5.4), d: M(2.5), y0: M(2.6), y1: M(2.85),
    },
  ],
  fixtures: [
    { kind: 'lamp', x: M(-4.6), z: M(1.4), heightM: 4.5 },
    { kind: 'bin', x: M(-3.4), z: M(-0.4), radius: M(0.26) },
    { kind: 'tree', x: M(-4.4), z: M(-4.4), heightM: 5.5, crownRadius: M(1.0) },
    { kind: 'shrub', x: M(-1.0), z: M(-5.0), radius: M(0.7) },
    { kind: 'shrub', x: M(1.4), z: M(-5.0), radius: M(0.7) },
    { kind: 'bollard', x: M(-4.0), z: M(2.6), radius: M(0.11) },
    { kind: 'bollard', x: M(4.0), z: M(2.6), radius: M(0.11) },
  ],
  // **No parked bus.** The city's buses are real vehicles driven by `VehicleRenderer` and
  // stop here on their routes; a static one at the stop would be a bus permanently parked in
  // front of the real one.
  vehicles: [],
};

// ===== Metro station =====

const metroTotem = totem(M(4.6), M(4.6), 2.2);

/**
 * Metro station — a surface concourse with **stair mouths on all four sides**.
 *
 * It has to read as a concourse you can descend from any direction: a glass concourse standing
 * at the centre of the cell, with a stair mouth reaching out to the sidewalk on each side.
 *
 * ```
 *            ▓ stair mouth
 *        ┌───────────┐
 *      ▓ │ concourse │ ▓
 *        └───────────┘
 *            ▓          ● totem (corner)
 * ```
 *
 * The mouths use `PART_GROUND` with a very low `shade`: a dark opening is the only signal that
 * says "you can go down here". All four face the cell's edges — enclosed in the middle, "four
 * ways down" would be a lie, and someone walking up beside the concourse would find no
 * entrance.
 */

/** Half-width of the concourse mass in metres. The four stair mouths attach from here outward. */
const CONCOURSE_HALF = 2.7;
/** Length of a stair mouth in metres, from the concourse wall out to the sidewalk. */
const MOUTH_LEN = 2.4;
/** Width of a stair mouth in metres. */
const MOUTH_W = 3.0;
/** Distance from the origin to a stair mouth's centre. */
const MOUTH_C = CONCOURSE_HALF + MOUTH_LEN / 2;

/** Unit vectors for the four directions, in the order N / S / E / W. */
const DIRS = [[0, -1], [0, 1], [1, 0], [-1, 0]] as const;

const metroMouths: CivicVolume[] = DIRS.map(([dx, dz]): CivicVolume => ({
  tag: 'stairMouth', part: PART_GROUND, shade: 0.04,
  x: M(dx * MOUTH_C), z: M(dz * MOUTH_C),
  w: M(dx === 0 ? MOUTH_W : MOUTH_LEN),
  d: M(dx === 0 ? MOUTH_LEN : MOUTH_W),
  y0: 0, y1: M(0.1),
}));

/** Railings along both sides of each stair mouth. Without them the four dark patches are stains on the ground. */
const metroRails: CivicVolume[] = DIRS.flatMap(([dx, dz]) =>
  ([-1, 1] as const).map((side): CivicVolume => ({
    tag: 'rail', part: PART_DETAIL,
    x: M(dx * MOUTH_C + (dx === 0 ? side * MOUTH_W / 2 : 0)),
    z: M(dz * MOUTH_C + (dx === 0 ? 0 : side * MOUTH_W / 2)),
    w: M(dx === 0 ? 0.12 : MOUTH_LEN),
    d: M(dx === 0 ? MOUTH_LEN : 0.12),
    y0: 0, y1: M(1.0),
  })));

export const metroStationPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('metro_station'),
  seed: [0.36, 0.68, 0.5],
  massing: [
    {
      // The glass concourse. `FACADE_TRANSIT`'s facade is glass throughout, so it lights
      // itself at night, which is how "something is down there" should look.
      tag: 'concourse',
      x: 0, z: 0, w: M(CONCOURSE_HALF * 2), d: M(CONCOURSE_HALF * 2),
      y0: 0, y1: M(3.4),
    },
    {
      tag: 'concourseRoof', part: PART_ROOF,
      x: 0, z: 0, w: M(6.0), d: M(6.0), y0: M(3.4), y1: M(3.8),
    },
    ...metroMouths,
    metroTotem.panel,
  ],
  decals: [
    // Sidewalk paving across the whole cell. All four sides have to be walkable, so there is
    // no front or back.
    { x: 0, z: 0, w: M(12.0), d: M(12.0), shade: 0.62 },
    // Tactile paving at the outer edge of each stair mouth.
    ...DIRS.map(([dx, dz]) => ({
      x: M(dx * (MOUTH_C + MOUTH_LEN / 2 + 0.3)),
      z: M(dz * (MOUTH_C + MOUTH_LEN / 2 + 0.3)),
      w: M(dx === 0 ? MOUTH_W : 0.4),
      d: M(dx === 0 ? 0.4 : MOUTH_W),
      shade: 0.9, layer: 'mark' as const,
    })),
  ],
  props: [
    metroTotem.post,
    ...metroRails,
  ],
  overhead: [],
  fixtures: [
    // All four stand at the **corners**: the axes carry the stair mouths, and a lamp on one
    // would block it.
    { kind: 'lamp', x: M(4.6), z: M(-4.6), heightM: 4.5 },
    { kind: 'lamp', x: M(-4.6), z: M(4.6), heightM: 4.5 },
    { kind: 'tree', x: M(-4.6), z: M(-4.6), heightM: 5.5, crownRadius: M(1.0) },
    { kind: 'bin', x: M(-3.2), z: M(-4.8), radius: M(0.26) },
    { kind: 'bikeRack', x: M(4.8), z: M(3.2), axis: 'z' },
    { kind: 'shrub', x: M(3.2), z: M(4.9), radius: M(0.6) },
    { kind: 'bollard', x: M(-4.9), z: M(3.2), radius: M(0.11) },
    { kind: 'bollard', x: M(-4.9), z: M(-3.2), radius: M(0.11) },
  ],
  vehicles: [],
};

// ===== Train station =====

/**
 * Train station — **one platform on each side of the track**, with the station hall and the
 * waiting room set diagonally on them.
 *
 * Verified against `canPlaceTransportStop`, `placeTransportStopOnGrid` and `TrackRenderer`: a
 * train station is built **on** the rail, not beside it. Placement requires `railType != 0` on
 * the cell, and writing the building only changes buildingId / reserved / zoneType, leaving
 * the track in the cell untouched. `TrackRenderer` therefore still draws ballast, sleepers and
 * two rails on the same cell, hugging the **cell centre** at `TRACK_WIDTH`.
 *
 * So this model draws no rails of its own, and the hall does not sit on the cell centre: the
 * real rails would come up through its floor.
 *
 * A small real station does not cross the line. The hall stands on the platform, and the
 * platform is the paving beside it plus a canopy; the hall's underside **is** the platform's
 * top surface, so joining them needs no structure at all.
 *
 * A track running through can be boarded from **both sides**, so the far side is a platform
 * too, not a forecourt: a forecourt would be cut off across the rails with no way to reach it,
 * and a footbridge does not fit on 12 m alongside stair towers and railings — it would cut a
 * platform that is only 2.6 m deep in two. The two buildings sit diagonally; mirrored, both
 * sides would read as one drawing pasted twice, while real double-sided platforms are uneven
 * anyway.
 *
 * ```
 *   z-  │ waiting │ ▔▔ canopy ▔▔ │  <- far platform
 *       ├──────────────┤  <- corridor, drawn by TrackRenderer
 *       │ <- the real track ->     │
 *       ├──────────────┤
 *   z+  │ ▔▔ canopy ▔▔ │ hall │  <- main platform (catenary masts on this side)
 * ```
 *
 * With both sides paved as platform the cell has **no ground left**, so `fixtures` is empty:
 * ground props stand at y = 0 and would be half-buried in the platform. Everything on the
 * platform — benches, bins, timetable, totem — goes through `props`, starting at the platform
 * surface.
 *
 * The corridor runs in one direction only: a cross on a 12 m cell leaves 4 m in each corner
 * and the hall no longer fits. The player rotates the station to match the track, as with
 * every other directional building.
 */

/** Half-width of the track corridor in metres. `TrackRenderer.TRACK_WIDTH` is 0.15 cells = 1.8 m. */
const CORRIDOR_HALF = 1.8;
/** The totem, at the east end of the far platform and clear of the canopy; underneath it would pierce the roof. */
const trainTotem = totem(M(5.2), M(-3.9), 3.1, 0.9);
/** Platform centre and depth in metres, from the corridor's south edge to the plot boundary. */
const PLATFORM_Z = 3.75;
const PLATFORM_D = 3.9;
/** The platform surface. The hall starts from this height. */
const PLATFORM_TOP = 0.9;
/** The hall's eave height, absolute and including the platform. */
const HALL_EAVE = 4.5;
/** The hall takes the platform's east end, x [0.3, 5.4]. */
const HALL_X = 2.85;
const HALL_W = 5.1;
/** The hall's centre and depth. The whole building stays within the platform, or one corner hangs in the air. */
const HALL_Z = 3.9;
const HALL_D = 2.6;
/** The waiting room opposite: lower than the hall and at the other end, so the diagonal reads as primary and secondary. */
const SHELTER_X = -2.8;
const SHELTER_W = 4.8;
const SHELTER_EAVE = 3.5;
/** Catenary masts, along the main platform's edge and clear of the corridor. */
const MAST_X = [-4.4, -0.8, 2.8] as const;
const MAST_Z = 2.0;
/**
 * Contact wire height in metres.
 *
 * Taken from `TRACK_CLEARANCE`, the structure gauge for an electrified line: a carriage of
 * about 4 m plus room for the pantograph and the wire. Below it a train would hit the wire,
 * which is what the corridor acceptance test guards.
 */
const WIRE_Y = 5.5;
/** The contact wire's black. It uses `PART_SHELL`, the only branch that draws a mass in its own colour. */
const WIRE = [0.05, 0.05, 0.06] as const;

export const trainStationPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('train_station'),
  seed: [0.44, 0.15, 0.66],
  massing: [
    // The platform, running from the corridor's south edge to the plot boundary, along the
    // track.
    {
      // The brightness has to separate from the forecourt paving (0.5). Equally dark, the
      // platform is just a same-coloured square on the ground in an isometric view and the
      // 0.9 m rise is invisible.
      tag: 'platform', part: PART_GROUND, shade: 0.78,
      x: 0, z: M(PLATFORM_Z), w: M(11.2), d: M(PLATFORM_D),
      y0: 0, y1: M(PLATFORM_TOP),
    },
    {
      // The hall, sitting on the platform surface; starting at 0 would bury its lower half in
      // the platform. Heights: eaves 4.5 m, ridge 5.9 m. Any taller on a 12 m plot reads as a
      // tower, and the bus stop next door is only 2.9 m.
      tag: 'hall',
      x: M(HALL_X), z: M(HALL_Z), w: M(HALL_W), d: M(HALL_D),
      y0: M(PLATFORM_TOP), y1: M(HALL_EAVE),
    },
    {
      // The gable overhangs at the **two ends** only (w 5.6 > 5.1), flush with the hall in z:
      // overhanging toward the platform would press the eaves onto the canopy, and toward the
      // forecourt would cross the plot boundary.
      tag: 'hallRoof', part: PART_ROOF, shape: 'gable',
      x: M(HALL_X), z: M(HALL_Z), w: M(5.6), d: M(HALL_D),
      y0: M(HALL_EAVE), y1: M(5.9),
    },
    // The entrance porch, projecting from the hall face turned away from the platform. That
    // side faces the cell's edge, which is where the road connects.
    {
      tag: 'portal',
      x: M(HALL_X), z: M(5.43), w: M(2.4), d: M(0.46),
      y0: M(PLATFORM_TOP), y1: M(HALL_EAVE),
    },
    // The clock, on the face **toward the platform**: with the hall on the platform that is
    // its front, seen both by people waiting and by an arriving train. It glows at night.
    {
      tag: 'clock', part: PART_LAMP,
      x: M(HALL_X), z: M(2.47), w: M(1.2), d: M(0.14), y0: M(2.9), y1: M(3.9),
    },
    // The far platform, the same height and length as the main one; uneven, the pair reads as
    // a step.
    {
      tag: 'sidePlatform', part: PART_GROUND, shade: 0.72,
      x: 0, z: M(-PLATFORM_Z), w: M(11.2), d: M(PLATFORM_D),
      y0: 0, y1: M(PLATFORM_TOP),
    },
    {
      // The waiting room: 1 m lower, 0.3 m shorter, and at the other end. Equal in size and
      // aligned, the two sides would be one drawing pasted twice.
      tag: 'shelter',
      x: M(SHELTER_X), z: M(-3.9), w: M(SHELTER_W), d: M(2.4),
      y0: M(PLATFORM_TOP), y1: M(SHELTER_EAVE),
    },
    {
      tag: 'shelterRoof', part: PART_ROOF, shape: 'gable',
      x: M(SHELTER_X), z: M(-3.9), w: M(5.3), d: M(2.4),
      y0: M(SHELTER_EAVE), y1: M(4.4),
    },
    trainTotem.panel,
  ],
  decals: [
    // The strip under the far platform: z [-6, -1.8]
    { x: 0, z: M(-3.9), w: M(12.0), d: M(4.2), shade: 0.62 },
    // The track corridor: z [-1.8, 1.8], in ballast colour. The real ballast is only 1.8 m
    // wide; the band on either side is its right of way.
    { tag: 'corridor', x: 0, z: 0, w: M(12.0), d: M(CORRIDOR_HALF * 2), shade: 0.24 },
    // Platform side: z [1.8, 6]
    { x: 0, z: M(3.9), w: M(12.0), d: M(4.2), shade: 0.5 },
    // The platform's yellow edge line cannot go here: the marking layer hugs the **ground**
    // while the platform is 0.9 m up, so it would land on the ballast at the platform's foot.
    // It is a thin band on the platform surface instead (see props).
  ],
  props: [
    trainTotem.post,
    // The platform's warning strip, laid on the platform surface rather than the marking
    // layer, which hugs the ground.
    {
      tag: 'platformEdge', part: PART_GROUND, shade: 0.95,
      x: 0, z: M(2.3), w: M(11.2), d: M(0.35),
      y0: M(PLATFORM_TOP), y1: M(PLATFORM_TOP + 0.02),
    },
    {
      tag: 'platformEdge', part: PART_GROUND, shade: 0.95,
      x: 0, z: M(-2.3), w: M(11.2), d: M(0.35),
      y0: M(PLATFORM_TOP), y1: M(PLATFORM_TOP + 0.02),
    },
    // Four posts per canopy, each standing on its own platform. **No rails** — those belong
    // to `TrackRenderer`.
    ...([-5.0, -0.6] as const).flatMap((x): CivicVolume[] =>
      ([3.2, 4.9] as const).map((z): CivicVolume => ({
        tag: 'canopyPost', part: PART_DETAIL,
        x: M(x), z: M(z), w: M(0.18), d: M(0.18),
        y0: M(PLATFORM_TOP), y1: M(3.0),
      }))),
    ...([0.0, 4.0] as const).flatMap((x): CivicVolume[] =>
      ([-3.2, -4.9] as const).map((z): CivicVolume => ({
        tag: 'canopyPost', part: PART_DETAIL,
        x: M(x), z: M(z), w: M(0.18), d: M(0.18),
        y0: M(PLATFORM_TOP), y1: M(3.0),
      }))),

    // ── Catenary ──────────────────────────────────────────────
    // With the hall and both platforms set back to the sides of the track, nothing on the cell
    // says "the track runs through here", and the real rails are at the cell centre, drawn by
    // `TrackRenderer`. The catenary supplies that: masts along the platform edge, cantilevers
    // reaching over the track, and a contact wire running the full cell along the rails.
    //
    // It is also the only thing here that takes the `above` branch of the corridor acceptance
    // test. The corridor is a **clearance envelope**, not a no-build zone, and
    // `TRACK_CLEARANCE` is the structure gauge for an electrified line: the wire sits at that
    // height and trains pass beneath it.
    ...MAST_X.flatMap((x): CivicVolume[] => [
      {
        tag: 'catenaryMast', part: PART_DETAIL,
        x: M(x), z: M(MAST_Z), w: M(0.22), d: M(0.22),
        y0: M(PLATFORM_TOP), y1: M(6.7),
      },
      {
        // The cantilever, reaching from the mast to directly above the track; any shorter and
        // the contact wire hangs from nothing.
        tag: 'cantilever', part: PART_DETAIL,
        x: M(x), z: M((MAST_Z - 0.2) / 2), w: M(0.18), d: M(MAST_Z + 0.2),
        y0: M(WIRE_Y), y1: M(WIRE_Y + 0.2),
      },
    ]),
    {
      tag: 'contactWire', part: PART_SHELL, color: WIRE,
      x: 0, z: 0, w: M(11.2), d: M(0.09), y0: M(WIRE_Y), y1: M(WIRE_Y + 0.09),
    },

    // ── Things on the platform ────────────────────────────────
    // Bare paving under a canopy reads as an arcade. Benches, bins and a timetable are the
    // signal that people wait here, and that is the difference between a platform and a
    // sidewalk.
    //
    // All through `props` rather than `fixtures`: ground props stand at y = 0 and would be
    // half-buried at platform height.
    ...([-3.8, -1.8] as const).map((x): CivicVolume => ({
      tag: 'bench', part: PART_DETAIL,
      x: M(x), z: M(4.7), w: M(1.6), d: M(0.5),
      y0: M(PLATFORM_TOP), y1: M(1.35),
    })),
    {
      tag: 'bench', part: PART_DETAIL,
      x: M(2.4), z: M(-4.6), w: M(1.6), d: M(0.5),
      y0: M(PLATFORM_TOP), y1: M(1.35),
    },
    {
      tag: 'platformBin', part: PART_DETAIL,
      x: M(-2.8), z: M(4.7), w: M(0.5), d: M(0.5),
      y0: M(PLATFORM_TOP), y1: M(1.6),
    },
    {
      // The timetable, on the hall's platform-facing side, beside the clock.
      tag: 'timetable', part: PART_DETAIL,
      x: M(1.2), z: M(2.52), w: M(1.2), d: M(0.12), y0: M(1.9), y1: M(3.0),
    },

    // The signal at the end of the platform: the shortest way to say "this is a railway", and
    // at night the point of red at the platform's far end.
    {
      tag: 'signalMast', part: PART_DETAIL,
      x: M(5.2), z: M(2.2), w: M(0.18), d: M(0.18),
      y0: M(PLATFORM_TOP), y1: M(4.6),
    },
    {
      tag: 'signalHead', part: PART_LAMP,
      x: M(5.2), z: M(2.05), w: M(0.3), d: M(0.24), y0: M(3.6), y1: M(4.3),
    },
  ],
  overhead: [
    {
      // The platform canopy, from the platform's west end to the hall's wall. In an isometric
      // view this is all "platform" amounts to; covering only a short stretch leaves bare
      // paving that reads as a plaza.
      //
      // Set back to 2.8 in z: the platform edge is left to the catenary masts, and a mast
      // through the canopy leaves neither readable. Real platform canopies do not reach the
      // edge either.
      tag: 'platformCanopy',
      x: M(-2.6), z: M(4.05), w: M(6.0), d: M(2.5), y0: M(3.0), y1: M(3.3),
    },
    {
      // The far canopy, from the waiting room's wall up to but not over the totem, which would
      // otherwise pierce the roof.
      tag: 'sideCanopy',
      x: M(2.1), z: M(-4.05), w: M(5.0), d: M(2.5), y0: M(3.0), y1: M(3.3),
    },
  ],
  // **No ground props at all.** With both sides paved as platform there is no ground left on
  // this cell, and `fixtures` stand at y = 0 and would be half-buried. Everything on the
  // platform — benches, bins, timetable, totem — is in `props`, starting at the platform
  // surface.
  fixtures: [],
  vehicles: [],
};

// ===== Ferry terminal =====

const ferryTotem = totem(M(-4.9), M(-0.8), 2.2);

/**
 * Ferry terminal — waiting hall at the back, a full quay deck in front, and the berth left
 * **empty**.
 *
 * **There is no water on this cell.** Verified: `Game.placeTransportStop` checks
 * `isShorePosition`, whose definition is "**this cell is land**, and one of its four
 * neighbours is water". Drawing a basin into the plot would contradict that, the same rule the
 * water plant follows: something built on land does not draw its own water.
 *
 * **And no boat sits at the berth.** Same reason as the bus stop: the city's ferries are real
 * vessels driven by `FerryAnimator` and berth here on their routes, so a static one would
 * occupy the berth permanently in front of the real one. The water is on the neighbouring cell
 * anyway, so a static boat could only sit on the paving at the plot's front edge and would
 * read as run aground.
 *
 * The largest area on the cell is therefore the empty deck, and the layout makes **the deck
 * the subject**: it takes the whole south half, with a waiting canopy over it and a row of
 * bollards and a gangway along its front edge.
 *
 * ```
 *   z-  ┌──────────────┐
 *       │ waiting hall  │
 *       ├──────────────┤
 *       │   forecourt   │
 *       │ ▁▁▁▁▁▁▁▁▁▁▁▁ │
 *       │ ▏ deck under canopy ▕│  ● navigation light
 *   z+  │ ▔▔ ⌷ ⌷ ⌷ ▔▔▔ │  <- bollards; the plot's front edge is the
 *       └──────┴gangway┴──┘     shoreline, and the next cell is water
 * ```
 */

/** Quay deck surface height in metres. Canopy posts, bollards and the gangway all attach at this height. */
const QUAY_TOP = 0.7;
/** Deck centre and depth in metres. z [0.8, 5.2]; the plot's front edge is 5.76. */
const QUAY_Z = 3.0;
const QUAY_D = 4.4;
/** The canopy's underside. Posts run from the deck surface up to here. */
const CANOPY_Y = 3.0;

export const ferryDockPlan: CivicPlan = {
  footprint: { w: 1, h: 1 },
  facade: FACADE_TRANSIT,
  color: civicColorOf('ferry_dock'),
  seed: [0.4, 0.55, 0.72],
  massing: [
    {
      tag: 'terminal',
      x: 0, z: M(-3.9), w: M(8.6), d: M(3.0), y0: 0, y1: M(4.4),
    },
    {
      tag: 'terminalRoof', part: PART_ROOF,
      x: 0, z: M(-3.9), w: M(9.2), d: M(3.3), y0: M(4.4), y1: M(4.8),
    },
    // The quay deck: raised paving. Marked as wall, a 0.7 m platform would grow windows. It is
    // the subject of this cell, so it is 4.4 m deep rather than 1.8 m — a deck people can stand
    // on, not a deck-shaped edge.
    {
      tag: 'quay', part: PART_GROUND, shade: 0.48,
      x: 0, z: M(QUAY_Z), w: M(11.2), d: M(QUAY_D), y0: 0, y1: M(QUAY_TOP),
    },
    // The navigation light: the quay's only point of light at night, at the deck's east end
    // and clear of the canopy.
    {
      tag: 'navLight', part: PART_LAMP,
      x: M(5.0), z: M(4.4), w: M(0.5), d: M(0.5), y0: M(3.4), y1: M(3.9),
    },
    ferryTotem.panel,
  ],
  decals: [
    // The waiting hall strip: z [-6, -2.2]
    { x: 0, z: M(-4.1), w: M(12.0), d: M(3.8), shade: 0.62 },
    // Forecourt and quay: z [-2.2, 6], hard paving throughout — the whole cell is land.
    { tag: 'apron', x: 0, z: M(1.9), w: M(12.0), d: M(8.2), shade: 0.5 },
    // The yellow line at the deck's front edge. The shoreline is here.
    { x: 0, z: M(4.9), w: M(11.0), d: M(0.2), shade: 0.95, layer: 'mark' },
    // The boarding line, from the forecourt to the gangway. On an empty deck this line is all
    // that says "board this way".
    { x: M(-2.4), z: M(2.6), w: M(0.2), d: M(3.4), shade: 0.9, layer: 'mark' },
  ],
  props: [
    ferryTotem.post,
    // The navigation light's mast.
    {
      tag: 'mast', part: PART_DETAIL,
      x: M(5.0), z: M(4.4), w: M(0.2), d: M(0.2), y0: M(QUAY_TOP), y1: M(3.4),
    },
    // The waiting canopy's four posts, standing on the deck and reaching the canopy, the same
    // approach as the train station's platform.
    ...([-4.0, 4.0] as const).flatMap((x): CivicVolume[] =>
      ([1.8, 4.4] as const).map((z): CivicVolume => ({
        tag: 'canopyPost', part: PART_DETAIL,
        x: M(x), z: M(z), w: M(0.18), d: M(0.18),
        y0: M(QUAY_TOP), y1: M(CANOPY_Y),
      }))),
    // The gangway, reaching past the shoreline from the deck's front edge. It is all that says
    // "board here".
    {
      tag: 'gangway', part: PART_DETAIL,
      x: M(-2.4), z: M(5.1), w: M(1.8), d: M(1.2),
      y0: M(QUAY_TOP - 0.25), y1: M(QUAY_TOP - 0.05),
    },
    // Bollards. With no boat at the berth they carry more weight: on an empty deck they are
    // the only thing saying a vessel comes alongside this edge, so they run as a row rather
    // than a pair.
    ...([-3.6, -0.4, 2.8] as const).map((x): CivicVolume => ({
      tag: 'mooring', part: PART_DETAIL, shape: 'cylinder',
      x: M(x), z: M(4.7), w: M(0.44), d: M(0.44),
      y0: M(QUAY_TOP), y1: M(QUAY_TOP + 0.6),
    })),
  ],
  overhead: [
    // The berth's waiting canopy, holding up the largest empty area on the cell.
    {
      tag: 'berthCanopy',
      x: 0, z: M(3.1), w: M(9.0), d: M(3.4), y0: M(CANOPY_Y), y1: M(3.3),
    },
  ],
  fixtures: [
    { kind: 'lamp', x: M(-5.0), z: M(-1.0), heightM: 4.0 },
    { kind: 'bin', x: M(3.6), z: M(-1.2), radius: M(0.26) },
    { kind: 'signPost', x: M(-2.6), z: M(-1.2), axis: 'z' },
    { kind: 'bikeRack', x: M(4.9), z: M(-3.4), axis: 'x' },
    { kind: 'tree', x: M(-5.0), z: M(-5.0), heightM: 5.0, crownRadius: M(0.6) },
    { kind: 'tree', x: M(5.0), z: M(-5.0), heightM: 5.0, crownRadius: M(0.6) },
    { kind: 'bollard', x: M(-1.2), z: M(-1.6), radius: M(0.11) },
    { kind: 'bollard', x: M(1.2), z: M(-1.6), radius: M(0.11) },
  ],
  vehicles: [],
};
