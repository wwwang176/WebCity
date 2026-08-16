import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WeatherRenderer } from '../WeatherRenderer';

/**
 * 地圖之外的底色。
 *
 * 它不是天空 —— 等角正交視角下這片色塊佔掉螢幕很大一塊。原本它吃的是天色關鍵
 * 影格，於是日落時整個畫面被 `_sunsetSky`（#ff4422，飽和橘紅）蓋滿，城市反而
 * 看不見。色相因此固定，只有明度隨晝夜走。
 *
 * hemisphere 光仍然吃 `skyColor`，所以日落打在建築頂面上的暖調不受影響 ——
 * 這裡管的是背景，不是光。
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

/** 一整天平均取樣，含日出與日落的尖峰。 */
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
    // 這是那個刺眼的傍晚的機器可檢查形式：紅一旦超過藍，就是往橘紅去了。
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
    // 日夜兩端是各自寫死的色票，中間走線性內插 —— 內插在線性空間做，所以色相
    // 會有幾度的漂移。幾度看不出來，換一個色系看得出來。
    expect(hi - lo, `色相全天跑了 ${(hi - lo).toFixed(1)} 度`).toBeLessThan(12);
  });

  it('should still be darker at night than at noon', () => {
    // 使用者要的是「色相固定」，不是「完全不變」—— 明度還要跟著晝夜走，
    // 否則夜裡城市會浮在一片亮底上。
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
    // 原本的夜間環境光是 #2244aa —— 藍是紅的五倍，乘完之後紅色通道只剩 7%，
    // 城市裡所有暖色在夜裡直接變黑。單純調高亮度只會讓畫面更藍。
    const sm = fakeSceneManager();
    const w = new WeatherRenderer(sm, 60);
    const lights = sm as unknown as {
      ambientLight: THREE.AmbientLight; directionalLight: THREE.DirectionalLight;
    };

    w.setDayFraction(0.0);
    for (const [name, light] of [
      ['環境光', lights.ambientLight], ['月光', lights.directionalLight],
    ] as const) {
      // `THREE.Color` 的 r/g/b 是**線性**空間的值，不是十六進位寫的那個。直接
      // 比會得到跟眼睛看到的完全不同的比例（#5a72b8 的紅藍比 sRGB 是 0.49、
      // 線性是 0.21），門檻就會訂在錯的刻度上。
      const c = light.color.clone().convertLinearToSRGB();
      expect(c.r / c.b, `夜間${name}的藍壓過紅太多（#${light.color.getHexString()}）`)
        .toBeGreaterThan(0.35);
    }
  });
});
