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

  it('should declare and forward the per-instance facade seed', () => {
    expect(BUILDING_VERT).toContain('attribute vec3 aSeed;');
    expect(BUILDING_VERT).toContain('varying vec3 vSeed;');
    expect(BUILDING_VERT).toContain('vSeed = aSeed;');
    expect(BUILDING_FRAG).toContain('varying vec3 vSeed;');
  });

  it('should no longer hardcode the floor height and window width', () => {
    // 這兩個常數是「高樓重複性太高」的隱藏主因：不論量體怎麼變，
    // 所有塔樓的窗戶格都一樣。
    expect(BUILDING_FRAG).not.toContain('float floorH =');
    expect(BUILDING_FRAG).not.toContain('float winW =');
  });

  it('should branch on the detail tag before it reaches the wall branch', () => {
    // 沒有這個分支，第三階段的水塔與冷氣機會被畫上窗戶。
    const detailAt = BUILDING_FRAG.indexOf('isDetail');
    const wallAt = BUILDING_FRAG.indexOf('=== WALL');
    expect(detailAt).toBeGreaterThan(-1);
    expect(wallAt).toBeGreaterThan(-1);
    expect(detailAt).toBeLessThan(wallAt);
  });

  it('should give low-density residential a window grid, not just siding lines', () => {
    // 這個分支原本只有水平壁板線，所以近看沒有任何細節可看。
    const branch = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('RESIDENTIAL LOW'),
      BUILDING_FRAG.indexOf('RESIDENTIAL HIGH'),
    );
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).toContain('winMask');
    expect(branch).toContain('floorHeight');
  });

  it('should carry the ground shade from the blue channel into the fragment', () => {
    // 同一份貼片幾何裡要同時有深色柏油與淺色鋪面，而 aSeed 是逐實例的 ——
    // 它分不出同一個 mesh 內的兩塊地面。所以明度走頂點色的 B 通道。
    expect(BUILDING_VERT).toContain('varying float vGroundShade;');
    expect(BUILDING_VERT).toContain('vGroundShade = color.b;');
    expect(BUILDING_FRAG).toContain('varying float vGroundShade;');
  });

  it('should branch on the ground tag before it reaches the wall branch', () => {
    // 落到牆的分支就會長出窗戶 —— 柏油地面上一格一格的窗。
    const groundAt = BUILDING_FRAG.indexOf('isGround');
    const wallAt = BUILDING_FRAG.indexOf('=== WALL');
    expect(groundAt).toBeGreaterThan(-1);
    expect(groundAt).toBeLessThan(wallAt);
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
