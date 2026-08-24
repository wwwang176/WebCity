import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shapeOf } from '../buildings/massing/assemble';
import { partOf, type Volume } from '../buildings/massing/volume';
import { GROUND_LAYERS } from '../buildings/massing/metrics';
import {
  tagPart, setGroundShade, PART_WALL, PART_GROUND, PART_FOLIAGE, PART_WATER,
} from '../buildings/parts';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import {
  CIVIC_INSET,
  type CivicDecal, type CivicVolume, type CivicVehicle, type CivicVehicleKind,
  type Footprint,
} from './types';
import { CIVIC_DEFAULT_COLOR, type CivicColor } from './colors';
import { VEHICLE_CONFIG } from '../../vehicleConfig';
import { propGeometry, propExtent, type PropSpec } from '../props';
import {
  buildCarGeometry, buildBusGeometry, buildTruckGeometry, buildFiretruckGeometry,
  buildPoliceCarGeometry, buildAmbulanceGeometry, buildGarbageTruckGeometry,
  buildVanGeometry, buildAirplaneGeometry, buildAirplaneVTailGeometry,
  buildFerryGeometry,
} from '../index';

/**
 * Assembly of civic buildings' masses and decals.
 *
 * The primitives (`frustum`, `cylinder`, `shapeOf`) all come from `buildings/massing`; only the
 * guards and the way decals are produced differ here. A second copy of the primitives is the
 * mistake behind BUG-231, where the floor colour existed twice.
 */

/**
 * `mergeGeometries`, but it **throws** on failure instead of returning null.
 *
 * three.js's `mergeGeometries` prints one `console.error` and returns null when the attribute
 * sets disagree; it does not throw. So `mergeGeometries(parts)!` lies to TypeScript, and the
 * null travels all the way to `new THREE.Mesh(geo, mat)` before failing, far from the scene.
 *
 * It happens in practice: an airport parks an **aircraft** (`position,normal,color`) and a bus
 * (`position,normal,color,uv`) on one plot, the merge returns null, and every test stays green,
 * because the data table checks that nothing throws and nothing does. Only opening it in a
 * browser shows it.
 *
 * The message lists each input's attribute set: "merge failed" alone leaves the next person to
 * find which one differs.
 */
export function mergeOrThrow(
  parts: THREE.BufferGeometry[], what: string,
): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (merged) return merged;
  const sets = parts.map((g, i) => `#${i} {${Object.keys(g.attributes).sort().join(',')}}`);
  throw new Error(
    `${what}: geometry merge failed — inconsistent attribute sets: ${sets.join(' ')}`,
  );
}

/** An empty geometry that still **carries vertex colours**. Without them the shader reads it as partType 0. */
function emptyTagged(part: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  tagPart(geo, part);
  tagColor(geo, CIVIC_DEFAULT_COLOR);
  return geo;
}

/**
 * Spreads the building colour across every vertex (`aBldgColor`).
 *
 * Written per **mass** rather than once over the merged result: a hospital's red cross and a
 * university's gold dome are one mass's colour, and after merging they cannot be told apart.
 * Exactly the same reasoning as `tagPart`.
 */
function tagColor(geo: THREE.BufferGeometry, c: CivicColor): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  geo.setAttribute('aBldgColor', new THREE.BufferAttribute(arr, 3));
}

/** The maximum distance from the plot's centre, per axis. An off-centre mass bulges on one side without its width showing it. */
function extentOf(v: Volume): { x: number; z: number } {
  return {
    x: Math.max(Math.abs(v.x - v.w / 2), Math.abs(v.x + v.w / 2)),
    z: Math.max(Math.abs(v.z - v.d / 2), Math.abs(v.z + v.d / 2)),
  };
}

/**
 * Throws when a mass leaves the plot.
 *
 * A **different guard** from the zoned `assemble()`'s: that one bounds the pedestrian envelope,
 * an in-cell concept whose door nodes sit outside it and which pedestrians cross by walking
 * through walls (BUG-221). Civic buildings occupy several cells, where the envelope does not
 * apply; what has to be kept out is a neighbouring cell's building or road.
 *
 * Measured per axis rather than as a single radius: a 2x3 hospital has 3 cells along z and only
 * 2 along x, and a single radius either wastes the long side or lets the short one overflow.
 *
 * Measured as the maximum distance from the centre rather than a bounding box width: an
 * off-centre mass bulges on one side without its width showing it, which is the shape of
 * BUG-222.
 */
