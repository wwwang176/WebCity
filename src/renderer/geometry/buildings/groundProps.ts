import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import { TRIANGLE_BUDGET, heightKey, type Density, type GeoBuilder } from './registry';
import { lowPropBand, type Band } from './propBands';
import { SIDE_AXIS, type Side } from './decals';
import { PART_FOLIAGE, PART_DETAIL } from './parts';
import {
  columnarTree as plantColumnarTree, shrubBall as plantShrubBall,
  topiary as plantTopiary, flowerBed as plantFlowerBed,
} from '../plants';
import {
  strip as propStrip, mailbox as propMailbox, bin as propBin,
  bollard as propBollard, fencePost as propFencePost, fenceRail as propFenceRail,
  bikeRack as propBikeRack, lamp as propLamp,
  dryingPost as propDryingPost, dryingLine as propDryingLine,
  signPost as propSignPost, drum as propDrum, pipeRack as propPipeRack,
  gasBottles as propGasBottles, palletStack as propPalletStack,
  hydrant as propHydrant, flagpole as propFlagpole,
} from '../props';

/**
 * The low-prop layer: things standing on the ground that pedestrians would walk into.
 *
 * It exists because of BUG-219. Level scaling multiplies `makeScale(w, h, d)` over the whole
 * merged geometry, so upgrading low-density residential from L1 to L3 stretches the yard's tree
 * by 1.75x, from 1.44 to 2.52 m. A tree does not grow because the house gained a storey. Split
 * out, this layer takes rotation and position only, with neither height nor footprint scaling
 * applied, so a tree is the same real size at every level.
 *
 * Geometry here is always written at **real size** (1 cell = 12 m), never as a proportion
 * awaiting a scale.
 *
 * Band widths vary widely: low-density residential has 1.45 m, enough for a tree, while other
 * zones have 0.4 m, enough only for bollards, bins and bike racks. So every piece takes a `Band`
 * and decides for itself whether it fits.
 */

export const PROP_TRIANGLE_BUDGET = TRIANGLE_BUDGET.PROP;

/** Metres to cells. */
const M = (metres: number) => metres / METRES_PER_CELL;

export type YardRing = Band;

/**
 * The ring a building leaves free: an alias for the low-prop band.
 *
 * The derivation itself lives in `propBands`, where decals, low props and overhangs share one
 * inner edge — the building's outer edge at its widest jitter — and differ only in outer edge.
 * Kept here it would be a second derivation, free to drift.
 */
export function yardRing(
  zoneType: number, density: Density, level: number,
): YardRing | null {
  return lowPropBand(zoneType, density, level);
}

export function hasGroundProps(zoneType: number, density: Density, level: number): boolean {
  return getGroundPropVariants(zoneType, density, level).length > 0;
}

// ===== Placement helpers =====

/** The band's centre line. A point object goes here, leaving half the clearance on each side. */
const mid = (b: Band) => (b.inner + b.outer) / 2;

/** The band's half-width: the radius limit for any point object. */
const halfBand = (b: Band) => (b.outer - b.inner) / 2;

/** Takes the smaller of `wanted` and what the band can hold, so one piece works in wide and narrow bands alike. */
function fit(b: Band, wantedM: number, ratio = 0.9): number {
  return Math.min(M(wantedM), halfBand(b) * ratio);
}

type Axis = 'x' | 'z';
type Sign = 1 | -1;

/** Converts (position along the edge t, distance from centre d) into x/z. */
function place(axis: Axis, sign: Sign, t: number, d: number): [number, number] {
  return axis === 'z' ? [t, sign * d] : [sign * d, t];
}

// ===== Pieces =====

/** The band's usable depth: 20% clearance, so objects do not sit flush against either edge. */
const bandDepth = (b: Band) => (b.outer - b.inner) * 0.8;

/** A continuous strip along one edge: hedge, planter, low wall. */
function strip(
  b: Band, axis: Axis, sign: Sign, lengthFrac: number, heightM: number, part: number,
): THREE.BufferGeometry {
  const [x, z] = place(axis, sign, 0, mid(b));
  return propStrip(x, z, axis, b.outer * 2 * lengthFrac, bandDepth(b), heightM, part);
}

/** A hedge. */
const hedge = (b: Band, axis: Axis, sign: Sign, lengthFrac: number, heightM: number) =>
  strip(b, axis, sign, lengthFrac, heightM, PART_FOLIAGE);

