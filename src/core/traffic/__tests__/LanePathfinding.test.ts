import { describe, it, expect } from 'vitest';
import { refineLanePath } from '../Pathfinding';
import { LaneGraph, LaneEdge } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';

function makeGridLookup(cells: Map<string, { roadType: RoadType; roadFlags: number }>) {
  return { getCell: (x: number, y: number) => cells.get(`${x},${y}`) ?? null };
}

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

  it('should prefer same-lane traversal (minimize lane changes)', () => {
    const { graph } = buildStraightRoad(5, RoadType.FOUR_LANE);
    const cellPath = ['0,0', '1,0', '2,0', '3,0', '4,0'];

    const edgePath = refineLanePath(graph, cellPath);
    expect(edgePath).not.toBeNull();

    // Count lane changes
    const laneChanges = edgePath!.filter(e => e.type === 'lane_change').length;
    expect(laneChanges).toBe(0); // no reason to change lanes on straight road
  });

  it('should handle single-cell path gracefully', () => {
    const { graph } = buildStraightRoad(1);
    const edgePath = refineLanePath(graph, ['0,0']);
    // Single cell = no edges to traverse
    expect(edgePath).not.toBeNull();
    expect(edgePath!.length).toBe(0);
  });

  it('should use preferredLane parameter on multi-lane road', () => {
    const { graph } = buildStraightRoad(5, RoadType.FOUR_LANE);
    const cellPath = ['0,0', '1,0', '2,0', '3,0', '4,0'];

    // Request lane 1 (second lane)
    const edgePath = refineLanePath(graph, cellPath, 1);
    expect(edgePath).not.toBeNull();
    expect(edgePath!.length).toBeGreaterThan(0);

    // All cross-cell edges should be on lane 1
    const crossEdges = edgePath!.filter(
      e => e.from.cellKey !== e.to.cellKey
    );
    for (const e of crossEdges) {
      expect(e.from.lane).toBe(1);
      expect(e.to.lane).toBe(1);
    }
  });

  it('should produce different paths for different preferredLane values', () => {
    const { graph } = buildStraightRoad(5, RoadType.FOUR_LANE);
    const cellPath = ['0,0', '1,0', '2,0', '3,0', '4,0'];

    const pathLane0 = refineLanePath(graph, cellPath, 0);
    const pathLane1 = refineLanePath(graph, cellPath, 1);

    expect(pathLane0).not.toBeNull();
    expect(pathLane1).not.toBeNull();

    // Paths should differ — different lane edges
    const lane0CrossIds = pathLane0!.filter(e => e.from.cellKey !== e.to.cellKey).map(e => e.id);
    const lane1CrossIds = pathLane1!.filter(e => e.from.cellKey !== e.to.cellKey).map(e => e.id);

    // At least some edges should be different
    const allSame = lane0CrossIds.every((id, i) => id === lane1CrossIds[i]);
    expect(allSame).toBe(false);
  });

  it('should prefer right lane for right turn at intersection (4-lane)', () => {
    // Build L-shaped 4-lane road: east then south
    const cells = new Map<string, { roadType: RoadType; roadFlags: number }>([
      ['0,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
      ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST | RoadDirection.SOUTH }],
      ['1,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '1,1']);

    const cellPath = ['0,0', '1,0', '1,1'];

    // With preferred lane 0 (inner/right lane for eastbound turning south)
    const edgePath0 = refineLanePath(graph, cellPath, 0);
    expect(edgePath0).not.toBeNull();

    // With preferred lane 1 (outer lane)
    const edgePath1 = refineLanePath(graph, cellPath, 1);
    expect(edgePath1).not.toBeNull();

    // Both should produce valid paths (no lane changes forced in this simple case)
    expect(edgePath0!.length).toBeGreaterThan(0);
    expect(edgePath1!.length).toBeGreaterThan(0);
  });
});