function assertInside(volumes: readonly Volume[], footprint: Footprint, inset: number): void {
  const limX = footprint.w / 2 - inset;
  const limZ = footprint.h / 2 - inset;
  let over = 0;
  for (const v of volumes) {
    const e = extentOf(v);
    over = Math.max(over, e.x - limX, e.z - limZ);
  }
  if (over > 1e-6) {
    throw new Error(
      `mass leaves the plot by ${(over * METRES_PER_CELL).toFixed(3)} m — it would overlap a neighbouring cell`,
    );
  }
}

/** Turns a civic building's masses into geometry. Throws when anything leaves the plot. */
export function assembleCivic(
  volumes: readonly CivicVolume[], footprint: Footprint, baseColor: CivicColor,
): THREE.BufferGeometry {
  assertInside(volumes, footprint, CIVIC_INSET);

  const parts: THREE.BufferGeometry[] = [];
  for (const v of volumes) {
    for (const g of shapeOf(v)) {
      tagPart(g, partOf(v));
      // **After tagPart.** `tagPart` rebuilds the whole colour attribute, zeroing all three
      // channels, so in the other order the brightness is silently erased.
      if (v.shade !== undefined) setGroundShade(g, v.shade);
      tagColor(g, v.color ?? baseColor);
      parts.push(g);
    }
  }
  // A park can have no masses at all, only decals and trees. An empty array makes
  // mergeGeometries return null, and the null travels to `new THREE.Mesh` before failing, far
  // from the scene.
  if (parts.length === 0) return emptyTagged(PART_WALL);
  return mergeOrThrow(parts, 'massing');
}

const layerY = (d: CivicDecal) =>
  (d.layer === 'mark' ? GROUND_LAYERS.MARKING : GROUND_LAYERS.DECAL);

/**
 * A rotated decal's axis-aligned envelope, expressed as a zero-height mass for `assertInside`.
 *
 * A w x d rectangle turned by theta has the envelope
 * (w|cos theta| + d|sin theta|) x (w|sin theta| + d|cos theta|), with the centre unchanged.
 */
function turnedBounds(d: CivicDecal): Volume {
  const c = Math.abs(Math.cos(d.rotationY ?? 0));
  const s = Math.abs(Math.sin(d.rotationY ?? 0));
  return {
    x: d.x, z: d.z,
    w: d.w * c + d.d * s,
    d: d.w * s + d.d * c,
    y0: 0, y1: 0,
  };
}

/** The horizontal intersection area of two decals. Sharing an edge returns 0. */
function overlapArea(a: CivicDecal, b: CivicDecal): number {
  const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const oz = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
  return ox > 1e-6 && oz > 1e-6 ? ox * oz : 0;
}

/**
 * Turns decals into geometry.
 *
 * Decals **take no `CIVIC_INSET`**: they are flat paving, and paving to the cell boundary is
 * correct, since a sidewalk runs all the way to the kerb. They still may not leave the plot.
 */
export function assembleDecals(
  decals: readonly CivicDecal[], footprint: Footprint,
): THREE.BufferGeometry {
  for (const d of decals) {
    if (d.rotationY && (d.layer ?? 'base') === 'base') {
      throw new Error(
        'only marking layers may be rotated — the base layer overlap check intersects '
        + 'axis-aligned rectangles, and a rotated base makes it silently wrong, letting two '
        + 'genuinely overlapping slabs through',
      );
    }
  }

  // Reuses the mass guard by treating a decal as a zero-height mass; the arithmetic is
  // identical. A rotated marking is checked against its **rotated** envelope: checked against
  // its original width and depth, a line that just fits along x reaches into the next cell once
  // turned 90 degrees, with nothing stopping it.
  assertInside(decals.map(turnedBounds), footprint, 0);

  // Base layers must not overlap each other. Marking layers may sit over paving and over each
  // other — parking bay lines drawn across an entrance tread — because they are at different
  // heights, or are meant to stack.
  const base = decals.filter(d => (d.layer ?? 'base') === 'base');
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      const area = overlapArea(base[i]!, base[j]!);
      if (area > 0) {
        throw new Error(
          `base decals overlap by ${(area * METRES_PER_CELL * METRES_PER_CELL).toFixed(2)} m2`
          + ' — two quads at the same height z-fight, invisible at rest and flickering the moment'
          + ' the camera moves',
        );
      }
    }
  }

  const parts = decals.map((d) => {
    const geo = new THREE.PlaneGeometry(d.w, d.d);
    geo.rotateX(-Math.PI / 2);   // Face up. The material is FrontSide, so face down is entirely invisible.
    // **Rotate before translating**: the other way round it turns about the origin and the whole
    // runway swings somewhere else.
    if (d.rotationY) geo.rotateY(d.rotationY);
    geo.translate(d.x, layerY(d), d.z);
    tagPart(geo, d.lawn ? PART_FOLIAGE : d.water ? PART_WATER : PART_GROUND);
    setGroundShade(geo, d.shade);
    // A decal's colour comes from the PART_GROUND / PART_FOLIAGE branches, not from
    // aBldgColor. It is written anyway: WebGL feeds 0 for a missing attribute, and the `isFloor`
    // branch reads it.
    tagColor(geo, CIVIC_DEFAULT_COLOR);
    return geo;
  });

  if (parts.length === 0) return emptyTagged(PART_GROUND);
  return mergeOrThrow(parts, 'decals');
}

