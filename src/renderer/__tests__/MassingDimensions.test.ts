import { describe, it, expect } from 'vitest';
import { variantRng } from '../geometry/buildings/massing/rng';
import {
  VARIANT_COUNT, heightOptions, dimensionsFor,
} from '../geometry/buildings/massing/dimensions';
import { M, FLOOR_HEIGHT_UNITS, HALF_ENVELOPE }
  from '../geometry/buildings/massing/metrics';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, type Density }
  from '../geometry/buildings/registry';

function eachBucket(fn: (z: number, d: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

const LEVELS = [1, 2, 3] as const;
const MID_FLOOR = (FLOOR_HEIGHT_UNITS.MIN + FLOOR_HEIGHT_UNITS.MAX) / 2;
/** The tall buckets. A percentage bites there, so the levels' ranges must not overlap. */
const TALL = ['2:HIGH', '4:HIGH', '6:HIGH'];

describe('variantRng', () => {
  it('should give the same stream for the same variant', () => {
    // Geometry is generated at game start and has to be vertex-identical across a save: any leaked
    // randomness gives the whole city a new set of shapes after a load.
    const a = variantRng(1, 'LOW', 2, 3);
    const b = variantRng(1, 'LOW', 2, 3);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('should give different streams to different variants', () => {
    const seen = new Set<number>();
    eachBucket((z, d) => {
      for (const lv of LEVELS) {
        for (let vi = 0; vi < VARIANT_COUNT; vi++) seen.add(variantRng(z, d, lv, vi)());
      }
    });
    // 7 buckets x 3 levels x 8 variants = 168. A collision means one input dimension never reached
    // the hash.
    expect(seen.size).toBe(168);
  });

  it('should stay inside [0, 1)', () => {
    const r = variantRng(5, 'LOW', 3, 7);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('heightOptions', () => {
  it('should never come back empty for any bucket in the table', () => {
    // An empty list means this target height reaches no integer number of storeys, leaving the
    // generator nothing to pick.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(heightOptions(M(TARGET_HEIGHTS_M[key]![lv - 1]!)).length,
          `${key} L${lv}`).toBeGreaterThan(0);
      }
    });
  });

  it('should widen the window to at least one storey', () => {
    // A fixed percentage collapses to one option on low buildings: low-density residential L1 targets
    // 5 m, and +/-10% holds only 2 storeys of 2.64 m. One storey is the meaningful lower bound in a
    // world of integer storeys.
    const floors = new Set(heightOptions(M(5)).map(o => o.floors));
    expect(floors.size, '住宅低 L1 只有一種樓層數').toBeGreaterThanOrEqual(2);
  });

  it('should keep every option within the tolerance', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const target = M(TARGET_HEIGHTS_M[key]![lv - 1]!);
        const tolerance = Math.max(0.1 * target, MID_FLOOR);
        for (const o of heightOptions(target)) {
          expect(Math.abs(o.height - target), `${key} L${lv} ${o.floors} 層`)
            .toBeLessThanOrEqual(tolerance + 1e-9);
          expect(o.height).toBeCloseTo(o.floors * o.floorHeight, 12);
          expect(o.floorHeight).toBeGreaterThanOrEqual(FLOOR_HEIGHT_UNITS.MIN - 1e-9);
          expect(o.floorHeight).toBeLessThanOrEqual(FLOOR_HEIGHT_UNITS.MAX + 1e-9);
        }
      }
    });
  });

  it('should give the tall buckets real height variety', () => {
    // Low buildings vary through roofs and wings; tall ones should vary through floor count.
    for (const key of TALL) {
      for (const lv of LEVELS) {
        expect(heightOptions(M(TARGET_HEIGHTS_M[key]![lv - 1]!)).length,
          `${key} L${lv}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('should come back sorted by height', () => {
    const opts = heightOptions(M(42));
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i]!.height).toBeGreaterThanOrEqual(opts[i - 1]!.height);
    }
  });

  it('should still find options for a target far below one storey', () => {
    // The tolerance is floored at one storey, so one storey at the minimum height always fits. This
    // confirms that floor really covers an extreme input rather than a fallback covering for it.
    const opts = heightOptions(M(0.5));
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) expect(o.floors).toBe(1);
  });
});

describe('dimensionsFor', () => {
  it('should return null for a bucket with no buildings', () => {
    expect(dimensionsFor(1, 'HIGH', 1, 0)).toBeNull();   // 住宅低沒有高密度
    expect(dimensionsFor(999, 'LOW', 1, 0)).toBeNull();
  });

  it('should use every height option across the eight variants', () => {
    // "Spread in layers" means the eight variants cover every feasible combination rather than
    // sampling at random, which can crowd all eight into the middle.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const opts = heightOptions(M(TARGET_HEIGHTS_M[key]![lv - 1]!));
        // Options are identified by (floor count, storey height) rather than by height: different
        // combinations reach the same height (5 x 0.24 = 4 x 0.30), but 4 storeys of 3.6 m and 5 of
        // 2.88 m are two different buildings with different numbers of window rows.
        const used = new Set<string>();
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          const dim = dimensionsFor(z, d, lv, vi)!;
          used.add(`${dim.floors}|${dim.floorHeight}`);
        }
        expect(used.size, `${key} L${lv} 用了 ${used.size}/${opts.length} 個組合`)
          .toBe(Math.min(opts.length, VARIANT_COUNT));
      }
    });
  });

  it('should keep the mean height climbing with level', () => {
    // The level ladder lives in the means rather than the extremes: on low buildings the tolerance is
    // wide enough for the ranges to overlap.
    eachBucket((z, d, key) => {
      const mean = (lv: number) => {
        let s = 0;
        for (let vi = 0; vi < VARIANT_COUNT; vi++) s += dimensionsFor(z, d, lv, vi)!.height;
        return s / VARIANT_COUNT;
      };
      expect(mean(2), `${key} L2 沒有比 L1 高`).toBeGreaterThan(mean(1));
      expect(mean(3), `${key} L3 沒有比 L2 高`).toBeGreaterThan(mean(2));
    });
  });

  it('should keep the tall buckets levels from overlapping at all', () => {
    // At the tall end a percentage bites, so the ladder can be required more strictly: the ranges do
    // not overlap at all.
    for (const key of TALL) {
      const [zs, ds] = key.split(':');
      const range = (lv: number) => {
        const hs: number[] = [];
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          hs.push(dimensionsFor(Number(zs), ds as Density, lv, vi)!.height);
        }
        return { lo: Math.min(...hs), hi: Math.max(...hs) };
      };
      expect(range(1).hi, `${key} L1 追上 L2`).toBeLessThan(range(2).lo);
      expect(range(2).hi, `${key} L2 追上 L3`).toBeLessThan(range(3).lo);
    }
  });

  it('should keep the footprint inside the pedestrian envelope', () => {
    // Crossing the envelope means pedestrians walk through walls (BUG-221). This guards the footprint
    // itself; a composer pushing a mass out is guarded by the composers' tests.
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          const dim = dimensionsFor(z, d, lv, vi)!;
          expect(Math.max(dim.w, dim.d) / 2, `${key} L${lv} v${vi}`)
            .toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
        }
      }
    });
  });

  it('should vary the footprint between variants', () => {
    // With identical footprints, low buildings vary only through roof form.
    const widths = new Set<number>();
    for (let vi = 0; vi < VARIANT_COUNT; vi++) {
      widths.add(Math.round(dimensionsFor(3, 'LOW', 2, vi)!.w * 1e6));
    }
    expect(widths.size).toBeGreaterThanOrEqual(6);
  });

  it('should never shrink the footprint below 85% of the target', () => {
    // Too narrow, the forecourt paving and the low-prop band pull apart and a ring of bare ground
    // shows at the wall's foot, which is the cause of BUG-226.
    eachBucket((z, d, key) => {
      const target = M(TARGET_WIDTHS_M[key]!);
      for (const lv of LEVELS) {
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          const dim = dimensionsFor(z, d, lv, vi)!;
          expect(dim.w / target, `${key} L${lv} v${vi} 寬`)
            .toBeGreaterThanOrEqual(0.85 - 1e-9);
          expect(dim.d / target, `${key} L${lv} v${vi} 深`)
            .toBeGreaterThanOrEqual(0.85 - 1e-9);
          expect(dim.w / target).toBeLessThanOrEqual(1 + 1e-9);
          expect(dim.d / target).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    });
  });
});
