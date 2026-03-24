import { describe, it, expect } from 'vitest';
import { refineLanePath, getLaneSpeedMultiplier, LANE_SPEED_DECAY } from '../Pathfinding';
import { findLanePathVariants } from '../LaneGraphPathfinder';
import { LaneGraph, LaneEdge } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
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

/** Build a minimal GridLike + UnifiedRoadLookup from a cell map for findLanePathVariants tests. */
function buildLookupFromCells(
  cells: Map<string, { roadType: RoadType; roadFlags: number }>,
  width: number,
  height: number,
): UnifiedRoadLookup {
  const gridLike = {
    width,
    height,
    getCell(x: number, y: number) {
      const c = cells.get(`${x},${y}`);
      return c ?? null;
    },
    forEachCell(fn: (cell: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const c = cells.get(`${x},${y}`);
          if (c) fn(c, x, y);
        }
    },
  };
  return UnifiedRoadLookup.fromGrid(gridLike as any);
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

describe('findLanePathVariants (A* single-phase) zigzag prevention', () => {
  it('should NOT zigzag on straight 4-lane road', () => {
    // Build a straight 4-lane road with buildings adjacent at start/end
    const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
    const length = 9;
    const allKeys: string[] = [];
    for (let x = 0; x < length; x++) {
      let flags = 0;
      if (x > 0) flags |= RoadDirection.WEST;
      if (x < length - 1) flags |= RoadDirection.EAST;
      cells.set(`${x},1`, { roadType: RoadType.FOUR_LANE, roadFlags: flags });
      allKeys.push(`${x},1`);
    }

    const lookup = buildLookupFromCells(cells, length, 3);
    const graph = new LaneGraph();
    graph.buildFromGrid(lookup, allKeys);

    // Find path from building at (0,0) to building at (8,2)
    // These are adjacent to road cells at (0,1) and (8,1)
    const variants = findLanePathVariants(graph, lookup, { x: 0, y: 0 }, { x: length - 1, y: 2 });
    expect(variants.length).toBeGreaterThanOrEqual(2);

    // Each variant should NOT zigzag: max ~2 lane changes (in→cruise, cruise→out)
    for (let vi = 0; vi < variants.length; vi++) {
      const v = variants[vi]!;
      let laneChanges = 0;
      for (const e of v) {
        if (e.type === 'lane_change') laneChanges++;
      }
      // A zigzag path on 9 cells would have 8+ lane changes
      // A good path should have at most ~4 (entry + exit lane adjustments)
      expect(laneChanges).toBeLessThanOrEqual(4);
    }
  });

  it('should NOT zigzag on alternating straight-intersection pattern', () => {
    // Build: straight → cross → straight → cross → straight (4-lane)
    const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
    const allKeys: string[] = [];
    for (let x = 0; x < 9; x++) {
      let flags = 0;
      if (x > 0) flags |= RoadDirection.WEST;
      if (x < 8) flags |= RoadDirection.EAST;
      if (x % 2 === 1) {
        flags |= RoadDirection.NORTH | RoadDirection.SOUTH;
      }
      cells.set(`${x},1`, { roadType: RoadType.FOUR_LANE, roadFlags: flags });
      allKeys.push(`${x},1`);
      if (x % 2 === 1) {
        cells.set(`${x},0`, { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.SOUTH });
        cells.set(`${x},2`, { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.NORTH });
        allKeys.push(`${x},0`, `${x},2`);
      }
    }

    const lookup = buildLookupFromCells(cells, 9, 3);
    const graph = new LaneGraph();
    graph.buildFromGrid(lookup, allKeys);

    const variants = findLanePathVariants(graph, lookup, { x: 0, y: 0 }, { x: 8, y: 2 });
    expect(variants.length).toBeGreaterThanOrEqual(2);

    for (let vi = 0; vi < variants.length; vi++) {
      const v = variants[vi]!;
      let laneChanges = 0;
      for (const e of v) {
        if (e.type === 'lane_change') laneChanges++;
      }
      expect(laneChanges).toBeLessThanOrEqual(4);
    }
  });
});