/**
 * Turns shared low props into geometry.
 *
 * Its own layer, never merged with `assembleCivic`'s output: these primitives use THREE's
 * cones, spheres and toruses (indexed, with uvs) while masses are `shapeOf` frusta
 * (non-indexed, no uvs), and `mergeGeometries` requires matching attribute sets.
 *
 * The guard is the same as for masses: leaving the plot throws. The extents come from
 * `propExtent`, which reports half-widths per axis; under-reported, something reaches out over
 * a neighbouring cell.
 */
export function assembleFixtures(
  fixtures: readonly PropSpec[], footprint: Footprint,
): THREE.BufferGeometry {
  assertInside(
    fixtures.map((p) => {
      const e = propExtent(p);
      return { x: p.x, z: p.z, w: e.x * 2, d: e.z * 2, y0: 0, y1: 0 };
    }),
    footprint,
    CIVIC_INSET,
  );

  const parts = fixtures.flatMap(propGeometry);
  if (parts.length === 0) return emptyTagged(PART_FOLIAGE);
  return mergeOrThrow(parts, 'shared ground props');
}

/**
 * Vehicle kind to its `VEHICLE_CONFIG` key.
 *
 * The two naming schemes differ (`policeCar` versus `police_car`), hence this table. It only
 * renames; the colour is still `VEHICLE_CONFIG`'s to decide.
 */
const VEHICLE_CONFIG_KEY: Record<CivicVehicleKind, string> = {
  car: 'car',
  policeCar: 'police_car',
  ambulance: 'ambulance',
  firetruck: 'firetruck',
  bus: 'bus',
  garbageTruck: 'garbage_truck',
  van: 'van',
  truck: 'truck',
  airplane: 'airplane',
  ferry: 'ferry',
};

/**
 * Fixed colours for parked vehicles whose `VEHICLE_CONFIG.color === -1`.
 *
 * That -1 means "pick from a palette per vehicle while driving", and picking needs a vehicle id,
 * which a parked vehicle has none of. Civic buildings have no variants either — three police
 * stations have to look alike — so a fixed value is given here. Pale is deliberate: these kinds
 * play the role of **work vehicles** on a civic plot (an airport's ground crew, a plant's
 * trucks), and work vehicles are pale.
 */
const PARKED_TINT: Partial<Record<CivicVehicleKind, number>> = {
  car: 0xb0bec5,
  van: 0xeceff1,
  truck: 0xcfd8dc,
  airplane: 0xf5f5f5,
};

/**
 * What colour a parked vehicle should be.
 *
 * **A parked vehicle and a driving one of the same type have to share a colour.** Vehicle
 * geometry writes the body's vertex colour as (1, 1, 1) and the real colour is multiplied in by
 * `VehicleRenderer`'s per-instance `setColorAt`, while `assembleVehicles` produces a plain
 * `Mesh` with no per-instance colour. Without this, the fire engine outside a fire station is
 * **white** while the one on the street is red — what looks like a fire engine that is not quite
 * dark enough has in fact no colour at all.
 */
export function civicVehicleTint(kind: CivicVehicleKind): number {
  const cfg = VEHICLE_CONFIG[VEHICLE_CONFIG_KEY[kind]];
  if (cfg && cfg.color !== -1) return cfg.color;
  return PARKED_TINT[kind] ?? 0xbdbdbd;
}

/** Multiplies a colour into the vertex colours, the same operation as `VehicleRenderer`'s per-instance colour. */
function tintVehicle(geo: THREE.BufferGeometry, hex: number): void {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3] = (arr[i * 3] ?? 1) * r;
    arr[i * 3 + 1] = (arr[i * 3 + 1] ?? 1) * g;
    arr[i * 3 + 2] = (arr[i * 3 + 2] ?? 1) * b;
  }
}

/**
 * An aircraft's vertical tail colour.
 *
 * `VehicleRenderer` picks a tail colour per aircraft from `AIRLINE_TAIL_COLORS`, which needs a
 * vehicle id that a parked aircraft has none of. So a fixed value is given here, for the same
 * reason as `PARKED_TINT`. Deep blue is the one least likely to collide with a pale fuselage.
 */
