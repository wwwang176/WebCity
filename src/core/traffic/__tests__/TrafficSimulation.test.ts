import { describe, it, expect } from 'vitest';
import { TrafficSimulation, getSpeedLimitForCell, TRAFFIC, SERVICE_VEHICLE_DIMS } from '../TrafficSimulation';
import type { ServiceVehicleType } from '../TrafficSimulation';
import { RoadType, getLaneCount } from '../../road/types';

/** Helper: create a straight edge between two cells. */
function makeEdge(id: string, fromCell: string, toCell: string, length = 1.0): any {
  const [fx, fy] = fromCell.split(',').map(Number);
  const [tx, ty] = toCell.split(',').map(Number);
  return {
    id,
    from: { id: `${id}_from`, cellKey: fromCell, position: { x: fx, y: fy }, lane: 0, direction: 'east', type: 'exit' },
    to: { id: `${id}_to`, cellKey: toCell, position: { x: tx, y: ty }, lane: 0, direction: 'east', type: 'entry' },
    length,
    edgeType: 'straight',
  };
}

/** Helper: create a long edge path of N cells going east. */
function makeLongPath(n: number): any[] {
  const edges: any[] = [];
  for (let i = 0; i < n - 1; i++) {
    edges.push(makeEdge(`e${i}`, `${i},0`, `${i + 1},0`));
  }
  return edges;
}

describe('TrafficSimulation', () => {
  it('should add a vehicle on edges', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(makeLongPath(3));
    expect(v.edgeIndex).toBe(0);
    expect(v.edgeProgress).toBe(0);
    expect(v.arrived).toBe(false);
  });

  it('should assign lane from first edge', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(makeLongPath(3));
    expect(v.lane).toBe(0);
  });

  it('should advance vehicle position each frame', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(makeLongPath(10));
    sim.advanceEdgeVehicles(0.1);
    expect(v.edgeProgress).toBeGreaterThan(0);
  });

  it('should mark vehicle as arrived at destination', () => {
    const sim = new TrafficSimulation();
    sim.addVehicleOnEdges(makeLongPath(3));
    // Advance enough to traverse 2 edges of length 1.0 each
    // EDGE_SPEED=14 * dt=1.0 * speedMultiplier(0.8-1.0) >> 2.0
    sim.advanceEdgeVehicles(1.0);
    expect(sim.getVehicleCount()).toBe(0);
  });

  it('should track segment density', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(makeLongPath(20));
    v.stallTime = 0; // remove jitter
    expect(sim.getSegmentDensity('0,0')).toBe(1);
    // With acceleration model, need more frames to leave first cell
    for (let i = 0; i < 20; i++) sim.advanceEdgeVehicles(0.1);
    // Vehicle has moved forward, density should shift
    expect(sim.getSegmentDensity('0,0')).toBe(0);
  });

  it('should remove arrived vehicles', () => {
    const sim = new TrafficSimulation();
    sim.addVehicleOnEdges(makeLongPath(2));
    sim.advanceEdgeVehicles(1.0);
    expect(sim.getVehicleCount()).toBe(0);
  });

  it('should move faster on roads with higher speed limit', () => {
    const sim1 = new TrafficSimulation();
    const v1 = sim1.addVehicleOnEdges(makeLongPath(50));
    v1.stallTime = 0;
    // Run enough frames for acceleration to reveal speed-limit difference
    for (let i = 0; i < 60; i++) sim1.advanceEdgeVehicles(0.05, undefined, () => 100);
    const progress1 = v1.edgeProgress + v1.edgeIndex;

    const sim2 = new TrafficSimulation();
    const v2 = sim2.addVehicleOnEdges(makeLongPath(50));
    v2.stallTime = 0;
    for (let i = 0; i < 60; i++) sim2.advanceEdgeVehicles(0.05, undefined, () => 30);
    const progress2 = v2.edgeProgress + v2.edgeIndex;

    expect(progress1).toBeGreaterThan(progress2);
  });

  it('should block vehicles on the same edge', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(10);
    const leader = sim.addVehicleOnEdges(edges);
    leader.edgeIndex = 2;
    leader.edgeProgress = 0.5;

    const follower = sim.addVehicleOnEdges(edges);
    follower.edgeIndex = 2;
    follower.edgeProgress = 0.0;

    // Red light blocks leader from crossing cells
    sim.advanceEdgeVehicles(0.1, () => false);

    // Follower should not have passed leader
    const leaderTotal = leader.edgeIndex + leader.edgeProgress;
    const followerTotal = follower.edgeIndex + follower.edgeProgress;
    expect(followerTotal).toBeLessThan(leaderTotal);
  });

  it('should stop at red lights', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(makeLongPath(10));
    // Block all cross-cell movement
    sim.advanceEdgeVehicles(0.5, () => false);
    // Vehicle should not have progressed past the first cell boundary
    expect(v.edgeIndex).toBe(0);
  });
});

