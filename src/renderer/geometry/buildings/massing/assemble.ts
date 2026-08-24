import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tagPart, PART_WALL } from '../parts';
import { HALF_ENVELOPE, TUB, STACK, coolingProfile } from './metrics';
import { maxAbsOf, partOf, type Volume } from './volume';
import { METRES_PER_CELL } from '../../../../core/grid/constants';

/**
 * The only place in `massing/` that touches Three.js.
 *
 * Every shape comes from the same `frustum`, differing only in the top face's size and offset: a
 * box's top matches its base, a gable's top is a line, a hip's top is a small patch, and a
 * shed's top is a line pushed to one side. Five shapes as five separate geometries would be five
 * nearly identical pieces of vertex arithmetic, and getting one wrong shows up only as "one
 * variant's roof looks odd".
 */

/** The gable ridge's width as a fraction. 0 produces degenerate triangles, so a thin edge is left. */
const RIDGE = 0.04;

/**
 * A frustum with a w x d base and a topW x topD top, optionally offset.
 *
 * With `y0 === 0` the base is omitted: those two triangles lie flat on the ground and are never
 * seen.
 */
function frustum(
  v: Volume, topW: number, topD: number, offX: number, offZ: number,
): THREE.BufferGeometry {
  const hw = v.w / 2;
  const hd = v.d / 2;
  const tw = topW / 2;
  const td = topD / 2;
  const b: Array<[number, number]> = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const t: Array<[number, number]> = [
    [offX - tw, offZ - td], [offX + tw, offZ - td],
    [offX + tw, offZ + td], [offX - tw, offZ + td],
  ];

  const pos: number[] = [];
  /**
   * One quad whose four corners run **counter-clockwise seen from outside that face**.
   *
   * The winding decides which side `computeVertexNormals` points the normals toward, and the
   * building material is `FrontSide`: reversed, what shows is the building's inner walls, with
   * nothing reported (BUG-227).
   */
  const quad = (
    p0: [number, number, number], p1: [number, number, number],
    p2: [number, number, number], p3: [number, number, number],
  ) => { pos.push(...p0, ...p2, ...p1, ...p0, ...p3, ...p2); };

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(
      [b[i]![0], v.y0, b[i]![1]], [b[j]![0], v.y0, b[j]![1]],
      [t[j]![0], v.y1, t[j]![1]], [t[i]![0], v.y1, t[i]![1]],
    );
  }
  // Top face
  quad(
    [t[0]![0], v.y1, t[0]![1]], [t[1]![0], v.y1, t[1]![1]],
    [t[2]![0], v.y1, t[2]![1]], [t[3]![0], v.y1, t[3]![1]],
  );
  // The base is needed only when the mass is off the ground; flat on it those two triangles are
  // never seen.
  if (v.y0 > 1e-6) {
    quad(
      [b[3]![0], v.y0, b[3]![1]], [b[2]![0], v.y0, b[2]![1]],
      [b[1]![0], v.y0, b[1]![1]], [b[0]![0], v.y0, b[0]![1]],
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  geo.translate(v.x, 0, v.z);
  return geo;
}

/** One sawtooth bay's span: roughly 6 m, close to a real industrial building's. */
const SAWTOOTH_SPAN = 6 / METRES_PER_CELL;

/**
 * A cylinder's side count. 8 already reads as round in an isometric view and **puts vertices on
 * +/-x and +/-z**, so after scaling it exactly fills the declared box and the wall positions
 * computed from the mass still match the geometry.
 */
const CYLINDER_SIDES = 8;

/**
 * Cylinders: stacks, silos, tanks.
 *
 * The one shape that does not go through `frustum`. It uses `THREE.CylinderGeometry` rather than
 * hand-stacked triangles because its winding is outward already (the lesson of BUG-227), but it
 * is indexed and carries uvs, which cannot merge with `frustum`'s output, so the uvs are dropped
 * and it is de-indexed first.
 *
 * Recomputing normals after de-indexing is deliberate: it gives flat shading, consistent with
 * the other shapes' low-poly look. The order cannot be swapped — non-uniform scaling distorts
 * existing normals.
 */
function cylinder(v: Volume): THREE.BufferGeometry {
  const src = new THREE.CylinderGeometry(0.5, 0.5, v.y1 - v.y0, CYLINDER_SIDES);
  src.deleteAttribute('uv');
  const geo = src.toNonIndexed();
  src.dispose();
  geo.scale(v.w, 1, v.d);
  geo.computeVertexNormals();
  geo.translate(v.x, (v.y0 + v.y1) / 2, v.z);
  return geo;
}

/**
 * Hemispheres: domes.
 *
 * The same path as `cylinder` (THREE primitive, drop uvs, de-index, recompute normals, scale)
 * for the same reasons: `SphereGeometry`'s winding is outward already, and it carries uvs and is
 * indexed, so it cannot merge with `frustum`'s output without being de-indexed first.
 *
 * The segment count matches the cylinder's 8: the two are often stacked, a dome on a shaft, and
 * differing side counts leave the seam visible. Four vertical segments — fewer reads as a conical
 * hat.
 */
function dome(v: Volume): THREE.BufferGeometry {
  const src = new THREE.SphereGeometry(
    0.5, CYLINDER_SIDES, 4, 0, Math.PI * 2, 0, Math.PI / 2,
  );
  src.deleteAttribute('uv');
  const geo = src.toNonIndexed();
  src.dispose();
  // The hemisphere's y runs 0 to 0.5 and has to fill the declared [y0, y1].
  geo.scale(v.w, (v.y1 - v.y0) * 2, v.d);
  geo.computeVertexNormals();
  geo.translate(v.x, v.y0, v.z);
  return geo;
}

/**
 * Cooling towers: a **waisted** surface of revolution.
 *
 * It is a power plant's most recognisable silhouette in a low-poly city, and that shape amounts
 * to one fact: the middle is narrower than both ends. A cylinder is straight and a frustum is
 * monotone, so neither produces a waist, making this the one shape that needs its own side
 * profile.
 *
 * The profile itself lives in `metrics.ts`: the mouth ring's inner and outer edges
 * (`COOL.THROAT` and `COOL.RIM`) are computed from the same hyperbola, and the mass data relies
 * on them to place the obstruction light on the ring. Computed on both sides, changing the waist
 * drops the light into the mouth.
 */
function coolingTower(v: Volume): THREE.BufferGeometry {
  return lathe(coolingProfile().map(([r, y]) => new THREE.Vector2(r, y)), v);
}

/**
 * Stacks: a slightly tapered shaft, a ring at the top, and the ring's inside **recessed**.
 *
 * A cylinder's top is a solid disc, while a real stack has a hole at the top — and the top is
 * the first thing seen of anything ten metres tall in an isometric view.
 *
 * Two concentric cylinders cannot produce the recess: the outer cap covers the inner one
 * entirely. Making the outer one an uncapped tube does not help either — the building material
 * is `FrontSide`, a tube wall's normals point outward, and looking down the inside is back-face
 * culled, showing straight through.
 *
 * A surface of revolution provides it: the profile folds back down at the top and that segment's
 * normals turn toward the axis, so looking down shows the recess's **inner wall** rather than its
 * back.
 */
function chimney(v: Volume): THREE.BufferGeometry {
  const { BORE, COLLAR, DEPTH } = STACK;
  return lathe([
    new THREE.Vector2(0.5, 0),            // base
    new THREE.Vector2(COLLAR, 0.86),      // slightly tapered shaft
    new THREE.Vector2(COLLAR, 1),         // outer edge of the mouth
    new THREE.Vector2(BORE, 1),           // the mouth ring
    new THREE.Vector2(BORE, 1 - DEPTH),   // recess inner wall, normals toward the axis
    new THREE.Vector2(0, 1 - DEPTH),      // floor
  ], v);
}

/**
 * Tubs: open containers whose inner wall runs all the way down to the floor.
 *
 * The same construction as a stack's recess with a different purpose: this holds water, and the
 * surface has to sit **below the rim** for the depth to read. A solid cylinder cannot do it —
 * its top is a solid disc, and the surface pushed beneath it disappears inside the mass, with the
 * data right and nothing on screen.
 *
 * The wall thickness comes from `TUB.INNER` and the depth from `TUB.DEPTH`, the same numbers the
 * mass data uses to place the water surface.
 */
function tub(v: Volume): THREE.BufferGeometry {
  const inner = 0.5 * TUB.INNER;
  const floor = 1 - TUB.DEPTH;
  return lathe([
    new THREE.Vector2(0.5, 0),        // outer edge of the floor
    new THREE.Vector2(0.5, 1),        // outside of the wall
    new THREE.Vector2(inner, 1),      // rim
    new THREE.Vector2(inner, floor),  // inside of the wall, normals toward the axis
    new THREE.Vector2(0, floor),      // floor
  ], v);
}

/**
 * Basins: the rectangular counterpart to `tub`, four walls enclosing a rectangle.
 *
 * A surface of revolution cannot turn a rectangle, and hollowing a box takes boolean operations.
 * Four solid walls give the same thing more cheaply: a box's face turned toward the centre is
 * already an **inward-facing** front face, which `FrontSide` does not cull.
 *
 * The two walls along x run the full width and the two along z are inset by the wall thickness,
 * so the four corners belong to the former only; overlapping, those corners would carry two
 * coplanar skins.
 */
function basinWalls(v: Volume): THREE.BufferGeometry[] {
  const tw = v.w * (1 - TUB.INNER) / 2;
  const td = v.d * (1 - TUB.INNER) / 2;
  const innerD = v.d - td * 2;
  return [
    ...([-1, 1] as const).map(s => frustum(
      { ...v, z: v.z + s * (v.d - td) / 2, d: td }, v.w, td, 0, 0)),
    ...([-1, 1] as const).map(s => frustum(
      { ...v, x: v.x + s * (v.w - tw) / 2, w: tw, d: innerD },
      tw, innerD, 0, 0)),
  ];
}

/**
 * Revolves one profile. Shared by `cooling` and `stack`.
 *
 * The same path as `cylinder` (drop uvs, de-index, scale, recompute normals, translate), and the
 * order cannot be swapped: non-uniform scaling distorts existing normals. The profile's x runs 0
 * to 0.5 and its y 0 to 1, so after scaling it exactly fills the declared box.
 */
function lathe(profile: THREE.Vector2[], v: Volume): THREE.BufferGeometry {
  const src = new THREE.LatheGeometry(profile, CYLINDER_SIDES);
  src.deleteAttribute('uv');
  const geo = src.toNonIndexed();
  src.dispose();
  geo.scale(v.w, v.y1 - v.y0, v.d);
  geo.computeVertexNormals();
  geo.translate(v.x, v.y0, v.z);
  return geo;
}

/**
 * One mass's geometry. A single mass can produce several geometries — a sawtooth roof is a row.
 *
 * Exported for `geometry/civic/`: civic buildings use the same primitives with a different guard,
 * bounding the plot rather than the pedestrian envelope. A second copy of the primitives is the
 * mistake behind BUG-231's duplicated floor colour.
 */
export function shapeOf(v: Volume): THREE.BufferGeometry[] {
  const alongZ = (v.facing ?? 0) % 2 === 0;
  const sign = (v.facing ?? 0) < 2 ? 1 : -1;

  switch (v.shape ?? 'box') {
    case 'box':
      return [frustum(v, v.w, v.d, 0, 0)];
    case 'cylinder':
      return [cylinder(v)];
    case 'dome':
      return [dome(v)];
    case 'cooling':
      return [coolingTower(v)];
    case 'stack':
      return [chimney(v)];
    case 'tub':
      return [tub(v)];
    case 'basin':
      return basinWalls(v);
    case 'gable':
      return alongZ
        ? [frustum(v, v.w, v.d * RIDGE, 0, 0)]
        : [frustum(v, v.w * RIDGE, v.d, 0, 0)];
    case 'hip':
      return [frustum(v, v.w * 0.2, v.d * 0.2, 0, 0)];
    case 'shed':
      return alongZ
        ? [frustum(v, v.w, v.d * RIDGE, 0, sign * (v.d / 2) * (1 - RIDGE))]
        : [frustum(v, v.w * RIDGE, v.d, sign * (v.w / 2) * (1 - RIDGE), 0)];
    case 'sawtooth': {
      const n = Math.max(2, Math.round(v.d / SAWTOOTH_SPAN));
      const teethD = v.d / n;
      const out: THREE.BufferGeometry[] = [];
      for (let i = 0; i < n; i++) {
        const z = v.z - v.d / 2 + teethD * (i + 0.5);
        out.push(frustum(
          { ...v, z, d: teethD },
          v.w, teethD * RIDGE, 0, sign * (teethD / 2) * (1 - RIDGE),
        ));
      }
      return out;
    }
  }
}

/**
 * Turns masses into geometry. **Throws** when anything crosses the pedestrian envelope.
 *
 * The exception should never fire while the game runs: the generators are deterministic and the
 * variant set is fixed, so passing tests mean it never throws. The throw is a guard for whoever
 * changes a prototype later, not run-time error handling — silently letting pedestrians walk
 * through walls is a hundred times harder to track down than failing on the spot.
 */
export function assemble(volumes: readonly Volume[]): THREE.BufferGeometry {
  const over = maxAbsOf(volumes) - HALF_ENVELOPE;
  if (over > 1e-6) {
    throw new Error(
      `mass crosses the pedestrian envelope by ${(over * METRES_PER_CELL).toFixed(3)} m — pedestrians would walk through walls (BUG-221)`,
    );
  }

  const parts: THREE.BufferGeometry[] = [];
  for (const v of volumes) {
    for (const g of shapeOf(v)) {
      tagPart(g, partOf(v));
      parts.push(g);
    }
  }
  if (parts.length === 0) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    tagPart(empty, PART_WALL);
    return empty;
  }
  return mergeGeometries(parts)!;
}
