/**
 * TDD tests for bus road movement system (BUS-ROAD-MOVEMENT-PLAN.md).
 * Covers Steps 1–6: vehicle lengths, placement, bus vehicle state,
 * path management, road change invalidation, and rendering integration.
 */
import { describe, it, expect } from 'vitest';
import { TrafficSimulation, TRAFFIC } from '../../traffic/TrafficSimulation';
import { canPlaceTransportStop, findAdjacentRoadCell } from '../TransportPlacement';
import { BusSystem } from '../BusSystem';
import type { LaneEdge } from '../../traffic/LaneGraph';
import { TransportType } from '../types';

// ── Helpers ──────────────────────────────────────────────────────

function makeEdge(id: string, fromCell: string, toCell: string, length = 1.0): LaneEdge {
  const [fx, fy] = fromCell.split(',').map(Number);
  const [tx, ty] = toCell.split(',').map(Number);
  return {
    id,
    from: { id: `${id}_from`, cellKey: fromCell, position: { x: fx!, y: fy! }, lane: 0, direction: 'east' as any, type: 'exit' as any, tangent: { tx: 1, ty: 0 } },
    to: { id: `${id}_to`, cellKey: toCell, position: { x: tx!, y: ty! }, lane: 0, direction: 'east' as any, type: 'entry' as any, tangent: { tx: 1, ty: 0 } },
    length,
    type: 'straight',
  } as LaneEdge;
}

function makeLongPath(n: number): LaneEdge[] {
  const edges: LaneEdge[] = [];
  for (let i = 0; i < n - 1; i++) {
    edges.push(makeEdge(`e${i}`, `${i},0`, `${i + 1},0`));
  }
  return edges;
}

function makeGrid(roads: Set<string>) {
  return {
    getCell(x: number, y: number) {
      const key = `${x},${y}`;
      return { roadType: roads.has(key) ? 2 : 0, buildingId: 0, railType: 0 };
    },
  };
}

// ── Step 1: No random bus vehicles ──────────────────────────────

describe('Step 1: random vehicle spawning excludes bus', () => {
  it('addVehicleOnEdges should never produce length 0.45 (bus)', () => {
    const sim = new TrafficSimulation();
    const lengths = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const v = sim.addVehicleOnEdges(makeLongPath(5));
      lengths.add(v.length);
    }
    expect(lengths.has(0.45)).toBe(false);
  });
});

// ── Step 2: Bus stop placement requires adjacent road ───────────

