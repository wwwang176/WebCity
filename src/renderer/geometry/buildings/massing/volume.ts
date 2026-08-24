import { PART_WALL } from '../parts';

/**
 * A mass: the generators' intermediate representation.
 *
 * The generators produce a run of box coordinates rather than a `BufferGeometry` directly. The
 * extra layer exists so that asymmetry, overlap and overrun can be verified exactly by
 * arithmetic: BUG-222 happened because only the merged bounding box could be measured, missing
 * the difference between "maximum distance from the cell centre" and "bounding box width".
 *
 * Coordinates are in cells (1 cell = 12 m), y0 = 0 is the ground, and the cell centre is (0, 0).
 */

/**
 * `cylinder` is the one shape not produced by `frustum`: stacks and silos are round, and an
 * octagon already reads as round in an isometric view. It still fills the declared w x d box,
 * since an octagon has vertices on +/-x and +/-z, so `maxAbsOf`, `overlapOf` and `rasterise` do
 * not have to know it is round.
 */
export type VolumeShape =
  'box' | 'gable' | 'hip' | 'shed' | 'sawtooth'
  | 'cylinder' | 'dome' | 'cooling' | 'stack'
  | 'tub' | 'basin';

export interface Volume {
  /** Centre. */
  x: number;
  z: number;
  /** Width and depth. */
  w: number;
  d: number;
  /** Bottom and top. */
  y0: number;
  y1: number;
  /** What it is drawn as. A box by default. */
  shape?: VolumeShape;
  /** The part tag, `PART_WALL` by default. */
  part?: number;
  /** Which way the slope faces: 0 = +z, 1 = +x, 2 = -z, 3 = -x. Only pitched roofs use it. */
  facing?: 0 | 1 | 2 | 3;
}

/** The silhouette raster's edge length. 16 is fine enough to separate a wing and coarse enough to be immune to floating-point error. */
export const RASTER = 16;

export const partOf = (v: Volume): number => v.part ?? PART_WALL;

const x0 = (v: Volume) => v.x - v.w / 2;
const x1 = (v: Volume) => v.x + v.w / 2;
const z0 = (v: Volume) => v.z - v.d / 2;
const z1 = (v: Volume) => v.z + v.d / 2;

/**
 * The maximum distance from the cell centre.
 *
 * Used instead of a bounding box width: an off-centre mass bulges on one side without its width
 * showing it. Pedestrian door nodes sit outside `HALF_ENVELOPE`, so crossing it means pedestrians
 * walk through walls (BUG-221/222).
 */
export function maxAbsOf(vs: readonly Volume[]): number {
  let m = 0;
  for (const v of vs) {
    m = Math.max(m, Math.abs(x0(v)), Math.abs(x1(v)), Math.abs(z0(v)), Math.abs(z1(v)));
  }
  return m;
}

/** The highest point. */
export function topOf(vs: readonly Volume[]): number {
  let m = 0;
  for (const v of vs) m = Math.max(m, v.y1);
  return m;
}

/**
 * Two masses' intersection volume. Touching, that is coplanar, returns 0.
 *
 * Overlapping masses create invisible interior faces: triangles spent for nothing, showing up
 * nowhere on screen, so arithmetic is the only thing that can catch them.
 */
export function overlapOf(a: Volume, b: Volume): number {
  const ox = Math.min(x1(a), x1(b)) - Math.max(x0(a), x0(b));
  const oz = Math.min(z1(a), z1(b)) - Math.max(z0(a), z0(b));
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return ox > 0 && oz > 0 && oy > 0 ? ox * oz * oy : 0;
}

/**
 * The volume centroid's distance from the bounding box's centre, divided by the box's edge length.
 * 0 is perfectly symmetric.
 *
 * This is the measure of whether rotation means anything, used instead of a raster difference: a
 * 7.5 x 8.2 box turned 90 degrees can show a 15% raster difference and still look like the same
 * box. The centroid sees real asymmetry — an L, a wing, an offset tower — and does not see
 * "merely a different width and depth".
 */
export function centroidOffset(vs: readonly Volume[]): number {
  let mass = 0;
  let cx = 0;
  let cz = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of vs) {
    const m = v.w * v.d * (v.y1 - v.y0);
    mass += m;
    cx += v.x * m;
    cz += v.z * m;
    minX = Math.min(minX, x0(v));
    maxX = Math.max(maxX, x1(v));
    minZ = Math.min(minZ, z0(v));
    maxZ = Math.max(maxZ, z1(v));
  }
  if (mass <= 0) return 0;
  const dx = cx / mass - (minX + maxX) / 2;
  const dz = cz / mass - (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ);
  return span > 0 ? Math.hypot(dx, dz) / span : 0;
}

/**
 * Rasterises the masses into a `RASTER x RASTER` height map covering the whole cell, [-0.5, 0.5].
 *
 * Each cell holds the highest point there, and cells with no mass hold 0. This turns "do these two
 * shapes look alike" into a computable number rather than a judgement call.
 */
export function rasterise(vs: readonly Volume[]): Float32Array {
  const g = new Float32Array(RASTER * RASTER);
  for (let r = 0; r < RASTER; r++) {
    const z = -0.5 + (r + 0.5) / RASTER;
    for (let c = 0; c < RASTER; c++) {
      const x = -0.5 + (c + 0.5) / RASTER;
      let h = 0;
      for (const v of vs) {
        if (x >= x0(v) && x <= x1(v) && z >= z0(v) && z <= z1(v)) h = Math.max(h, v.y1);
      }
      g[r * RASTER + c] = h;
    }
  }
  return g;
}

/** Rotates a height map by a quarter turn. */
export function rotate90(grid: Float32Array): Float32Array {
  const out = new Float32Array(grid.length);
  for (let r = 0; r < RASTER; r++) {
    for (let c = 0; c < RASTER; c++) {
      out[c * RASTER + (RASTER - 1 - r)] = grid[r * RASTER + c]!;
    }
  }
  return out;
}

/**
 * Two height maps' difference ratio: the share of cells differing in height by more than
 * `tolerance`, over **the union of the two**.
 *
 * The denominator is the union rather than the whole map. Over the whole map, the smaller a shape
 * the more easily it is judged identical: an L's notch is 20% of the building itself, but the
 * building covers only half the cell, so it dilutes to 10% and lands right on the threshold. The
 * union as denominator makes the measure scale-independent.
 *
 * `tolerance` is usually half a storey: ten centimetres lower is not a different shape.
 */
export function differenceRatio(
  a: Float32Array, b: Float32Array, tolerance: number,
): number {
  let diff = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]! > 0 || b[i]! > 0) union++;
    if (Math.abs(a[i]! - b[i]!) > tolerance) diff++;
  }
  return union === 0 ? 0 : diff / union;
}
