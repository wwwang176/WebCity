import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WeatherRenderer } from '../WeatherRenderer';

/**
 * update() 只能讓時間往前走，所以要看「某個時刻長什麼樣」原本沒有辦法。
 * 展示區的時間滑桿靠這個存取子；沒有它，滑桿只能改到 uTime，而 uTime 在
 * shader 裡只控制窗戶亮燈的隨機週期，日夜完全不動 —— 拖了像沒反應。
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

describe('setDayFraction', () => {
  it('should land exactly where it is told', () => {
    const w = new WeatherRenderer(fakeSceneManager(), 60);
    w.setDayFraction(0.5);
    expect(w.dayFraction).toBeCloseTo(0.5, 10);
  });

  it('should wrap values outside a single day', () => {
    const w = new WeatherRenderer(fakeSceneManager(), 60);
    w.setDayFraction(2.25);
    expect(w.dayFraction).toBeCloseTo(0.25, 10);
    w.setDayFraction(-0.25);
    expect(w.dayFraction).toBeCloseTo(0.75, 10);
  });

  it('should make noon brighter than midnight', () => {
    // 這才是「時間滑桿有沒有效」的實質檢查：光真的變了。
    const w = new WeatherRenderer(fakeSceneManager(), 60);
    w.setDayFraction(0.5);
    const noon = w.sunIntensity;
    w.setDayFraction(0.0);
    const midnight = w.sunIntensity;
    expect(noon).toBeGreaterThan(midnight);
  });

  it('should apply the lighting immediately, without waiting for update()', () => {
    const w = new WeatherRenderer(fakeSceneManager(), 60);
    w.setDayFraction(0.0);
    const before = w.sunIntensity;
    w.setDayFraction(0.5);
    expect(w.sunIntensity).not.toBe(before);
  });
});
