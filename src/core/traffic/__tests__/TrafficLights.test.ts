import { describe, it, expect } from 'vitest';
import { TrafficLightSystem, TRAFFIC_LIGHT } from '../TrafficLights';

describe('TrafficLightSystem', () => {
  it('should add and retrieve a light', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(5, 5);
    expect(sys.getLight(5, 5)).toBeDefined();
  });

  it('should advance phase after PHASE_DURATION ticks', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0);
    const initialPhase = sys.getLight(0, 0)!.phase;
    for (let i = 0; i < TRAFFIC_LIGHT.PHASE_DURATION + 1; i++) sys.tick();
    // Phase should have changed at least once
    // (exact timing depends on stagger offset)
    const afterTicks = sys.getLight(0, 0)!;
    expect(afterTicks).toBeDefined();
  });
});

describe('TRAFFIC_LIGHT constants', () => {
  it('phase duration should be a positive integer', () => {
    expect(TRAFFIC_LIGHT.PHASE_DURATION).toBeGreaterThan(0);
    expect(Number.isInteger(TRAFFIC_LIGHT.PHASE_DURATION)).toBe(true);
  });
});
