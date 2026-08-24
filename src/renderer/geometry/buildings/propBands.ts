import { METRES_PER_CELL } from '../../../core/grid/constants';
import type { Density } from './registry';
import { volumesFor, VARIANT_COUNT } from './massing';
import { maxAbsOf } from './massing/volume';
import {
  HALF_ENVELOPE, CELL_EDGE, OVERHEAD_CLEARANCE, FLOOR_HEIGHT_UNITS,
  SHOPFRONT_CEILING, GROUND_LAYERS,
} from './massing/metrics';

// Existing callers take these constants from propBands. The values live in massing/metrics and
// are only re-exported here: propBands measures the masses massing produces, and defining them
// here would be a cycle.
export { OVERHEAD_CLEARANCE, FLOOR_HEIGHT_UNITS, SHOPFRONT_CEILING, GROUND_LAYERS };

/**
 * The three placement bands for ground objects.
 *
 * Deriving only the low-prop band gives "only low-density residential has room", which is correct
 * as far as it goes but covers only things that stand on the ground, occupy height, and can be
 * walked into. The other two have entirely different constraints:
 *
 *   decals    perfectly flat, walked on — that is a sidewalk, and it can reach the cell boundary
 *   overhead  lowest point above head height, walked under — it can project like an arcade
 *
 * Both have more than a metre of room in every zone, and neither requires changing any building
 * dimension.
 */

/** No low-prop band narrower than 0.4 m: nothing visible fits in less. */
const MIN_LOW_BAND = 0.4 / METRES_PER_CELL;

/** No decal or overhead band narrower than 1 m. */
const MIN_WIDE_BAND = 1.0 / METRES_PER_CELL;

export interface Band {
  inner: number;
  outer: number;
}

/**
 * Where the building's wall is — but the eight variants in a bucket differ in width, so "where is
 * the wall" has two answers, and which one applies depends on whether the object **has to touch**
 * the wall:
 *
 *   widest       for free-standing things. Trees and bins go outside **every** building, or the
 *                widest one swallows them into its wall.
 *   narrowest    for things that attach. Canopies and paving have to reach **every** building, and
 *                the excess buries inside the wall where it is hidden.
 *
 * Using the widest value for something that attaches is BUG-226: only the widest building is
 * reached, and on every other one it floats 0.68 to 1.17 m away.
 *
 * Both values are **measured** by running the eight variants' masses, rather than derived as
 * target width times a jitter factor. A derivation running separately from the geometry is exactly
 * how BUG-226 happened, and measuring masses needs no geometry, so it is cheap.
 */
function edgesOf(
  zoneType: number, density: Density, level: number,
): { lo: number; hi: number } | null {
  const key = `${zoneType}:${density}:${level}`;
  const hit = edgeCache.get(key);
  if (hit !== undefined) return hit;

  let lo = Infinity;
  let hi = 0;
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    const vs = volumesFor(zoneType, density, level, vi);
    if (vs.length === 0) continue;
    const m = maxAbsOf(vs);
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
  }
  const out = hi > 0 ? { lo, hi } : null;
  edgeCache.set(key, out);
  return out;
}

/** The measurement cache. Running all eight variants for every building placed makes startup slow. */
const edgeCache = new Map<string, { lo: number; hi: number } | null>();

/** The widest variant's wall. The inner edge for free-standing objects. */
export function widestBuildingEdge(
  zoneType: number, density: Density, level: number,
): number | null {
  return edgesOf(zoneType, density, level)?.hi ?? null;
}

/** The narrowest variant's wall. The inner edge for objects that attach. */
export function narrowestBuildingEdge(
  zoneType: number, density: Density, level: number,
): number | null {
  return edgesOf(zoneType, density, level)?.lo ?? null;
}

function band(inner: number | null, outer: number, min: number): Band | null {
  if (inner === null || outer - inner < min) return null;
  return { inner, outer };
}

/**
 * Decals: from the building's wall to the cell boundary. Pedestrians walk on them, so they may
 * cover the walkway.
 *
 * The inner edge takes the narrowest wall: paving has to reach every building's foot, and the part
 * reaching under a building is hidden by the building itself. With the widest value, a ring of
 * bare ground shows at the foot of the narrower ones.
 */
export function decalBand(
  zoneType: number, density: Density, level: number,
): Band | null {
  return band(narrowestBuildingEdge(zoneType, density, level), CELL_EDGE, MIN_WIDE_BAND);
}

/** Low props: from the building's wall to the pedestrian envelope. Free-standing, so the inner edge takes the widest wall. Returns null below 0.4 m. */
export function lowPropBand(
  zoneType: number, density: Density, level: number,
): Band | null {
  return band(widestBuildingEdge(zoneType, density, level), HALF_ENVELOPE, MIN_LOW_BAND);
}

/** Overhead: the same width and the same reasoning as decals, but an object's lowest point has to clear `OVERHEAD_CLEARANCE`. */
export function overheadBand(
  zoneType: number, density: Density, level: number,
): Band | null {
  return band(narrowestBuildingEdge(zoneType, density, level), CELL_EDGE, MIN_WIDE_BAND);
}
