import { describe, it, expect } from 'vitest';
import { BUILDING_VERT } from '../BuildingMaterial';

/**
 * Where a building's wall colour comes from.
 *
 * Zoned buildings go through `InstancedMesh.setColorAt` into `instanceColor`. Civic buildings are
 * plain `Mesh` nodes under a `THREE.Group` in the game and plain `Mesh` nodes in the showcase, so
 * they have **no** `instanceColor` and fall to the `#else` branch.
 *
 * With `vec3(0.7)` hardcoded in that branch, a police station and a fire station both get one flat
 * grey, and "police blue, fire red" is unreachable.
 */
/**
 * Cuts out only the section that decides `vBldgColor`.
 *
 * `indexOf('#ifdef USE_INSTANCING')` cannot serve as the end: `USE_INSTANCING` is a prefix of
 * `USE_INSTANCING_COLOR`, so it matches back at the start and yields an empty string, and an empty
 * string silently passes every assertion other than `toContain`.
 */
function colourBlock(): string {
  const start = BUILDING_VERT.indexOf('#ifdef USE_INSTANCING_COLOR');
  const end = BUILDING_VERT.indexOf('mat4 world');
  return BUILDING_VERT.slice(start, end);
}

describe('非實例化的建築也要有自己的顏色', () => {
  it('should declare the per-geometry colour attribute', () => {
    expect(BUILDING_VERT, '沒有宣告 aBldgColor').toContain('attribute vec3 aBldgColor;');
  });

  it('should read that attribute when there is no instanceColor', () => {
    const block = colourBlock();
    expect(block.length, '找不到 vBldgColor 的指定').toBeGreaterThan(0);
    expect(block, '非實例化的分支還是寫死的灰').not.toContain('vec3(0.7)');
    expect(block, '非實例化的分支沒有讀 aBldgColor').toContain('vBldgColor = aBldgColor;');
  });

  it('should still prefer instanceColor when instancing', () => {
    // The path zoned buildings take in game. Broken, every building in the city turns one colour.
    const block = colourBlock();
    expect(block).toContain('vBldgColor = instanceColor;');
    expect(block.indexOf('instanceColor'), 'instanceColor 不在 #ifdef 那一支')
      .toBeLessThan(block.indexOf('aBldgColor'));
  });
});
