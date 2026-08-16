import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WeatherRenderer } from '../WeatherRenderer';

/**
 * 影子的濃度要跟著太陽高度走，不是跟著亮度曲線走。
 *
 * 那是兩套時程：亮度從 t=0.19 就開始爬，但 `sunY` 的下限讓太陽在 `sunFactor`
 * 超過 0.1 之前（約 t=0.266）一直凍在同一個位置。照亮度給濃度的話，影子會在太陽
 * 還沒開始動的時候就浮出來、在原地僵著，等太陽脫離下限才忽然開始縮 —— 畫面上
 * 就是「天亮了一陣子，影子才開始動」。
 */

function harness() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const directionalLight = new THREE.DirectionalLight();
  const sm = {
    scene,
    ambientLight: new THREE.AmbientLight(),
    directionalLight,
    hemisphereLight: new THREE.HemisphereLight(),
    sunOffset: new THREE.Vector3(),
  };
  return {
    w: new WeatherRenderer(sm as unknown as ConstructorParameters<typeof WeatherRenderer>[0], 60),
    light: directionalLight,
    sun: sm.sunOffset,
  };
}

/** `sunY = 80 * max(0.1, sunFactor)` 的下限值。太陽凍住時就停在這裡。 */
const FROZEN_SUN_Y = 8;
const STEPS = 720;

describe('影子的濃度', () => {
  it('should never show a shadow while the sun is still frozen at its floor', () => {
    // 這條就是「天亮了一陣子，影子才開始動」的機器可檢查形式。
    const { w, light, sun } = harness();
    let seen = 0;
    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS;
      w.setDayFraction(t);
      if (light.shadow.intensity <= 0) continue;
      seen++;
      expect(sun.y, `t=${t.toFixed(3)}：影子已經看得見，太陽卻還凍在下限`)
        .toBeGreaterThan(FROZEN_SUN_Y);
    }
    expect(seen, '整天都沒有影子，這條測試等於空轉').toBeGreaterThan(STEPS / 4);
  });

  it('should leave no shadow at night', () => {
    const { w, light } = harness();
    for (const t of [0.0, 0.05, 0.1, 0.15, 0.9, 0.95]) {
      w.setDayFraction(t);
      expect(light.shadow.intensity, `t=${t} 的夜裡還有影子`).toBe(0);
    }
  });

  it('should be solid at noon', () => {
    // 反面：白天沒有影子的話，整個畫面會扁掉。
    const { w, light } = harness();
    w.setDayFraction(0.5);
    expect(light.shadow.intensity, '正午的影子不是實心的').toBe(1);
    expect(light.castShadow, '正午沒在畫影子').toBe(true);
  });

  it('should keep the shadow pass in step with the shadow', () => {
    // 濃度 0 卻還開著 castShadow，就是每幀白畫一張 2048² 深度圖；反過來則是
    // 影子該看得見卻被關掉。兩者綁同一個數字，兩邊都不該發生。
    const { w, light } = harness();
    let off = 0, on = 0;
    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS;
      w.setDayFraction(t);
      const lit = light.shadow.intensity > 0;
      expect(light.castShadow, `t=${t.toFixed(3)}：shadow pass 與影子濃度對不上`)
        .toBe(lit);
      if (lit) on++; else off++;
    }
    expect(off, '整天都在畫影子，夜裡沒有省到').toBeGreaterThan(0);
    expect(on, '整天都沒在畫影子').toBeGreaterThan(0);
  });

  it('should fade rather than pop', () => {
    const { w, light } = harness();
    let partial = 0;
    for (let i = 0; i < STEPS; i++) {
      w.setDayFraction(i / STEPS);
      const v = light.shadow.intensity;
      if (v > 0.02 && v < 0.98) partial++;
    }
    expect(partial, '影子是硬切的，沒有任何中間狀態').toBeGreaterThan(4);
  });

  it('should keep the light above the horizon all day', () => {
    // 讓光源沉下去會從底下往上打，建築的下緣會亮起來。夜裡的解法是把影子的
    // 濃度歸零，不是把光源埋掉。
    const { w, sun } = harness();
    for (let i = 0; i < STEPS; i++) {
      w.setDayFraction(i / STEPS);
      expect(sun.y, `t=${(i / STEPS).toFixed(3)} 的光源沉到地平線下`).toBeGreaterThan(0);
    }
  });
});
