import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  PART_WALL, PART_DETAIL, PART_FOLIAGE, PART_GROUND, PART_ROOF, PART_SHELL,
  PART_WATER, PART_LAMP, PART_THRESHOLDS,
  tagPart, ZONE_CAT, stampZoneCategory, setGroundShade, triangleCount,
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

  /**
   * 每個標籤只能落進**一個**桶。
   *
   * 前面那幾條是一個標籤一條、手寫的，所以新增一個標籤時沒有任何東西會問
   * 「它跟別人撞了嗎」。`PART_SHELL` 加進來的時候正是這個處境：它要塞進
   * 一段沒有人用的號碼，而塞錯的表現是「水塔忽然變成屋頂色」——
   * 那在畫面上看起來只是「顏色怪怪的」。
   *
   * 這條把 shader 的門檻**照抄成述詞**，然後要求分類是一對一的。
   */
  it('should put every tag in exactly one bucket', () => {
    const t = PART_THRESHOLDS;
    const buckets: Record<string, (p: number) => boolean> = {
      wall: p => p < t.ROOF_BY_NORMAL,
      shell: p => p > t.SHELL_MIN && p < t.SHELL_MAX,
      detail: p => p > t.ROOF_BY_NORMAL && p < t.LAMP_MIN,
      lamp: p => p > t.LAMP_MIN && p < t.FOLIAGE_MIN,
      foliage: p => p > t.FOLIAGE_MIN && p < t.FOLIAGE_MAX,
      water: p => p > t.WATER_MIN && p < t.WATER_MAX,
      ground: p => p > t.GROUND_MIN && p < t.GROUND_MAX,
      roof: p => p > t.ROOF_MIN,
    };
    const want: Record<string, number> = {
      wall: PART_WALL, shell: PART_SHELL, detail: PART_DETAIL, lamp: PART_LAMP,
      foliage: PART_FOLIAGE, water: PART_WATER, ground: PART_GROUND, roof: PART_ROOF,
    };
    for (const [name, value] of Object.entries(want)) {
      const hit = Object.entries(buckets).filter(([, f]) => f(value)).map(([k]) => k);
      expect(hit, `${name} (${value}) 落進 ${hit.length} 個桶`).toEqual([name]);
    }
  });

  /**
   * 標籤與門檻之間要留得下浮點誤差。
   *
   * 頂點色是 Float32，而這些數字要在 TS 端寫進屬性、在 GLSL 端拿字面值比較。
   * 兩邊都只有約 7 位有效數字，所以標籤壓在門檻上是不行的 —— 而「差一點點」
   * 的表現是某些三角形走錯分支，也就是一根柱子上零星幾片別的顏色。
   */
  it('should leave slack between every tag and its bucket walls', () => {
    const t = PART_THRESHOLDS;
    const walls = Object.values(t);
    for (const [name, value] of Object.entries({
      PART_WALL, PART_SHELL, PART_DETAIL, PART_LAMP,
      PART_FOLIAGE, PART_WATER, PART_GROUND, PART_ROOF,
    })) {
      for (const w of walls) {
        expect(Math.abs(value - w), `${name} 離門檻 ${w} 太近`)
          .toBeGreaterThan(0.02);
      }
    }
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

/**
 * 地面貼片需要自己的標籤：標成 PART_WALL 會長出窗戶，標成 PART_ROOF 會拿到
 * 屋瓦顏色。0.7 落在 shader 留在樹葉與屋頂之間的空號段。
 */
describe('PART_GROUND', () => {
  it('should sit in the gap the shader leaves between foliage and roof', () => {
    expect(PART_GROUND).toBeGreaterThan(PART_THRESHOLDS.FOLIAGE_MAX);
    expect(PART_GROUND).toBeLessThan(PART_THRESHOLDS.ROOF_MIN);
  });

  it('should not collide with any existing tag', () => {
    const tags = [PART_WALL, PART_DETAIL, PART_FOLIAGE, PART_GROUND, PART_ROOF];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('should keep the shade in the blue channel, leaving tag and zone intact', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_GROUND);
    stampZoneCategory(geo, ZONE_CAT[ZoneType.INDUSTRIAL]!);
    setGroundShade(geo, 0.25);
    const col = geo.getAttribute('color');
    for (let i = 0; i < col.count; i++) {
      expect(col.getX(i), `頂點 ${i} 標籤被蓋掉`).toBeCloseTo(PART_GROUND, 6);
      expect(col.getY(i), `頂點 ${i} 分區被蓋掉`).toBeCloseTo(ZONE_CAT[ZoneType.INDUSTRIAL]!, 6);
      expect(col.getZ(i), `頂點 ${i} 明度沒寫進去`).toBeCloseTo(0.25, 6);
    }
  });

  it('should survive stampZoneCategory running after it', () => {
    // 兩個函式都在改同一個屬性，呼叫順序不該影響結果。
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_GROUND);
    setGroundShade(geo, 0.8);
    stampZoneCategory(geo, ZONE_CAT[ZoneType.COMMERCIAL_LOW]!);
    const col = geo.getAttribute('color');
    expect(col.getZ(0)).toBeCloseTo(0.8, 6);
  });
});
