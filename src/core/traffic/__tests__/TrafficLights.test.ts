import { describe, it, expect } from 'vitest';
import { TrafficLightSystem, TRAFFIC_LIGHT, syncTrafficLightsWithGrid } from '../TrafficLights';
import { Grid } from '../../grid/Grid';
import { RoadType, RoadDirection } from '../../road/types';

describe('TrafficLightSystem', () => {
  it('should add and retrieve a light', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(5, 5);
    expect(sys.getLight(5, 5)).toBeDefined();
  });

  it('should advance phase after PHASE_DURATION seconds', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0);
    const light = sys.getLight(0, 0)!;
    const initialPhase = light.phase;
    // Advance past the initial timer + one full phase
    const totalTime = light.timer + TRAFFIC_LIGHT.PHASE_DURATION + 0.01;
    sys.tick(totalTime);
    // Phase should have changed at least once
    expect(sys.getLight(0, 0)!.phase).not.toBe(initialPhase);
  });

  it('should cycle phases with small dt increments', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0);
    const light = sys.getLight(0, 0)!;
    const initialPhase = light.phase;
    // Burn through initial timer
    const burnTime = light.timer + 0.001;
    sys.tick(burnTime);
    // Now advance one full phase in small steps
    const steps = 100;
    const stepDt = TRAFFIC_LIGHT.PHASE_DURATION / steps;
    for (let i = 0; i < steps + 1; i++) sys.tick(stepDt);
    // Should have toggled back to initial phase
    expect(sys.getLight(0, 0)!.phase).toBe(initialPhase);
  });
});

describe('TRAFFIC_LIGHT constants', () => {
  it('phase duration should be a positive number in seconds', () => {
    expect(TRAFFIC_LIGHT.PHASE_DURATION).toBeGreaterThan(0);
  });
});

describe('syncTrafficLightsWithGrid', () => {
  it('should add lights at 3-way intersections', () => {
    const grid = new Grid(10, 10);
    // 3-way intersection: N, S, E
    grid.setCell(5, 5, {
      roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST,
    });
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeDefined();
  });

  it('should not add lights at 2-way roads', () => {
    const grid = new Grid(10, 10);
    grid.setCell(5, 5, {
      roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH,
    });
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });

  it('should remove stale lights when intersection is demolished', () => {
    const grid = new Grid(10, 10);
    const sys = new TrafficLightSystem();
    sys.addLight(5, 5); // pre-existing light
    // No road at 5,5 — light should be removed
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });
});
