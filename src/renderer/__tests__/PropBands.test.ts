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
 * 階段 2B 只推導了矮物件那一類，結論是「只有住宅低密度有空間」。那個結論
 * 沒有錯，但它只涵蓋「站在地上、佔據高度、行人會撞到」的東西。另外兩類的
 * 限制不同 —— 貼片行人走在上面，懸挑行人從下面走過。
 */
describe('decalBand', () => {
  it('should exist for every zone at every level', () => {
    // 本階段的核心主張：貼片不受行人包絡線限制。
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
    // 越過格子邊界就是鋪到鄰居家或馬路上。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(decalBand(z, d, lv)!.outer, `${key} L${lv}`)
          .toBeLessThanOrEqual(CELL_EDGE + 1e-9);
      }
    });
  });

  it('should reach in far enough to meet the narrowest building', () => {
    // BUG-226：鋪面原本從**最寬**的牆面起算，所以窄的那些建築腳下露出一圈
    // 0.68–1.17 m 的裸地。伸進建築底下的部分被建築本身擋住，看不見。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(decalBand(z, d, lv)!.inner, `${key} L${lv}`)
          .toBeLessThanOrEqual(narrowestBuildingEdge(z, d, lv)! + 1e-9);
      }
    });
  });

  it('should reach further out than the low prop band', () => {
    // 貼片可以蓋過走道，矮物件不行 —— 兩者若一樣寬，就是有一邊算錯了。
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
    // 縮寬（商業低／辦公低 8.4→7.8、鋪滿基地者 9.8→9.0）之後每個分區都有
    // 0.4 m 以上，放得下矮柱、垃圾桶、單車架。
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
    // 給一條 0.07 m 的帶子，等於默許幾何作者去猜自己塞不塞得下。
    // 用一個不在表上的分區驗證這條路徑。
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
    // 2.2 m 是雨遮不會打到頭的下限。
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
    // 以前是「目標寬 × (1 ± 抖動)」—— 那是推出來的，而推導與幾何各走各的
    // 正是 BUG-226 發生的方式。現在量八個變體的實際值。
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
    // 兩者若相等，BUG-226 的整個分辨就沒有意義。基地在目標的 85%–100% 之間
    // 取，所以八個變體之間本來就該有距離。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const gap = (widestBuildingEdge(z, d, lv)! - narrowestBuildingEdge(z, d, lv)!)
          * METRES_PER_CELL;
        expect(gap, `${key} L${lv} 最窄與最寬同寬`).toBeGreaterThan(0.2);
      }
    });
  });

  it('should never let the widest variant cross the pedestrian envelope', () => {
    // 這是 BUG-221 的不變式，而且現在是量出來的 —— 公式算對但幾何沒照著長，
    // 正是 BUG-222 發生的方式。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(widestBuildingEdge(z, d, lv)!, `${key} L${lv}`)
          .toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
      }
    });
  });

  it('should keep the widest variant close to the target width', () => {
    // 基地在目標的 85%–100% 之間取，所以最寬的那一個不該低於 85%。
    // 低於的話前庭鋪面與矮物件帶會被拉開，牆腳露出一圈裸地。
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
    // 樓高由變體決定，懸挑物的幾何是整桶共用的一份 —— 取最低值才保證永遠
    // 不會越過一樓。取平均或最高值都會在矮的那些樓上掛到二樓去。
    expect(SHOPFRONT_CEILING).toBe(FLOOR_HEIGHT_UNITS.MIN);
    expect(FLOOR_HEIGHT_UNITS.MIN).toBeLessThan(FLOOR_HEIGHT_UNITS.MAX);
  });

  it('should leave room above a walking person', () => {
    // 雨遮要塞進 [行人淨空, 一樓樓板線] 這條帶子裡。帶子歸零就無解。
    expect((SHOPFRONT_CEILING - OVERHEAD_CLEARANCE) * METRES_PER_CELL)
      .toBeGreaterThan(0.3);
  });
});
