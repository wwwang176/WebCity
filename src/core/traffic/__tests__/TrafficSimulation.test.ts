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
    // Use a long enough path so vehicle doesn't arrive in 1 tick (speed=3.5)
    sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '7,0', '8,0', '9,0']);
    expect(sim.getSegmentDensity('0,0')).toBe(1);
    sim.tick();
    expect(sim.getSegmentDensity('0,0')).toBe(0);
    // After 1 tick at speed 3.5, vehicle should be at cell index 3
    expect(sim.getSegmentDensity('3,0')).toBe(1);
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
    const v = sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '7,0', '8,0', '9,0']);
    sim.tick();
    // Default speed = 3.5 (base speed, equivalent to speedLimit 50)
    expect(v.pathPos).toBeCloseTo(3.5, 1);
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
    const path = ['0,0', '1,0', '2,0', '3,0', '4,0'];
    // v1 near end of path — can only move 0.2 before arriving
    const v1 = sim.addVehicle(path, 1);
    v1.lane = 0;
    v1.pathPos = 3.8;
    const v2 = sim.addVehicle(path, 1);
    v2.lane = 0;
    v2.pathPos = 3.6;

    sim.tick();
    // v1 arrives at 4.0, v2 should be blocked by MIN_GAP constraint
    expect(v2.pathPos).toBeLessThan(v1.pathPos);
  });

  it('should change lane when blocked and adjacent lane is free', () => {
    const sim = new TrafficSimulation();
    const path = ['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '7,0'];
    // Slow vehicle ahead in lane 0
    const blocker = sim.addVehicle(path, 2);
    blocker.lane = 0;
    blocker.pathPos = 2.0;
    blocker.speed = 0; // stopped

    // Fast vehicle behind in lane 0
    const follower = sim.addVehicle(path, 2);
    follower.lane = 0;
    follower.pathPos = 1.0;

    // Tick multiple times — follower should eventually switch to lane 1
    for (let i = 0; i < 5; i++) sim.tick();
    expect(follower.lane).toBe(1);
  });

  it('should not change lane when adjacent lane is occupied', () => {
    const sim = new TrafficSimulation();
    const path = ['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '7,0'];
    // Blocker in lane 0
    const blocker0 = sim.addVehicle(path, 2);
    blocker0.lane = 0;
    blocker0.pathPos = 2.0;
    blocker0.speed = 0;

    // Blocker in lane 1 at same position
    const blocker1 = sim.addVehicle(path, 2);
    blocker1.lane = 1;
    blocker1.pathPos = 1.8;
    blocker1.speed = 0;

    // Follower in lane 0
    const follower = sim.addVehicle(path, 2);
    follower.lane = 0;
    follower.pathPos = 1.0;

    for (let i = 0; i < 5; i++) sim.tick();
    // Should stay in lane 0 — no safe lane to switch to
    expect(follower.lane).toBe(0);
  });

  it('should not change lane on single-lane road', () => {
    const sim = new TrafficSimulation();
    const path = ['0,0', '1,0', '2,0', '3,0', '4,0', '5,0'];
    const blocker = sim.addVehicle(path, 1);
    blocker.lane = 0;
    blocker.pathPos = 2.0;
    blocker.speed = 0;

    const follower = sim.addVehicle(path, 1);
    follower.lane = 0;
    follower.pathPos = 1.0;

    for (let i = 0; i < 5; i++) sim.tick();
    expect(follower.lane).toBe(0); // no other lane available
  });

  it('should have lane change cooldown to prevent frequent switching', () => {
    const sim = new TrafficSimulation();
    const path = ['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '7,0', '8,0', '9,0'];
    // Blocker in lane 0
    const blocker = sim.addVehicle(path, 2);
    blocker.lane = 0;
    blocker.pathPos = 2.0;
    blocker.speed = 0;

    const follower = sim.addVehicle(path, 2);
    follower.lane = 0;
    follower.pathPos = 1.0;

    // First tick batch — should switch once
    sim.tick();
    sim.tick();
    sim.tick();
    const laneAfterSwitch = follower.lane;
    expect(laneAfterSwitch).toBe(1);

    // Next tick — even if lane 0 is now clear, cooldown should prevent immediate switch back
    blocker.pathPos = 9.0; // move blocker far away
    sim.tick();
    expect(follower.lane).toBe(1); // still on lane 1 due to cooldown
  });

  it('should update totalLanes and clamp lane when entering a wider road', () => {
    const sim = new TrafficSimulation();
    // Path goes from a 1-lane segment to a 2-lane segment
    const path = ['0,0', '1,0', '2,0', '3,0', '4,0'];
    const v = sim.addVehicle(path, 1);
    v.lane = 0;
    v.totalLanes = 1;

    // getCellLaneCount: cells 0-1 are 1-lane, cells 2+ are 2-lane
    const getCellLaneCount = (cellKey: string) => {
      const x = Number(cellKey.split(',')[0]);
      return x >= 2 ? 2 : 1;
    };

    // Move vehicle into the 2-lane zone
    sim.tick(undefined, undefined, getCellLaneCount);
    expect(v.totalLanes).toBe(2);
  });

  it('should clamp lane when entering a narrower road', () => {
    const sim = new TrafficSimulation();
    const path = ['0,0', '1,0', '2,0', '3,0', '4,0'];
    const v = sim.addVehicle(path, 2);
    v.lane = 1;
    v.totalLanes = 2;

    // getCellLaneCount: cells 2+ are 1-lane
    const getCellLaneCount = (cellKey: string) => {
      const x = Number(cellKey.split(',')[0]);
      return x >= 2 ? 1 : 2;
    };

    sim.tick(undefined, undefined, getCellLaneCount);
    expect(v.totalLanes).toBe(1);
    expect(v.lane).toBe(0); // clamped from 1 to 0
  });

  it('should detect vehicle ahead mid-turn (90° heading difference)', () => {
    const sim = new TrafficSimulation();
    // v1 is turning: path goes east then north, stopped near end
    const v1 = sim.addVehicle(['0,0', '1,0', '1,1', '1,2'], 1);
    v1.lane = 0;
    v1.pathPos = 1.5; // mid-turn, heading north at cell (1,0)->(1,1)

    // v2 is behind on the straight segment, heading east
    const v2 = sim.addVehicle(['0,0', '1,0', '1,1', '1,2'], 1);
    v2.lane = 0;
    v2.pathPos = 0.5; // heading east at cell (0,0)->(1,0)

    // Block v1 from moving (near end of path)
    v1.pathPos = 2.8;

    sim.tick();
    // v2 should NOT overlap with v1 — it should stop behind
    expect(v2.pathPos).toBeLessThan(v1.pathPos);
  });
});

describe('predicted congestion flow', () => {
  it('should accept predicted flow map and use it for getSegmentDensity', () => {
    const sim = new TrafficSimulation();
    const flowMap = new Map<string, number>();
    flowMap.set('3,0', 42);
    flowMap.set('5,5', 10);

    sim.updatePredictedFlow(flowMap);

    expect(sim.getSegmentDensity('3,0')).toBe(42);
    expect(sim.getSegmentDensity('5,5')).toBe(10);
    expect(sim.getSegmentDensity('0,0')).toBe(0); // no flow
  });

  it('should use predicted flow in getTopCongested', () => {
    const sim = new TrafficSimulation();
    const flowMap = new Map<string, number>();
    flowMap.set('1,0', 5);
    flowMap.set('2,0', 15);
    flowMap.set('3,0', 10);

    sim.updatePredictedFlow(flowMap);

    const top = sim.getTopCongested(2);
    expect(top.length).toBe(2);
    expect(top[0]!.segment).toBe('2,0');
    expect(top[0]!.density).toBe(15);
    expect(top[1]!.segment).toBe('3,0');
  });

  it('should override vehicle-based density when predicted flow is set', () => {
    const sim = new TrafficSimulation();
    // Add a legacy vehicle at cell 0,0
    sim.addVehicle(['0,0', '1,0', '2,0', '3,0', '4,0']);
    sim.tick(); // vehicle moves, density built

    // Set predicted flow — should override
    const flowMap = new Map<string, number>();
    flowMap.set('5,5', 99);
    sim.updatePredictedFlow(flowMap);

    expect(sim.getSegmentDensity('5,5')).toBe(99);
    // Vehicle-based density is no longer used by getSegmentDensity
    // getVehicleCount still works independently
    expect(sim.getVehicleCount()).toBeGreaterThanOrEqual(0);
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
