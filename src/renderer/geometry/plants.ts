import * as THREE from 'three';
import { tagPart, PART_DETAIL, PART_FOLIAGE } from './buildings/parts';
import { M } from './buildings/massing/metrics';

/**
 * Planting primitives: trees and shrubs.
 *
 * Residential yards and civic greenery share what is here. Drawn separately, a civic building's
 * tree and a residential one are two differently shaped trees in one city, and a change to one
 * does not reach the other.
 *
 * **This module does not know who calls it.** It takes world coordinates and sizes in cells, not
 * "the cell's prop band": the residential side computes coordinates from its band and then calls
 * in, while civic buildings pass coordinates directly. Keeping the band concept here would make
 * it unusable for civic buildings, which occupy 2x2 to 9x6 cells and have no ring at all.
 *
 * The geometry uses THREE's primitives rather than `massing`'s `frustum`: a crown is a cone and a
 * shrub is a sphere, and neither is a frustum. The cost is that they carry uvs and are indexed,
 * so they **cannot be merged with the masses**, and civic buildings put planting in a layer of
 * its own (see `assemblePlants` in `civic/assemble.ts`).
 */

/** A declaration of one tree or shrub. Coordinates and sizes are in cells. */
export type Plant =
  | { kind: 'tree'; x: number; z: number; heightM: number; crownRadius: number }
  | { kind: 'shrub'; x: number; z: number; radius: number };

/**
 * A columnar tree, cypress-shaped.
 *
 * A residential yard band is 1.45 m at its widest and a round crown does not fit; a columnar crown
 * is narrow and grows upward, the only choice at that size that still reads as a tree. Civic
 * buildings have far more room, and sharing the same tree is deliberate: one city's trees should
 * be one kind of tree.
 */
export function columnarTree(
  x: number, z: number, heightM: number, crownRadius: number,
): THREE.BufferGeometry[] {
  const trunkH = M(heightM * 0.25);
  const crownH = M(heightM * 0.75);

  const trunk = new THREE.CylinderGeometry(M(0.09), M(0.12), trunkH, 5);
  trunk.translate(x, trunkH / 2, z);
  tagPart(trunk, PART_DETAIL); // a trunk is not a wall; tagged PART_WALL it grows windows

  const crown = new THREE.ConeGeometry(crownRadius, crownH, 6);
  crown.translate(x, trunkH + crownH / 2, z);
  tagPart(crown, PART_FOLIAGE);
  return [trunk, crown];
}

/** A low shrub. */
export function shrubBall(x: number, z: number, radius: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(radius, 5, 4);
  geo.translate(x, radius, z);
  tagPart(geo, PART_FOLIAGE);
  return geo;
}

/** This plant's horizontal radius. Civic buildings use it for the plot check. */
export function plantRadius(p: Plant): number {
  return p.kind === 'tree' ? p.crownRadius : p.radius;
}

/** This plant's geometry. */
export function plantGeometry(p: Plant): THREE.BufferGeometry[] {
  return p.kind === 'tree'
    ? columnarTree(p.x, p.z, p.heightM, p.crownRadius)
    : [shrubBall(p.x, p.z, p.radius)];
}

/**
 * A topiary ball: two spheres stacked on a short stem.
 *
 * `radius` is the lower sphere's radius; the upper one is 0.7 times it.
 */
export function topiary(x: number, z: number, radius: number): THREE.BufferGeometry[] {
  const stem = new THREE.CylinderGeometry(M(0.06), M(0.08), M(0.5), 5);
  stem.translate(x, M(0.25), z);
  tagPart(stem, PART_DETAIL);
  const lower = new THREE.SphereGeometry(radius, 5, 3);
  lower.translate(x, M(0.5) + radius, z);
  tagPart(lower, PART_FOLIAGE);
  const upper = new THREE.SphereGeometry(radius * 0.7, 5, 3);
  upper.translate(x, M(0.5) + radius * 2.4, z);
  tagPart(upper, PART_FOLIAGE);
  return [stem, lower, upper];
}

/** A round flower bed: a low ring wall with flowers inside. */
export function flowerBed(x: number, z: number, radius: number): THREE.BufferGeometry[] {
  const rim = new THREE.CylinderGeometry(radius, radius, M(0.28), 6);
  rim.translate(x, M(0.14), z);
  tagPart(rim, PART_DETAIL);
  const bloom = new THREE.SphereGeometry(radius * 0.85, 6, 2);
  bloom.scale(1, 0.5, 1);
  bloom.translate(x, M(0.28) + radius * 0.2, z);
  tagPart(bloom, PART_FOLIAGE);
  return [rim, bloom];
}

/**
 * A hedge: a continuous green strip.
 *
 * `axis` is **the direction it extends**: `'z'` means it runs along world x, the same convention
 * as `strip`, which comes from "along which edge of the cell".
 */
export function hedge(
  x: number, z: number, axis: 'x' | 'z',
  length: number, depth: number, heightM: number,
): THREE.BufferGeometry {
  const h = M(heightM);
  const geo = axis === 'z'
    ? new THREE.BoxGeometry(length, h, depth)
    : new THREE.BoxGeometry(depth, h, length);
  geo.translate(x, h / 2, z);
  tagPart(geo, PART_FOLIAGE);
  return geo;
}
