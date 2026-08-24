import {
  FACADE_UTILITY, PART_ROOF, PART_DETAIL, PART_LAMP, PART_GROUND,
} from '../../buildings/parts';
import { M } from '../../buildings/massing/metrics';
import { civicColorOf } from '../colors';
import type { PropSpec } from '../../props';
import type { CivicPlan, CivicVolume, CivicDecal, CivicVehicle } from '../types';

/**
 * Landfill — 2x2 cells = 24 x 24 m.
 *
 * Recognition features: **two earth mounds**, a tipping shed, a weighbridge, and the refuse
 * trucks on site. The mounds are the strongest — no other building in the city carries a sloped
 * mass with no roof.
 *
 * The mounds take `PART_GROUND` plus `shade`: they are **earth cover**, not walls. Tagged as
 * walls, the facade paints a high window band across the heap.
 */

const SHED_TOP = M(10.0);
const SHED_ROOF = M(11.6);
/** The earth cover's brightness: a dark earth tone, distinguishable from the concrete beside it. */
const EARTH_SHADE = 0.32;

const massing: CivicVolume[] = [
  // ── Tipping shed: x [-11, 2], z [-11, -1] ─────────────────
  {
    tag: 'shed',
    x: M(-4.5), z: M(-6.0), w: M(13.0), d: M(10.0), y0: 0, y1: SHED_TOP,
  },
  {
    // A shed roof. Trucks drive in from the tall end.
    tag: 'shedRoof', part: PART_ROOF, shape: 'shed', facing: 0,
    x: M(-4.5), z: M(-6.0), w: M(13.6), d: M(10.6), y0: SHED_TOP, y1: SHED_ROOF,
  },

  // ── Two earth mounds. `hip` tapers to a ridge on all four sides, which on a roofless mass is a
  // mound. ──
  // One large and one small: equal in size they read as two identical blocks.
  {
    tag: 'mound', part: PART_GROUND, shade: EARTH_SHADE, shape: 'hip',
    x: M(6.6), z: M(-6.4), w: M(9.0), d: M(9.0), y0: 0, y1: M(6.4),
  },
  {
    tag: 'mound', part: PART_GROUND, shade: EARTH_SHADE, shape: 'hip',
    x: M(6.6), z: M(3.4), w: M(9.0), d: M(9.0), y0: 0, y1: M(4.4),
  },

  // ── The weigh hut: small, against the entrance. ───────────
  {
    tag: 'weighHut',
    x: M(-9.0), z: M(6.0), w: M(3.0), d: M(3.0), y0: 0, y1: M(3.2),
  },
  {
    tag: 'weighHutRoof', part: PART_ROOF,
    x: M(-9.0), z: M(6.0), w: M(3.4), d: M(3.4), y0: M(3.2), y1: M(3.5),
  },
  {
    // The weighbridge's signal light. At night it and the high masts are all the site has.
    tag: 'beacon', part: PART_LAMP,
    x: M(-9.0), z: M(6.0), w: M(0.5), d: M(0.5), y0: M(3.5), y1: M(3.9),
  },
];

const decals: CivicDecal[] = [
  // Concrete under the tipping shed.
  { x: M(-5.5), z: M(-6.5), w: M(13.0), d: M(11.0), shade: 0.55 },
  // Site asphalt: z [-1, 12]
  { x: 0, z: M(5.5), w: M(24.0), d: M(13.0), shade: 0.0 },
  // Gravel on the mound side.
  { x: M(6.5), z: M(-6.5), w: M(11.0), d: M(11.0), shade: 0.28 },
];

// The weighbridge platform's markings.
decals.push({ x: M(-5.4), z: M(6.0), w: M(4.0), d: M(3.6), shade: 0.9, layer: 'mark' });

const props: CivicVolume[] = [
  // The weighbridge platform: a metal deck, slightly above the ground.
  {
    tag: 'weighbridge', part: PART_DETAIL,
    x: M(-5.4), z: M(6.0), w: M(4.0), d: M(3.6), y0: 0, y1: M(0.22),
  },
  // Two large hoppers.
  ...([-9.0, -5.4] as const).map((x): CivicVolume => ({
    tag: 'hopper', part: PART_DETAIL,
    x: M(x), z: M(10.0), w: M(3.0), d: M(2.4), y0: 0, y1: M(2.4),
  })),
];

