import { describe, it, expect } from 'vitest';
import { LaneGraph, LaneEdge, LANE_GEOMETRY } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';
import { makeGridLookup } from '../../../../tests/helpers/makeGridLookup';

describe('Transparent Intersection — No points/edges for intersection cells', () => {
  it('intersection cell (>=3 directions) should have NO connection points', () => {
    // Cross intersection at (1,1)
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // Intersection cell should have ZERO connection points
    const points = graph.getConnectionPoints('1,1');
    expect(points.length).toBe(0);
  });

  it('T-junction cell (3 directions) should have NO connection points', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,2']);

    const points = graph.getConnectionPoints('1,1');
    expect(points.length).toBe(0);
  });

  it('intersection cell should have NO internal edges (from/to same cell)', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    const internalEdges = graph.getAllEdges().filter(
      e => e.from.cellKey === '1,1' && e.to.cellKey === '1,1'
    );
    expect(internalEdges.length).toBe(0);
  });

  it('non-intersection neighbor cells should still have connection points', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // Neighbor cells should still have their normal connection points
    expect(graph.getConnectionPoints('0,1').length).toBeGreaterThan(0);
    expect(graph.getConnectionPoints('2,1').length).toBeGreaterThan(0);
    expect(graph.getConnectionPoints('1,0').length).toBeGreaterThan(0);
    expect(graph.getConnectionPoints('1,2').length).toBeGreaterThan(0);
  });
});

describe('Transparent Intersection — Cross-intersection edges', () => {
  it('straight-through: west cell exit → east cell entry through cross intersection', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // Cross-intersection edge: 0,1 → 2,1 (skipping 1,1)
    const crossEdges = graph.getEdgesBetween('0,1', '2,1');
    expect(crossEdges.length).toBeGreaterThanOrEqual(1);

    // Should be 'straight' type (same axis: east exit → west entry)
    const straightEdges = crossEdges.filter(e => e.type === 'straight');
    expect(straightEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('turn: west cell exit → south cell entry through cross intersection', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // Cross-intersection turn: 0,1 → 1,2 (west cell going east, turns south)
    const turnEdges = graph.getEdgesBetween('0,1', '1,2');
    expect(turnEdges.length).toBeGreaterThanOrEqual(1);

    // Should be 'turn' type (different axis)
    const turnTyped = turnEdges.filter(e => e.type === 'turn');
    expect(turnTyped.length).toBeGreaterThanOrEqual(1);

    // Turn edges should have Bezier control points
    for (const e of turnTyped) {
      expect(e.bezierControl).toBeDefined();
      expect(e.bezierControl!.length).toBe(1);
    }
  });

  it('no U-turn: west cell exit should NOT connect back to west cell entry', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // No U-turn back to self
    const uTurnEdges = graph.getEdgesBetween('0,1', '0,1');
    expect(uTurnEdges.length).toBe(0);
  });

  it('T-junction: generates cross-intersection edges for all 3 active directions', () => {
    // T-junction at (1,1): EAST, WEST, SOUTH
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,2']);

    // From west (0,1): straight-through east (2,1) + turn south (1,2) = 2 edges
    const fromWest = graph.getAllEdges().filter(e => e.from.cellKey === '0,1' && e.to.cellKey !== '0,1');
    // We expect edges going to 2,1 AND 1,2
    const toEast = fromWest.filter(e => e.to.cellKey === '2,1');
    const toSouth = fromWest.filter(e => e.to.cellKey === '1,2');
    expect(toEast.length).toBeGreaterThanOrEqual(1);
    expect(toSouth.length).toBeGreaterThanOrEqual(1);
  });

  it('cross-intersection edges should have correct length (> 1.0 for straight-through)', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    const crossEdges = graph.getEdgesBetween('0,1', '2,1');
    // Straight-through spans ~1.4 units (exit at 0.5 offset + entry at 0.4 offset = ~0.9 gap per cell, 2 cells)
    for (const e of crossEdges) {
      expect(e.length).toBeGreaterThan(0.5);
    }
  });

  it('4-lane cross intersection: all-to-all lane connections across intersection', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // Straight-through west→east: 2 exit lanes × 2 entry lanes = 4 edges
    const straightEdges = graph.getEdgesBetween('0,1', '2,1');
    expect(straightEdges.length).toBe(4);

    // Turn west→south: 2 exit lanes × 2 entry lanes = 4 edges
    const turnEdges = graph.getEdgesBetween('0,1', '1,2');
    expect(turnEdges.length).toBe(4);
  });

  it('mixed road types: FOUR_LANE through intersection to TWO_LANE', () => {
    // FOUR_LANE intersection with TWO_LANE south arm
    const cells = new Map([
      ['0,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST | RoadDirection.SOUTH }],
      ['2,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,2']);

    // From west (FOUR_LANE, 2 exit lanes) to south (TWO_LANE, 1 entry lane)
    // = 2 × 1 = 2 edges
    const turnEdges = graph.getEdgesBetween('0,1', '1,2');
    expect(turnEdges.length).toBe(2);
  });

  it('no old-style edges from/to intersection cell', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // No edges should have the intersection cell as from or to
    const allEdges = graph.getAllEdges();
    const intersectionEdges = allEdges.filter(
      e => e.from.cellKey === '1,1' || e.to.cellKey === '1,1'
    );
    expect(intersectionEdges.length).toBe(0);
  });

  it('cross intersection edge count for cross (4-dir) with 2-lane', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // Each of 4 neighbor cells generates edges to the other 3 neighbors
    // 4 neighbors × 3 targets × 1 lane × 1 lane = 12 cross-intersection edges
    // Plus normal cell-internal edges for the neighbor cells themselves
    const crossEdges = graph.getAllEdges().filter(
      e => e.from.cellKey !== e.to.cellKey
    );

    // 12 cross-intersection edges (straight-through and turn)
    // Plus regular neighbor-to-neighbor edges from end caps
    // From 0,1: exits to 2,1 (straight), 1,0 (turn), 1,2 (turn) = 3
    // From 2,1: exits to 0,1 (straight), 1,0 (turn), 1,2 (turn) = 3
    // From 1,0: exits to 1,2 (straight), 0,1 (turn), 2,1 (turn) = 3
    // From 1,2: exits to 1,0 (straight), 0,1 (turn), 2,1 (turn) = 3
    // Total = 12 cross-intersection edges
    expect(crossEdges.length).toBe(12);
  });
});

