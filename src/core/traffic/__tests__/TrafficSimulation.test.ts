import { describe, it, expect } from 'vitest';
import { TrafficSimulation, getLaneCount } from '../TrafficSimulation';
import { RoadType } from '../../road/types';

describe('TrafficSimulation', () => {
  it('should add a vehicle with path', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicle(['0,0', '1,0', '2,0']);
    expect(v.pathPos).toBe(0);
    expect(v.arrived).toBe(false);
  });

  it('should assign lane 0 by default (single lane)', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicle(['0,0', '1,0', '2,0']);
    expect(v.lane).toBe(0);
  });

  it('should assign lanes to vehicles on multi-lane roads', () => {
    const sim = new TrafficSimulation();
    // Spawn two vehicles with 2 directional lanes
    const v1 = sim.addVehicle(['0,0', '1,0', '2,0'], 2);
    const v2 = sim.addVehicle(['0,0', '1,0', '2,0'], 2);
    // They should be on different lanes (load-balanced)
    expect(v1.lane).not.toBe(v2.lane);
  });

  it('should advance vehicle position each tick', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicle(['0,0', '1,0', '2,0']);
    sim.tick();
    expect(v.pathPos).toBeGreaterThan(0);
  });

  it('should mark vehicle as arrived at destination', () => {
    const sim = new TrafficSimulation();
    sim.addVehicle(['0,0', '1,0', '2,0']);
    sim.tick(); // at 1,0
    sim.tick(); // at 2,0 - arrived
    expect(sim.getVehicleCount()).toBe(0);
  });

  it('should track segment density', () => {
    const sim = new TrafficSimulation();
    sim.addVehicle(['0,0', '1,0', '2,0']);
    expect(sim.getSegmentDensity('0,0')).toBe(1);
    sim.tick();
    expect(sim.getSegmentDensity('0,0')).toBe(0);
    expect(sim.getSegmentDensity('1,0')).toBe(1);
  });

  it('should remove arrived vehicles', () => {
    const sim = new TrafficSimulation();
    sim.addVehicle(['0,0', '1,0']);
    sim.tick(); // arrived
    expect(sim.getVehicleCount()).toBe(0);
  });

  it('should move faster on roads with higher speed limit', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
    // getSpeedLimit returns HIGHWAY speed (100)
    sim.tick(undefined, (cellKey) => 100);
    const highSpeedPos = v.pathPos;

    const sim2 = new TrafficSimulation();
    const v2 = sim2.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
    // getSpeedLimit returns RURAL speed (30)
    sim2.tick(undefined, (cellKey) => 30);

    expect(highSpeedPos).toBeGreaterThan(v2.pathPos);
  });

  it('should move at base speed when no speedLimit callback provided', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
    sim.tick();
    // Default speed = 1.0 (base speed, equivalent to speedLimit 50)
    expect(v.pathPos).toBeCloseTo(1.0, 1);
  });

  it('should use per-cell speed limit as vehicle moves', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
    // First tick: RURAL speed (30) → slower
    sim.tick(undefined, () => 30);
    const posAfterSlow = v.pathPos;

    // Second tick: HIGHWAY speed (100) → faster
    sim.tick(undefined, () => 100);
    const moved = v.pathPos - posAfterSlow;

    // Highway move should be larger than rural move
    expect(moved).toBeGreaterThan(posAfterSlow);
  });

  it('should allow vehicles in different lanes to pass each other', () => {
    const sim = new TrafficSimulation();
    // Two vehicles on same path but different lanes
    const v1 = sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0'], 2);
    v1.lane = 0;
    const v2 = sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0'], 2);
    v2.lane = 1;
    // Advance v1 ahead
    v1.pathPos = 2;
    v2.pathPos = 1.5;

    // Tick — v2 should not be blocked by v1 (different lane)
    const prevPos = v2.pathPos;
    sim.tick();
    expect(v2.pathPos).toBeGreaterThan(prevPos);
  });

  it('should block vehicles in the same lane', () => {
    const sim = new TrafficSimulation();
    // Two vehicles on same path AND same lane
    const v1 = sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0'], 1);
    v1.lane = 0;
    const v2 = sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0'], 1);
    v2.lane = 0;
    // Place them close together
    v1.pathPos = 1.2;
    v2.pathPos = 1.0;

    sim.tick();
    // v2 should move less than full speed due to v1 being close ahead in same lane
    // The gap between them (0.2 path units) minus vehicle lengths should restrict movement
    expect(v2.pathPos).toBeLessThan(v1.pathPos);
  });
});

describe('getLaneCount', () => {
  it('should return 1 for RURAL', () => {
    expect(getLaneCount(RoadType.RURAL)).toBe(1);
  });

  it('should return 1 for TWO_LANE', () => {
    expect(getLaneCount(RoadType.TWO_LANE)).toBe(1);
  });

  it('should return 2 for FOUR_LANE', () => {
    expect(getLaneCount(RoadType.FOUR_LANE)).toBe(2);
  });

  it('should return 3 for SIX_LANE', () => {
    expect(getLaneCount(RoadType.SIX_LANE)).toBe(3);
  });

  it('should return 2 for HIGHWAY', () => {
    expect(getLaneCount(RoadType.HIGHWAY)).toBe(2);
  });

  it('should return 2 for ONE_WAY (all lanes in one direction)', () => {
    expect(getLaneCount(RoadType.ONE_WAY)).toBe(2);
  });
});
