import { hashCell } from '../../../BuildingAppearance';
import type { Density } from '../registry';

/** Each call returns a new value in [0, 1). */
export type Rng = () => number;

/**
 * A deterministic random stream belonging to one variant.
 *
 * A different thing from `BuildingAppearance`'s per-cell randomness: that decides which variant a
 * cell uses, and this decides what that variant looks like. A variant's shape must not vary by
 * cell — its geometry is one copy shared across the bucket, and one variant has to look identical
 * everywhere in the city.
 *
 * The four inputs are packed into `hashCell`'s first two parameters, all within safe ranges: zone
 * 1-6, level 1-3, variant 0-7, density 0-1. The fourth parameter serves as a call counter.
 */
export function variantRng(
  zoneType: number, density: Density, level: number, variantIndex: number,
): Rng {
  const a = zoneType * 8 + level;
  const b = variantIndex * 2 + (density === 'HIGH' ? 1 : 0);
  let n = 0;
  return () => hashCell(a, b, 0, n++);
}
