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
    const totalTime = light.timer + light.phaseDuration + 0.01;
    sys.tick(totalTime);
    expect(sys.getLight(0, 0)!.phase).not.toBe(initialPhase);
  });

  it('should cycle phases with small dt increments', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0);
    const light = sys.getLight(0, 0)!;
    const initialPhase = light.phase;
    const burnTime = light.timer + 0.001;
    sys.tick(burnTime);
    const steps = 100;
    const stepDt = light.phaseDuration / steps;
    for (let i = 0; i < steps + 1; i++) sys.tick(stepDt);
    expect(sys.getLight(0, 0)!.phase).toBe(initialPhase);
  });

  it('should use custom phaseDuration when provided', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0, 4);
    expect(sys.getLight(0, 0)!.phaseDuration).toBe(4);
  });

  it('should use per-light phaseDuration in tick', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0, 4);
    const light = sys.getLight(0, 0)!;
    const initialPhase = light.phase;
    // Advance past timer but less than 4s phase — should only change once
    sys.tick(light.timer + 4.01);
    expect(sys.getLight(0, 0)!.phase).not.toBe(initialPhase);
  });
});

describe('TRAFFIC_LIGHT constants', () => {
  it('phase duration should be a positive number in seconds', () => {
    expect(TRAFFIC_LIGHT.PHASE_DURATION).toBeGreaterThan(0);
    expect(TRAFFIC_LIGHT.PHASE_DURATION_LARGE).toBeGreaterThan(TRAFFIC_LIGHT.PHASE_DURATION);
  });
});

describe('syncTrafficLightsWithGrid', () => {
  it('should NOT add lights at small 3-way (T) intersections', () => {
    const grid = new Grid(10, 10);
    grid.setCell(5, 5, {
      roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST,
    });
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });

  it('should add lights at 3-way (T) intersections with major roads', () => {
    const grid = new Grid(10, 10);
    grid.setCell(5, 5, {
      roadType: RoadType.FOUR_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST,
    });
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeDefined();
    expect(sys.getLight(5, 5)!.phaseDuration).toBe(TRAFFIC_LIGHT.PHASE_DURATION);
  });

  it('should add lights at 4-way intersections with standard duration', () => {
    const grid = new Grid(10, 10);
    grid.setCell(5, 5, {
      roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST,
    });
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeDefined();
    expect(sys.getLight(5, 5)!.phaseDuration).toBe(TRAFFIC_LIGHT.PHASE_DURATION);
  });

  it('should use longer phase duration for large 4-way intersections', () => {
    const grid = new Grid(10, 10);
    grid.setCell(5, 5, {
      roadType: RoadType.FOUR_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST,
    });
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeDefined();
    expect(sys.getLight(5, 5)!.phaseDuration).toBe(TRAFFIC_LIGHT.PHASE_DURATION_LARGE);
  });

  it('should update phaseDuration when road is upgraded', () => {
    const grid = new Grid(10, 10);
    grid.setCell(5, 5, {
      roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST,
    });
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)!.phaseDuration).toBe(TRAFFIC_LIGHT.PHASE_DURATION);

    // Upgrade to four-lane
    grid.setCell(5, 5, {
      roadType: RoadType.FOUR_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST,
    });
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)!.phaseDuration).toBe(TRAFFIC_LIGHT.PHASE_DURATION_LARGE);
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
    sys.addLight(5, 5);
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });

  it('should remove lights when 4-way downgraded to small 3-way', () => {
    const grid = new Grid(10, 10);
    grid.setCell(5, 5, {
      roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST,
    });
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeDefined();

    // Remove one direction → small T-intersection
    grid.setCell(5, 5, {
      roadType: RoadType.TWO_LANE,
      roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST,
    });
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });
});