describe('Step 2: bus stop placement requires adjacent road', () => {
  it('should allow bus stop on empty cell adjacent to road', () => {
    const grid = makeGrid(new Set(['5,4'])); // road at (5,4)
    const cell = grid.getCell(5, 3); // empty cell at (5,3)
    const result = canPlaceTransportStop('bus', cell, grid, 5, 3);
    expect(result.ok).toBe(true);
  });

  it('should reject bus stop with no adjacent road', () => {
    const grid = makeGrid(new Set()); // no roads at all
    const cell = grid.getCell(5, 3);
    const result = canPlaceTransportStop('bus', cell, grid, 5, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NEED_ADJACENT_ROAD');
  });

  it('should still reject bus stop on occupied cell even with adjacent road', () => {
    const grid = {
      getCell(x: number, y: number) {
        if (x === 5 && y === 4) return { roadType: 2, buildingId: 0, railType: 0 };
        if (x === 5 && y === 3) return { roadType: 0, buildingId: 7, railType: 0 };
        return { roadType: 0, buildingId: 0, railType: 0 };
      },
    };
    const cell = grid.getCell(5, 3);
    const result = canPlaceTransportStop('bus', cell, grid, 5, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TILE_OCCUPIED');
  });

  it('should not require adjacent road for non-bus types (backward compat)', () => {
    const grid = makeGrid(new Set()); // no roads
    const cell = { roadType: 0, buildingId: 0, railType: 0 };
    const result = canPlaceTransportStop('metro', cell, grid, 5, 3);
    expect(result.ok).toBe(true);
  });

  it('should work without grid parameter (backward compat)', () => {
    const cell = { roadType: 0, buildingId: 0, railType: 0 };
    const result = canPlaceTransportStop('bus', cell);
    expect(result.ok).toBe(true);
  });

  it('findAdjacentRoadCell should return the road cell coords', () => {
    const grid = makeGrid(new Set(['3,2'])); // road at (3,2)
    const result = findAdjacentRoadCell(grid, 3, 3); // stop at (3,3), road is north
    expect(result).toEqual({ roadX: 3, roadY: 2 });
  });

  it('findAdjacentRoadCell should return null when no adjacent road', () => {
    const grid = makeGrid(new Set());
    expect(findAdjacentRoadCell(grid, 3, 3)).toBeNull();
  });
});

// ── Step 3: Vehicle bus state ───────────────────────────────────

describe('Step 3: bus vehicle in TrafficSimulation', () => {
  it('addBusVehicle should create vehicle with busState', () => {
    const sim = new TrafficSimulation();
    const seg1 = makeLongPath(5);
    const seg2 = makeLongPath(5);
    const v = sim.addBusVehicle([seg1, seg2], 42);
    expect(v.busState).toBeDefined();
    expect(v.busState!.routeId).toBe(42);
    expect(v.busState!.segmentIndex).toBe(0);
    expect(v.busState!.dwelling).toBe(false);
    expect(v.length).toBe(0.45);
    expect(v.edgePath).toBe(seg1);
  });

  it('bus should not despawn when reaching end of segment (enters dwell)', () => {
    const sim = new TrafficSimulation();
    const seg1 = makeLongPath(3); // short path
    const seg2 = makeLongPath(5);
    const v = sim.addBusVehicle([seg1, seg2], 1);

    // Advance enough to traverse 2 edges
    sim.advanceEdgeVehicles(1.0);

    // Bus should still be alive, in dwell state
    expect(sim.vehicles.some(veh => veh.id === v.id)).toBe(true);
    expect(v.busState!.dwelling).toBe(true);
  });

  it('bus should load next segment after dwell timer expires', () => {
    const sim = new TrafficSimulation();
    const seg1 = makeLongPath(3);
    const seg2 = makeLongPath(5);
    const v = sim.addBusVehicle([seg1, seg2], 1);

    // Reach end of seg1
    sim.advanceEdgeVehicles(1.0);
    expect(v.busState!.dwelling).toBe(true);

    // Advance through dwell time (BUS_DWELL_SECONDS = 2.0)
    sim.advanceEdgeVehicles(1.0);
    sim.advanceEdgeVehicles(1.0);

    // Should now be on seg2
    expect(v.busState!.dwelling).toBe(false);
    expect(v.busState!.segmentIndex).toBe(1);
    expect(v.edgePath).toBe(seg2);
  });

  it('bus should not be despawned by stall timer', () => {
    const sim = new TrafficSimulation();
    const seg1 = makeLongPath(5);
    const seg2 = makeLongPath(5);
    const v = sim.addBusVehicle([seg1, seg2], 1);
    v.stallTime = 0; // reset jitter

    // Block all movement
    for (let i = 0; i < 200; i++) {
      sim.advanceEdgeVehicles(0.25, () => false);
    }
    // Bus should still exist (stall despawn doesn't apply)
    expect(sim.vehicles.some(veh => veh.id === v.id)).toBe(true);
  });

  it('regular vehicles should still despawn when stalled', () => {
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(makeLongPath(5));
    v.stallTime = 0;

    for (let i = 0; i < 200; i++) {
      sim.advanceEdgeVehicles(0.25, () => false);
    }
    expect(sim.vehicles.some(veh => veh.id === v.id)).toBe(false);
  });

  it('removeBusVehicles should remove only vehicles of given route', () => {
    const sim = new TrafficSimulation();
    sim.addBusVehicle([makeLongPath(5)], 1);
    sim.addBusVehicle([makeLongPath(5)], 2);
    sim.addVehicleOnEdges(makeLongPath(5));

    sim.removeBusVehicles(1);
    expect(sim.vehicles.length).toBe(2); // route 2 bus + regular car
    expect(sim.vehicles.every(v => !(v.busState && v.busState.routeId === 1))).toBe(true);
  });

  it('bus should cycle back to segment 0 after last segment', () => {
    const sim = new TrafficSimulation();
    const seg1 = makeLongPath(3);
    const seg2 = makeLongPath(3);
    const v = sim.addBusVehicle([seg1, seg2], 1);

    // Finish seg1 and dwell
    sim.advanceEdgeVehicles(1.0);
    expect(v.busState!.dwelling).toBe(true);
    sim.advanceEdgeVehicles(1.0);
    sim.advanceEdgeVehicles(1.0);
    expect(v.busState!.segmentIndex).toBe(1);

    // Finish seg2 and dwell
    sim.advanceEdgeVehicles(1.0);
    expect(v.busState!.dwelling).toBe(true);
    sim.advanceEdgeVehicles(1.0);
    sim.advanceEdgeVehicles(1.0);

    // Should cycle back to segment 0
    expect(v.busState!.segmentIndex).toBe(0);
    expect(v.edgePath).toBe(seg1);
  });
});

// ── Step 4: BusSystem path management ───────────────────────────

describe('Step 4: createRouteWithTraffic', () => {
  it('should create route, compute segments, and spawn bus in one call', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1;
    s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4;
    s2.roadY = 0;

    const findPath = () => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    const route = bus.createRouteWithTraffic([s1, s2], 1, findPath, refinePath, traffic);
    expect(route).not.toBeNull();
    expect(bus.getRoutes().length).toBe(1);
    expect(traffic.vehicles.length).toBe(1);
    expect(traffic.vehicles[0]!.busState).toBeDefined();
    expect(traffic.vehicles[0]!.busState!.routeId).toBe(route!.id);
  });

  it('should return null and not create route when path fails', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1;
    s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4;
    s2.roadY = 0;

    const route = bus.createRouteWithTraffic([s1, s2], 1, () => null, () => [], traffic);
    expect(route).toBeNull();
    expect(bus.getRoutes().length).toBe(0);
    expect(traffic.vehicles.length).toBe(0);
  });

  it('should round-robin buses across stops (0→A, 1→B, 2→A, 3→B)', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1; s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4; s2.roadY = 0;

    const findPath = () => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    // 2 stops → 2 segments (A→B, B→A). 5 buses should alternate: A,B,A,B,A
    const route = bus.createRouteWithTraffic([s1, s2], 5, findPath, refinePath, traffic);
    expect(route).not.toBeNull();
    expect(traffic.vehicles.length).toBe(5);

    const segs = traffic.vehicles.map(v => v.busState!.segmentIndex);
    expect(segs).toEqual([0, 1, 0, 1, 0]); // A, B, A, B, A
    // All start at edge 0 (stop position)
    for (const v of traffic.vehicles) {
      expect(v.edgeIndex).toBe(0);
    }
  });

  it('addVehicleWithTraffic should round-robin based on existing count', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1; s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4; s2.roadY = 0;

    const findPath = () => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    // Create with 1 bus at seg 0 (A)
    const route = bus.createRouteWithTraffic([s1, s2], 1, findPath, refinePath, traffic);
    expect(traffic.vehicles[0]!.busState!.segmentIndex).toBe(0);

    // Add via + button: existing=1 → seg 1 (B)
    bus.addVehicleWithTraffic(route!.id, traffic);
    expect(traffic.vehicles[1]!.busState!.segmentIndex).toBe(1);

    // Add again: existing=2 → seg 0 (A)
    bus.addVehicleWithTraffic(route!.id, traffic);
    expect(traffic.vehicles[2]!.busState!.segmentIndex).toBe(0);
  });

  it('deleteRouteWithTraffic should remove from both BusSystem and TrafficSimulation', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1; s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4; s2.roadY = 0;

    const findPath = () => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    const route = bus.createRouteWithTraffic([s1, s2], 2, findPath, refinePath, traffic);
    expect(traffic.vehicles.length).toBe(2);

    bus.deleteRouteWithTraffic(route!.id, traffic);
    expect(bus.getRoutes().length).toBe(0);
    expect(traffic.vehicles.length).toBe(0);
  });

  it('addVehicleWithTraffic should spawn a new bus in TrafficSimulation', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1; s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4; s2.roadY = 0;

    const findPath = () => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    const route = bus.createRouteWithTraffic([s1, s2], 1, findPath, refinePath, traffic);
    expect(traffic.vehicles.length).toBe(1);

    bus.addVehicleWithTraffic(route!.id, traffic);
    expect(traffic.vehicles.length).toBe(2);
    expect(route!.vehicles).toBe(2);
  });

  it('removeVehicleWithTraffic should remove a bus from TrafficSimulation', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1; s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4; s2.roadY = 0;

    const findPath = () => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    const route = bus.createRouteWithTraffic([s1, s2], 3, findPath, refinePath, traffic);
    expect(traffic.vehicles.length).toBe(3);

    bus.removeVehicleWithTraffic(route!.id, traffic);
    expect(traffic.vehicles.length).toBe(2);
    expect(route!.vehicles).toBe(2);
  });
});

