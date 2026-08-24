import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { Grid } from '../../core/grid/Grid';

/**
 * An overlay has to be visible where it draws, and must not paint where there is no data.
 *
 * Two independent faults share this file:
 *
 * 1. **Districts have no colours.** With no `DISTRICT` branch in `getColor`'s switch it falls to
 *    `default` and returns a fixed grey. The builder computes a hashed value per district
 *    (`district` in `OverlayBuilders.ts`, 20-99) that `getColor` never reads, leaving every
 *    district the same grey — drawn or not, it looks the same.
 *
 * 2. **The alpha never reaches the geometry.** The per-cell alpha is written into a local array and
 *    discarded while the material takes a uniform `opacity`, so **cells whose value is 0 are painted
 *    too**, in `getColor(type, 0)`, laying a uniform wash over the whole map. That affects every
 *    overlay, not only districts.
 */

const W = 16;
const H = 16;

/** Reads a vertex colour back. One vertex per cell, and vertex (i,j) is cell (i,j); the alignment is guarded by `OverlayAlignment`. */
function sample(geometry: THREE.BufferGeometry, x: number, y: number) {
  const attr = geometry.getAttribute('color');
  const idx = y * W + x;
  return {
    r: attr.getX(idx),
    g: attr.getY(idx),
    b: attr.getZ(idx),
    /** No fourth component means the alpha was never wired up at all. */
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
    // The builder gives each district a hashed value; this confirms that value reaches the screen.
    const g = build(OverlayType.DISTRICT, new Map([['3,3', 20], ['5,5', 75]]));
    const a = sample(g, 3, 3);
    const b = sample(g, 5, 5);
    const dist = Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    expect(dist, `兩個分區畫成同一個顏色（#${a.r},${a.g},${a.b}）`).toBeGreaterThan(0.2);
  });

  it('should read the value as a hue, so spread-out values stay spread out', () => {
    // This tests the renderer's half: whether the value is used as a hue. Whether the values are
    // separable is the builder's responsibility, guarded by
    // `keeps consecutively created districts far apart` in `OverlayBuilders.test.ts`. Both are
    // needed, because either failing alone leaves the districts looking the same.
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
    // This is "a uniform wash over the whole map" in machine-checkable form.
    const g = build(OverlayType.POLLUTION, new Map([['3,3', 80]]));
    expect(sample(g, 10, 10).a, '沒有資料的格子還是被塗到了').toBe(0);
  });

  it('should keep cells with data visible', () => {
    const g = build(OverlayType.POLLUTION, new Map([['3,3', 80]]));
    expect(sample(g, 3, 3).a, '有資料的格子看不見').toBeGreaterThan(0.3);
  });

  it('should do the same for every overlay type', () => {
    // Every overlay shares the same construction code, and the fault with it.
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
    // No power is 15 and undersupplied is 50: with alpha proportional to the value, the red warnings
    // that most need seeing fade to almost nothing while full green, meaning everything is fine, is
    // the most prominent thing on screen.
    const g = build(OverlayType.POWER, new Map([['3,3', 15], ['5,5', 100]]));
    expect(sample(g, 3, 3).a, '缺電的紅色警告淡到看不見')
      .toBeGreaterThan(sample(g, 5, 5).a! * 0.8);
  });
});
