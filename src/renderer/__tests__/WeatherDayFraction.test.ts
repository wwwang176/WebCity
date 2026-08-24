import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WeatherRenderer } from '../WeatherRenderer';

/**
 * update() only moves time forward, leaving no way to see what a given moment looks like. The
 * showcase's time slider needs this accessor: without it the slider can only reach uTime, which in
 * the shader drives the random period of the window lights alone and leaves the day-night cycle
 * still, so dragging it appears to do nothing.
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
    // The substantive check that the time slider works: the light really changes.
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