const overhead: CivicVolume[] = [
  // The weighbridge canopy: the driver winds the window down under it.
  {
    tag: 'canopy',
    x: M(-7.2), z: M(6.0), w: M(2.2), d: M(4.4), y0: M(4.0), y1: M(4.4),
  },
];

const fixtures: PropSpec[] = [
  { kind: 'fence', x: 0, z: M(-11.4), axis: 'z', length: M(22.0) },
  { kind: 'fence', x: M(-11.4), z: M(-4.0), axis: 'x', length: M(14.0) },
  { kind: 'fence', x: M(11.4), z: 0, axis: 'x', length: M(22.0) },

  { kind: 'drum', x: M(-1.4), z: M(9.8), radius: M(0.42) },
  { kind: 'drum', x: M(-0.4), z: M(9.8), radius: M(0.42) },
  { kind: 'drum', x: M(-0.9), z: M(10.8), radius: M(0.42) },
  { kind: 'palletStack', x: M(2.0), z: M(10.2), axis: 'z', depth: M(1.0) },
  { kind: 'palletStack', x: M(3.6), z: M(10.2), axis: 'z', depth: M(1.0) },
  // Outside the tipping shed, whose leading edge is at z = -1. At z = -2.4 it spans the inside of
  // the shed.
  { kind: 'pipeRack', x: M(1.4), z: M(-0.2), axis: 'z', span: M(3.4) },

  { kind: 'lamp', x: M(-10.8), z: M(1.0), heightM: 6.0 },
  { kind: 'lamp', x: M(-1.0), z: M(1.0), heightM: 6.0 },
  { kind: 'lamp', x: M(10.8), z: M(9.6), heightM: 6.0 },

  // The screening belt. A landfill needs screening most, and needs most to show that someone
  // manages it.
  { kind: 'hedge', x: M(4.0), z: M(11.4), axis: 'z', length: M(12.0), depth: M(0.6), heightM: 1.4 },
  { kind: 'tree', x: M(-6.4), z: M(-10.4), heightM: 6.5, crownRadius: M(1.0) },
  { kind: 'tree', x: M(-2.0), z: M(-10.4), heightM: 6.5, crownRadius: M(1.0) },
  { kind: 'shrub', x: M(9.0), z: M(10.6), radius: M(0.8) },

  // On the same line as the two bollards, x = -3.2. At -2.4 it stands in the lane the refuse
  // trucks park along.
  { kind: 'signPost', x: M(-3.2), z: M(3.0), axis: 'z' },
  { kind: 'hydrant', x: M(-10.8), z: M(9.8) },
  { kind: 'bollard', x: M(-3.2), z: M(4.0), radius: M(0.12) },
  { kind: 'bollard', x: M(-3.2), z: M(8.0), radius: M(0.12) },
];

/**
 * The refuse trucks on site: this building's most direct recognition signal, and where they
 * belong anyway.
 *
 * Parked across at x = 1.4 with a 6.7 m body along x, their right half is buried inside the
 * second mound, which starts at x >= 2.1.
 *
 * They park **lengthwise** (`rotationY = pi/2`) along the 5 m passage between the tipping shed
 * and the mounds: the only orientation on site that holds a 6.7 m body.
 */
const vehicles: CivicVehicle[] = [
  { kind: 'garbageTruck', x: M(-1.6), z: M(4.2), rotationY: Math.PI / 2 },
  { kind: 'garbageTruck', x: M(0.6), z: M(4.2), rotationY: Math.PI / 2 },
  { kind: 'truck', x: M(-6.0), z: M(1.4) },
];

const SEED = [0.7, 0.36, 0.62] as const;

export const garbagePlan: CivicPlan = {
  footprint: { w: 2, h: 2 },
  facade: FACADE_UTILITY,
  color: civicColorOf('garbage'),
  seed: SEED,
  massing,
  decals,
  props,
  overhead,
  fixtures,
  vehicles,
};
