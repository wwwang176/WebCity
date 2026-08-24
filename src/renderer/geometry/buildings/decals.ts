import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import { decalBand, GROUND_LAYERS, type Band } from './propBands';
import { tagPart, setGroundShade, PART_GROUND, PART_FOLIAGE } from './parts';
import { heightKey, type Density, type GeoBuilder } from './registry';

/**
 * Ground decals: the paving at a building's feet.
 *
 * Perfectly flat — a single quad with no thickness — and walked on, which makes them the one of
 * the three ground-object classes that fits in every zone. Low props have to avoid the path
 * pedestrians take around a building; decals do not, because that path is a sidewalk and paving is
 * exactly what it should look like.
 *
 * With thickness the sides become walls, and walls grow windows. So these always use
 * `PlaneGeometry`.
 *
 * The ground is fixed at y = 0, since `cell.elevation` is never written by TerrainGenerator, and
 * the height above it comes from `GROUND_LAYERS`: decals and buildings have to sit at the same
 * height, or the forecourt paving does not meet the wall's foot (BUG-224).
 */

/** The base paving's height. The value lives in `GROUND_LAYERS`: decals and buildings have to sit
 * at the same height above the ground, or the forecourt paving does not meet the wall's foot
 * (BUG-224). */
export const DECAL_Y = GROUND_LAYERS.DECAL;

/**
 * The markings' and treads' height.
 *
 * Two layers are necessary: parking bay lines lie over asphalt by nature. But **base layers must
 * not overlap each other** — two quads at the same height and position z-fight, which does not
 * show in a static screenshot and turns into a flickering sheet as soon as the camera moves. So
 * the base layer is expressed as "one surface per side" and stacking happens only on the marking
 * layer.
 */
export const MARK_Y = GROUND_LAYERS.MARKING;

const M = (metres: number) => metres / METRES_PER_CELL;

// Brightness in the vertex colour's B channel: 0 is asphalt, 1 is white paint.
const TARMAC = 0.0;
const ASPHALT_PATH = 0.22;
const CONCRETE = 0.58;
const BRICK = 0.85;
const LINE_PAINT = 1.0;

export type Side = 'n' | 's' | 'e' | 'w';

/** One side's surface. `lawn` takes the foliage branch for green; everything else is PART_GROUND plus a brightness. */
type Surface = { kind: 'paved'; shade: number } | { kind: 'lawn' };

const paved = (shade: number): Surface => ({ kind: 'paved', shade });
const LAWN: Surface = { kind: 'lawn' };

interface Mark {
  kind: 'bays' | 'pad';
  count?: number;
  shade?: number;
}

interface Forecourt {
  /** One surface per side. Omitted sides are unpaved, and by construction two cannot stack on one side. */
  sides: Partial<Record<Side, Surface>>;
  /**
   * Markings and treads stacked over the paving, at most one per side.
   *
   * A Record rather than an array for the same reason as `sides`: two markings on one side, a
   * drop-off plus parking bays, necessarily overlap, and there is only one marking layer, where an
   * overlap is a z-fight.
   */
  marks?: Partial<Record<Side, Mark>>;
}

/**
 * Side to axis and sign. The low-prop layer reads this table too: trees stand on the grass side,
 * and with the convention written on both sides they end up planted opposite.
 */
export const SIDE_AXIS: Record<Side, { axis: 'x' | 'z'; sign: 1 | -1 }> = {
  n: { axis: 'z', sign: -1 },
  s: { axis: 'z', sign: 1 },
  e: { axis: 'x', sign: 1 },
  w: { axis: 'x', sign: -1 },
};

/** One flat quad centred at (cx, cz). */
function quad(
  cx: number, cz: number, w: number, d: number,
  y: number, part: number, shade: number,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2); // 朝上
  geo.translate(cx, y, cz);
  tagPart(geo, part);
  setGroundShade(geo, shade);
  return geo;
}

