import { describe, it, expect } from 'vitest';
import { getVariants, ZONE_TYPES, LEVELS, TRIANGLE_BUDGET } from '../geometry/buildings/registry';
import { PART_THRESHOLDS, triangleCount } from '../geometry/buildings/parts';
import { ZoneType } from '../../core/grid/types';

/**
 * 幾何是手寫的，所以最容易出的錯是「某個零件忘了標記」與「不小心長到格子外面」。
 * 前者會讓那個面被 shader 當成牆去畫窗戶；後者會讓建築吃進鄰格或馬路。
 * 這兩件事在畫面上都不明顯，但在測試裡很好抓。
 */
describe('getVariants', () => {
  it('should give every zone at every level at least one variant', () => {
    for (const zone of ZONE_TYPES) {
      for (const level of LEVELS) {
        expect(getVariants(zone, level).length,
          `zone ${zone} level ${level} has no variant`).toBeGreaterThan(0);
      }
    }
  });

  it('should return an empty list for a zone that has no buildings', () => {
    expect(getVariants(ZoneType.NONE, 1)).toEqual([]);
  });
});

describe('every variant geometry', () => {
  const all = ZONE_TYPES.flatMap(zone =>
    getVariants(zone, 1).map((build, i) => ({ zone, i, geo: build() })));

  it('should tag every vertex with a known part', () => {
    const known = [0.0, 0.2, 0.5, 1.0];
    for (const { zone, i, geo } of all) {
      const attr = geo.getAttribute('color');
      expect(attr, `zone ${zone} variant ${i} has no color attribute`).toBeDefined();
      for (let v = 0; v < attr.count; v++) {
        const tag = attr.getX(v);
        expect(known.some(k => Math.abs(k - tag) < 1e-6),
          `zone ${zone} variant ${i} vertex ${v} has unknown part tag ${tag}`).toBe(true);
      }
    }
  });

  it('should stay inside its own cell', () => {
    // 建築放在格子中心，縮放最大 1.15 倍，所以未縮放的包圍盒半徑上限是
    // 0.5 / 1.15 = 0.4347。超過就會吃到鄰格。
    const limit = 0.5 / 1.15;
    for (const { zone, i, geo } of all) {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(Math.max(Math.abs(b.min.x), Math.abs(b.max.x)),
        `zone ${zone} variant ${i} overflows in x`).toBeLessThanOrEqual(limit);
      expect(Math.max(Math.abs(b.min.z), Math.abs(b.max.z)),
        `zone ${zone} variant ${i} overflows in z`).toBeLessThanOrEqual(limit);
    }
  });

  it('should sit on the ground, not under it', () => {
    for (const { zone, i, geo } of all) {
      geo.computeBoundingBox();
      expect(geo.boundingBox!.min.y,
        `zone ${zone} variant ${i} dips below ground`).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it('should stay inside the triangle budget', () => {
    for (const { zone, i, geo } of all) {
      const tris = triangleCount(geo);
      expect(tris, `zone ${zone} variant ${i} is ${tris} triangles`)
        .toBeLessThanOrEqual(TRIANGLE_BUDGET.TOWER);
    }
  });

  it('should not use the detail tag before the phase that introduces it', () => {
    // 這條是提醒，不是限制：第三階段加屋頂物件時把它刪掉。
    for (const { geo } of all) {
      const attr = geo.getAttribute('color');
      for (let v = 0; v < attr.count; v++) {
        expect(Math.abs(attr.getX(v) - 0.2)).toBeGreaterThan(1e-6);
      }
    }
  });

  it('should keep the foliage tag inside the shader foliage band', () => {
    for (const { geo } of all) {
      const attr = geo.getAttribute('color');
      for (let v = 0; v < attr.count; v++) {
        const tag = attr.getX(v);
        if (Math.abs(tag - 0.5) < 1e-6) {
          expect(tag).toBeGreaterThan(PART_THRESHOLDS.FOLIAGE_MIN);
          expect(tag).toBeLessThan(PART_THRESHOLDS.FOLIAGE_MAX);
        }
      }
    }
  });
});
