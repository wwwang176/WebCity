import { describe, it, expect } from 'vitest';
import {
  hashCell, STREAM, variantIndexOf, appearanceOf,
} from '../BuildingAppearance';

/**
 * 這裡的每一條都對應 BuildingRenderer 現行寫法的一個具體缺陷或性質：
 * 決定論是存檔重開一致的前提；流獨立性直接針對舊寫法的對角線相關性；
 * 範圍是為了讓既有的視覺調校不被這次重構改變。
 */
describe('hashCell', () => {
  it('should return the same value for the same inputs', () => {
    expect(hashCell(3, 7, 0, STREAM.VARIANT)).toBe(hashCell(3, 7, 0, STREAM.VARIANT));
  });

  it('should stay inside [0, 1)', () => {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const v = hashCell(x, y, 0, STREAM.HEIGHT);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('should not share any stream value between cells 100 apart on the diagonal', () => {
    // 舊寫法的具體失效模式：hash(x+100,y+100) 在 (0,0) 等於 hash(x,y) 在 (100,100)，
    // 所以 (0,0) 與 (100,100) 的多條流共用同一批數字、只是換了角色。
    //
    // 斷言的是「兩格的所有流值合起來全部相異」，而不是「a 的每個值都不等於
    // b 的每個值」。後者在「根本沒有流」的實作下會空過：那時每格的所有流
    // 都塌成同一個值，兩格各一個值，兩兩自然不相等。
    const streams = Object.values(STREAM);
    const all = [
      ...streams.map(s => hashCell(0, 0, 0, s)),
      ...streams.map(s => hashCell(100, 100, 0, s)),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('should give a different value for each stream of the same cell', () => {
    const seen = new Set<number>();
    for (const s of Object.values(STREAM)) seen.add(hashCell(12, 34, 0, s));
    expect(seen.size).toBe(Object.values(STREAM).length);
  });

  it('should change when only seedByte changes', () => {
    expect(hashCell(5, 5, 0, STREAM.VARIANT)).not.toBe(hashCell(5, 5, 1, STREAM.VARIANT));
  });
});

describe('variantIndexOf', () => {
  it('should always land inside the variant list', () => {
    for (let x = 0; x < 60; x++) {
      for (let y = 0; y < 60; y++) {
        const i = variantIndexOf(x, y, 0, 8);
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(8);
      }
    }
  });

  it('should use every variant roughly evenly', () => {
    const counts = new Array<number>(8).fill(0);
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) counts[variantIndexOf(x, y, 0, 8)]!++;
    }
    const expected = 10000 / 8;
    for (const c of counts) {
      expect(c).toBeGreaterThan(expected * 0.7);
      expect(c).toBeLessThan(expected * 1.3);
    }
  });

  it('should return 0 rather than NaN when there are no variants', () => {
    expect(variantIndexOf(1, 1, 0, 0)).toBe(0);
  });
});

describe('appearanceOf', () => {
  const input = {
    x: 4, y: 9, zoneType: 2, level: 2, seedByte: 0,
    variantCount: 8, paletteSize: 8,
  };

  it('should depend on nothing but its inputs', () => {
    expect(appearanceOf(input)).toEqual(appearanceOf({ ...input }));
  });

  it('should keep scale jitter inside the ranges the look was tuned with', () => {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const a = appearanceOf({ ...input, x, y });
        expect(a.widthScale).toBeGreaterThanOrEqual(0.85);
        expect(a.widthScale).toBeLessThanOrEqual(1.15);
        expect(a.depthScale).toBeGreaterThanOrEqual(0.85);
        expect(a.depthScale).toBeLessThanOrEqual(1.15);
        expect(a.heightScale).toBeGreaterThanOrEqual(0.95);
        expect(a.heightScale).toBeLessThanOrEqual(1.05);
        expect([0, 1, 2, 3]).toContain(a.rotationQuarter);
        expect(a.paletteIndex).toBeGreaterThanOrEqual(0);
        expect(a.paletteIndex).toBeLessThan(8);
      }
    }
  });

  it('should keep height jitter well under one storey', () => {
    // ±17.5% 讓同一等級的房子高矮差一層樓，看起來像等級不同。
    // 目標高度表落實之後，抖動只該是同一種建築的自然差異。
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = 0; x < 60; x++) {
      for (let y = 0; y < 60; y++) {
        const h = appearanceOf({ ...input, x, y }).heightScale;
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    expect(hi / lo).toBeLessThan(1.12);
  });

  it('should produce three facade seed components, each in [0, 1)', () => {
    const a = appearanceOf(input);
    expect(a.facadeSeed).toHaveLength(3);
    for (const v of a.facadeSeed) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('should give two neighbouring cells different facade seeds', () => {
    const a = appearanceOf({ ...input, x: 10, y: 10 });
    const b = appearanceOf({ ...input, x: 11, y: 10 });
    expect(a.facadeSeed).not.toEqual(b.facadeSeed);
  });

  it('should agree with variantIndexOf', () => {
    expect(appearanceOf(input).variantIndex)
      .toBe(variantIndexOf(input.x, input.y, input.seedByte, input.variantCount));
  });
});