describe('stuck vehicle despawn', () => {
  it('should despawn edge vehicle stalled too long', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);

    const leader = sim.addVehicleOnEdges(edges);
    leader.edgeIndex = 0;
    leader.edgeProgress = 0.5;

    const follower = sim.addVehicleOnEdges(edges);
    follower.edgeIndex = 0;
    follower.edgeProgress = 0.0;

    // Red light blocks everything
    const canAdvance = () => false;

    // Advance many frames — each call with dt=0.25
    // stallTime starts in [-5, 0] due to jitter, so need 35s worst case → 140+ calls
    for (let i = 0; i < 150; i++) {
      sim.advanceEdgeVehicles(0.25, canAdvance);
    }

    // Both should be despawned
    expect(sim.getVehicleCount()).toBe(0);
  });

  it('should reset stall time when vehicle moves again', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(10);

    const leader = sim.addVehicleOnEdges(edges);
    leader.edgeIndex = 1;
    leader.edgeProgress = 0.5;

    const follower = sim.addVehicleOnEdges(edges);
    follower.edgeIndex = 0;
    follower.edgeProgress = 0.0;

    // Stall for a bit (not enough to despawn): block cross-cell movement
    for (let i = 0; i < 50; i++) {
      sim.advanceEdgeVehicles(0.25, () => false);
    }
    expect(sim.vehicles.some(v => v.id === follower.id)).toBe(true);
    expect(follower.stallTime).toBeGreaterThan(0);

    // Unblock — allow cross-cell movement
    sim.advanceEdgeVehicles(0.25, () => true);

    // Follower should have moved and stallTime reset
    expect(follower.stallTime).toBe(0);
  });

  it('should not despawn vehicles that are moving slowly but not stalled', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(50);
    const v = sim.addVehicleOnEdges(edges);

    // Advance with very slow speed limit (5) — vehicle moves slowly but NOT stalled
    for (let i = 0; i < 130; i++) {
      sim.advanceEdgeVehicles(0.25, undefined, () => 5);
    }

    // Vehicle should not be force-despawned (it's still moving)
    expect(v.stallTime).toBe(0);
  });
});

