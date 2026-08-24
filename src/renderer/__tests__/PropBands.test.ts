import { describe, it, expect } from 'vitest';
import {
  widestBuildingEdge, narrowestBuildingEdge, decalBand, lowPropBand, overheadBand,
  OVERHEAD_CLEARANCE, SHOPFRONT_CEILING, FLOOR_HEIGHT_UNITS,
} from '../geometry/buildings/propBands';
import { volumesFor, VARIANT_COUNT } from '../geometry/buildings/massing';
import { maxAbsOf } from '../geometry/buildings/massing/volume';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, type Density }
  from '../geometry/buildings/registry';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;
const CELL_EDGE = 0.5;
const LEVELS = [1, 2, 3] as const;

function eachBucket(fn: (zoneType: number, density: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

/**
 * Deriving only the low-prop band gives "only low-density residential has room", which is correct
 * as far as it goes but covers only things that stand on the ground, occupy height, and can be
 * walked into. The other two have different constraints: decals are walked on and overhangs are
 * walked under.
 */
describe('decalBand', () => {
  it('should exist for every zone at every level', () => {
    // The central claim here: decals are not bounded by the pedestrian envelope.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const band = decalBand(z, d, lv);
        expect(band, `${key} L${lv} 沒有貼片帶`).not.toBeNull();
        expect((band!.outer - band!.inner) * METRES_PER_CELL, `${key} L${lv}`)
          .toBeGreaterThan(1.0);
      }
    });
  });

  it('should stop at the cell edge', () => {
    // Past the cell boundary it paves a neighbour's plot or the road.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(decalBand(z, d, lv)!.outer, `${key} L${lv}`)
          .toBeLessThanOrEqual(CELL_EDGE + 1e-9);
      }
    });
  });

  it('should reach in far enough to meet the narrowest building', () => {
    // BUG-226: measured from the **widest** wall, paving leaves a ring of 0.68 to 1.17 m of bare
    // ground at the narrower buildings' feet. The part reaching under a building is hidden by the
    // building itself.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(decalBand(z, d, lv)!.inner, `${key} L${lv}`)
          .toBeLessThanOrEqual(narrowestBuildingEdge(z, d, lv)! + 1e-9);
      }
    });
  });

  it('should reach further out than the low prop band', () => {
    // Decals may cover the walkway and low props may not: equal widths mean one of the two is
    // computed wrongly.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const low = lowPropBand(z, d, lv);
        if (!low) continue;
        expect(decalBand(z, d, lv)!.outer, `${key} L${lv}`).toBeGreaterThan(low.outer);
      }
    });
  });
});

describe('lowPropBand', () => {
  it('should never reach past the pedestrian envelope', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const band = lowPropBand(z, d, lv);
        if (!band) continue;
        expect(band.outer, `${key} L${lv}`).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
      }
    });
  });

  it('should exist for every zone once the buildings make room', () => {
    // With the widths trimmed — low-density commercial and office from 8.4 to 7.8, plot-filling
    // types from 9.8 to 9.0 — every zone has at least 0.4 m, enough for bollards, bins and bike
    // racks.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const band = lowPropBand(z, d, lv);
        expect(band, `${key} L${lv} 沒有矮物件帶`).not.toBeNull();
        expect((band!.outer - band!.inner) * METRES_PER_CELL, `${key} L${lv}`)
          .toBeGreaterThanOrEqual(0.4 - 1e-6);
      }
    });
  });

  it('should refuse a band too narrow to hold anything', () => {
    // Handing back a 0.07 m band leaves the geometry's author guessing whether anything fits. This
    // exercises that path with a zone absent from the table.
    expect(lowPropBand(999, 'LOW', 1)).toBeNull();
  });

  it('should still give the low-density house the widest yard', () => {
    const res = lowPropBand(1, 'LOW', 1)!;
    eachBucket((z, d) => {
      if (z === 1) return;
      const other = lowPropBand(z, d, 1)!;
      expect(res.outer - res.inner).toBeGreaterThan(other.outer - other.inner);
    });
  });
});

