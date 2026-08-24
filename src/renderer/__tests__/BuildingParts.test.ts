import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  PART_WALL, PART_DETAIL, PART_FOLIAGE, PART_GROUND, PART_ROOF, PART_SHELL,
  PART_WATER, PART_LAMP, PART_THRESHOLDS,
  tagPart, ZONE_CAT, stampZoneCategory, setGroundShade, triangleCount,
} from '../geometry/buildings/parts';
import { ZoneType } from '../../core/grid/types';

/**
 * BUG-223: `position.count / 3` counts vertices rather than triangles. All building geometry is
 * indexed and shares vertices between faces, so that formula under-reports by 30 to 50% — leaving
 * the showcase's budget counter reading low.
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
    // A fractional result means it is counting vertices, which is how this fault surfaces.
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
 * Part tags live in the vertex colour's R channel, which the shader cuts into segments by
 * threshold. With tags and thresholds in two files, changing one and forgetting the other reports
 * nothing — which is how rooftop objects end up with windows drawn on them. This keeps the two
 * together and asserts they agree.
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
    // Above the bound at which a normal decides a roof, so horizontal detail does not become roof;
    // below the foliage bound, so it is not coloured green; and far below the roof bound.
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
   * Every tag falls into **exactly one** bucket.
   *
   * The cases above are one hand-written case per tag, so adding a tag leaves nothing asking
   * whether it collides with another. `PART_SHELL` arrived in exactly that position: it had to fit
   * into an unused range, and getting it wrong shows up as a water tank suddenly taking roof
   * colours, which on screen reads only as "the colour looks off".
   *
   * This **transcribes the shader's thresholds as predicates** and requires the classification to
   * be one to one.
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
   * Tags leave room for floating-point error against their thresholds.
   *
   * Vertex colours are Float32, and these numbers are written into an attribute on the TS side and
   * compared against literals in GLSL. Both carry about 7 significant digits, so a tag sitting on a
   * threshold does not work — and "off by a little" shows up as some triangles taking the wrong
   * branch, that is, a few patches of another colour on a post.
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
 * Ground decals need a tag of their own: tagged PART_WALL they grow windows, and tagged PART_ROOF
 * they take roof tile colours. 0.7 falls in the range the shader leaves unused between foliage and
 * roof.
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
    // Both functions modify the same attribute, and the call order should not change the result.
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_GROUND);
    setGroundShade(geo, 0.8);
    stampZoneCategory(geo, ZONE_CAT[ZoneType.COMMERCIAL_LOW]!);
    const col = geo.getAttribute('color');
    expect(col.getZ(0)).toBeCloseTo(0.8, 6);
  });
});