describe('TRAFFIC constants', () => {
  it('speed multiplier range should produce values between 0 and 1', () => {
    expect(TRAFFIC.SPEED_MULTIPLIER_MIN).toBeGreaterThan(0);
    expect(TRAFFIC.SPEED_MULTIPLIER_MIN + TRAFFIC.SPEED_MULTIPLIER_RANGE).toBeLessThanOrEqual(1);
  });

  it('density capacity per cell should be positive', () => {
    expect(TRAFFIC.DENSITY_CAPACITY_PER_CELL).toBeGreaterThan(0);
  });

  it('edge speed and reference limit should be positive', () => {
    expect(TRAFFIC.EDGE_SPEED).toBeGreaterThan(0);
    expect(TRAFFIC.REFERENCE_LIMIT).toBeGreaterThan(0);
  });

  it('min gap should be positive and less than 1', () => {
    expect(TRAFFIC.MIN_GAP).toBeGreaterThan(0);
    expect(TRAFFIC.MIN_GAP).toBeLessThan(1);
  });

  it('despawn stall time should be positive', () => {
    expect(TRAFFIC.DESPAWN_STALL_TIME).toBeGreaterThan(0);
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
    sim.addVehicleOnEdges(makeLongPath(5));
    sim.advanceEdgeVehicles(0.1);

    const flowMap = new Map<string, number>();
    flowMap.set('5,5', 99);
    sim.updatePredictedFlow(flowMap);

    expect(sim.getSegmentDensity('5,5')).toBe(99);
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

describe('getSpeedLimitForCell', () => {
  it('should return default 50 for non-road cells', () => {
    const grid = { getCell: () => ({ roadType: 0 }) };
    expect(getSpeedLimitForCell(grid, '5,5')).toBe(50);
  });

  it('should return default 50 for null cell', () => {
    const grid = { getCell: () => null };
    expect(getSpeedLimitForCell(grid, '5,5')).toBe(50);
  });

  it('should return speed limit from road config for road cells', () => {
    const grid = { getCell: () => ({ roadType: RoadType.HIGHWAY }) };
    const limit = getSpeedLimitForCell(grid, '5,5');
    expect(limit).toBeGreaterThan(50); // highways are faster
  });

  it('should return speed limit for two-lane road', () => {
    const grid = { getCell: () => ({ roadType: RoadType.TWO_LANE }) };
    const limit = getSpeedLimitForCell(grid, '3,3');
    expect(limit).toBe(50); // default two-lane speed
  });
});

describe('stall jitter', () => {
  it('should initialize stallTime in [-5, 0] range', () => {
    const sim = new TrafficSimulation();
    const results: number[] = [];
    for (let i = 0; i < 100; i++) {
      const v = sim.addVehicleOnEdges(makeLongPath(5));
      results.push(v.stallTime);
    }
    // All values should be in [-5, 0]
    for (const st of results) {
      expect(st).toBeGreaterThanOrEqual(-5);
      expect(st).toBeLessThanOrEqual(0);
    }
    // At least some should be negative (probabilistic but 100 samples makes it near-certain)
    const hasNegative = results.some(st => st < 0);
    expect(hasNegative).toBe(true);
  });
});

describe('addServiceVehicle', () => {
  it('should add a service vehicle with correct serviceType', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);
    const v = sim.addServiceVehicle(edges, 'police');
    expect(v.serviceType).toBe('police');
    expect(v.arrived).toBe(false);
    expect(v.length).toBe(SERVICE_VEHICLE_DIMS.police.length);
  });

  it('should use correct lengths for each service type', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);
    for (const type of ['police', 'fire', 'health', 'garbage'] as ServiceVehicleType[]) {
      const v = sim.addServiceVehicle(edges, type);
      expect(v.length).toBe(SERVICE_VEHICLE_DIMS[type].length);
    }
  });

  it('service vehicle should be counted in getVehicleCount', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);
    sim.addServiceVehicle(edges, 'police');
    expect(sim.getVehicleCount()).toBe(1);
  });
});

describe('removeServiceVehicles', () => {
  it('should remove all vehicles of a specific service type', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);
    sim.addServiceVehicle(edges, 'police');
    sim.addServiceVehicle(edges, 'police');
    sim.addServiceVehicle(edges, 'fire');

    sim.removeServiceVehicles('police');

    expect(sim.getVehicleCount()).toBe(1);
    expect(sim.vehicles[0]!.serviceType).toBe('fire');
  });

  it('should not remove other vehicle types', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);
    sim.addVehicleOnEdges(edges);
    sim.addServiceVehicle(edges, 'police');

    sim.removeServiceVehicles('police');

    expect(sim.getVehicleCount()).toBe(1);
    expect(sim.vehicles[0]!.serviceType).toBeUndefined();
  });
});

describe('getServiceVehicleCount', () => {
  it('should count all service vehicles when no type specified', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);
    sim.addServiceVehicle(edges, 'police');
    sim.addServiceVehicle(edges, 'fire');
    sim.addServiceVehicle(edges, 'health');

    expect(sim.getServiceVehicleCount()).toBe(3);
  });

  it('should count service vehicles of a specific type', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);
    sim.addServiceVehicle(edges, 'police');
    sim.addServiceVehicle(edges, 'police');
    sim.addServiceVehicle(edges, 'fire');

    expect(sim.getServiceVehicleCount('police')).toBe(2);
    expect(sim.getServiceVehicleCount('fire')).toBe(1);
    expect(sim.getServiceVehicleCount('garbage')).toBe(0);
  });

  it('should not count regular vehicles', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);
    sim.addVehicleOnEdges(edges);
    sim.addServiceVehicle(edges, 'police');

    expect(sim.getServiceVehicleCount()).toBe(1);
  });
});

