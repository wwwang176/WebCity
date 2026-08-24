import { PART_WALL } from '../parts';
import type { GeoBuilder, Density } from '../registry';
import { VARIANT_COUNT, dimensionsFor } from './dimensions';
import { FLOOR_HEIGHT_UNITS } from './metrics';
import { variantRng } from './rng';
import { prototypeFor } from './prototypes';
import { roofFor, buildRoof } from './roofForms';
import { assemble } from './assemble';
import { topOf, type Volume } from './volume';

export { VARIANT_COUNT };

/**
 * This variant's masses, without geometry.
 *
 * `propBands` and the tests both read this: "where is the building's wall" and "is the silhouette
 * asymmetric" are arithmetic questions and do not require building all eight variants' geometry
 * first.
 */
export function volumesFor(
  zoneType: number, density: Density, level: number, variantIndex: number,
): Volume[] {
  const dims = dimensionsFor(zoneType, density, level, variantIndex);
  if (!dims) return [];

  // Body and roof take separate random streams. The roof **form** is layered by variantIndex and
  // draws no randomness, so sharing a stream would not lock the form; what it would lock is the
  // ridge orientation, correlating a podium tower's offset direction with a gable's facing.
  // Separating them is cheap insurance rather than a requirement.
  const bodyRng = variantRng(zoneType, density, level, variantIndex);
  const roofRng = variantRng(zoneType, density, level, variantIndex + VARIANT_COUNT);

  const body = prototypeFor(zoneType, level, variantIndex).compose(dims, bodyRng);
  // The roof caps the tallest **wall**, not the tallest mass: an industrial stack is taller than
  // its shed, and a sawtooth roof on a stack is both absurd and buries the stack itself.
  const walls = body.filter(v => (v.part ?? PART_WALL) === PART_WALL);
  const top = (walls.length > 0 ? walls : body).reduce((a, b) => (b.y1 > a.y1 ? b : a));
  const roof = buildRoof(roofFor(zoneType, level, variantIndex), top, dims, roofRng);
  return [...body, ...roof];
}

/**
 * The eight massing variants for this (zone, density, level). Returns an empty array when there
 * are no buildings.
 *
 * The geometry is produced at **final size**, with no height scaling and no footprint scaling.
 * That is the precondition for removing instance scaling: BUG-219, where trees grew with their
 * house, and BUG-226, where a canopy clung to an imagined wall, are both products of scaling.
 */
export function getMassingVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  if (!dimensionsFor(zoneType, density, level, 0)) return [];
  const out: GeoBuilder[] = [];
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    out.push(() => assemble(volumesFor(zoneType, density, level, vi)));
  }
  return out;
}

/** This variant's height, in cells. */
export function heightOf(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return topOf(volumesFor(zoneType, density, level, variantIndex));
}

/** This variant's storey height, in cells. The facade shader's window rows align to it. */
export function floorHeightOf(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return dimensionsFor(zoneType, density, level, variantIndex)?.floorHeight
    ?? (FLOOR_HEIGHT_UNITS.MIN + FLOOR_HEIGHT_UNITS.MAX) / 2;
}

/**
 * Whether this variant's **body itself** is round.
 *
 * It tests part tags rather than "is there a cylinder": industrial stacks and silos are cylinders
 * too, but they are `PART_DETAIL` while the shed itself is rectangular. Without the distinction,
 * the whole industrial zone would count as round-bodied.
 *
 * The overhead layer reads this: canopies and signage are flat panels, and against a curved wall
 * they either pierce it or float.
 */
export function isRoundBodied(
  zoneType: number, density: Density, level: number, variantIndex: number,
): boolean {
  return volumesFor(zoneType, density, level, variantIndex)
    .some(v => v.shape === 'cylinder' && (v.part ?? PART_WALL) === PART_WALL);
}