/** A stone planter or low wall. Tagged PART_DETAIL for the metal-grey branch, so it grows no windows and does not turn green. */
const planter = (b: Band, axis: Axis, sign: Sign, lengthFrac: number) =>
  strip(b, axis, sign, lengthFrac, 0.4, PART_DETAIL);

/**
 * A columnar tree, cypress-shaped.
 *
 * The yard band is 1.45 m at its widest and a round crown does not fit; a columnar crown is
 * narrow and grows upward, the only choice at this size that still reads as a tree.
 *
 * The tree itself lives in `geometry/plants`, shared with civic buildings' greenery. This only
 * converts a position on the band into coordinates and a radius, because the band is a concept
 * that exists **on the zoned side only** — civic buildings occupy 2x2 to 9x6 cells and have no
 * ring.
 */
function columnarTree(
  b: Band, axis: Axis, sign: Sign, t: number, heightM: number,
): THREE.BufferGeometry[] {
  const [x, z] = place(axis, sign, t, mid(b));
  return plantColumnarTree(x, z, heightM, fit(b, 0.7));
}

/**
 * A tree planted on one named side.
 *
 * It takes an **edge name** rather than an axis and a sign: a tree stands on grass, and which
 * edges are grass is stated by the forecourt layer (`lawnSidesFor`). Written as (axis, sign),
 * one side says `('x', -1)` and the other says `'w'`, and whether they agree can only be worked
 * out from memory — disagreeing, the result is a tree growing out of asphalt.
 */
function treeOn(b: Band, side: Side, t: number, heightM: number) {
  const { axis, sign } = SIDE_AXIS[side];
  return columnarTree(b, axis, sign, t, heightM);
}

/** A low shrub. As with the tree, the sphere itself lives in `geometry/plants`. */
function shrub(b: Band, axis: Axis, sign: Sign, t: number, radiusM: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return plantShrubBall(x, z, fit(b, radiusM, 0.95));
}

/** A topiary ball: two spheres stacked on a short stem. */
function topiary(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return plantTopiary(x, z, fit(b, 0.35, 0.85));
}

/** A round flower bed: a low ring wall with flowers inside. */
function flowerBed(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return plantFlowerBed(x, z, fit(b, 0.45, 0.9));
}

/** A mailbox: a post and a box. */
function mailbox(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propMailbox(x, z);
}

/** A bin. */
function bin(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propBin(x, z, fit(b, 0.28, 0.9));
}

/** A bollard row: short posts evenly spaced along one edge, keeping vehicles out. */
function bollards(b: Band, axis: Axis, sign: Sign, count: number) {
  const out: THREE.BufferGeometry[] = [];
  const span = b.outer * 1.5;
  const r = fit(b, 0.11, 0.5);
  for (let i = 0; i <= count; i++) {
    const [x, z] = place(axis, sign, -span / 2 + (span / count) * i, mid(b));
    out.push(propBollard(x, z, r));
  }
  return out;
}

/** A picket row: thinner than bollards, with a rail across them. */
function picketFence(b: Band, axis: Axis, sign: Sign, count: number) {
  const out: THREE.BufferGeometry[] = [];
  const span = b.outer * 1.7;
  for (let i = 0; i <= count; i++) {
    const [x, z] = place(axis, sign, -span / 2 + (span / count) * i, mid(b));
    out.push(propFencePost(x, z));
  }
  const [rx, rz] = place(axis, sign, 0, mid(b));
  out.push(propFenceRail(rx, rz, axis, span));
  return out;
}

/** A bike rack: two hoops. */
function bikeRack(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propBikeRack(x, z, axis);
}

/**
 * A garden or street lamp.
 *
 * The pole is cold metal (`PART_DETAIL`) and only the **head** glows (`PART_LAMP`); tagging the
 * whole thing as glowing gives a post lit from the ground to the top at night.
 */
function lamp(b: Band, axis: Axis, sign: Sign, t: number, heightM: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propLamp(x, z, heightM);
}

/** A drying rack: two posts and two lines. */
function dryingRack(b: Band, axis: Axis, sign: Sign) {
  const out: THREE.BufferGeometry[] = [];
  const span = b.outer * 0.9;
  for (const t of [-span / 2, span / 2]) {
    const [x, z] = place(axis, sign, t, mid(b));
    out.push(propDryingPost(x, z));
  }
  const [cx, cz] = place(axis, sign, 0, mid(b));
  for (const h of [1.4, 1.6]) out.push(propDryingLine(cx, cz, axis, span, h));
  return out;
}