describe('Step 4: BusSystem route path management', () => {
  it('computeRouteSegments should compute paths for all stop pairs', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1;
    s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4;
    s2.roadY = 0;
    const route = bus.createRoute([s1, s2], 0);

    const findPath = (_fx: number, _fy: number, _tx: number, _ty: number) => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[], _lane: number) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    const segments = bus.computeRouteSegments(route, findPath, refinePath);
    expect(segments).not.toBeNull();
    expect(segments!.length).toBe(2); // s1→s2 and s2→s1 (loop)
  });

  it('computeRouteSegments should return null if any segment has no path', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1;
    s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4;
    s2.roadY = 0;
    const route = bus.createRoute([s1, s2], 0);

    const findPath = () => null; // no path found
    const refinePath = () => [];

    const segments = bus.computeRouteSegments(route, findPath, refinePath);
    expect(segments).toBeNull();
  });

  it('spawnBusInTraffic should create bus vehicle in TrafficSimulation', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1;
    s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4;
    s2.roadY = 0;
    const route = bus.createRoute([s1, s2], 0);

    const findPath = () => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    bus.computeRouteSegments(route, findPath, refinePath);
    const v = bus.spawnBusInTraffic(route.id, traffic);

    expect(v).not.toBeNull();
    expect(traffic.vehicles.length).toBe(1);
    expect(traffic.vehicles[0]!.busState).toBeDefined();
    expect(traffic.vehicles[0]!.busState!.routeId).toBe(route.id);
  });

  it('spawnBusInTraffic returns null if no segments cached', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    expect(bus.spawnBusInTraffic(999, traffic)).toBeNull();
  });

  it('tick should be a no-op (movement handled by TrafficSimulation)', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 0);
    bus.createRoute([s1, s2], 1);

    // tick should not throw and vehicles should not move via old logic
    bus.tick();
    const vehicles = bus.getVehicles();
    // Old tick creates TransportVehicles; after override, no movement logic runs
    // But we still have the legacy vehicles from createRoute
    expect(vehicles.length).toBe(1);
  });
});

