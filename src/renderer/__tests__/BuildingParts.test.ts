import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  PART_WALL, PART_DETAIL, PART_FOLIAGE, PART_ROOF, PART_THRESHOLDS,
  tagPart, ZONE_CAT, stampZoneCategory, triangleCount,
} from '../geometry/buildings/parts';
import { ZoneType } from '../../core/grid/types';

/**
 * BUG-223：`position.count / 3` 數的是頂點不是三角形。所有建築幾何都是索引
 * 幾何，頂點被多個面共用，所以那個算法少報三到五成 —— 展示區的預算計數器
 * 因此一直在低報。
 */
describe('triangleCount', () => {
  it('should count faces, not vertices, on an indexed geometry', () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    expect(box.index).not.toBeNull();
    expect(box.getAttribute('position').count).toBe(24); // 每個角被三個面各用一次
    expect(triangleCount(box)).toBe(12);                 // 六個面 x 兩個三角形
  });

  it('should still be right when a geometry has no index', () => {
    const plain = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    expect(plain.index).toBeNull();
    expect(triangleCount(plain)).toBe(12);
  });

  it('should never return a fraction', () => {
    // 小數就是在數頂點 —— 那是這個 bug 現形的方式。
    for (const geo of [
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.SphereGeometry(1, 5, 4),
      new THREE.CylinderGeometry(1, 1, 1, 5),
      new THREE.ConeGeometry(1, 1, 6),
    ]) {
      expect(Number.isInteger(triangleCount(geo))).toBe(true);
    }
  });
});

/**
 * 零件標籤是頂點色的 R 通道，shader 用門檻把它切成四段。標籤與門檻分屬
 * 兩個檔案時，改了一邊忘了另一邊不會有任何東西報錯 —— 屋頂物件被畫上
 * 窗戶就是這樣來的。這裡把兩者放在一起，並且斷言它們一致。
 */
describe('part tags sit in the buckets the shader cuts', () => {
  it('should keep every tag distinct', () => {
    const tags = [PART_WALL, PART_DETAIL, PART_FOLIAGE, PART_ROOF];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('should classify wall as wall', () => {
    expect(PART_WALL).toBeLessThan(PART_THRESHOLDS.ROOF_BY_NORMAL);
  });

  it('should keep detail out of every other bucket', () => {
    // 高於「法線可判定為屋頂」的上限，所以水平面的細節不會變成屋頂；
    // 低於植栽下限，所以不會被上成綠色；遠低於屋頂下限。
    expect(PART_DETAIL).toBeGreaterThan(PART_THRESHOLDS.ROOF_BY_NORMAL);
    expect(PART_DETAIL).toBeLessThan(PART_THRESHOLDS.FOLIAGE_MIN);
    expect(PART_DETAIL).toBeLessThan(PART_THRESHOLDS.ROOF_MIN);
  });

  it('should classify foliage as foliage', () => {
    expect(PART_FOLIAGE).toBeGreaterThan(PART_THRESHOLDS.FOLIAGE_MIN);
    expect(PART_FOLIAGE).toBeLessThan(PART_THRESHOLDS.FOLIAGE_MAX);
  });

  it('should classify roof as roof', () => {
    expect(PART_ROOF).toBeGreaterThan(PART_THRESHOLDS.ROOF_MIN);
  });
});

describe('tagPart', () => {
  it('should write the tag on every vertex', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_DETAIL);
    const attr = geo.getAttribute('color');
    expect(attr.count).toBe(geo.getAttribute('position').count);
    for (let i = 0; i < attr.count; i++) {
      expect(attr.getX(i)).toBeCloseTo(PART_DETAIL, 6);
    }
  });

  it('should leave the zone channel at zero for stampZoneCategory to fill', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_WALL);
    const attr = geo.getAttribute('color');
    for (let i = 0; i < attr.count; i++) expect(attr.getY(i)).toBe(0);
  });
});

describe('stampZoneCategory', () => {
  it('should write the category on every vertex without touching the part tag', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_ROOF);
    stampZoneCategory(geo, ZONE_CAT[ZoneType.INDUSTRIAL]!);
    const attr = geo.getAttribute('color');
    for (let i = 0; i < attr.count; i++) {
      expect(attr.getX(i)).toBeCloseTo(PART_ROOF, 6);
      expect(attr.getY(i)).toBeCloseTo(ZONE_CAT[ZoneType.INDUSTRIAL]!, 6);
    }
  });

  it('should give every zone type a distinct category', () => {
    const cats = Object.values(ZONE_CAT);
    expect(new Set(cats).size).toBe(cats.length);
  });
});