/** A notice board or sign post. */
function signPost(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propSignPost(x, z, axis);
}

/** A drum (industrial). */
function drum(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propDrum(x, z, fit(b, 0.29, 0.9));
}

/**
 * A pipe rack: two posts carrying two horizontal pipes (industrial).
 *
 * One of the most recognisable things on an industrial site, and it is **horizontal**. Among a
 * layer otherwise made entirely of upright posts, one horizontal piece immediately reads as "a
 * process runs here".
 *
 * Kept under 2 m: any higher and it enters the overhead layer's clearance
 * (`OVERHEAD_CLEARANCE`).
 */
function pipeRack(b: Band, axis: Axis, sign: Sign, lengthFrac: number) {
  const [x, z] = place(axis, sign, 0, mid(b));
  return propPipeRack(x, z, axis, b.outer * 2 * lengthFrac);
}

/** A gas bottle rack: three cylinders against a low frame (industrial). */
function gasBottles(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propGasBottles(x, z, axis, fit(b, 0.16, 0.9));
}

/**
 * A pallet stack: three wooden pallets (industrial).
 *
 * Its length along the edge is not bounded by the band's width: the band is 0.4 m deep, but 1.2 m
 * fits along the wall. So it is one of the few pieces of goods with real volume that a narrow
 * band can still hold.
 */
function palletStack(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propPalletStack(x, z, axis, bandDepth(b));
}

/** A hydrant (industrial and commercial). */
function hydrant(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propHydrant(x, z);
}

/** A flagpole (office). */
function flagpole(b: Band, axis: Axis, sign: Sign, t: number) {
  const [x, z] = place(axis, sign, t, mid(b));
  return propFlagpole(x, z, axis);
}

// ===== Per-zone recipes =====

type Recipe = (b: Band) => THREE.BufferGeometry[];

/**
 * The low-density residential yard ladder (the "surroundings" column of spec revision 4).
 *
 *   L1 bare yard: pickets, shrubs, mailbox, bin, with a tree in one front yard out of four
 *      (a tree in all four would push L1's piece count above L2's and invert the ladder)
 *   L2 hedge and one tree: hedge, columnar tree, flower bed, bike rack, drying rack
 *   L3 tended garden: hedges on three sides, two trees, topiary, planter, garden lamp
 *
 * Four recipes per level: two combined with four rotations give only 8 faces, and an 8x8 block
 * shows the repetition. Four give 16.
 *
 * Forecourt grass: north only at L1, north and east at L2, north, east and west at L3. **Trees go
 * only on those sides** — the rest are the driveway and the path.
 */
const RES_LOW: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [...picketFence(b, 'z', 1, 5), shrub(b, 'x', 1, -0.1, 0.55),
          ...mailbox(b, 'z', 1, -0.28)],
    b => [...picketFence(b, 'x', -1, 4), shrub(b, 'z', 1, 0.15, 0.6), ...bin(b, 'z', 1, -0.3)],
    b => [shrub(b, 'x', 1, 0.1, 0.6), shrub(b, 'x', -1, -0.15, 0.45),
          ...treeOn(b, 'n', -0.14, 3.2), ...mailbox(b, 'z', 1, 0.3)],
    b => [...picketFence(b, 'z', -1, 5), ...bin(b, 'x', -1, 0.2), shrub(b, 'z', -1, -0.2, 0.5)],
  ],
  // L2 keeps L1's mailbox and bin: upgrading a house does not lose its mailbox. Without them,
  // "L2 is richer than L1" does not hold geometrically — L1's four picket runs are more pieces.
  [
    b => [hedge(b, 'z', 1, 0.9, 0.9), ...treeOn(b, 'e', -0.2, 4.0),
          ...flowerBed(b, 'z', 1, 0.28), ...bikeRack(b, 'z', 1, -0.25),
          ...mailbox(b, 'x', 1, 0.3)],
    b => [hedge(b, 'z', -1, 0.9, 0.8), hedge(b, 'x', -1, 0.6, 0.9),
          ...treeOn(b, 'e', 0.2, 3.6), ...dryingRack(b, 'z', -1),
          ...bin(b, 'z', 1, 0.3)],
    b => [hedge(b, 'x', 1, 0.8, 0.85), ...treeOn(b, 'n', -0.25, 4.2),
          ...flowerBed(b, 'x', -1, 0.1), ...mailbox(b, 'z', 1, 0.3),
          ...bin(b, 'z', 1, -0.3)],
    b => [hedge(b, 'z', 1, 0.85, 0.9), ...treeOn(b, 'n', 0.25, 3.8),
          ...bin(b, 'x', 1, -0.2), shrub(b, 'x', -1, 0.2, 0.5),
          ...mailbox(b, 'z', 1, 0.3)],
  ],
  [
    b => [hedge(b, 'z', 1, 0.95, 1.0), hedge(b, 'x', 1, 0.9, 1.0), hedge(b, 'x', -1, 0.9, 1.0),
          ...treeOn(b, 'n', -0.24, 4.8), ...treeOn(b, 'n', 0.24, 4.2),
          ...topiary(b, 'z', 1, 0.28)],
    b => [hedge(b, 'z', -1, 0.95, 1.0), hedge(b, 'z', 1, 0.95, 0.9), hedge(b, 'x', 1, 0.85, 1.0),
          ...treeOn(b, 'w', 0.22, 5.0), ...treeOn(b, 'w', -0.22, 4.4),
          ...lamp(b, 'z', 1, 0.3, 2.4)],
    b => [hedge(b, 'x', 1, 0.95, 1.0), hedge(b, 'x', -1, 0.95, 1.0), planter(b, 'z', 1, 0.8),
          ...treeOn(b, 'n', -0.2, 4.6), ...topiary(b, 'z', 1, -0.3),
          ...topiary(b, 'z', 1, 0.3)],
    b => [hedge(b, 'z', 1, 0.95, 1.0), hedge(b, 'x', -1, 0.9, 1.0), planter(b, 'z', -1, 0.7),
          ...treeOn(b, 'e', 0.2, 4.8), ...flowerBed(b, 'x', 1, -0.22),
          ...lamp(b, 'z', 1, -0.3, 2.2)],
  ],
];

