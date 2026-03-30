import { describe, it, expect } from 'vitest';
import { TrafficSimulation, Vehicle } from '../TrafficSimulation';
import { LaneGraph, LaneEdge } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';
import { makeGridLookup } from '../../../../tests/helpers/makeGridLookup';

/** Helper: build a simple horizontal road grid and lane graph */
function buildHorizontalRoad(length: number, roadType = RoadType.TWO_LANE) {
  const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
  const cellKeys: string[] = [];

  for (let x = 0; x < length; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < length - 1) flags |= RoadDirection.EAST;
    cells.set(`${x},0`, { roadType, roadFlags: flags });
    cellKeys.push(`${x},0`);
  }

  const grid = makeGridLookup(cells);
  const graph = new LaneGraph();
  graph.buildFromGrid(grid, cellKeys);

  return { grid, graph, cellKeys };
}

/** Helper: resolve a lane-edge path for going east along a straight road */
function resolveEastPath(graph: LaneGraph, cellKeys: string[], lane = 0): LaneEdge[] {
  const edges: LaneEdge[] = [];

  // For each pair of adjacent cells going east: need internal traversal + cross-cell edge
  for (let i = 0; i < cellKeys.length - 1; i++) {
    const fromCell = cellKeys[i]!;
    const toCell = cellKeys[i + 1]!;

    // Internal edge: entry(west) → exit(east) within fromCell (except for first cell)
    if (i > 0) {
      const internalEdges = graph.getAllEdges().filter(
        e => e.from.cellKey === fromCell && e.to.cellKey === fromCell
          && e.from.direction === 'west' && e.to.direction === 'east'
          && e.from.lane === lane && e.to.lane === lane
          && e.type === 'straight'
      );
      if (internalEdges.length > 0) edges.push(internalEdges[0]!);
    }

    // Cross-cell edge: exit(east) of fromCell → entry(west) of toCell
    const crossEdges = graph.getEdgesBetween(fromCell, toCell).filter(
      e => e.from.lane === lane && e.to.lane === lane && e.type === 'straight'
    );
    if (crossEdges.length > 0) edges.push(crossEdges[0]!);
  }

  return edges;
}

/** Simulate dt seconds of edge vehicle advancement (at ~60fps frame intervals) */
function advanceFor(sim: TrafficSimulation, dtSeconds: number,
  canAdvance?: (cur: string, next: string) => boolean,
  getSpeedLimit?: (cellKey: string) => number,
) {
  // Use a single call with the full dt
  sim.advanceEdgeVehicles(dtSeconds, canAdvance, getSpeedLimit);
}