describe('zero-alloc vehicle removal', () => {
  it('advanceEdgeVehicles should compact arrived vehicles in-place', () => {
    const sim = new TrafficSimulation();
    sim.addVehicleOnEdges(makeLongPath(2)); // will arrive quickly
    sim.addVehicleOnEdges(makeLongPath(50)); // will stay
    const arrRef = sim.vehicles;
    sim.advanceEdgeVehicles(1.0);
    // Same array reference after removal
    expect(sim.vehicles).toBe(arrRef);
    expect(sim.getVehicleCount()).toBe(1);
  });

  it('removeBusVehicles should compact in-place', () => {
    const sim = new TrafficSimulation();
    const seg = [makeLongPath(5)];
    sim.addBusVehicle(seg, 1);
    sim.addVehicleOnEdges(makeLongPath(5));
    const arrRef = sim.vehicles;
    sim.removeBusVehicles(1);
    expect(sim.vehicles).toBe(arrRef);
    expect(sim.getVehicleCount()).toBe(1);
  });

  it('removeServiceVehicles should compact in-place', () => {
    const sim = new TrafficSimulation();
    sim.addServiceVehicle(makeLongPath(5), 'police');
    sim.addVehicleOnEdges(makeLongPath(5));
    const arrRef = sim.vehicles;
    sim.removeServiceVehicles('police');
    expect(sim.vehicles).toBe(arrRef);
    expect(sim.getVehicleCount()).toBe(1);
  });

  it('removeVehiclesByIds should compact in-place', () => {
    const sim = new TrafficSimulation();
    const v1 = sim.addVehicleOnEdges(makeLongPath(5));
    sim.addVehicleOnEdges(makeLongPath(5));
    const arrRef = sim.vehicles;
    sim.removeVehiclesByIds(new Set([v1.id]));
    expect(sim.vehicles).toBe(arrRef);
    expect(sim.getVehicleCount()).toBe(1);
  });
});

