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
/** 高樓的桶。百分比咬得住，等級區間必須互不重疊。 */
const TALL = ['2:HIGH', '4:HIGH', '6:HIGH'];

describe('variantRng', () => {
  it('should give the same stream for the same variant', () => {
    // 幾何在遊戲啟動時生成，存檔前後必須逐頂點相同 —— 亂數一旦洩漏，
    // 讀檔之後整座城市會換一批形狀。
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
    // 7 桶 × 3 等級 × 8 變體 = 168。撞值代表輸入的某個維度沒有進雜湊。
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
    // 空清單代表這個目標高度湊不出整數層 —— 生成器會沒有東西可挑。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(heightOptions(M(TARGET_HEIGHTS_M[key]![lv - 1]!)).length,
          `${key} L${lv}`).toBeGreaterThan(0);
      }
    });
  });

  it('should widen the window to at least one storey', () => {
    // 固定百分比在矮建築上會塌成一個選項：住宅低 L1 目標 5 m，±10% 只容得下
    // 「2 層 × 2.64 m」。一層樓的容差才是整數層世界裡有意義的下限。
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
    // 矮建築的變化來自屋頂與偏屋，高樓的變化就該來自樓層數。
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
    // 容差有一層樓的下限，所以「1 層 × 最低樓高」永遠落得進去 —— 這條
    // 確認那個下限真的兜得住極端輸入，而不是靠 fallback 補。
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
    // 「分層鋪滿」的意思：八個變體要覆蓋所有可行組合，不是隨機取樣。
    // 隨機取樣有可能八個都擠在中間。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const opts = heightOptions(M(TARGET_HEIGHTS_M[key]![lv - 1]!));
        // 用 (樓層數, 樓高) 而不是高度來認選項：不同的組合可以湊出同一個
        // 高度（5 × 0.24 = 4 × 0.30），但 4 層 3.6 m 與 5 層 2.88 m 是兩棟
        // 不同的建築 —— 窗戶橫列數不一樣。
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
    // 等級階梯活在平均值裡，不在極值裡 —— 矮建築的容差寬到區間會重疊。
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
    // 高樓那一端百分比咬得住，所以階梯可以要求得更嚴：區間完全不重疊。
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
    // 越過包絡線就是行人穿牆（BUG-221）。這裡擋的是「基地本身」，
    // 組合器把量體推出去的情形由組合器的測試擋。
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
    // 基地全一樣的話，矮建築就只剩屋頂形式可以變。
    const widths = new Set<number>();
    for (let vi = 0; vi < VARIANT_COUNT; vi++) {
      widths.add(Math.round(dimensionsFor(3, 'LOW', 2, vi)!.w * 1e6));
    }
    expect(widths.size).toBeGreaterThanOrEqual(6);
  });

  it('should never shrink the footprint below 85% of the target', () => {
    // 太窄的話前庭鋪面與矮物件帶會被拉開，牆腳露出一圈裸地（BUG-226 的成因）。
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