describe('LaneEdge Vehicle Movement', () => {
  describe('addVehicleOnEdges', () => {
    it('should create a vehicle with LaneEdge path', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);

      const edgePath = resolveEastPath(graph, cellKeys);
      expect(edgePath.length).toBeGreaterThan(0);

      const v = sim.addVehicleOnEdges(edgePath);
      expect(v).toBeDefined();
      expect(v.edgePath).toBe(edgePath);
      expect(v.edgeIndex).toBe(0);
      expect(v.edgeProgress).toBe(0);
      expect(v.arrived).toBe(false);
    });
  });

  describe('advanceEdgeVehicles movement', () => {
    it('should advance vehicle along edge path', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);
      const initialProgress = v.edgeProgress;

      advanceFor(sim, 0.1); // 100ms

      // Vehicle should have moved forward
      const totalProgress = v.edgeIndex + v.edgeProgress;
      expect(totalProgress).toBeGreaterThan(initialProgress);
    });

    it('should transition between edges when reaching edge end', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);
      // Move vehicle close to end of first edge
      v.edgeProgress = edgePath[0]!.length - 0.01;

      advanceFor(sim, 0.1);

      // Should have moved to next edge
      expect(v.edgeIndex).toBeGreaterThanOrEqual(1);
    });

    it('should mark vehicle as arrived when reaching end of edge path', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(3);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);
      // Place at last edge, near end
      v.edgeIndex = edgePath.length - 1;
      v.edgeProgress = edgePath[edgePath.length - 1]!.length - 0.001;

      advanceFor(sim, 0.1);

      expect(v.arrived).toBe(true);
    });
  });

  describe('getVehiclePositionOnEdges', () => {
    it('should return correct position for vehicle on straight edge', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);
      v.edgeProgress = 0;

      const pos = sim.getVehiclePositionOnEdges(v);
      expect(pos).not.toBeNull();
      // Should be at the start of the first edge
      expect(pos!.x).toBeCloseTo(edgePath[0]!.from.position.x, 1);
      expect(pos!.y).toBeCloseTo(edgePath[0]!.from.position.y, 1);
    });

    it('should interpolate position along edge', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);
      const edge = edgePath[0]!;
      v.edgeProgress = edge.length / 2; // midpoint

      const pos = sim.getVehiclePositionOnEdges(v);
      expect(pos).not.toBeNull();
      // Should be roughly between from and to positions
      const midX = (edge.from.position.x + edge.to.position.x) / 2;
      const midY = (edge.from.position.y + edge.to.position.y) / 2;
      expect(pos!.x).toBeCloseTo(midX, 0);
      expect(pos!.y).toBeCloseTo(midY, 0);
    });
  });

  describe('getVehicleHeadingOnEdges', () => {
    it('should return eastward heading for eastbound vehicle', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);

      const heading = sim.getVehicleHeadingOnEdges(v);
      // Heading should point east (positive x)
      expect(heading).toBeCloseTo(0, 0); // 0 radians = east
    });
  });

  describe('collision detection on edge path', () => {
    it('should block trailing vehicle behind leading vehicle on same edge', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      // Leader near end of first edge
      const leader = sim.addVehicleOnEdges(edgePath);
      leader.edgeProgress = edgePath[0]!.length * 0.8;

      // Follower behind on same edge
      const follower = sim.addVehicleOnEdges(edgePath);
      follower.edgeProgress = edgePath[0]!.length * 0.6;

      advanceFor(sim, 0.1);

      // Follower should not pass leader
      const leaderTotal = leader.edgeIndex * 1000 + leader.edgeProgress;
      const followerTotal = follower.edgeIndex * 1000 + follower.edgeProgress;
      expect(followerTotal).toBeLessThan(leaderTotal);
    });
  });

  describe('speed limit integration', () => {
    it('should respect speed limit callback', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(40);
      const edgePath = resolveEastPath(graph, cellKeys);

      // Vehicle on slow road
      const vSlow = sim.addVehicleOnEdges(edgePath);
      vSlow.stallTime = 0;
      // Vehicle on fast road (separate sim to isolate)
      const sim2 = new TrafficSimulation();
      const { graph: g2, cellKeys: ck2 } = buildHorizontalRoad(40);
      const edgePath2 = resolveEastPath(g2, ck2);
      const vFast = sim2.addVehicleOnEdges(edgePath2);
      vFast.stallTime = 0;

      // Enough frames for slower vehicle to cap out so speed-limit gap emerges
      for (let i = 0; i < 200; i++) {
        advanceFor(sim, 0.016, undefined, () => 30);   // slow
        advanceFor(sim2, 0.016, undefined, () => 100);  // fast
      }

      const slowProgress = vSlow.edgeIndex + vSlow.edgeProgress;
      const fastProgress = vFast.edgeIndex + vFast.edgeProgress;
      expect(fastProgress).toBeGreaterThan(slowProgress);
    });
  });

  describe('speed multiplier', () => {
    it('should assign speedMultiplier between 0.8 and 1.0 to edge vehicles', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      // Create many vehicles and check their speed multipliers are in range
      for (let i = 0; i < 20; i++) {
        const v = sim.addVehicleOnEdges(edgePath);
        expect(v.speedMultiplier).toBeGreaterThanOrEqual(0.8);
        expect(v.speedMultiplier).toBeLessThanOrEqual(1.0);
      }
    });

    it('should cause vehicles with different multipliers to separate over time', () => {
      const sim1 = new TrafficSimulation();
      const sim2 = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(20);
      const edgePath = resolveEastPath(graph, cellKeys);

      const vSlow = sim1.addVehicleOnEdges(edgePath);
      vSlow.speedMultiplier = 0.8; // slowest
      vSlow.stallTime = 0;
      const vFast = sim2.addVehicleOnEdges(edgePath);
      vFast.speedMultiplier = 1.0; // fastest
      vFast.stallTime = 0;

      // Advance both for ~3 seconds — enough for slower vehicle to hit its cap
      // so the speed multiplier difference becomes visible
      for (let i = 0; i < 180; i++) {
        advanceFor(sim1, 0.016);
        advanceFor(sim2, 0.016);
      }

      const slowTotal = vSlow.edgeIndex + vSlow.edgeProgress;
      const fastTotal = vFast.edgeIndex + vFast.edgeProgress;
      expect(fastTotal).toBeGreaterThan(slowTotal);
    });
  });

  describe('front-to-back ordering', () => {
    it('should move leading vehicle first so trailing vehicle sees updated position', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(10);
      const edgePath = resolveEastPath(graph, cellKeys);

      // Place leader ahead of follower with small gap
      const leader = sim.addVehicleOnEdges(edgePath);
      leader.edgeIndex = 2;
      leader.edgeProgress = 0;

      const follower = sim.addVehicleOnEdges(edgePath);
      follower.edgeIndex = 1;
      follower.edgeProgress = edgePath[1]!.length * 0.8;

      const leaderBefore = leader.edgeIndex * 1000 + leader.edgeProgress;
      advanceFor(sim, 0.1);

      // Leader should have advanced
      const leaderAfter = leader.edgeIndex * 1000 + leader.edgeProgress;
      expect(leaderAfter).toBeGreaterThan(leaderBefore);

      // Follower should not overtake leader
      const followerAfter = follower.edgeIndex * 1000 + follower.edgeProgress;
      expect(followerAfter).toBeLessThan(leaderAfter);
    });
  });

  describe('overlap resolution by ID priority', () => {
    it('should let lower-ID vehicle move first when spawned at same position', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(10);
      const edgePath = resolveEastPath(graph, cellKeys);

      // Spawn 3 vehicles at exact same position (progress=0, edge 0)
      const v1 = sim.addVehicleOnEdges(edgePath);
      const v2 = sim.addVehicleOnEdges(edgePath);
      const v3 = sim.addVehicleOnEdges(edgePath);

      // Force identical speed so only ID priority matters
      v1.speedMultiplier = 1.0;
      v2.speedMultiplier = 1.0;
      v3.speedMultiplier = 1.0;

      // Advance a few frames
      for (let i = 0; i < 10; i++) {
        advanceFor(sim, 1 / 60);
      }

      // v1 (lowest ID) should be furthest ahead
      const p1 = v1.edgeIndex * 1000 + v1.edgeProgress;
      const p2 = v2.edgeIndex * 1000 + v2.edgeProgress;
      const p3 = v3.edgeIndex * 1000 + v3.edgeProgress;

      expect(p1).toBeGreaterThan(0); // v1 must have moved
      expect(p1).toBeGreaterThanOrEqual(p2);
      expect(p2).toBeGreaterThanOrEqual(p3);
    });

    it('should not allow trailing vehicle to squeeze past when gap < MIN_GAP', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(10);
      const edgePath = resolveEastPath(graph, cellKeys);

      const leader = sim.addVehicleOnEdges(edgePath);
      leader.edgeProgress = 0.1; // slightly ahead
      const follower = sim.addVehicleOnEdges(edgePath);
      follower.edgeProgress = 0.05; // gap ≈ 0.05 - halfLens < MIN_GAP

      const followerBefore = follower.edgeProgress;
      advanceFor(sim, 1 / 60);

      // Leader moves, follower should NOT have moved into leader
      const leaderPos = leader.edgeIndex * 1000 + leader.edgeProgress;
      const followerPos = follower.edgeIndex * 1000 + follower.edgeProgress;
      expect(followerPos).toBeLessThan(leaderPos);
    });

    it('should not deadlock — overlapping vehicles eventually separate', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(20);
      const edgePath = resolveEastPath(graph, cellKeys);

      // Spawn 5 vehicles at same position
      const vehicles = [];
      for (let i = 0; i < 5; i++) {
        const v = sim.addVehicleOnEdges(edgePath);
        v.speedMultiplier = 1.0;
        v.stallTime = 0;
        vehicles.push(v);
      }

      // Advance for ~2 seconds (120 frames) — enough for acceleration to propagate
      for (let i = 0; i < 120; i++) {
        advanceFor(sim, 1 / 60);
      }

      // All vehicles should have moved (no deadlock)
      for (const v of vehicles) {
        const p = v.edgeIndex * 1000 + v.edgeProgress;
        expect(p).toBeGreaterThan(0);
      }

      // They should be spread out (not all at same position)
      const positions = vehicles.map(v => v.edgeIndex * 1000 + v.edgeProgress);
      const spread = Math.max(...positions) - Math.min(...positions);
      expect(spread).toBeGreaterThan(0);
    });
  });

  describe('cell density for edge vehicles', () => {
    it('should count edge vehicle in its current cell via getSegmentDensity', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);
      advanceFor(sim, 1 / 60);

      // Vehicle should be counted in whatever cell it's currently on
      const idx = Math.min(v.edgeIndex, edgePath.length - 1);
      const currentCell = edgePath[idx]!.from.cellKey;
      expect(sim.getSegmentDensity(currentCell)).toBeGreaterThanOrEqual(1);
    });

    it('should include edge vehicles in getTopCongested', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      // Add 3 vehicles
      for (let i = 0; i < 3; i++) {
        sim.addVehicleOnEdges(edgePath);
      }
      advanceFor(sim, 1 / 60);

      const top = sim.getTopCongested(5);
      const totalDensity = top.reduce((sum, t) => sum + t.density, 0);
      expect(totalDensity).toBe(3);
    });

    it('should update density as edge vehicle moves to new cell', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(10);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);
      v.speedMultiplier = 1.0;

      // Advance enough to move past first cell
      for (let i = 0; i < 30; i++) {
        advanceFor(sim, 1 / 60);
      }

      // Vehicle should no longer be in first cell
      const firstCell = edgePath[0]!.from.cellKey;
      expect(sim.getSegmentDensity(firstCell)).toBe(0);
    });
  });

  describe('traffic light at intersection entry', () => {
    it('should stop edge-based vehicle at red light', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);
      v.edgeIndex = 0;
      v.edgeProgress = 0;

      // Red light between cell 1,0 and 2,0 — canAdvance returns false
      const canAdvance = (from: string, to: string) => {
        if (from === '1,0' && to === '2,0') return false;
        return true;
      };

      // Advance for 2 seconds (plenty of time)
      for (let i = 0; i < 120; i++) {
        advanceFor(sim, 1 / 60, canAdvance);
      }

      // Vehicle should have stopped before crossing from 1,0 to 2,0
      const crossEdgeIdx = edgePath.findIndex(
        e => e.from.cellKey === '1,0' && e.to.cellKey === '2,0'
      );
      expect(crossEdgeIdx).toBeGreaterThan(-1);

      // Vehicle should not have passed this cross edge
      if (v.edgeIndex < crossEdgeIdx) {
        expect(true).toBe(true);
      } else if (v.edgeIndex === crossEdgeIdx) {
        expect(v.edgeProgress).toBeLessThan(0.01);
      } else {
        expect(v.edgeIndex).toBeLessThanOrEqual(crossEdgeIdx);
      }
    });

    it('should allow vehicle through when light is green', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);

      // All green — advance for 2 seconds
      const canAdvance = () => true;
      for (let i = 0; i < 120; i++) {
        advanceFor(sim, 1 / 60, canAdvance);
      }

      // Vehicle should have passed well beyond cell 2,0
      const totalProgress = v.edgeIndex + v.edgeProgress;
      expect(totalProgress).toBeGreaterThan(2);
    });
  });
});
