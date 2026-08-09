import { describe, it, expect } from 'vitest';
import {
  TARGET_HEIGHTS_M, TARGET_WIDTHS_M, FOOTPRINTS, getVariants, LEVELS, variantWidthUnits,
  footprintEnvelopeUnits, footprintScaleFor, footprintScaleFrom, widthJitterFor,
  type Density,
} from '../geometry/buildings/registry';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

function eachBucket(fn: (zoneType: number, density: Density, level: number, vi: number) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    const zoneType = Number(zs);
    const density = ds as Density;
    for (const level of LEVELS) {
      const variants = getVariants(zoneType, level);
      for (let vi = 0; vi < variants.length; vi++) fn(zoneType, density, level, vi);
    }
  }
}

describe('footprint envelope', () => {
  it('should keep every variant inside the pedestrian envelope at maximum jitter', () => {
    // BUG-222：20 個變體有 14 個越線，其中 4 個吃進鄰居的格子。舊的上限
    // 只保證「寬度 <= 1 格」，而行人的門節點在 0.4083 外側。
    eachBucket((zoneType, density, level, vi) => {
      const half = footprintEnvelopeUnits(zoneType, density, level, vi);
      expect(half, `zone ${zoneType}/${density} L${level} v${vi}`)
        .toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
    });
  });

  it('should still draw the approved width at median jitter', () => {
    // 修法不得偷偷把已確認的尺寸改小。若上限咬到了，畫出來的寬度會小於
    // 尺寸表 x 抖動中位數 —— 這一條就是在盯「上限退化成安全網」。
    eachBucket((zoneType, density, level, vi) => {
      const target = TARGET_WIDTHS_M[`${zoneType}:${density}`]!;
      const { down, up } = widthJitterFor(zoneType, density);
      const median = 1 - down + 0.5 * (down + up);
      const drawnM = variantWidthUnits(zoneType, density, level, vi)
        * footprintScaleFor(zoneType, density, level, vi, 0.5) * METRES_PER_CELL;
      expect(drawnM, `zone ${zoneType}/${density} L${level} v${vi}`)
        .toBeCloseTo(target * median, 6);
    });
  });
});

describe('footprintScaleFrom', () => {
  const JITTER = { down: 0.15, up: 0.15 };

  it('should refuse to scale a variant past the envelope however big the target', () => {
    // 現行尺寸表裡「想要的寬度」永遠先咬，所以上限是護欄而不是常態路徑。
    // 護欄要能擋住的是「有人把目標寬度調過頭」—— 那正是 BUG-222 的發生方式。
    for (const targetM of [9.8, 12, 14, 30]) {
      for (const units of [0.4, 0.5, 0.68, 1.0]) {
        const maxAbs = units / 2;
        const scale = footprintScaleFrom(targetM, units, maxAbs, JITTER, 1);
        expect(maxAbs * scale, `target ${targetM}m units ${units}`)
          .toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
      }
    }
  });

  it('should still honour a target that fits', () => {
    // 護欄不得在合法範圍內動手腳。
    const scale = footprintScaleFrom(6.0, 0.5, 0.25, JITTER, 0.5);
    expect(0.5 * scale * METRES_PER_CELL).toBeCloseTo(6.0, 9);
  });

  it('should measure the ceiling from the centre, not from the width', () => {
    // 單邊外凸的幾何：寬 0.68 但最大半距 0.43。用寬度算上限會放它過去。
    const scale = footprintScaleFrom(9.8, 0.68, 0.43, { down: 0.15, up: 0 }, 1);
    expect(0.43 * scale).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
  });

  it('should not divide by zero for an empty variant', () => {
    expect(footprintScaleFrom(6.0, 0, 0, JITTER, 0.5)).toBe(1);
    expect(Number.isFinite(footprintScaleFrom(6.0, 0.5, 0, JITTER, 0.5))).toBe(true);
  });
});

describe('centreFootprint', () => {
  it('should leave no variant lopsided about the cell centre', () => {
    // 單邊外凸會浪費另一側的餘裕：makeResHighV3 的 z 是 -0.25 ~ +0.43，
    // 等比縮放到「寬度 0.68 格」之後那一側仍在 0.43。
    eachBucket((zoneType, _d, level, vi) => {
      const geo = getVariants(zoneType, level)[vi]!();
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(Math.abs(b.max.x + b.min.x), `zone ${zoneType} L${level} v${vi} x`)
        .toBeLessThan(1e-6);
      expect(Math.abs(b.max.z + b.min.z), `zone ${zoneType} L${level} v${vi} z`)
        .toBeLessThan(1e-6);
      geo.dispose();
    });
  });

  it('should keep buildings standing on the ground', () => {
    // 置中只能動 x/z。連 y 一起置中的話建築會有一半埋進地面。
    eachBucket((zoneType, _d, level, vi) => {
      const geo = getVariants(zoneType, level)[vi]!();
      geo.computeBoundingBox();
      expect(geo.boundingBox!.min.y, `zone ${zoneType} L${level} v${vi}`)
        .toBeGreaterThanOrEqual(-1e-6);
      geo.dispose();
    });
  });
});

describe('building massing', () => {
  it('should contain no foliage — greenery lives in the ground prop layer', () => {
    // BUG-219 的機器可檢查形式：只要量體裡還有樹葉，它就會跟著等級被拉高。
    eachBucket((zoneType, _d, level, vi) => {
      const geo = getVariants(zoneType, level)[vi]!();
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const part = col.getX(i);
        expect(part > 0.35 && part < 0.65, `zone ${zoneType} L${level} v${vi} 頂點 ${i} 是樹葉`)
          .toBe(false);
      }
      geo.dispose();
    });
  });
});

describe('FOOTPRINTS', () => {
  // 這一組以前用「目標寬度 == MAX_BUILDING_WIDTH_M」來識別鋪滿基地的分區。
  // 階段 2B-2 把 9.8 調成 9.0 的那一刻，篩選條件一個也選不中，兩支測試
  // 從此空轉 —— 用資料值當哨兵，資料一動測試就悄悄失效。
  // 改成對每一筆都斷言不變式，沒有篩選就沒有空轉的餘地。

  it('should cover every zone the height table covers', () => {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      expect(FOOTPRINTS[key], `${key} 沒有基地規格`).toBeDefined();
    }
  });

  it('should never let jitter push a building past the pedestrian envelope', () => {
    // BUG-222 的不變式。抖動是**乘在**目標寬度之後的，兩者必須一起看。
    for (const [key, spec] of Object.entries(FOOTPRINTS)) {
      const maxHalf = (spec.widthM / METRES_PER_CELL / 2) * (1 + spec.jitter.up);
      expect(maxHalf, `${key} 抖到最寬時越線`).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
    }
  });

  it('should leave every zone room for its ground props', () => {
    // 階段 2B-2 縮寬的目的。0.4 m 是矮柱、垃圾桶、單車架的下限。
    for (const [key, spec] of Object.entries(FOOTPRINTS)) {
      const maxHalf = (spec.widthM / METRES_PER_CELL / 2) * (1 + spec.jitter.up);
      expect((HALF_ENVELOPE - maxHalf) * METRES_PER_CELL, `${key} 沒有物件帶`)
        .toBeGreaterThanOrEqual(0.4 - 1e-6);
    }
  });

  it('should keep some downward jitter everywhere', () => {
    // 完全取消抖動會讓一整排塔樓寬度一模一樣。
    for (const [key, spec] of Object.entries(FOOTPRINTS)) {
      expect(spec.jitter.down, `${key} down`).toBeGreaterThan(0.05);
    }
  });
});
