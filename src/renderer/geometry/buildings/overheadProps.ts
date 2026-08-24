import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import {
  overheadBand, OVERHEAD_CLEARANCE, SHOPFRONT_CEILING, type Band,
} from './propBands';
import { tagPart, PART_DETAIL, PART_LAMP, PART_ROOF } from './parts';
import { heightKey, type Density, type GeoBuilder } from './registry';

/**
 * Overhead objects: things attached outside a building that pedestrians walk beneath.
 *
 * The least constrained of the three ground-object classes. Low props may not cross the pedestrian
 * envelope, since they block the way; overhangs may, as long as their lowest point clears head
 * height. That is exactly how a real arcade works.
 *
 * So a commercial street does not have to narrow its buildings to fit a canopy: that 1.5 m
 * projection belongs above the sidewalk. Projecting is this layer's only reason to exist;
 * anything inside the building's outline is a facade component, not an overhang.
 *
 * The geometry is written at real size (1 cell = 12 m) and, like the low-prop layer, takes no
 * scaling at all.
 */

/**
 * The triangle limit per overhead recipe.
 *
 * With double-sided planes the measured maximum is 12 — two canopies plus one sign — so a limit of
 * 160 is no limit at all. A budget has to sit close to reality to catch the next regression.
 */
export const OVERHEAD_TRIANGLE_BUDGET = 24;

const M = (metres: number) => metres / METRES_PER_CELL;

type Axis = 'x' | 'z';
type Sign = 1 | -1;

const AXIS: Record<Side, { axis: Axis; sign: Sign }> = {
  n: { axis: 'z', sign: -1 },
  s: { axis: 'z', sign: 1 },
  e: { axis: 'x', sign: 1 },
  w: { axis: 'x', sign: -1 },
};

export type Side = 'n' | 's' | 'e' | 'w';

function place(axis: Axis, sign: Sign, t: number, d: number): [number, number] {
  return axis === 'z' ? [t, sign * d] : [sign * d, t];
}

/**
 * How far a canopy drops from the wall to its outer edge.
 *
 * Its upper edge sits on the first-floor line at 2.64 m, so the outer edge lands at
 * 2.64 - 0.36 = 2.28 m, still above the 2.2 m pedestrian clearance. The slope is not only for
 * looks: it gives the normals an upward component, and the camera's elevation is always above 0,
 * so the front face always points toward it.
 */
const AWNING_DROP = M(0.36);

type Vec3 = [number, number, number];

/**
 * One double-sided quad.
 *
 * A `BoxGeometry` gives a canopy 10 cm of thickness, which at 1 cell = 12 m never reaches a pixel,
 * and five of its six faces are wasted. As a plane, each piece drops from 12 triangles to 4.
 *
 * Double-sided rather than single-sided because the building material sets no `side` and therefore
 * defaults to `FrontSide`, while the camera's azimuth turns freely: a single-sided sign disappears
 * entirely once turned to its back. Each face gets its own set of vertices — their normals are
 * opposite, so they cannot be shared — and culling then draws only the face pointing at the
 * camera.
 */
function panel(corners: [Vec3, Vec3, Vec3, Vec3], part: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const [a, b, c, d] = corners;
  const front = [a, b, c, a, c, d];
  const back = [a, c, b, a, d, c];
  const pos = new Float32Array(36);
  [...front, ...back].forEach((v, i) => pos.set(v, i * 3));
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // Six corners into two sets of four vertices: the tests split pieces back out by counting 8
  // vertices per piece.
  const merged = mergeVertices(geo, 1e-6);
  tagPart(merged, part);
  return merged;
}

/** A sloped or upright panel along one side, from the wall at `inner` out to `outer`. */
function spanFromWall(
  b: Band, side: Side, len: number, innerY: number, outerY: number,
  reachFrac: number, part: number,
): THREE.BufferGeometry {
  const { axis, sign } = AXIS[side];
  const near = b.inner;
  const far = b.inner + (b.outer - b.inner) * reachFrac;
  const at = (d: number, t: number, y: number): Vec3 => {
    const [x, z] = place(axis, sign, t, d);
    return [x, y, z];
  };
  return panel([
    at(near, -len / 2, innerY), at(near, len / 2, innerY),
    at(far, len / 2, outerY), at(far, -len / 2, outerY),
  ], part);
}

/**
 * A canopy or awning: one panel sloping outward and down from the wall.
 *
 * A flat panel plus two braces is three pieces, and the braces are bars hanging beneath the panel
 * that read at range as two floating lines. The slope alone gives the silhouette that reads as a
 * canopy from a distance, and it takes one piece.
 */
function awning(
  b: Band, side: Side, lengthFrac: number, topUnits: number,
): THREE.BufferGeometry[] {
  return [spanFromWall(
    b, side, b.outer * 2 * lengthFrac,
    topUnits, topUnits - AWNING_DROP, 1, PART_ROOF,
  )];
}

/**
 * A projecting sign: a small panel perpendicular to the wall, above the canopy.
 *
 * It starts at the wall rather than at the overhead band's centre line, because a sign is bolted
 * to the wall and nothing at the centre line holds it up. Its face is perpendicular to the wall,
 * making it the piece in this layer that most needs to be double-sided.
 */