/** Commercial: sidewalk furniture. A 0.4 m band holds upright pieces only. */
const COMMERCIAL: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [...bin(b, 'z', 1, 0.28), ...hydrant(b, 'x', 1, -0.2)],
    b => [...bin(b, 'z', 1, -0.28), ...bollards(b, 'z', 1, 4)],
  ],
  [
    b => [...bollards(b, 'z', 1, 5), ...signPost(b, 'z', 1, -0.3), ...bin(b, 'x', 1, 0.2)],
    b => [...bikeRack(b, 'z', 1, 0.1), ...signPost(b, 'x', 1, -0.2), ...bin(b, 'z', 1, -0.3)],
  ],
  [
    b => [...bollards(b, 'z', 1, 6), ...signPost(b, 'z', 1, 0.3), ...lamp(b, 'x', 1, 0.1, 3.2),
          ...bikeRack(b, 'x', -1, 0)],
    b => [...bollards(b, 'z', 1, 6), ...lamp(b, 'z', 1, -0.3, 3.4), ...bin(b, 'x', 1, -0.15),
          ...signPost(b, 'x', -1, 0.15)],
  ],
];

/**
 * Industrial: pipe racks, gas bottles, pallets, drums, bollards, hydrants. No greenery on an
 * industrial site.
 *
 * Industry's level ladder does not show in height — modern plants are single-storey with high
 * ceilings, covering the plot — so it rests entirely on equipment. Together with stacks and
 * silos, this layer is the whole of the evidence that this is a factory rather than a shop.
 */
const INDUSTRIAL: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [drum(b, 'x', 1, 0.1), drum(b, 'x', 1, -0.15), ...palletStack(b, 'z', -1, 0.16),
          ...hydrant(b, 'z', 1, 0.3)],
    b => [drum(b, 'z', -1, 0.2), ...pipeRack(b, 'x', 1, 0.7), ...hydrant(b, 'x', -1, -0.1)],
  ],
  [
    b => [drum(b, 'x', 1, 0.12), drum(b, 'x', 1, -0.12), drum(b, 'x', 1, 0.36),
          ...pipeRack(b, 'z', -1, 0.75), ...bollards(b, 'z', 1, 4),
          ...hydrant(b, 'z', 1, -0.32)],
    b => [drum(b, 'z', -1, 0.18), drum(b, 'z', -1, -0.18), ...gasBottles(b, 'x', 1, 0.1),
          ...bollards(b, 'x', -1, 4), ...hydrant(b, 'z', 1, 0.3)],
  ],
  [
    b => [drum(b, 'x', 1, 0.12), drum(b, 'x', 1, -0.12), ...pipeRack(b, 'z', -1, 0.8),
          ...palletStack(b, 'x', -1, 0.2), ...bollards(b, 'z', 1, 5),
          ...lamp(b, 'x', 1, 0.3, 4.0), ...hydrant(b, 'z', 1, -0.32)],
    b => [drum(b, 'z', -1, 0.2), ...gasBottles(b, 'x', 1, 0.12),
          ...palletStack(b, 'z', 1, -0.2), ...bollards(b, 'x', -1, 5),
          ...lamp(b, 'z', 1, 0.3, 4.2), ...signPost(b, 'x', 1, -0.15)],
  ],
];

