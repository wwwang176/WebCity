import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { Grid } from '../../core/grid/Grid';

/**
 * 覆蓋層畫出來要看得見，而且沒有資料的地方不能被塗到。
 *
 * 兩個獨立的缺陷共用這一支測試：
 *
 * 1. **分區沒有配色。** `getColor` 的 switch 沒有 `DISTRICT` 分支，掉進 `default`
 *    回傳固定灰。builder 特地為每個分區算了雜湊色值（`OverlayBuilders.ts` 的
 *    `district`，20–99），`getColor` 完全不看 —— 所以每一區都同一個灰，畫了跟
 *    沒畫一樣。
 *
 * 2. **透明度沒有接上 geometry。** 每格算出來的 alpha 只寫進一條本地陣列就被丟掉，
 *    材質吃的是統一的 `opacity`，於是**值為 0 的格子照樣被塗**成
 *    `getColor(type, 0)` —— 整張地圖蓋一層均勻的色。這條影響所有圖層，不只分區。
 */

const W = 16;
const H = 16;

/** 讀回頂點色。一格一個頂點，頂點 (i,j) 就是格 (i,j)（對位由 `OverlayAlignment` 守著）。 */
function sample(geometry: THREE.BufferGeometry, x: number, y: number) {
  const attr = geometry.getAttribute('color');
  const idx = y * W + x;
  return {
    r: attr.getX(idx),
    g: attr.getY(idx),
    b: attr.getZ(idx),
    /** 沒有第四個分量就代表透明度根本沒有接上。 */
    a: attr.itemSize >= 4 ? attr.getW(idx) : null,
  };
}

function build(type: OverlayType, data: Map<string, number>) {
  const renderer = new OverlayRenderer();
  const scene = new THREE.Scene();
  renderer.setOverlay(type, scene, new Grid(W, H), data);
  const mesh = (renderer as unknown as { mesh: THREE.Mesh }).mesh;
  expect(mesh, '覆蓋層沒有建起來，這支測試等於沒測').not.toBeNull();
  return mesh.geometry;
}

describe('分區覆蓋層的配色', () => {
  it('should paint two districts in two different colours', () => {
    // builder 給每個分區一個雜湊色值，這條確認那個值真的走到畫面上。
    const g = build(OverlayType.DISTRICT, new Map([['3,3', 20], ['5,5', 75]]));
    const a = sample(g, 3, 3);
    const b = sample(g, 5, 5);
    const dist = Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    expect(dist, `兩個分區畫成同一個顏色（#${a.r},${a.g},${a.b}）`).toBeGreaterThan(0.2);
  });

  it('should read the value as a hue, so spread-out values stay spread out', () => {
    // 這條測的是 renderer 這一半:值有沒有被當成色相。值本身分不分得開是 builder
    // 的責任，由 `OverlayBuilders.test.ts` 的
    // `keeps consecutively created districts far apart` 守著 —— 兩邊都要有，因為
    // 兩邊各自壞掉都會讓分區看起來一樣。
    const values = [20, 35, 50, 65, 80, 95];
    const g = build(
      OverlayType.DISTRICT,
      new Map(values.map((v, i) => [`${i * 2},3`, v])),
    );
    const hues = values.map((_, i) => {
      const c = sample(g, i * 2, 3);
      const hsl = { h: 0, s: 0, l: 0 };
      new THREE.Color(c.r, c.g, c.b).getHSL(hsl);
      return hsl.h * 360;
    });
    const uniq = new Set(hues.map(h => Math.round(h / 20)));
    expect(uniq.size, `六個分區只分出 ${uniq.size} 種色相：${hues.map(h => h.toFixed(0)).join(', ')}`)
      .toBeGreaterThanOrEqual(5);
  });

  it('should not fall through to the neutral default', () => {
    const g = build(OverlayType.DISTRICT, new Map([['3,3', 60]]));
    const c = sample(g, 3, 3);
    const isNeutral = Math.abs(c.r - c.g) < 0.02 && Math.abs(c.g - c.b) < 0.02;
    expect(isNeutral, 'DISTRICT 掉進 default 拿到中性灰').toBe(false);
  });
});

describe('覆蓋層的透明度', () => {
  it('should carry per-cell alpha on the geometry', () => {
    const g = build(OverlayType.POLLUTION, new Map([['3,3', 80]]));
    expect(g.getAttribute('color').itemSize, '頂點色只有 RGB，逐格透明度沒有接上 geometry')
      .toBe(4);
  });

  it('should leave cells with no data untouched', () => {
    // 這是「整張地圖蓋一層均勻的色」的機器可檢查形式。
    const g = build(OverlayType.POLLUTION, new Map([['3,3', 80]]));
    expect(sample(g, 10, 10).a, '沒有資料的格子還是被塗到了').toBe(0);
  });

  it('should keep cells with data visible', () => {
    const g = build(OverlayType.POLLUTION, new Map([['3,3', 80]]));
    expect(sample(g, 3, 3).a, '有資料的格子看不見').toBeGreaterThan(0.3);
  });

  it('should do the same for every overlay type', () => {
    // 所有圖層共用同一段建立程式碼，缺陷也是共用的。
    for (const type of [
      OverlayType.DISTRICT, OverlayType.POLICE, OverlayType.COMMUTE,
      OverlayType.LAND_VALUE, OverlayType.CRIME, OverlayType.GARBAGE,
    ]) {
      const g = build(type, new Map([['3,3', 80]]));
      expect(sample(g, 10, 10).a, `${type} 把沒有資料的格子也塗了`).toBe(0);
      expect(sample(g, 3, 3).a, `${type} 有資料的格子看不見`).toBeGreaterThan(0.3);
    }
  });

  it('should not fade out a low but meaningful value', () => {
    // 缺電是 15、供電不足是 50 —— 照數值等比給透明度的話，最該看到的紅色警告
    // 會淡到幾乎不見，而滿格的綠色（一切正常）反而最顯眼。
    const g = build(OverlayType.POWER, new Map([['3,3', 15], ['5,5', 100]]));
    expect(sample(g, 3, 3).a, '缺電的紅色警告淡到看不見')
      .toBeGreaterThan(sample(g, 5, 5).a! * 0.8);
  });
});