/**
 * One side's length.
 *
 * North-south sides span the full cell (`outer * 2`) and east-west sides span only the building's
 * width (`inner * 2`). With all four paved, that division makes the four pieces a ring with
 * neither gaps nor overlaps. Spanning both fully would stack a 1.5 m square overlap in each
 * corner, and two quads at the same height and position z-fight: invisible in a static
 * screenshot, a flickering sheet as soon as the camera moves.
 *
 * Markings and treads take the same length, so they never reach past their own side.
 */
function sideLength(band: Band, side: Side): number {
  return SIDE_AXIS[side].axis === 'z' ? band.outer * 2 : band.inner * 2;
}

/** A paving strip along one whole side. */
function sideQuad(band: Band, side: Side, surface: Surface): THREE.BufferGeometry {
  const { axis, sign } = SIDE_AXIS[side];
  const mid = (band.inner + band.outer) / 2;
  const depth = band.outer - band.inner;
  const len = sideLength(band, side);
  const part = surface.kind === 'lawn' ? PART_FOLIAGE : PART_GROUND;
  const shade = surface.kind === 'lawn' ? 0 : surface.shade;
  return axis === 'z'
    ? quad(0, sign * mid, len, depth, DECAL_Y, part, shade)
    : quad(sign * mid, 0, depth, len, DECAL_Y, part, shade);
}

/** Parking bay or loading markings: short white lines evenly spaced along one side. */
function bays(band: Band, side: Side, count: number): THREE.BufferGeometry[] {
  const { axis, sign } = SIDE_AXIS[side];
  const mid = (band.inner + band.outer) / 2;
  const depth = (band.outer - band.inner) * 0.85;
  const span = sideLength(band, side) * 0.85;
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= count; i++) {
    const t = -span / 2 + (span / count) * i;
    out.push(axis === 'z'
      ? quad(t, sign * mid, M(0.16), depth, MARK_Y, PART_GROUND, LINE_PAINT)
      : quad(sign * mid, t, depth, M(0.16), MARK_Y, PART_GROUND, LINE_PAINT));
  }
  return out;
}

/** An entrance tread or drop-off: a small patch against the middle of one side. */
function pad(band: Band, side: Side, shade: number): THREE.BufferGeometry {
  const { axis, sign } = SIDE_AXIS[side];
  const mid = (band.inner + band.outer) / 2;
  const depth = (band.outer - band.inner) * 0.9;
  const len = sideLength(band, side) * 0.4;
  return axis === 'z'
    ? quad(0, sign * mid, len, depth, MARK_Y, PART_GROUND, shade)
    : quad(sign * mid, 0, depth, len, MARK_Y, PART_GROUND, shade);
}

function buildForecourt(band: Band, f: Forecourt): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [side, surface] of Object.entries(f.sides)) {
    parts.push(sideQuad(band, side as Side, surface));
  }
  for (const [side, m] of Object.entries(f.marks ?? {})) {
    if (m.kind === 'bays') parts.push(...bays(band, side as Side, m.count ?? 4));
    else parts.push(pad(band, side as Side, m.shade ?? CONCRETE));
  }
  return mergeGeometries(parts)!;
}

/**
 * Each zone's forecourt. Higher levels are more fully paved and in better materials.
 *
 * One recipe per level, unlike the three-dimensional objects with their several variants: visually
 * a decal is a background, and the sense of repetition comes from what stands on it rather than
 * from the ground itself.
 */
