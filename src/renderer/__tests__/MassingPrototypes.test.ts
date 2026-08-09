import { describe, it, expect } from 'vitest';
import { prototypesFor, prototypeFor } from '../geometry/buildings/massing/prototypes';
import { centroidOffset } from '../geometry/buildings/massing/volume';
import { VARIANT_COUNT, type Dimensions } from '../geometry/buildings/massing/dimensions';
import { variantRng } from '../geometry/buildings/massing/rng';
import { ZONE_TYPES } from '../geometry/buildings/registry';

const LEVELS = [1, 2, 3] as const;
const DIMS: Dimensions = { w: 0.72, d: 0.68, floors: 8, floorHeight: 0.26, height: 2.08 };

describe('prototype table', () => {
  it('should give every zone at least two prototypes at every level', () => {
    // 一個原型的話八個變體只剩尺寸可以變。
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        expect(prototypesFor(z, lv).length, `zone ${z} L${lv}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('should only ever add prototypes as the level climbs', () => {
    // 等級的外型差異就靠這個。L3 少掉 L1 有的東西是筆誤。
    for (const z of ZONE_TYPES) {
      const names = (lv: number) => new Set(prototypesFor(z, lv).map(p => p.name));
      for (const lower of [1, 2]) {
        for (const n of names(lower)) {
          expect(names(lower + 1).has(n), `zone ${z} L${lower + 1} 少了 ${n}`).toBe(true);
        }
      }
      expect(names(3).size, `zone ${z} 的 L3 沒有比 L1 多`).toBeGreaterThan(names(1).size);
    }
  });

  it('should keep at least half the available prototypes asymmetric', () => {
    // prototypeFor 用 variantIndex % 可用數輪流取，所以不對稱變體的比例約等於
    // 不對稱原型的比例 —— 而驗收要 4/8。高密度分區在 L1 只有板樓與裙樓塔，
    // 兩個都對稱，所以偏置塔必須在 L1 就開放。
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        const ps = prototypesFor(z, lv);
        const asym = ps.filter(
          p => centroidOffset(p.compose(DIMS, variantRng(z, 'LOW', lv, 0))) > 0.04,
        );
        expect(asym.length * 2, `zone ${z} L${lv} 只有 ${asym.length}/${ps.length} 個不對稱`)
          .toBeGreaterThanOrEqual(ps.length);
      }
    }
  });

  it('should use every available prototype across the eight variants', () => {
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        const used = new Set<string>();
        for (let vi = 0; vi < VARIANT_COUNT; vi++) used.add(prototypeFor(z, lv, vi).name);
        expect(used.size, `zone ${z} L${lv}`).toBe(prototypesFor(z, lv).length);
      }
    }
  });

  it('should give the same prototype for the same variant every time', () => {
    for (let vi = 0; vi < VARIANT_COUNT; vi++) {
      expect(prototypeFor(3, 2, vi).name).toBe(prototypeFor(3, 2, vi).name);
    }
  });

  it('should fall back rather than crash for an unknown zone', () => {
    expect(prototypesFor(999, 1).length).toBe(0);
    expect(prototypeFor(999, 1, 0).name).toBe('single');
  });
});
