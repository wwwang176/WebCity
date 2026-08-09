import { describe, it, expect } from 'vitest';
import {
  RASTER, maxAbsOf, topOf, overlapOf, centroidOffset,
  rasterise, rotate90, differenceRatio, type Volume,
} from '../geometry/buildings/massing/volume';

const box = (o: Partial<Volume> = {}): Volume =>
  ({ x: 0, z: 0, w: 0.6, d: 0.6, y0: 0, y1: 0.5, ...o });

describe('volume measurement', () => {
  it('should measure the furthest corner from the cell centre', () => {
    // 用「離格心的最大距離」而不是包圍盒寬度：非置中的量體會單邊外凸，
    // 而寬度看不出來。那正是 BUG-222 的一半。
    expect(maxAbsOf([box()])).toBeCloseTo(0.3, 12);
    expect(maxAbsOf([box({ x: 0.2 })]), '偏心的量體').toBeCloseTo(0.5, 12);
    expect(maxAbsOf([box({ w: 0.4, d: 0.9 })]), '深比寬大').toBeCloseTo(0.45, 12);
  });

  it('should report the tallest point', () => {
    expect(topOf([box({ y1: 0.4 }), box({ y0: 0.4, y1: 0.9 })])).toBeCloseTo(0.9, 12);
  });

  it('should find no overlap between stacked volumes', () => {
    // 裙樓與塔身共用一個平面：塔的底等於裙樓的頂，接觸不算重疊。
    expect(overlapOf(box({ y1: 0.3 }), box({ y0: 0.3, y1: 1.0 }))).toBe(0);
  });

  it('should find no overlap between volumes side by side', () => {
    expect(overlapOf(box({ x: -0.3, w: 0.4 }), box({ x: 0.3, w: 0.2 }))).toBe(0);
  });

  it('should measure the intersection when volumes really do overlap', () => {
    // 重疊的量體會產生看不見的內部面 —— 白吃三角形，而且畫面上完全看不出來。
    const a = box({ x: 0, w: 0.4, d: 0.4, y0: 0, y1: 1 });
    const b = box({ x: 0.2, w: 0.4, d: 0.4, y0: 0, y1: 1 });
    expect(overlapOf(a, b)).toBeCloseTo(0.2 * 0.4 * 1, 12);
  });

  it('should call a centred single box symmetric', () => {
    expect(centroidOffset([box()])).toBeCloseTo(0, 12);
  });

  it('should call an L-shape asymmetric', () => {
    // 兩翼的重心明顯偏離包圍盒中心。
    const l: Volume[] = [
      { x: -0.1, z: 0, w: 0.4, d: 0.7, y0: 0, y1: 0.6 },
      { x: 0.2, z: -0.2, w: 0.3, d: 0.3, y0: 0, y1: 0.6 },
    ];
    expect(centroidOffset(l)).toBeGreaterThan(0.04);
  });

  it('should not be fooled by a box that is merely wider than deep', () => {
    // 7.5 x 8.2 的盒子轉 90 度看起來還是同一個盒子。重心法看得出來，
    // 光柵差異法看不出來 —— 這正是這個指標存在的理由。
    expect(centroidOffset([box({ w: 0.5, d: 0.7 })])).toBeCloseTo(0, 12);
  });
});

describe('silhouette raster', () => {
  it('should record the height of each cell', () => {
    const g = rasterise([box({ w: 1.0, d: 1.0, y1: 0.42 })]);
    expect(g.length).toBe(RASTER * RASTER);
    for (let i = 0; i < g.length; i++) expect(g[i]).toBeCloseTo(0.42, 6);
  });

  it('should leave empty ground at zero', () => {
    const g = rasterise([box({ x: -0.25, w: 0.4, d: 1.0, y1: 0.5 })]);
    // 右半邊沒有量體。
    expect(g[RASTER * 8 + RASTER - 1]).toBe(0);
    expect(g[RASTER * 8 + 1]).toBeCloseTo(0.5, 6);
  });

  it('should keep the tallest volume when two stack', () => {
    const g = rasterise([box({ y1: 0.3 }), box({ w: 0.2, d: 0.2, y0: 0.3, y1: 0.8 })]);
    expect(g[RASTER * 8 + 8]).toBeCloseTo(0.8, 6);
  });

  it('should rotate a quarter turn', () => {
    const g = rasterise([box({ x: -0.3, w: 0.3, d: 0.9, y1: 0.5 })]);
    const r = rotate90(g);
    expect(r.length).toBe(g.length);
    // 轉過之後原本靠西的那一條不再在原位。
    expect(differenceRatio(g, r, 0.05)).toBeGreaterThan(0.1);
  });

  it('should call a shape identical to itself', () => {
    const g = rasterise([box()]);
    expect(differenceRatio(g, g, 0.05)).toBe(0);
  });

  it('should call a square box unchanged by rotation', () => {
    // 正方形的盒子轉 90 度是無操作 —— 那就是現行變體的處境。
    const g = rasterise([box({ w: 0.6, d: 0.6 })]);
    expect(differenceRatio(g, rotate90(g), 0.05)).toBe(0);
  });

  it('should ignore height differences below the tolerance', () => {
    // 容差取半層樓：矮了 10 公分不算「不一樣的形狀」。
    // 量體要鋪滿整格，否則「差異率」的分母包含大片空地，看起來像沒差多少。
    const a = rasterise([box({ w: 1, d: 1, y1: 0.50 })]);
    const b = rasterise([box({ w: 1, d: 1, y1: 0.51 })]);
    expect(differenceRatio(a, b, 0.05)).toBe(0);
    expect(differenceRatio(a, b, 0.005)).toBeGreaterThan(0.9);
  });
});
