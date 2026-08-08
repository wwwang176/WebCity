import { describe, it, expect } from 'vitest';
import {
  BUILDING_VERT, BUILDING_FRAG, getBuildingMaterial, resetBuildingMaterial,
} from '../BuildingMaterial';
import { PART_THRESHOLDS } from '../geometry/buildings/parts';

/**
 * GLSL 本身測不了，但「TS 常數有沒有真的進到 GLSL 裡」測得了 —— 而那正是
 * 兩邊會漂移的地方。
 */
describe('the shader uses the thresholds the parts module defines', () => {
  it('should carry every threshold value into the fragment source', () => {
    for (const v of Object.values(PART_THRESHOLDS)) {
      expect(BUILDING_FRAG).toContain(String(v));
    }
  });

  it('should declare the attributes the renderer writes', () => {
    expect(BUILDING_VERT).toContain('attribute float aHighlight;');
    expect(BUILDING_VERT).toContain('attribute vec3 aHighlightColor;');
    expect(BUILDING_VERT).toContain('attribute float aOccupancy;');
  });
});

describe('getBuildingMaterial', () => {
  it('should return the same instance every time', () => {
    resetBuildingMaterial();
    expect(getBuildingMaterial()).toBe(getBuildingMaterial());
  });

  it('should expose the uniforms the renderer drives', () => {
    resetBuildingMaterial();
    const m = getBuildingMaterial();
    expect(m.uniforms.uGlobalOpacity).toBeDefined();
    expect(m.uniforms.uDesaturate).toBeDefined();
    expect(m.uniforms.uTime).toBeDefined();
    expect(m.lights).toBe(true);
    expect(m.vertexColors).toBe(true);
  });
});
