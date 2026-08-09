import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { stampInstanceValues, floorRhythm01 } from '../instanceAttrs';
import { BUILDING_VERT } from '../../renderer/BuildingMaterial';
import { floorHeightOf, VARIANT_COUNT } from '../../renderer/geometry/buildings/massing';
import { FLOOR_HEIGHT_UNITS } from '../../renderer/geometry/buildings/massing/metrics';
import { TARGET_HEIGHTS_M, LEVELS, type Density }
  from '../../renderer/geometry/buildings/registry';

/**
 * 展示區畫的是普通 `Mesh`，而 shader 讀的是逐實例屬性。沒有繫結的 attribute
 * 一律是 0 —— 立面用最小樓高、窗戶相位全對齊、`aOccupancy = 0` 讓一扇燈都不亮。
 * 三者都不報錯，只是讓展示區看到的東西與遊戲不同。
 */
function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1);
}

describe('showcase instance attributes', () => {
  it('should provide every attribute the vertex shader declares', () => {
    // shader 加了新屬性而展示區沒跟上的話，那個屬性在展示區永遠是 0。
    const declared = [...BUILDING_VERT.matchAll(/attribute\s+\w+\s+(a\w+);/g)]
      .map(m => m[1]!);
    expect(declared.length, '沒有從 shader 抓到任何 attribute').toBeGreaterThan(0);

    const geo = box();
    stampInstanceValues(geo, { occupancy: 0.5, seed: [0.1, 0.2, 0.3] });
    for (const name of declared) {
      expect(geo.hasAttribute(name), `展示區沒有餵 ${name}`).toBe(true);
    }
  });

  it('should give every vertex the same value', () => {
    // 非實例化的 attribute 是逐頂點的。一份幾何一個值 = 整棟建築共用，
    // 與遊戲的逐實例語意一致。
    const geo = box();
    stampInstanceValues(geo, { occupancy: 0.75, seed: [0.1, 0.2, 0.3] });
    const occ = geo.getAttribute('aOccupancy');
    const seed = geo.getAttribute('aSeed');
    for (let i = 0; i < occ.count; i++) {
      expect(occ.getX(i), `頂點 ${i} 的 occupancy`).toBeCloseTo(0.75, 6);
      expect(seed.getX(i)).toBeCloseTo(0.1, 6);
      expect(seed.getY(i)).toBeCloseTo(0.2, 6);
      expect(seed.getZ(i)).toBeCloseTo(0.3, 6);
    }
  });

  it('should let an empty building be truly empty', () => {
    // 0 是有意義的值（空屋、燒毀），不是「沒設定」。
    const geo = box();
    stampInstanceValues(geo, { occupancy: 0, seed: [0, 0, 0] });
    expect(geo.getAttribute('aOccupancy').getX(0)).toBe(0);
  });

  it('should encode the floor rhythm the shader decodes', () => {
    // shader 端是 mix(MIN, MAX, aSeed.x)。兩邊各寫一份的話，展示區的窗戶
    // 橫列會與量體的樓板線錯開 —— 而那正是這個值存在的理由。
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const lv of LEVELS) {
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          const r = floorRhythm01(Number(zs), ds as Density, lv, vi);
          const decoded = FLOOR_HEIGHT_UNITS.MIN
            + (FLOOR_HEIGHT_UNITS.MAX - FLOOR_HEIGHT_UNITS.MIN) * r;
          expect(decoded, `${key} L${lv} v${vi}`)
            .toBeCloseTo(floorHeightOf(Number(zs), ds as Density, lv, vi), 9);
          expect(r, `${key} L${lv} v${vi} 超出 [0,1]`).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