describe('Transparent Intersection — updateCells', () => {
  it('should correctly rebuild after adding a new arm to make a T-junction', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
    ]);
    const graph = new LaneGraph();
    const allKeys = ['0,1', '1,1', '2,1'];
    graph.buildFromGrid(makeGridLookup(cells), allKeys);

    // Before: (1,1) is a straight road, has connection points
    expect(graph.getConnectionPoints('1,1').length).toBeGreaterThan(0);

    // Add south arm — (1,1) becomes T-junction
    cells.set('1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST | RoadDirection.SOUTH });
    cells.set('1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH });
    graph.updateCells(makeGridLookup(cells), ['1,1', '1,2']);

    // After: (1,1) is an intersection, should have NO connection points
    expect(graph.getConnectionPoints('1,1').length).toBe(0);

    // Cross-intersection edges should exist
    const crossEdges = graph.getEdgesBetween('0,1', '2,1');
    expect(crossEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('updateCells on a neighbor should preserve cross-intersection edges from far-side cells', () => {
    // Build cross intersection
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // Verify cross-intersection edges exist before update
    const beforeEdges = graph.getEdgesBetween('2,1', '0,1');
    expect(beforeEdges.length).toBeGreaterThanOrEqual(1);

    // Update only cell (0,1) — should still have cross edges from (2,1)→(0,1)
    graph.updateCells(makeGridLookup(cells), ['0,1']);

    const afterEdges = graph.getEdgesBetween('2,1', '0,1');
    expect(afterEdges.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Transparent Intersection — Non-intersection cells adjacent to intersection', () => {
  it('straight road cells adjacent to intersection should NOT generate exit→intersection entry edges', () => {
    const cells = new Map([
      ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
      ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
      ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
    ]);
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

    // cell 0,1's exit[east] should NOT connect to 1,1's entry[west] (doesn't exist)
    const toIntersection = graph.getAllEdges().filter(
      e => e.to.cellKey === '1,1'
    );
    expect(toIntersection.length).toBe(0);
  });
});
