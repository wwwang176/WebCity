import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { stampInstanceValues, floorRhythm01 } from '../../renderer/geometry/civic/instanceAttrs';
import { BUILDING_VERT } from '../../renderer/BuildingMaterial';
import { floorHeightOf, VARIANT_COUNT } from '../../renderer/geometry/buildings/massing';
import { FLOOR_HEIGHT_UNITS } from '../../renderer/geometry/buildings/massing/metrics';
import { TARGET_HEIGHTS_M, LEVELS, type Density }
  from '../../renderer/geometry/buildings/registry';

/**
 * The showcase draws plain `Mesh` nodes while the shader reads per-instance attributes. An unbound
 * attribute is 0 throughout: facades take the minimum floor height, every window's phase aligns, and
 * `aOccupancy = 0` leaves not one light on. None of the three reports anything; they only make the
 * showcase differ from the game.
 */
function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1);
}

describe('showcase instance attributes', () => {
  it('should provide every attribute the vertex shader declares', () => {
    // An attribute added to the shader without the showcase following stays 0 there forever.
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
    // A non-instanced attribute is per vertex. One value per geometry means one value per building,
    // matching the game's per-instance semantics.
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
    // 0 is a meaningful value — empty, burned — rather than unset.
    const geo = box();
    stampInstanceValues(geo, { occupancy: 0, seed: [0, 0, 0] });
    expect(geo.getAttribute('aOccupancy').getX(0)).toBe(0);
  });

  it('should encode the floor rhythm the shader decodes', () => {
    // The shader side is mix(MIN, MAX, aSeed.x). Written separately on each side, the showcase's
    // window courses fall out of line with the massing's floor lines, which is exactly what this
    // value exists to prevent.
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
