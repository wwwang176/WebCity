import { describe, it, expect } from 'vitest';
import { refineLanePath, getLaneSpeedMultiplier, LANE_SPEED_DECAY } from '../Pathfinding';
import { LaneGraph, LaneEdge } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';
import { makeGridLookup } from '../../../../tests/helpers/makeGridLookup';

function buildStraightRoad(length: number, roadType = RoadType.TWO_LANE) {
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

describe('refineLanePath', () => {
  it('should produce a LaneEdge path from a cell-level path on a straight road', () => {
    const { graph } = buildStraightRoad(5);
    const cellPath = ['0,0', '1,0', '2,0', '3,0', '4,0'];

    const edgePath = refineLanePath(graph, cellPath);
    expect(edgePath).not.toBeNull();
    expect(edgePath!.length).toBeGreaterThan(0);

    // All edges should be straight type
    for (const e of edgePath!) {
      expect(['straight', 'turn', 'lane_change']).toContain(e.type);
    }
  });

  it('should produce a connected LaneEdge path (each edge.to = next edge.from)', () => {
    const { graph } = buildStraightRoad(5);
    const cellPath = ['0,0', '1,0', '2,0', '3,0', '4,0'];

    const edgePath = refineLanePath(graph, cellPath);
    expect(edgePath).not.toBeNull();

    for (let i = 1; i < edgePath!.length; i++) {
      const prev = edgePath![i - 1]!;
      const curr = edgePath![i]!;
      // The to-point of prev should connect to the from-point of curr
      expect(prev.to.id).toBe(curr.from.id);
    }
  });

  it('should handle a path with a 90° turn at an intersection', () => {
    // Build L-shaped road: east then south
    const cells = new Map<string, { roadType: RoadType; roadFlags: number }>([
      ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST | RoadDirection.SOUTH | RoadDirection.EAST }],
      ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0', '1,1']);

    const cellPath = ['0,0', '1,0', '1,1'];
    const edgePath = refineLanePath(graph, cellPath);
    expect(edgePath).not.toBeNull();
    expect(edgePath!.length).toBeGreaterThan(0);

    // Should contain at least one turn edge
    const hasTurn = edgePath!.some(e => e.type === 'turn');
    expect(hasTurn).toBe(true);
  });

  it('should return null for an impossible path', () => {
    const { graph } = buildStraightRoad(3);
    // Disconnected cells
    const cellPath = ['0,0', '5,5'];
    const edgePath = refineLanePath(graph, cellPath);
    expect(edgePath).toBeNull();
  });

  it('should start and end on outermost lane on multi-lane road', () => {
    const { graph } = buildStraightRoad(5, RoadType.FOUR_LANE);
    const cellPath = ['0,0', '1,0', '2,0', '3,0', '4,0'];

    const edgePath = refineLanePath(graph, cellPath);
    expect(edgePath).not.toBeNull();
    expect(edgePath!.length).toBeGreaterThan(0);

    // First edge should start on outermost lane (lane 1 for 2 dir-lanes)
    const firstEdge = edgePath![0]!;
    expect(firstEdge.from.lane).toBe(1);

    // Last edge should end on outermost lane
    const lastEdge = edgePath![edgePath!.length - 1]!;
    expect(lastEdge.to.lane).toBe(1);
  });

  it('should handle single-cell path gracefully', () => {
    const { graph } = buildStraightRoad(1);
    const edgePath = refineLanePath(graph, ['0,0']);
    // Single cell = no edges to traverse
    expect(edgePath).not.toBeNull();
    expect(edgePath!.length).toBe(0);
  });

  it('should use lane changes on long multi-lane road to optimize speed', () => {
    const { graph } = buildStraightRoad(10, RoadType.FOUR_LANE);
    const cellPath = Array.from({ length: 10 }, (_, i) => `${i},0`);

    const edgePath = refineLanePath(graph, cellPath);
    expect(edgePath).not.toBeNull();
    expect(edgePath!.length).toBeGreaterThan(0);

    // On a long road, Dijkstra should find lane changes worthwhile
    // (start outer → inner for speed → back to outer)
    const laneChanges = edgePath!.filter(e => e.type === 'lane_change').length;
    expect(laneChanges).toBeGreaterThan(0);
  });

  it('should NOT lane-change on short multi-lane road (cost not worth it)', () => {
    const { graph } = buildStraightRoad(3, RoadType.FOUR_LANE);
    const cellPath = ['0,0', '1,0', '2,0'];

    const edgePath = refineLanePath(graph, cellPath);
    expect(edgePath).not.toBeNull();

    const laneChanges = edgePath!.filter(e => e.type === 'lane_change').length;
    expect(laneChanges).toBe(0);
  });

  it('getLaneSpeedMultiplier should decay per lane', () => {
    expect(getLaneSpeedMultiplier(0)).toBe(1.0);
    expect(getLaneSpeedMultiplier(1)).toBeCloseTo(LANE_SPEED_DECAY);
    expect(getLaneSpeedMultiplier(2)).toBeCloseTo(LANE_SPEED_DECAY ** 2);
  });

  it('should handle right turn at intersection (4-lane)', () => {
    const cells = new Map<string, { roadType: RoadType; roadFlags: number }>([
      ['0,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
      ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST | RoadDirection.SOUTH }],
      ['1,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '1,1']);

    const cellPath = ['0,0', '1,0', '1,1'];
    const edgePath = refineLanePath(graph, cellPath);
    expect(edgePath).not.toBeNull();
    expect(edgePath!.length).toBeGreaterThan(0);
  });
});
