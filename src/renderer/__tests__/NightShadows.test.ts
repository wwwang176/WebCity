import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WeatherRenderer } from '../WeatherRenderer';

/**
 * Shadow intensity follows the sun's height, not the brightness curve.
 *
 * They are two schedules: brightness starts climbing at t=0.19 while `sunY`'s lower bound freezes
 * the sun in place until `sunFactor` passes 0.1, around t=0.266. Driven by brightness, shadows
 * appear while the sun has not started moving, stand still, and then suddenly begin to shorten once
 * the sun leaves the bound — on screen, the shadows only start moving a while after dawn.
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

/** The lower bound of `sunY = 80 * max(0.1, sunFactor)`, where the frozen sun rests. */
const FROZEN_SUN_Y = 8;
const STEPS = 720;

describe('影子的濃度', () => {
  it('should never show a shadow while the sun is still frozen at its floor', () => {
    // The machine-checkable form of "the shadows only start moving a while after dawn".
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
    // The other side: without shadows in daylight the whole view flattens.
    const { w, light } = harness();
    w.setDayFraction(0.5);
    expect(light.shadow.intensity, '正午的影子不是實心的').toBe(1);
    expect(light.castShadow, '正午沒在畫影子').toBe(true);
  });

  it('should keep the shadow pass in step with the shadow', () => {
    // castShadow left on at zero intensity draws a 2048-square depth map every frame for nothing;
    // the reverse hides shadows that should be visible. Both are tied to the same number so neither
    // can happen.
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
    // Sinking the light below the ground lights buildings from underneath and brightens their
    // lower edges. At night the intensity goes to zero instead.
    const { w, sun } = harness();
    for (let i = 0; i < STEPS; i++) {
      w.setDayFraction(i / STEPS);
      expect(sun.y, `t=${(i / STEPS).toFixed(3)} 的光源沉到地平線下`).toBeGreaterThan(0);
    }
  });
});