describe('acceleration and braking model', () => {
  it('new vehicle should start with currentSpeed = 0', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(makeLongPath(10));
    expect(v.currentSpeed).toBe(0);
  });

  it('vehicle should accelerate gradually, not instantly reach max speed', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(makeLongPath(50));
    v.stallTime = 0; // remove jitter

    // Single small frame — should accelerate but not reach full speed
    sim.advanceEdgeVehicles(0.016); // ~60fps frame
    const speedAfterOneFrame = v.currentSpeed;
    expect(speedAfterOneFrame).toBeGreaterThan(0);

    // Calculate max possible speed for comparison
    const maxSpeed = TRAFFIC.EDGE_SPEED * v.speedMultiplier;
    expect(speedAfterOneFrame).toBeLessThan(maxSpeed);
  });

  it('vehicle should reach full speed after enough frames', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(makeLongPath(100));
    v.stallTime = 0;

    for (let i = 0; i < 300; i++) {
      sim.advanceEdgeVehicles(0.016);
    }

    const maxSpeed = TRAFFIC.EDGE_SPEED * v.speedMultiplier;
    expect(v.currentSpeed).toBeCloseTo(maxSpeed, 1);
  });

  it('vehicle should brake when approaching a stopped vehicle ahead', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(20);

    // Leader stuck at red light
    const leader = sim.addVehicleOnEdges(edges);
    leader.edgeIndex = 5;
    leader.edgeProgress = 0.5;
    leader.stallTime = 0;

    // Follower approaching from behind
    const follower = sim.addVehicleOnEdges(edges);
    follower.edgeIndex = 0;
    follower.edgeProgress = 0.0;
    follower.stallTime = 0;

    // Advance many frames with red light blocking leader
    for (let i = 0; i < 200; i++) {
      sim.advanceEdgeVehicles(0.016, () => false);
    }

    // Follower should have slowed down and stopped behind leader
    expect(follower.currentSpeed).toBeLessThan(TRAFFIC.EDGE_SPEED * follower.speedMultiplier * 0.5);
  });

  it('vehicle should decelerate proportionally to distance within BRAKE_DISTANCE', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(20);

    // Place two vehicles with a gap inside BRAKE_DISTANCE
    const leader = sim.addVehicleOnEdges(edges);
    leader.edgeIndex = 3;
    leader.edgeProgress = 0.0;
    leader.stallTime = 0;
    leader.currentSpeed = 0; // leader stopped

    const follower = sim.addVehicleOnEdges(edges);
    follower.edgeIndex = 1;
    follower.edgeProgress = 0.0;
    follower.stallTime = 0;
    follower.currentSpeed = TRAFFIC.EDGE_SPEED * follower.speedMultiplier; // at full speed

    // One frame — follower is ~2.0 units away from leader, within BRAKE_DISTANCE
    sim.advanceEdgeVehicles(0.016, () => false);

    // Follower should have reduced speed
    expect(follower.currentSpeed).toBeLessThan(TRAFFIC.EDGE_SPEED * follower.speedMultiplier);
  });

  it('vehicles waiting in a queue should start moving in a wave after green light', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(30);

    // Line up 3 vehicles close together, all stopped
    const v1 = sim.addVehicleOnEdges(edges);
    v1.edgeIndex = 2; v1.edgeProgress = 0.5; v1.stallTime = 0; v1.currentSpeed = 0;
    const v2 = sim.addVehicleOnEdges(edges);
    v2.edgeIndex = 1; v2.edgeProgress = 0.5; v2.stallTime = 0; v2.currentSpeed = 0;
    const v3 = sim.addVehicleOnEdges(edges);
    v3.edgeIndex = 0; v3.edgeProgress = 0.5; v3.stallTime = 0; v3.currentSpeed = 0;

    // Green light — allow movement
    sim.advanceEdgeVehicles(0.1);

    // v1 (front) should start moving first, v3 (back) should move least
    expect(v1.currentSpeed).toBeGreaterThan(0);
    expect(v1.currentSpeed).toBeGreaterThanOrEqual(v2.currentSpeed);
    expect(v2.currentSpeed).toBeGreaterThanOrEqual(v3.currentSpeed);
  });

  it('BRAKE_DISTANCE and ACCEL constants should exist', () => {
    expect(TRAFFIC.BRAKE_DISTANCE).toBeGreaterThan(0);
    expect(TRAFFIC.ACCEL).toBeGreaterThan(0);
  });

  it('vehicle should move slower on turn edges than straight edges', () => {
    // Build a path with a turn edge in the middle
    const straightEdge = makeEdge('s0', '0,0', '1,0');
    straightEdge.type = 'straight';
    const turnEdge = makeEdge('t0', '1,0', '1,1');
    turnEdge.type = 'turn';
    const straightEdge2 = makeEdge('s1', '1,1', '2,1');
    straightEdge2.type = 'straight';

    // Vehicle on straight-only path
    const sim1 = new TrafficSimulation();
    const v1 = sim1.addVehicleOnEdges([straightEdge, straightEdge, straightEdge]);
    v1.stallTime = 0;

    // Vehicle on turn path
    const sim2 = new TrafficSimulation();
    const v2 = sim2.addVehicleOnEdges([straightEdge, turnEdge, straightEdge2]);
    v2.stallTime = 0;
    // Force same speed multiplier
    v2.speedMultiplier = v1.speedMultiplier;

    // Advance both — place vehicles on second edge to compare
    v1.edgeIndex = 1; v1.edgeProgress = 0; v1.currentSpeed = 5;
    v2.edgeIndex = 1; v2.edgeProgress = 0; v2.currentSpeed = 5;

    sim1.advanceEdgeVehicles(0.016);
    sim2.advanceEdgeVehicles(0.016);

    // Turn vehicle should have lower currentSpeed due to turn speed cap
    expect(v2.currentSpeed).toBeLessThan(v1.currentSpeed);
  });

  it('lane_change edges should not reduce speed', () => {
    const straightEdge = makeEdge('s0', '0,0', '1,0');
    straightEdge.type = 'straight';
    const lcEdge = makeEdge('lc0', '1,0', '2,0');
    lcEdge.type = 'lane_change';

    const sim1 = new TrafficSimulation();
    const v1 = sim1.addVehicleOnEdges([straightEdge, straightEdge]);
    v1.stallTime = 0;

    const sim2 = new TrafficSimulation();
    const v2 = sim2.addVehicleOnEdges([straightEdge, lcEdge]);
    v2.stallTime = 0;
    v2.speedMultiplier = v1.speedMultiplier;

    v1.edgeIndex = 1; v1.edgeProgress = 0; v1.currentSpeed = 5;
    v2.edgeIndex = 1; v2.edgeProgress = 0; v2.currentSpeed = 5;

    sim1.advanceEdgeVehicles(0.016);
    sim2.advanceEdgeVehicles(0.016);

    // Lane change should not reduce speed — same as straight
    expect(v2.currentSpeed).toBe(v1.currentSpeed);
  });
});