const RECIPES: Record<string, [Forecourt, Forecourt, Forecourt]> = {
  // Low-density residential: mostly lawn, gaining a driveway and an entrance tread with level.
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]: [
    { sides: { n: LAWN } },
    { sides: { n: LAWN, e: LAWN, s: paved(ASPHALT_PATH) } },
    {
      sides: { n: LAWN, e: LAWN, w: LAWN, s: paved(ASPHALT_PATH) },
      marks: { n: { kind: 'pad', shade: CONCRETE } },
    },
  ],
  // High-density residential: a concrete ring, gaining grass and a brick entrance with level.
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    { sides: { n: LAWN, s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    {
      sides: { n: LAWN, s: paved(BRICK), e: paved(CONCRETE), w: LAWN },
      marks: { s: { kind: 'pad', shade: BRICK } },
    },
  ],
  // Low-density commercial: sidewalk, becoming brick shopfront paving and arcade flooring with
  // level.
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    { sides: { n: paved(CONCRETE), s: paved(BRICK), e: paved(CONCRETE), w: paved(CONCRETE) } },
    {
      sides: { n: paved(CONCRETE), s: paved(BRICK), e: paved(BRICK), w: paved(CONCRETE) },
      marks: { n: { kind: 'pad', shade: BRICK } },
    },
  ],
  // High-density commercial: sidewalk ring, then a plaza, then a brick plaza with a drop-off.
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    { sides: { n: paved(CONCRETE), s: paved(BRICK), e: paved(CONCRETE), w: paved(BRICK) } },
    {
      sides: { n: paved(BRICK), s: paved(BRICK), e: paved(BRICK), w: paved(BRICK) },
      marks: { s: { kind: 'pad', shade: CONCRETE }, w: { kind: 'bays', count: 3 } },
    },
  ],
  // Industrial: asphalt throughout, gaining loading markings and parking bays with level.
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]: [
    { sides: { n: paved(TARMAC), s: paved(TARMAC), e: paved(TARMAC), w: paved(TARMAC) } },
    {
      sides: { n: paved(TARMAC), s: paved(TARMAC), e: paved(TARMAC), w: paved(TARMAC) },
      marks: { s: { kind: 'bays', count: 4 } },
    },
    {
      sides: { n: paved(TARMAC), s: paved(TARMAC), e: paved(TARMAC), w: paved(TARMAC) },
      marks: { s: { kind: 'bays', count: 5 }, w: { kind: 'bays', count: 4 } },
    },
  ],
  // Low-density office: sidewalk, then an entrance walk, then a brick plaza with grass.
  [heightKey(ZoneType.OFFICE, 'LOW')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    {
      sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) },
      marks: { s: { kind: 'pad', shade: BRICK } },
    },
    {
      sides: { n: paved(BRICK), s: paved(BRICK), e: paved(BRICK), w: LAWN },
      marks: { s: { kind: 'pad', shade: CONCRETE } },
    },
  ],
  // High-density office: as high-density commercial, but keeping one patch of grass.
  [heightKey(ZoneType.OFFICE, 'HIGH')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    { sides: { n: paved(CONCRETE), s: paved(BRICK), e: paved(CONCRETE), w: paved(CONCRETE) } },
    {
      sides: { n: paved(BRICK), s: paved(BRICK), e: paved(BRICK), w: LAWN },
      marks: { s: { kind: 'pad', shade: CONCRETE }, n: { kind: 'bays', count: 3 } },
    },
  ],
};

/**
 * Which sides of this (zone, density, level)'s forecourt are grass.
 *
 * The low-prop layer uses it to decide which side trees go on: with each layer stating which sides
 * are grass, trees grow out of asphalt and nothing reports it.
 */
export function lawnSidesFor(
  zoneType: number, density: Density, level: number,
): Side[] {
  if (!decalBand(zoneType, density, level)) return [];
  const recipes = RECIPES[heightKey(zoneType, density)];
  if (!recipes) return [];
  const forecourt = recipes[Math.max(1, Math.min(3, level)) - 1]!;
  return (Object.entries(forecourt.sides) as Array<[Side, Surface]>)
    .filter(([, s]) => s.kind === 'lawn')
    .map(([side]) => side);
}

/** This (zone, density, level)'s forecourt. No decal band means no forecourt. */
export function getDecalVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  const band = decalBand(zoneType, density, level);
  if (!band) return [];
  const recipes = RECIPES[heightKey(zoneType, density)];
  if (!recipes) return [];
  const forecourt = recipes[Math.max(1, Math.min(3, level)) - 1]!;
  return [() => buildForecourt(band, forecourt)];
}