export const PARKED_TAIL_TINT = 0x1e5aa8;

/**
 * Vehicle kind to **each piece** of its geometry, and that piece's own colour. This table is the
 * only such mapping; written a second time elsewhere it produces a parked ambulance that is
 * really a van, a mistake only one person ever notices.
 *
 * It returns an array rather than a single geometry because an aircraft is more than one piece:
 * `VehicleRenderer` draws the fuselage and the **vertical tail** as two instanced meshes so the
 * tail can carry its own livery colour. Taking the fuselage alone leaves an aircraft parked on
 * an apron with no tail, which is visible at a glance.
 *
 * `tint` is that piece's own colour; without one it takes the whole vehicle's.
 */
const VEHICLE_PARTS: Record<
  CivicVehicleKind, () => Array<{ geo: THREE.BufferGeometry; tint?: number }>
> = {
  car: () => [{ geo: buildCarGeometry() }],
  policeCar: () => [{ geo: buildPoliceCarGeometry() }],
  ambulance: () => [{ geo: buildAmbulanceGeometry() }],
  firetruck: () => [{ geo: buildFiretruckGeometry() }],
  bus: () => [{ geo: buildBusGeometry() }],
  garbageTruck: () => [{ geo: buildGarbageTruckGeometry() }],
  van: () => [{ geo: buildVanGeometry() }],
  truck: () => [{ geo: buildTruckGeometry() }],
  airplane: () => [
    { geo: buildAirplaneGeometry() },
    { geo: buildAirplaneVTailGeometry(), tint: PARKED_TAIL_TINT },
  ],
  ferry: () => [{ geo: buildFerryGeometry() }],
};

/**
 * Every piece of one vehicle, coloured and placed at the origin.
 *
 * Extracted so the showcase's **in-flight** aircraft takes the same path: it needs a coloured
 * aircraft without a parking position and without the plot guard. Built separately, the livery
 * in the air and the livery on the ground would differ, which is what this whole batch exists to
 * avoid.
 */
export function vehiclePieces(
  kind: CivicVehicleKind, tint?: number,
): THREE.BufferGeometry[] {
  return VEHICLE_PARTS[kind]().map(({ geo, tint: partTint }) => {
    // Attribute sets differ between kinds: the eight ground vehicles carry `uv` and aircraft do
    // not. The vehicle material (`MeshLambertMaterial` plus vertex colours) samples no texture,
    // so uvs are pure dead weight — dropped from all of them, rather than fabricated for
    // aircraft.
    geo.deleteAttribute('uv');
    tintVehicle(geo, partTint ?? tint ?? civicVehicleTint(kind));
    return geo;
  });
}

/** One complete coloured vehicle, merged into a single geometry at the origin. */
export function civicVehicleGeometry(
  kind: CivicVehicleKind, tint?: number,
): THREE.BufferGeometry {
  return mergeOrThrow(vehiclePieces(kind, tint), `vehicle ${kind}`);
}

/**
 * Turns parked vehicles into geometry.
 *
 * **No `tagPart` and no `tagColor`.** A vehicle's `color` attribute holds real RGB, and
 * overwriting it turns a body's white and blue into part tags. They use the vehicle material,
 * not the building shader.
 *
 * The guard is the same as for masses, measured against the **rotated** bounding box: a vehicle
 * turned 90 degrees occupies a different direction, and checked against its original width and
 * depth one that actually reaches out would pass.
 *
 * Note: `computeBoundingBox()` is correct before or after the rotation — three.js's
 * `applyMatrix4` recomputes it when a `boundingBox` already exists. What matters is that the box
 * being checked is the rotated one, not where this line sits.
 */
export function assembleVehicles(
  vehicles: readonly CivicVehicle[], footprint: Footprint,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bounds: Volume[] = [];

  for (const v of vehicles) {
    const box = new THREE.Box3();
    for (const geo of vehiclePieces(v.kind, v.tint)) {
      if (v.rotationY) geo.rotateY(v.rotationY);
      geo.translate(v.x, 0, v.z);
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
      parts.push(geo);
    }
    bounds.push({
      x: (box.min.x + box.max.x) / 2,
      z: (box.min.z + box.max.z) / 2,
      w: box.max.x - box.min.x,
      d: box.max.z - box.min.z,
      y0: 0,
      y1: 0,
    });
  }

  assertInside(bounds, footprint, CIVIC_INSET);

  if (parts.length === 0) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    // The material reads vertex colours, so even an empty geometry carries `color`; without it
    // the attribute set after mergeGeometries would differ from the case with vehicles.
    empty.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    return empty;
  }
  return mergeOrThrow(parts, 'vehicles');
}
