import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WeatherRenderer } from '../WeatherRenderer';

/**
 * The backdrop beyond the map.
 *
 * It is not the sky: in an isometric orthographic view it covers a large share of the screen.
 * Driven by the sky keyframes, sunset floods the whole screen with `_sunsetSky` (#ff4422, a
 * saturated orange-red) and the city disappears into it. So its hue is fixed and only its
 * brightness follows the day.
 *
 * The hemisphere light still takes `skyColor`, so sunset's warmth on building roofs is unaffected:
 * this governs the backdrop, not the light.
 */

function fakeSceneManager() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  return {
    scene,
    ambientLight: new THREE.AmbientLight(),
    directionalLight: new THREE.DirectionalLight(),
    hemisphereLight: new THREE.HemisphereLight(),
    sunOffset: new THREE.Vector3(),
  } as unknown as ConstructorParameters<typeof WeatherRenderer>[0];
}

/** Evenly sampled across a whole day, including the sunrise and sunset peaks. */
const SAMPLES = Array.from({ length: 48 }, (_, i) => i / 48);

function sampleBackdrops(): THREE.Color[] {
  const sm = fakeSceneManager();
  const w = new WeatherRenderer(sm, 60);
  const scene = (sm as unknown as { scene: THREE.Scene }).scene;
  return SAMPLES.map(t => {
    w.setDayFraction(t);
    return (scene.background as THREE.Color).clone();
  });
}

describe('地圖之外的底色', () => {
  it('should never go warm', () => {
    // The garish evening in machine-checkable form: once red exceeds blue, it is heading for
    // orange-red.
    const hsl = { h: 0, s: 0, l: 0 };
    for (const [i, c] of sampleBackdrops().entries()) {
      c.getHSL(hsl, THREE.SRGBColorSpace);
      expect(c.b, `t=${SAMPLES[i]!.toFixed(3)} 的背景偏暖（#${c.getHexString()}）`)
        .toBeGreaterThanOrEqual(c.r);
    }
  });

  it('should hold one hue from midnight to midnight', () => {
    const hsl = { h: 0, s: 0, l: 0 };
    const hues = sampleBackdrops().map(c => {
      c.getHSL(hsl, THREE.SRGBColorSpace);
      return hsl.h * 360;
    });
    const lo = Math.min(...hues), hi = Math.max(...hues);
    // Day and night are separate stated colours with linear interpolation between them, and the
    // interpolation happens in linear space, so the hue drifts by a few degrees. A few degrees is
    // invisible; a change of colour family is not.
    expect(hi - lo, `色相全天跑了 ${(hi - lo).toFixed(1)} 度`).toBeLessThan(12);
  });

  it('should still be darker at night than at noon', () => {
    // What is wanted is a fixed hue rather than no change at all: the brightness still follows the
    // day, or at night the city floats on a bright ground.
    const sm = fakeSceneManager();
    const w = new WeatherRenderer(sm, 60);
    const scene = (sm as unknown as { scene: THREE.Scene }).scene;
    const bg = () => (scene.background as THREE.Color);

    w.setDayFraction(0.5);
    const noon = bg().getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l;
    w.setDayFraction(0.0);
    const midnight = bg().getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l;

    expect(midnight, '夜裡的背景沒有比白天暗').toBeLessThan(noon);
    expect(midnight, '夜裡的背景暗到跟純黑沒兩樣').toBeGreaterThan(0.05);
  });
});

describe('夜間的光', () => {
  it('should not crush the warm channels', () => {
    // At #2244aa the night ambient has blue at five times red, leaving the red channel at 7% after
    // the multiply and turning every warm colour in the city black at night. Raising the brightness
    // alone only makes the screen bluer.
    const sm = fakeSceneManager();
    const w = new WeatherRenderer(sm, 60);
    const lights = sm as unknown as {
      ambientLight: THREE.AmbientLight; directionalLight: THREE.DirectionalLight;
    };

    w.setDayFraction(0.0);
    for (const [name, light] of [
      ['環境光', lights.ambientLight], ['月光', lights.directionalLight],
    ] as const) {
      // `THREE.Color`'s r/g/b are **linear**-space values rather than what the hex says. Compared
      // directly they give a ratio entirely unlike what the eye sees — #5a72b8's red-to-blue is 0.49
      // in sRGB and 0.21 in linear — and the threshold would be set on the wrong scale.
      const c = light.color.clone().convertLinearToSRGB();
      expect(c.r / c.b, `夜間${name}的藍壓過紅太多（#${light.color.getHexString()}）`)
        .toBeGreaterThan(0.35);
    }
  });
});
