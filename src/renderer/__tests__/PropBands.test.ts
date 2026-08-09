import { describe, it, expect } from 'vitest';
import {
  buildingEdge, decalBand, lowPropBand, overheadBand, OVERHEAD_CLEARANCE,
} from '../geometry/buildings/propBands';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, widthJitterFor, type Density }
  from '../geometry/buildings/registry';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;
const CELL_EDGE = 0.5;

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
  it('should exist for every zone, including the plot-filling ones', () => {
    // 本階段的核心主張：貼片不受行人包絡線限制。
    eachBucket((z, d, key) => {
      const band = decalBand(z, d);
      expect(band, `${key} 沒有貼片帶`).not.toBeNull();
      expect((band!.outer - band!.inner) * METRES_PER_CELL, key).toBeGreaterThan(1.0);
    });
  });

  it('should stop at the cell edge', () => {
    // 越過格子邊界就是鋪到鄰居家或馬路上。
    eachBucket((z, d, key) => {
      expect(decalBand(z, d)!.outer, key).toBeLessThanOrEqual(CELL_EDGE + 1e-9);
    });
  });

  it('should start outside the widest the building can jitter to', () => {
    eachBucket((z, d, key) => {
      expect(decalBand(z, d)!.inner, key)
        .toBeGreaterThanOrEqual(buildingEdge(z, d)! - 1e-9);
    });
  });

  it('should reach further out than the low prop band', () => {
    // 貼片可以蓋過走道，矮物件不行 —— 兩者若一樣寬，就是有一邊算錯了。
    eachBucket((z, d, key) => {
      const low = lowPropBand(z, d);
      if (!low) return;
      expect(decalBand(z, d)!.outer, key).toBeGreaterThan(low.outer);
    });
  });
});

describe('lowPropBand', () => {
  it('should never reach past the pedestrian envelope', () => {
    eachBucket((z, d, key) => {
      const band = lowPropBand(z, d);
      if (!band) return;
      expect(band.outer, key).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
    });
  });

  it('should exist for every zone once the buildings make room', () => {
    // 縮寬（商業低／辦公低 8.4→7.8、鋪滿基地者 9.8→9.0）之後每個分區都有
    // 0.4 m 以上，放得下矮柱、垃圾桶、單車架。
    eachBucket((z, d, key) => {
      const band = lowPropBand(z, d);
      expect(band, `${key} 沒有矮物件帶`).not.toBeNull();
      expect((band!.outer - band!.inner) * METRES_PER_CELL, key)
        .toBeGreaterThanOrEqual(0.4 - 1e-6);
    });
  });

  it('should refuse a band too narrow to hold anything', () => {
    // 給一條 0.07 m 的帶子，等於默許幾何作者去猜自己塞不塞得下。
    // 用一個不在表上的分區驗證這條路徑。
    expect(lowPropBand(999, 'LOW')).toBeNull();
  });

  it('should still give the low-density house the widest yard', () => {
    const res = lowPropBand(1, 'LOW')!;
    eachBucket((z, d) => {
      if (z === 1) return;
      const other = lowPropBand(z, d)!;
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
      const band = overheadBand(z, d)!;
      expect(band.outer, key).toBeGreaterThan(HALF_ENVELOPE);
      expect(band.outer, key).toBeLessThanOrEqual(CELL_EDGE + 1e-9);
    });
  });
});

describe('buildingEdge', () => {
  it('should account for the jitter, not just the target width', () => {
    // 只用目標寬度的話，抖到最寬的房子會長進自己的院子裡。
    //
    // 斷言精確值而不是「不小於目標半寬」—— 後者在「完全不算抖動」的實作下
    // 剛好取等號，空過。
    eachBucket((z, d, key) => {
      const targetHalf = TARGET_WIDTHS_M[key]! / METRES_PER_CELL / 2;
      const { up } = widthJitterFor(z, d);
      expect(buildingEdge(z, d)!, key).toBeCloseTo(targetHalf * (1 + up), 9);
    });
  });

  it('should actually widen the edge for the zones that jitter upward', () => {
    // 上一條在 up = 0 的分區是恆等式。這一條確保「有抖動的分區真的變寬了」
    // 這件事至少被驗證一次。
    const widened = Object.keys(TARGET_HEIGHTS_M).filter((key) => {
      const [zs, ds] = key.split(':');
      const targetHalf = TARGET_WIDTHS_M[key]! / METRES_PER_CELL / 2;
      return buildingEdge(Number(zs), ds as Density)! > targetHalf + 1e-9;
    });
    expect(widened.length, '沒有任何分區的外緣被抖動撐開').toBeGreaterThan(0);
  });

  it('should return null for a zone with no buildings', () => {
    expect(buildingEdge(999, 'LOW')).toBeNull();
  });
});
