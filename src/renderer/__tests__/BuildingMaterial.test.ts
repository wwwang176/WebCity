import { describe, it, expect } from 'vitest';
import {
  BUILDING_VERT, BUILDING_FRAG, getBuildingMaterial, resetBuildingMaterial,
  sortedFacadeKeys,
} from '../BuildingMaterial';
import { PART_THRESHOLDS, SHELL_LIFT, WATER_BOB } from '../geometry/buildings/parts';
import { METRES_PER_CELL } from '../../core/grid/constants';
import { FLOOR_HEIGHT_UNITS, SHOPFRONT_CEILING } from '../geometry/buildings/propBands';
import { roofPaletteFor } from '../ColorPalettes';
import { ZONE_TYPES } from '../geometry/buildings/registry';

/** GLSL has to see a float: an integer literal is not one. */
const glslNum = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

/**
 * The GLSL itself cannot be tested, but whether the TS constants actually reach it can be — and
 * that is exactly where the two drift apart.
 */
describe('the shader uses the thresholds the parts module defines', () => {
  it('should carry every threshold value into the fragment source', () => {
    for (const v of Object.values(PART_THRESHOLDS)) {
      expect(BUILDING_FRAG).toContain(String(v));
    }
  });

  it('should carry the floor height the geometry hangs awnings from', () => {
    // A canopy hangs on the first-floor line, and that line is the storey height the shader draws
    // windows from. Written on both sides, the canopy lands across the middle of a window and
    // nothing reports it.
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
    // These two constants are the hidden reason towers repeat: however the masses vary, every
    // tower shares one window grid.
    expect(BUILDING_FRAG).not.toContain('float floorH =');
    expect(BUILDING_FRAG).not.toContain('float winW =');
  });

  it('should branch on the detail tag before it reaches the wall branch', () => {
    // Without this branch, water tanks and air handling units get windows drawn on them.
    const detailAt = BUILDING_FRAG.indexOf('isDetail');
    const wallAt = BUILDING_FRAG.indexOf('=== WALL');
    expect(detailAt).toBeGreaterThan(-1);
    expect(wallAt).toBeGreaterThan(-1);
    expect(detailAt).toBeLessThan(wallAt);
  });

  /**
   * A mass that specifies a colour has to actually get it.
   *
   * A white water tank can render grey with the data entirely correct: the tank carries
   * `color: [0.94, 0.95, 0.96]` and the tests check that array. The problem is that **the shader
   * has no branch that draws it**:
   *
   * - a wall is compressed by `FACADE_UTILITY` to `vBldgColor * 0.70-0.90` and given a high window
   *   band and a row of red warning lamps;
   * - `PART_DETAIL` hard-codes a metal grey (`vec3(m, m*1.02, m*1.06)`) and never reads
   *   `vBldgColor`, so specifying a colour on it does nothing;
   * - `PART_GROUND`'s ramp tops out at brick, `vec3(0.60, 0.58, 0.55)`, and even `shade: 1.0`
   *   reaches only mid grey.
   *
   * None of the three reaches white, and **none of them reports anything**. `PART_SHELL` is the
   * missing one: a painted shell — water tank, stack, storage vessel — drawn in the mass's own
   * colour, with no windows and no glow.
   */
  it('should paint a shell in the colour the volume asked for', () => {
    const start = BUILDING_FRAG.indexOf('} else if (isShell)');
    expect(start, 'shader 沒有外殼分支').toBeGreaterThan(-1);
    const shell = BUILDING_FRAG.slice(start, BUILDING_FRAG.indexOf('} else if', start + 10));
    expect(shell, '外殼沒有照量體自己的顏色畫').toContain('vBldgColor');
    expect(shell, '外殼長了窗戶').not.toContain('winMask');
    expect(shell, '外殼會自己發光 —— 那是 PART_LAMP 的事').not.toContain('emissive');
  });

  /**
   * A shell may not darken the colour it was given.
   *
   * The second layer of the same fault: with `PART_SHELL` added, a white tank is **still**
   * beige-grey, because that branch writes `vBldgColor * 0.90` of its own. Walls are 0.70-0.90 and
   * `PART_DETAIL` is a hard-coded 0.42-0.58; below 1, the new branch merely swaps one grey for
   * another, and nothing says so before a screenshot.
   */
  it('should not darken a shell below the colour it was given', () => {
    expect(SHELL_LIFT.BASE, '外殼的明度係數 < 1 —— 白色還是會畫成灰色')
      .toBeGreaterThanOrEqual(1);
    expect(BUILDING_FRAG, 'shader 沒有用 SHELL_LIFT，那是第二份資料')
      .toContain(`${SHELL_LIFT.BASE} + ${SHELL_LIFT.TOP} * max(n.y, 0.0)`);
  });

  /**
   * The water level **really** moves; it is not only the colour that moves.
   *
   * The fragment shader's shimmer changes colour only and the plane itself is static, which reads
   * as patterned flooring. Making the level rise and fall takes displacement in the vertex stage,
   * which needs `uTime` there too.
   */
  it('should make the water surface actually rise and fall', () => {
    expect(BUILDING_VERT, '頂點端沒有時間，位移做不出來')
      .toContain('uniform float uTime;');
    expect(BUILDING_VERT, '水面沒有位移 —— 波光只是顏色').toContain('wPos.y +=');
    expect(BUILDING_VERT, '位移沒有只挑水面')
      .toContain(String(PART_THRESHOLDS.WATER_MIN));
    // Only upward-facing surfaces move; moving the walls too makes the whole vessel breathe.
    expect(BUILDING_VERT, '位移沒有只挑朝上的面').toContain('normal.y > 0.5');
    expect(BUILDING_VERT, 'shader 沒有用 WATER_BOB，那是第二份資料')
      .toContain(String(WATER_BOB.AMP_M / METRES_PER_CELL));
  });

  it('should branch on the shell tag before it reaches the wall branch', () => {
    // Falling to the wall branch means a high window band and warning lamps: a stack with windows
    // in it.
    const shellAt = BUILDING_FRAG.indexOf('isShell');
    const wallAt = BUILDING_FRAG.indexOf('=== WALL');
    expect(shellAt).toBeGreaterThan(-1);
    expect(shellAt).toBeLessThan(wallAt);
  });

  it('should give low-density residential a window grid, not just siding lines', () => {
    // With horizontal siding lines alone, this branch has no detail to look at up close.
    const branch = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('RESIDENTIAL LOW'),
      BUILDING_FRAG.indexOf('RESIDENTIAL HIGH'),
    );
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).toContain('winMask');
    expect(branch).toContain('floorHeight');
  });

  it('should carry the ground shade from the blue channel into the fragment', () => {
    // One decal geometry has to carry both dark asphalt and pale paving, and aSeed is per instance
    // and cannot tell two ground patches within one mesh apart. So the brightness goes through the
    // vertex colour's B channel.
    expect(BUILDING_VERT).toContain('varying float vGroundShade;');
    expect(BUILDING_VERT).toContain('vGroundShade = color.b;');
    expect(BUILDING_FRAG).toContain('varying float vGroundShade;');
  });

  it('should branch on the ground tag before it reaches the wall branch', () => {
    // Falling to the wall branch grows windows: a grid of them across the asphalt.
    const groundAt = BUILDING_FRAG.indexOf('isGround');
    const wallAt = BUILDING_FRAG.indexOf('=== WALL');
    expect(groundAt).toBeGreaterThan(-1);
    expect(groundAt).toBeLessThan(wallAt);
  });

  it('should carry every roof colour from the palette table into the fragment', () => {
    // Hard-coded into the GLSL's `getRoofColor`, nothing about the roof colours is testable, and
    // "the whole low-density commercial street is orange" can only be found by eye.
    for (const zone of ZONE_TYPES) {
      for (const [r, g, b] of roofPaletteFor(zone)) {
        expect(BUILDING_FRAG, `zone ${zone} 的 ${r},${g},${b} 沒有進到 shader`)
          .toContain(`vec3(${glslNum(r)}, ${glslNum(g)}, ${glslNum(b)})`);
      }
    }
  });

  it('should branch on zone in the order the category constants define', () => {
    // Thresholds in the wrong order report nothing; they only give one zone somebody else's roof
    // permanently.
    const branch = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('vec3 getRoofColor'),
      BUILDING_FRAG.indexOf('void main'),
    );
    const thresholds = [...branch.matchAll(/zoneCat < ([\d.]+)/g)].map(m => Number(m[1]));
    expect(thresholds.length, '沒有找到任何分區門檻').toBeGreaterThan(0);
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]!, `第 ${i} 個門檻沒有遞增`).toBeGreaterThan(thresholds[i - 1]!);
    }
    // The last category takes the else, so there is one threshold fewer than categories.
    //
    // `sortedFacadeKeys()` rather than `ZONE_TYPES`: the chain is generated from `ZONE_CAT`, which
    // holds the civic facade categories (`FACADE_*`) alongside the six zones. `ZONE_TYPES` is
    // derived from the height table as "which zones have buildings", and civic buildings have no
    // height table — the two were never the same thing and merely happened to be the same size
    // before the civic categories were added.
    expect(thresholds.length).toBe(sortedFacadeKeys().length - 1);
  });

  it('should let the shopfront glass take part in day and night', () => {
    // Shopfront glazing that computes a colour without setting windowMask gets no reflection by day
    // and never lights at night — and it is what a shopping street looks like at night.
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
    // Looking different from the small windows above is the whole point of shopfront glazing. It
    // has vertical mullions only, so its division reads wallU alone; as soon as a division takes
    // fract of y, it becomes an ordinary window grid.
    const storefront = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('COMMERCIAL LOW'),
      BUILDING_FRAG.indexOf('Upper wall'),
    );
    expect(storefront, '落地窗被切出樓層橫線').not.toMatch(/fract\s*\(\s*y/);
    expect(storefront).toContain('fract(bay)');
  });

  it('should let a branch opt out of the daytime sky reflection', () => {
    // "Passes light" and "is glass" are different things: an industrial roller door spills warm
    // light at night and should not turn blue by day. Without the separation, the only option is a
    // roller door that never lights.
    expect(BUILDING_FRAG).toContain('float glassiness = 1.0;');
    expect(BUILDING_FRAG, '天空反射沒有吃 glassiness')
      .toContain('dayFactor * windowMask * glassiness');
    expect(BUILDING_FRAG, '陽光鏡面沒有吃 glassiness')
      .toContain('windowMask * glassiness * facingSun');
  });

  it('should compute the day/night factors outside the window block', () => {
    // Signage and lamp heads have no windows and still need to know whether it is night.
    const nightAt = BUILDING_FRAG.indexOf('float nightFactor');
    const windowAt = BUILDING_FRAG.indexOf('if (windowMask > 0.01)');
    expect(nightAt).toBeGreaterThan(-1);
    expect(windowAt).toBeGreaterThan(-1);
    expect(nightAt, '日夜係數還關在窗戶的判斷裡').toBeLessThan(windowAt);
  });

  it('should open exactly one door on a low-density house', () => {
    // `doorX = abs(fract(fx) - 0.5)` holds for **every** cell, so "one door at the centre of the
    // ground floor" is in fact one door per cell. A wall is 1.5 to 2.3 cells (a 6 m house at 2.6 to
    // 3.9 m per cell) and there are four of them, giving one house six to eight brown doors
    // (BUG-233).
    //
    // A door has to be bound to both which wall and the centre of that wall, and both can only come
    // from the building's cell, the one quantity constant per building inside a fragment shader.
    expect(BUILDING_FRAG, '門的橫向位置還是只看 fract，等於每格一道')
      .not.toContain('abs(fract(fx) - 0.5)');
    expect(BUILDING_FRAG, '門沒有挑一面牆').toContain('doorSide');
    expect(BUILDING_FRAG, '門沒有對齊牆的中央').toContain('wallCentre');
  });

  it('should still give the ground floor windows', () => {
    // `winMask = doorRow ? 0.0 : winMask` zeroes the whole ground floor's windows rather than only
    // the door's cell. The ground floor therefore gets no windowMask: no glass, no daytime sky
    // reflection, `isLitWindow` permanently false, and the whole ground floor dark at night.
    expect(BUILDING_FRAG, '一樓的窗戶仍被整層歸零')
      .not.toContain('winMask = doorRow ? 0.0 : winMask;');
    expect(BUILDING_FRAG, '門沒有從窗戶遮罩裡扣掉，而是取代了它')
      .toContain('winMask *= 1.0 - doorMask;');
  });

  it('should at least be bracket-balanced', () => {
    // The GLSL cannot be compiled here, so a compile error shows up only as **a blank screen**.
    // Balanced brackets catch no type errors, but they do catch half a block removed during an
    // edit — the most common slip in this file, which is a string no tool checks.
    for (const [open, close] of [['{', '}'], ['(', ')']] as const) {
      for (const src of [BUILDING_VERT, BUILDING_FRAG]) {
        let depth = 0;
        for (const ch of src) {
          if (ch === open) depth++;
          else if (ch === close) depth--;
          expect(depth, `${open}${close} 在中途變成負的`).toBeGreaterThanOrEqual(0);
        }
        expect(depth, `${open}${close} 沒有收齊`).toBe(0);
      }
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