// ── Step 5: Road change invalidation ────────────────────────────

describe('Step 5: road change invalidation', () => {
  it('onRoadChanged should dissolve route when path cannot be recalculated', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1;
    s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4;
    s2.roadY = 0;
    const route = bus.createRoute([s1, s2], 0);

    const findPath = () => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    bus.computeRouteSegments(route, findPath, refinePath);
    bus.spawnBusInTraffic(route.id, traffic);

    // Road at 2,0 destroyed — path through it no longer works
    const dissolved = bus.onRoadChanged(
      new Set(['2,0']),
      () => null, // can't find new path
      () => [],
      traffic,
    );

    expect(dissolved).toContain(route.id);
    expect(bus.getRoutes().length).toBe(0);
    expect(traffic.vehicles.length).toBe(0);
  });

  it('onRoadChanged should recalculate when alternative path exists', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1;
    s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4;
    s2.roadY = 0;
    const route = bus.createRoute([s1, s2], 0);

    const origPath = ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    bus.computeRouteSegments(route, () => origPath, refinePath);
    bus.spawnBusInTraffic(route.id, traffic);

    // Road changed at 2,0 but alternative path exists
    const newPath = ['1,0', '1,1', '2,1', '3,1', '4,0'];
    const dissolved = bus.onRoadChanged(
      new Set(['2,0']),
      () => newPath,
      refinePath,
      traffic,
    );

    expect(dissolved.length).toBe(0);
    expect(bus.getRoutes().length).toBe(1);
  });

  it('onRoadChanged should not affect routes on unrelated cells', () => {
    const bus = new BusSystem();
    const traffic = new TrafficSimulation();
    const s1 = bus.addStop(0, 0);
    s1.roadX = 1;
    s1.roadY = 0;
    const s2 = bus.addStop(5, 0);
    s2.roadX = 4;
    s2.roadY = 0;
    const route = bus.createRoute([s1, s2], 0);

    const findPath = () => ['1,0', '2,0', '3,0', '4,0'];
    const refinePath = (cellPath: string[]) => {
      const edges: LaneEdge[] = [];
      for (let i = 0; i < cellPath.length - 1; i++) {
        edges.push(makeEdge(`e${i}`, cellPath[i]!, cellPath[i + 1]!));
      }
      return edges;
    };

    bus.computeRouteSegments(route, findPath, refinePath);

    // Road changed far away at 99,99
    const dissolved = bus.onRoadChanged(
      new Set(['99,99']),
      findPath,
      refinePath,
      traffic,
    );

    expect(dissolved.length).toBe(0);
    expect(bus.getRoutes().length).toBe(1);
  });
});

// ── Step 6: Rendering integration ───────────────────────────────

describe('Step 6: bus rendering from TrafficSimulation', () => {
  it('bus vehicle should have correct position from edge interpolation', () => {
    const sim = new TrafficSimulation();
    const seg1 = makeLongPath(5);
    const v = sim.addBusVehicle([seg1], 1);

    sim.advanceEdgeVehicles(0.05); // small step
    const pos = sim.getVehiclePositionOnEdges(v);
    expect(pos).not.toBeNull();
    expect(typeof pos!.x).toBe('number');
    expect(typeof pos!.y).toBe('number');
  });

  it('bus vehicle should have valid heading', () => {
    const sim = new TrafficSimulation();
    const seg1 = makeLongPath(5);
    const v = sim.addBusVehicle([seg1], 1);

    sim.advanceEdgeVehicles(0.05);
    const heading = sim.getVehicleHeadingOnEdges(v);
    expect(typeof heading).toBe('number');
    expect(Number.isFinite(heading)).toBe(true);
  });
});
