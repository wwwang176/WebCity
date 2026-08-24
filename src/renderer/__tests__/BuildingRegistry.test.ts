import { describe, it, expect } from 'vitest';
import { getMassingVariants } from '../geometry/buildings/massing';
import { ZONE_TYPES, LEVELS, TARGET_HEIGHTS_M, heightKey, type Density }
  from '../geometry/buildings/registry';
import { ZoneType } from '../../core/grid/types';

/**
 * The registry's own properties. The geometry invariants — sitting on the ground, centring, the
 * envelope, the triangle budget, the part labels — live in `MassingGeometry.test.ts`, as they are
 * the generator's responsibility rather than the registry's.
 */
describe('building variants', () => {
  it('should give every zone at every level a full set of variants', () => {
    for (const zone of ZONE_TYPES) {
      for (const density of ['LOW', 'HIGH'] as Density[]) {
        if (!TARGET_HEIGHTS_M[heightKey(zone, density)]) continue;
        for (const level of LEVELS) {
          expect(getMassingVariants(zone, density, level).length,
            `zone ${zone}/${density} L${level}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('should return an empty list for a zone that has no buildings', () => {
    expect(getMassingVariants(ZoneType.NONE, 'LOW', 1)).toEqual([]);
  });

  it('should have no zone with both densities except office', () => {
    // Offices are the only zone with buildings at both densities (BUG-220). One more means the
    // height table changed without anyone rethinking what density means.
    const both = ZONE_TYPES.filter(z =>
      TARGET_HEIGHTS_M[heightKey(z, 'LOW')] && TARGET_HEIGHTS_M[heightKey(z, 'HIGH')]);
    expect(both).toEqual([ZoneType.OFFICE]);
  });
});
