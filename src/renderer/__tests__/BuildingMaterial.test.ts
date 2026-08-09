import { describe, it, expect } from 'vitest';
import {
  BUILDING_VERT, BUILDING_FRAG, getBuildingMaterial, resetBuildingMaterial,
} from '../BuildingMaterial';
import { PART_THRESHOLDS } from '../geometry/buildings/parts';
import { FLOOR_HEIGHT_UNITS, SHOPFRONT_CEILING } from '../geometry/buildings/propBands';
import { roofPaletteFor } from '../ColorPalettes';
import { ZONE_TYPES } from '../geometry/buildings/registry';

/** GLSL 一定要看得出是 float —— 整數字面值在 GLSL 裡不是 float。 */
const glslNum = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

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

  it('should carry the floor height the geometry hangs awnings from', () => {
    // 雨遮掛在「一樓樓板線」上，而樓板線是 shader 畫窗戶用的樓層高度。
    // 兩邊各寫一份的話，雨遮會壓在窗戶中間 —— 沒有任何東西會報錯。
    expect(BUILDING_FRAG).toContain(String(FLOOR_HEIGHT_UNITS.MIN));
    expect(BUILDING_FRAG).toContain(String(FLOOR_HEIGHT_UNITS.MAX));
    expect(SHOPFRONT_CEILING).toBe(FLOOR_HEIGHT_UNITS.MIN);
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

  it('should carry every roof colour from the palette table into the fragment', () => {
    // 屋頂色以前是寫死在 GLSL 的 `getRoofColor` 裡。那裡沒有任何東西測得到，
    // 所以「商業低密度整條街是橘的」只能靠眼睛發現。
    for (const zone of ZONE_TYPES) {
      for (const [r, g, b] of roofPaletteFor(zone)) {
        expect(BUILDING_FRAG, `zone ${zone} 的 ${r},${g},${b} 沒有進到 shader`)
          .toContain(`vec3(${glslNum(r)}, ${glslNum(g)}, ${glslNum(b)})`);
      }
    }
  });

  it('should branch on zone in the order the category constants define', () => {
    // 門檻寫錯順序不會有任何東西報錯 —— 只會讓某個分區永遠拿到別人的屋頂。
    const branch = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('vec3 getRoofColor'),
      BUILDING_FRAG.indexOf('void main'),
    );
    const thresholds = [...branch.matchAll(/zoneCat < ([\d.]+)/g)].map(m => Number(m[1]));
    expect(thresholds.length, '沒有找到任何分區門檻').toBeGreaterThan(0);
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]!, `第 ${i} 個門檻沒有遞增`).toBeGreaterThan(thresholds[i - 1]!);
    }
    // 最後一個分區走 else，所以門檻數比分區數少一個。
    expect(thresholds.length).toBe(ZONE_TYPES.length - 1);
  });

  it('should let the shopfront glass take part in day and night', () => {
    // 落地窗原本算好了顏色卻沒有設 windowMask —— 白天沒有反射、夜晚不會亮，
    // 而一條商店街的夜景主角就是它。
    const storefront = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('COMMERCIAL LOW'),
      BUILDING_FRAG.indexOf('Upper wall'),
    );
    expect(storefront.length).toBeGreaterThan(0);
    expect(storefront, '落地窗沒有進 windowMask').toContain('windowMask =');
    expect(storefront, '落地窗夜晚不會亮').toContain('isLitWindow');
    expect(storefront, '落地窗不看住戶在不在').toContain('occ');
  });

  it('should keep the shopfront floor-to-ceiling, not a window grid', () => {
    // 落地窗與樓上的小窗長得不一樣正是它的重點。它只有豎向窗框，所以
    // 分割式只吃 wallU；一旦出現對 y 取 fract 的分割，它就變成一般窗格了。
    const storefront = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('COMMERCIAL LOW'),
      BUILDING_FRAG.indexOf('Upper wall'),
    );
    expect(storefront, '落地窗被切出樓層橫線').not.toMatch(/fract\s*\(\s*y/);
    expect(storefront).toContain('fract(bay)');
  });

  it('should let a branch opt out of the daytime sky reflection', () => {
    // 「會透光」與「是玻璃」是兩件事：工業的捲門夜裡會透出暖光，但它白天
    // 不該變成一片藍。少了這個分離，唯一的做法是讓捲門完全不亮。
    expect(BUILDING_FRAG).toContain('float glassiness = 1.0;');
    expect(BUILDING_FRAG, '天空反射沒有吃 glassiness')
      .toContain('dayFactor * windowMask * glassiness');
    expect(BUILDING_FRAG, '陽光鏡面沒有吃 glassiness')
      .toContain('windowMask * glassiness * facingSun');
  });

  it('should compute the day/night factors outside the window block', () => {
    // 招牌與燈頭沒有窗戶，但它們一樣要知道現在是不是晚上。
    const nightAt = BUILDING_FRAG.indexOf('float nightFactor');
    const windowAt = BUILDING_FRAG.indexOf('if (windowMask > 0.01)');
    expect(nightAt).toBeGreaterThan(-1);
    expect(windowAt).toBeGreaterThan(-1);
    expect(nightAt, '日夜係數還關在窗戶的判斷裡').toBeLessThan(windowAt);
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
