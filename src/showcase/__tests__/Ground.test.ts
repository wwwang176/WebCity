import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createShowcaseGround } from '../ground';
import { TERRAIN_COLORS } from '../../renderer/terrainColors';
import { TerrainType } from '../../core/grid/types';

/**
 * The showcase's floor.
 *
 * A dark green `0x3a4a3a` chosen for the showcase against the game's bright green `0x4caf50` terrain
 * differs twofold in lightness, so **the ground decals' contrast differs entirely between the two**:
 * industrial asphalt is shade 0, near black, obvious against the game's bright green and nearly lost
 * against the showcase's dark green. The showcase's only value is that what it shows is what ships,
 * and at the ground layer that was distorted.
 */
describe('showcase ground', () => {
  it('should use the same colour as the game terrain', () => {
    const ground = createShowcaseGround(120);
    const mat = ground.material as THREE.MeshLambertMaterial;
    expect(mat.color.getHex()).toBe(TERRAIN_COLORS[TerrainType.PLAIN]);
  });

  it('should use the same lighting model as the game terrain', () => {
    // The same colour under a different lighting model still gives the wrong contrast. The game's
    // terrain is a MeshLambertMaterial carrying a per-cell DataTexture.
    const ground = createShowcaseGround(120);
    expect((ground.material as THREE.Material).type).toBe('MeshLambertMaterial');
  });

  it('should lie flat at y = 0 and receive shadow', () => {
    // The decal layer is at y = 0.002, only 2.4 cm up. A slightly tilted floor swallows the whole
    // paving.
    const ground = createShowcaseGround(120);
    expect(ground.position.y).toBe(0);
    expect(ground.receiveShadow).toBe(true);
    ground.geometry.computeBoundingBox();
    const b = ground.geometry.boundingBox!;
    expect(b.max.y - b.min.y, '地板不是水平的').toBeCloseTo(0, 9);
  });

  it('should keep the industrial tarmac readable against it', () => {
    // This case is the reason for the whole thing rather than an extra refinement. Industrial is the
    // only zone using shade 0, and the shader's tarmac is vec3(0.20, 0.20, 0.21). Below a lightness
    // ratio of 2 against the floor, that paving is invisible in the showcase.
    //
    // **The two are not in the same colour space**: `THREE.Color`'s r/g/b are linear, while the
    // building material is a ShaderMaterial without colorspace_fragment included, so the numbers it
    // writes to the framebuffer are taken as already-encoded display values. The floor is converted
    // back to display space before the comparison; compared directly it gives 1.63, a number that
    // means nothing.
    const toSRGB = (v: number) =>
      (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

    const ground = createShowcaseGround(120);
    const c = (ground.material as THREE.MeshLambertMaterial).color;
    const groundLum = lum(toSRGB(c.r), toSRGB(c.g), toSRGB(c.b));
    expect(groundLum / lum(0.20, 0.20, 0.21), '柏油與地板的亮度太接近')
      .toBeGreaterThan(2);
  });
});
