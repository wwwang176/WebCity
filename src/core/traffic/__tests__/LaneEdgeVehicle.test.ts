import { describe, it, expect } from 'vitest';
import { TrafficSimulation, Vehicle } from '../TrafficSimulation';
import { LaneGraph, LaneEdge } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';

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

  const grid = { getCell: (x: number, y: number) => cells.get(`${x},${y}`) ?? null };
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

  describe('tick with edge-based movement', () => {
    it('should advance vehicle along edge path', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);
      const initialProgress = v.edgeProgress;

      sim.tick();

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

      sim.tick();

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

      sim.tick();

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

      sim.tick();

      // Follower should not pass leader
      const leaderTotal = leader.edgeIndex * 1000 + leader.edgeProgress;
      const followerTotal = follower.edgeIndex * 1000 + follower.edgeProgress;
      expect(followerTotal).toBeLessThan(leaderTotal);
    });
  });

  describe('speed limit integration', () => {
    it('should respect speed limit callback', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(10);
      const edgePath = resolveEastPath(graph, cellKeys);

      // Vehicle on slow road
      const vSlow = sim.addVehicleOnEdges(edgePath);
      // Vehicle on fast road (separate sim to isolate)
      const sim2 = new TrafficSimulation();
      const vFast = sim2.addVehicleOnEdges(edgePath);

      sim.tick(undefined, () => 30);   // slow
      sim2.tick(undefined, () => 100);  // fast

      const slowProgress = vSlow.edgeIndex + vSlow.edgeProgress;
      const fastProgress = vFast.edgeIndex + vFast.edgeProgress;
      expect(fastProgress).toBeGreaterThan(slowProgress);
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
      sim.tick();

      // Leader should have advanced
      const leaderAfter = leader.edgeIndex * 1000 + leader.edgeProgress;
      expect(leaderAfter).toBeGreaterThan(leaderBefore);

      // Follower should not overtake leader
      const followerAfter = follower.edgeIndex * 1000 + follower.edgeProgress;
      expect(followerAfter).toBeLessThan(leaderAfter);
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

      // Tick several times
      for (let i = 0; i < 20; i++) {
        sim.tick(canAdvance);
      }

      // Vehicle should have stopped before crossing from 1,0 to 2,0
      // Find the cross-cell edge from 1,0 to 2,0 in the path
      const crossEdgeIdx = edgePath.findIndex(
        e => e.from.cellKey === '1,0' && e.to.cellKey === '2,0'
      );
      expect(crossEdgeIdx).toBeGreaterThan(-1);

      // Vehicle should not have passed this cross edge
      if (v.edgeIndex < crossEdgeIdx) {
        // Still before the blocked edge — correct
        expect(true).toBe(true);
      } else if (v.edgeIndex === crossEdgeIdx) {
        // At the blocked edge but should have minimal progress
        expect(v.edgeProgress).toBeLessThan(0.01);
      } else {
        // Past the blocked edge — WRONG
        expect(v.edgeIndex).toBeLessThanOrEqual(crossEdgeIdx);
      }
    });

    it('should allow vehicle through when light is green', () => {
      const sim = new TrafficSimulation();
      const { graph, cellKeys } = buildHorizontalRoad(5);
      const edgePath = resolveEastPath(graph, cellKeys);

      const v = sim.addVehicleOnEdges(edgePath);

      // All green
      const canAdvance = () => true;

      for (let i = 0; i < 20; i++) {
        sim.tick(canAdvance);
      }

      // Vehicle should have passed well beyond cell 2,0
      const totalProgress = v.edgeIndex + v.edgeProgress;
      expect(totalProgress).toBeGreaterThan(2);
    });
  });
});