/**
 * Office: flagpole, flower bed, bike rack. At L3 the forecourt's west side is grass, so the tree
 * goes there.
 *
 * Both densities share this recipe: at L3 both forecourts are brick on three sides with grass to
 * the west.
 */
const OFFICE: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [...bollards(b, 'z', 1, 4), ...bin(b, 'x', 1, 0.2)],
    b => [...bikeRack(b, 'z', 1, 0.15), ...bin(b, 'z', 1, -0.3)],
  ],
  [
    b => [...bollards(b, 'z', 1, 5), ...flowerBed(b, 'z', 1, -0.3), ...bikeRack(b, 'x', 1, 0)],
    b => [...bollards(b, 'x', 1, 4), ...flowerBed(b, 'z', 1, 0.3), ...bin(b, 'z', 1, -0.28)],
  ],
  [
    b => [...bollards(b, 'z', 1, 6), ...flagpole(b, 'z', 1, -0.3), ...flowerBed(b, 'z', 1, 0.3),
          ...treeOn(b, 'w', 0.16, 4.0), ...bikeRack(b, 'x', -1, 0)],
    b => [...bollards(b, 'z', 1, 6), ...flagpole(b, 'x', 1, 0.2), ...treeOn(b, 'w', -0.2, 3.6),
          ...lamp(b, 'z', 1, 0.3, 3.6), ...topiary(b, 'z', 1, -0.3)],
  ],
];

/**
 * High-density residential: entrance planting, between low-density residential and commercial.
 *
 * Forecourt grass: none at L1, north at L2, north and west at L3, and the trees follow it. The
 * band is only 0.4 m wide, so these are slender street trees at 0.36 m across and 3 m tall,
 * rather than low-density residential's 5 m garden trees.
 */
const RES_HIGH: [Recipe[], Recipe[], Recipe[]] = [
  [
    b => [...bin(b, 'z', 1, 0.28), ...bollards(b, 'z', 1, 4)],
    b => [...bin(b, 'x', 1, -0.2), ...bikeRack(b, 'z', 1, 0.1)],
  ],
  [
    b => [...bollards(b, 'z', 1, 5), ...treeOn(b, 'n', -0.2, 3.0), ...bin(b, 'x', -1, 0.2)],
    b => [...bikeRack(b, 'z', 1, 0.15), ...treeOn(b, 'n', 0.22, 3.2), ...bin(b, 'z', 1, -0.3)],
  ],
  [
    b => [...bollards(b, 'z', 1, 6), ...treeOn(b, 'n', 0.24, 3.4), ...topiary(b, 'z', 1, -0.3),
          ...lamp(b, 'x', 1, 0.15, 3.0), ...bikeRack(b, 'x', -1, 0)],
    b => [...bollards(b, 'z', 1, 5), ...treeOn(b, 'w', 0.2, 3.2), ...treeOn(b, 'w', -0.2, 2.8),
          ...lamp(b, 'z', 1, -0.3, 3.2), ...flowerBed(b, 'z', 1, 0.3)],
  ],
];

const RECIPES: Record<string, [Recipe[], Recipe[], Recipe[]]> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   RES_LOW,
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: RES_HIGH,
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    COMMERCIAL,
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  COMMERCIAL,
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        INDUSTRIAL,
  [heightKey(ZoneType.OFFICE, 'LOW')]:            OFFICE,
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           OFFICE,
};

/** The low-prop recipes for this (zone, density, level). No band means no props. */
export function getGroundPropVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  const band = lowPropBand(zoneType, density, level);
  if (!band) return [];
  const byLevel = RECIPES[heightKey(zoneType, density)];
  if (!byLevel) return [];
  const recipes = byLevel[Math.max(1, Math.min(3, level)) - 1]!;
  return recipes.map(recipe => () => mergeGeometries(recipe(band))!);
}