describe('overheadBand', () => {
  it('should clear a walking person', () => {
    // 2.2 m is the lower bound at which a canopy clears people's heads.
    expect(OVERHEAD_CLEARANCE * METRES_PER_CELL).toBeGreaterThanOrEqual(2.2);
  });

  it('should be allowed to overhang the walkway like a real arcade', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const band = overheadBand(z, d, lv)!;
        expect(band.outer, `${key} L${lv}`).toBeGreaterThan(HALF_ENVELOPE);
        expect(band.outer, `${key} L${lv}`).toBeLessThanOrEqual(CELL_EDGE + 1e-9);
      }
    });
  });
});

describe('building edges', () => {
  it('should measure the edges from the variants, not from a jitter formula', () => {
    // As "target width times (1 +/- jitter)" this is a derivation, and a derivation running
    // separately from the geometry is exactly how BUG-226 happened. It now measures the eight
    // variants' actual values.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        let lo = Infinity;
        let hi = 0;
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          const m = maxAbsOf(volumesFor(z, d, lv, vi));
          lo = Math.min(lo, m);
          hi = Math.max(hi, m);
        }
        expect(narrowestBuildingEdge(z, d, lv)!, `${key} L${lv} 最窄`).toBeCloseTo(lo, 12);
        expect(widestBuildingEdge(z, d, lv)!, `${key} L${lv} 最寬`).toBeCloseTo(hi, 12);
      }
    });
  });

  it('should leave a real gap between the narrowest and the widest', () => {
    // If the two were equal, BUG-226's whole distinction would mean nothing. Footprints take 85% to
    // 100% of the target, so the eight variants should differ.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const gap = (widestBuildingEdge(z, d, lv)! - narrowestBuildingEdge(z, d, lv)!)
          * METRES_PER_CELL;
        expect(gap, `${key} L${lv} 最窄與最寬同寬`).toBeGreaterThan(0.2);
      }
    });
  });

  it('should never let the widest variant cross the pedestrian envelope', () => {
    // BUG-221's invariant, and now measured: a correct formula with geometry that does not follow
    // it is exactly how BUG-222 happened.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(widestBuildingEdge(z, d, lv)!, `${key} L${lv}`)
          .toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
      }
    });
  });

  it('should keep the widest variant close to the target width', () => {
    // Footprints take 85% to 100% of the target, so the widest should not fall below 85%. Below it,
    // the forecourt paving and the low-prop band pull apart and a ring of bare ground shows at the
    // wall's foot.
    eachBucket((z, d, key) => {
      const targetHalf = TARGET_WIDTHS_M[key]! / METRES_PER_CELL / 2;
      for (const lv of LEVELS) {
        expect(widestBuildingEdge(z, d, lv)!, `${key} L${lv}`)
          .toBeGreaterThanOrEqual(targetHalf * 0.85 - 1e-9);
      }
    });
  });

  it('should return null for a zone with no buildings', () => {
    expect(widestBuildingEdge(999, 'LOW', 1)).toBeNull();
    expect(narrowestBuildingEdge(999, 'LOW', 1)).toBeNull();
  });
});

describe('SHOPFRONT_CEILING', () => {
  it('should be the lowest floor the facade shader can draw', () => {
    // The storey height comes from the variant while an overhang's geometry is one copy shared
    // across the bucket, so only the lowest value guarantees it never crosses the first floor. The
    // mean or the maximum hangs it at second-floor height on the shorter ones.
    expect(SHOPFRONT_CEILING).toBe(FLOOR_HEIGHT_UNITS.MIN);
    expect(FLOOR_HEIGHT_UNITS.MIN).toBeLessThan(FLOOR_HEIGHT_UNITS.MAX);
  });

  it('should leave room above a walking person', () => {
    // A canopy has to fit between the pedestrian clearance and the first-floor line. A zero-width
    // band has no solution.
    expect((SHOPFRONT_CEILING - OVERHEAD_CLEARANCE) * METRES_PER_CELL)
      .toBeGreaterThan(0.3);
  });
});