describe('vehicle factory consistency', () => {
  it('all factory methods should initialize common fields identically', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);

    const commute = sim.addVehicleOnEdges(edges);
    const freight = sim.addFreightVehicle(edges);
    const service = sim.addServiceVehicle(edges, 'fire');
    const bus = sim.addBusVehicle([edges], 0);

    // All should start at edge 0, progress 0
    for (const v of [commute, freight, service, bus]) {
      expect(v.edgeIndex).toBe(0);
      expect(v.edgeProgress).toBe(0);
      expect(v.arrived).toBe(false);
      expect(v.currentSpeed).toBe(0);
      expect(v.edgeMoveRate).toBe(0);
      expect(v.lane).toBe(0);
      // speedMultiplier in valid range
      expect(v.speedMultiplier).toBeGreaterThanOrEqual(0.8);
      expect(v.speedMultiplier).toBeLessThanOrEqual(1.0);
    }
  });

  it('all factory methods should update cellDensity on creation', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);

    sim.addVehicleOnEdges(edges);
    expect(sim.getSegmentDensity('0,0')).toBe(1);

    sim.addFreightVehicle(edges);
    expect(sim.getSegmentDensity('0,0')).toBe(2);

    sim.addServiceVehicle(edges, 'police');
    expect(sim.getSegmentDensity('0,0')).toBe(3);

    sim.addBusVehicle([edges], 0);
    expect(sim.getSegmentDensity('0,0')).toBe(4);
  });

  it('each factory should produce unique vehicle IDs', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);
    const ids = new Set<number>();

    ids.add(sim.addVehicleOnEdges(edges).id);
    ids.add(sim.addFreightVehicle(edges).id);
    ids.add(sim.addServiceVehicle(edges, 'police').id);
    ids.add(sim.addBusVehicle([edges], 0).id);

    expect(ids.size).toBe(4);
  });

  it('freight vehicle should use truck dimensions', () => {
    const sim = new TrafficSimulation();
    const v = sim.addFreightVehicle(makeLongPath(5));
    expect(v.length).toBe(0.45);
    expect(v.width).toBe(0.125);
  });
});

describe('service vehicle stall exemption', () => {
  it('should not despawn service vehicles due to stall time', () => {
    const sim = new TrafficSimulation();
    const edges = makeLongPath(5);

    const leader = sim.addVehicleOnEdges(edges);
    leader.edgeIndex = 0;
    leader.edgeProgress = 0.5;

    const serviceV = sim.addServiceVehicle(edges, 'police');
    serviceV.edgeIndex = 0;
    serviceV.edgeProgress = 0.0;
    serviceV.stallTime = 0; // reset jitter

    // Block all cross-cell movement
    for (let i = 0; i < 150; i++) {
      sim.advanceEdgeVehicles(0.25, () => false);
    }

    // Regular vehicle should be despawned, but service vehicle should remain
    const remaining = sim.vehicles.filter(v => v.serviceType === 'police');
    expect(remaining.length).toBe(1);
  });
});
