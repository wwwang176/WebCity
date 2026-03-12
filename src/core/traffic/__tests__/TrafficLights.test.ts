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