function blade(b: Band, side: Side, yUnits: number, sizeM: number) {
  const { axis, sign } = AXIS[side];
  const half = M(sizeM) / 2;
  const near = b.inner;
  const far = b.inner + (b.outer - b.inner) * 0.75;
  const at = (d: number, y: number): Vec3 => {
    const [x, z] = place(axis, sign, 0, d);
    return [x, y, z];
  };
  // PART_LAMP: a projecting sign is a light box that glows at night, and only while the shop is
  // occupied.
  return panel([
    at(near, yUnits - half), at(far, yUnits - half),
    at(far, yUnits + half), at(near, yUnits + half),
  ], PART_LAMP);
}

/** A billboard: a long panel along the facade, held just off the wall to avoid being coplanar with it. Lit at night. */
function billboard(b: Band, side: Side, lengthFrac: number, yUnits: number) {
  const half = M(1.1) / 2;
  return spanFromWall(
    b, side, b.outer * 2 * lengthFrac,
    yUnits + half, yUnits - half, 0.08, PART_LAMP,
  );
}

/** A loading canopy: longer than an ordinary one, for industry. Its height matches a shopfront canopy's, for the reason given in `SHOPFRONT_CEILING`. */
function loadingCanopy(b: Band, side: Side) {
  return awning(b, side, 0.85, SHOPFRONT_CEILING);
}

type Recipe = (b: Band) => THREE.BufferGeometry[];

/**
 * A sign's height.
 *
 * Expressed in first-floor lines rather than a hand-picked number of metres: hand-picked gives a
 * 3.9 m sign on a 5 m low-density commercial L1, which is 80% of the building's height and reads
 * as roof decoration rather than shop signage.
 */
const SIGN_Y = SHOPFRONT_CEILING * 1.5;
const BILLBOARD_Y = SHOPFRONT_CEILING * 1.9;

/**
 * Each zone's overhangs.
 *
 * Low-density residential has none: a detached house has neither an arcade nor signage, and adding
 * them makes it look like a shop.
 */
const COMMERCIAL_LOW: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => awning(b, 's', 0.8, SHOPFRONT_CEILING)],
  [
    b => [...awning(b, 's', 0.95, SHOPFRONT_CEILING), blade(b, 's', SIGN_Y, 0.8)],
    b => [...awning(b, 's', 0.95, SHOPFRONT_CEILING), ...awning(b, 'e', 0.7, SHOPFRONT_CEILING),
          blade(b, 's', SIGN_Y, 0.7)],
  ],
];

const COMMERCIAL_HIGH: [Recipe[], Recipe[], Recipe[]] = [
  [b => awning(b, 's', 0.5, SHOPFRONT_CEILING)],
  [b => [...awning(b, 's', 0.7, SHOPFRONT_CEILING), blade(b, 'e', SIGN_Y, 0.9)]],
  [
    b => [...awning(b, 's', 0.95, SHOPFRONT_CEILING), ...awning(b, 'e', 0.9, SHOPFRONT_CEILING),
          billboard(b, 'n', 0.9, BILLBOARD_Y)],
    b => [...awning(b, 's', 0.95, SHOPFRONT_CEILING), ...awning(b, 'w', 0.9, SHOPFRONT_CEILING),
          blade(b, 's', SIGN_Y, 1.0)],
  ],
];

const OFFICE: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => awning(b, 's', 0.5, SHOPFRONT_CEILING)],
  [
    b => [...awning(b, 's', 0.7, SHOPFRONT_CEILING), blade(b, 's', SIGN_Y, 0.7)],
    b => [...awning(b, 's', 0.65, SHOPFRONT_CEILING), ...awning(b, 'e', 0.5, SHOPFRONT_CEILING)],
  ],
];

const INDUSTRIAL: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => loadingCanopy(b, 's')],
  [
    b => [...loadingCanopy(b, 's'), ...loadingCanopy(b, 'w')],
    b => [...loadingCanopy(b, 's'), blade(b, 'n', SIGN_Y, 0.9)],
  ],
];

const RES_HIGH: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => awning(b, 's', 0.4, SHOPFRONT_CEILING)],
  [b => [...awning(b, 's', 0.55, SHOPFRONT_CEILING), ...awning(b, 'n', 0.4, SHOPFRONT_CEILING)]],
];

const RECIPES: Record<string, [Recipe[], Recipe[], Recipe[]]> = {
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: RES_HIGH,
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    COMMERCIAL_LOW,
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  COMMERCIAL_HIGH,
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        INDUSTRIAL,
  [heightKey(ZoneType.OFFICE, 'LOW')]:            OFFICE,
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           OFFICE,
};

/** This (zone, density, level)'s overhangs. Low-density residential and most zones at L1 have none. */
export function getOverheadVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  const band = overheadBand(zoneType, density, level);
  if (!band) return [];
  const byLevel = RECIPES[heightKey(zoneType, density)];
  if (!byLevel) return [];
  const recipes = byLevel[Math.max(1, Math.min(3, level)) - 1]!;
  return recipes.map(recipe => () => mergeGeometries(recipe(band))!);
}

/** The clearance constant is re-exported so geometry authors need not compute it. */
export { OVERHEAD_CLEARANCE };
