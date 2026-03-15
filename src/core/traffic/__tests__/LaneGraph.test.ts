import { describe, it, expect } from 'vitest';
import {
  LaneGraph,
  ConnectionPoint,
  LaneEdge,
  LANE_GEOMETRY,
} from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';

/** Helper: create a minimal grid-like lookup for LaneGraph */
function makeGridLookup(cells: Map<string, { roadType: RoadType; roadFlags: number }>) {
  return {
    getCell: (x: number, y: number) => cells.get(`${x},${y}`) ?? null,
  };
}

describe('LaneGraph', () => {
  describe('ConnectionPoint generation', () => {
    it('should generate correct connection points for a 2LINE straight road', () => {
      // Horizontal road: (0,0) → (1,0) → (2,0)
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      // 2LINE = 1 directional lane per direction
      // Each cell with connections should have entry + exit per direction per lane
      const points = graph.getConnectionPoints('1,0');
      // Cell (1,0) has EAST and WEST connections → 2 directions
      // Per direction: 1 lane × (1 entry + 1 exit) = 2 points
      // Total: 2 directions × 2 = 4 points
      expect(points.length).toBe(4);

      const entries = points.filter(p => p.type === 'entry');
      const exits = points.filter(p => p.type === 'exit');
      expect(entries.length).toBe(2);
      expect(exits.length).toBe(2);
    });

    it('should generate correct connection points for a 4LINE road', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      // 4LINE = 2 directional lanes per direction
      // Cell (1,0): 2 dirs × 2 lanes × 2 (entry+exit) = 8
      const points = graph.getConnectionPoints('1,0');
      expect(points.length).toBe(8);
    });

    it('should generate correct connection points for a 6LINE road', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.SIX_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.SIX_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.SIX_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      // 6LINE = 3 directional lanes per direction
      // Cell (1,0): 2 dirs × 3 lanes × 2 (entry+exit) = 12
      const points = graph.getConnectionPoints('1,0');
      expect(points.length).toBe(12);
    });
  });

  describe('Straight road edges', () => {
    it('should create edges linking exit to entry between adjacent cells', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      // Going east: cell(0,0).exit_east_lane0 → cell(1,0).entry_west_lane0
      const edges = graph.getEdgesBetween('0,0', '1,0');
      // 2LINE: 1 lane east direction
      const straightEdges = edges.filter(e => e.type === 'straight');
      expect(straightEdges.length).toBeGreaterThanOrEqual(1);

      // Each straight edge should have positive length
      for (const e of straightEdges) {
        expect(e.length).toBeGreaterThan(0);
      }
    });

    it('should create edges in both directions for bidirectional road', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      // East direction: 0,0 → 1,0
      const eastEdges = graph.getEdgesBetween('0,0', '1,0');
      expect(eastEdges.length).toBeGreaterThanOrEqual(1);

      // West direction: 1,0 → 0,0
      const westEdges = graph.getEdgesBetween('1,0', '0,0');
      expect(westEdges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Lane change edges', () => {
    it('should create lane_change edges between adjacent lanes on multi-lane roads', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      // 4LINE has 2 directional lanes → lane change edges between lane 0 and lane 1
      const allEdges = graph.getAllEdges();
      const laneChangeEdges = allEdges.filter(e => e.type === 'lane_change');
      expect(laneChangeEdges.length).toBeGreaterThan(0);

      // Each lane change should connect lane i to lane i±1 within the same cell
      for (const e of laneChangeEdges) {
        expect(e.from.cellKey).toBe(e.to.cellKey);
        expect(Math.abs(e.from.lane - e.to.lane)).toBe(1);
      }
    });

    it('should NOT create lane_change edges on single-lane roads', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      const allEdges = graph.getAllEdges();
      const laneChangeEdges = allEdges.filter(e => e.type === 'lane_change');
      expect(laneChangeEdges.length).toBe(0);
    });
  });

  describe('Width transition (2LINE → 4LINE)', () => {
    it('should map lane0 of narrow road to lane0 of wide road', () => {
      // 2LINE (1 dir lane) → 4LINE (2 dir lanes)
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      // Going east: 2LINE.lane0.exit → 4LINE.lane0.entry
      const edges = graph.getEdgesBetween('0,0', '1,0');
      expect(edges.length).toBeGreaterThanOrEqual(1);
      // The primary connection should be lane 0 → lane 0
      const lane0Edge = edges.find(
        e => e.from.lane === 0 && e.to.lane === 0 && e.type === 'straight'
      );
      expect(lane0Edge).toBeDefined();
    });
  });

  describe('Intersection turn edges', () => {
    it('should create turn edges at a cross intersection', () => {
      // Cross intersection at (1,1)
      const cells = new Map([
        ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
        ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
        ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

      const allEdges = graph.getAllEdges();
      const turnEdges = allEdges.filter(e => e.type === 'turn');

      // 4 incoming directions, each can go to 3 outgoing directions
      // 2LINE = 1 lane per direction → 4 × 3 = 12 turn edges
      expect(turnEdges.length).toBe(12);
    });

    it('should create turn edges at a T-junction (3 directions only)', () => {
      // T-junction at (1,1): EAST, WEST, SOUTH (no NORTH)
      const cells = new Map([
        ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
        ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
        ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,2']);

      const allEdges = graph.getAllEdges();
      const turnEdges = allEdges.filter(e => e.type === 'turn');

      // 3 incoming dirs × 2 outgoing dirs = 6 turn edges
      expect(turnEdges.length).toBe(6);
    });

    it('should create turn edges with Bezier control points for 90° turns', () => {
      const cells = new Map([
        ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
        ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
        ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

      const allEdges = graph.getAllEdges();
      const turnEdges = allEdges.filter(e => e.type === 'turn');

      // All turn edges should have a single quadratic bezierControl point
      for (const e of turnEdges) {
        expect(e.bezierControl).toBeDefined();
        expect(e.bezierControl!.length).toBe(1);
      }
    });
  });

  describe('L-bend turn edges', () => {
    it('should create turn edges with bezier for a 2-direction L-bend', () => {
      // L-bend at (1,0): EAST + SOUTH (perpendicular, not opposite)
      const cells = new Map([
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.SOUTH }],
        ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
        ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['1,0', '2,0', '1,1']);

      const allEdges = graph.getAllEdges();
      const turnEdges = allEdges.filter(e => e.type === 'turn' && e.from.cellKey === '1,0');

      // 2 directions, not opposite → 2 turn edges (east→south, south→east)
      expect(turnEdges.length).toBe(2);

      for (const e of turnEdges) {
        expect(e.bezierControl).toBeDefined();
        expect(e.bezierControl!.length).toBe(1);
      }
    });

    it('should NOT create turn edges for a straight road (opposite directions)', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      const allEdges = graph.getAllEdges();
      const turnEdgesInMiddle = allEdges.filter(
        e => e.type === 'turn' && e.from.cellKey === '1,0'
      );
      // Opposite directions (east↔west) → no turn edges, only straight
      expect(turnEdgesInMiddle.length).toBe(0);
    });

    it('should create turn edges with bezier for 4-lane L-bend', () => {
      const cells = new Map([
        ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.SOUTH }],
        ['2,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
        ['1,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.NORTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['1,0', '2,0', '1,1']);

      const allEdges = graph.getAllEdges();
      const turnEdges = allEdges.filter(e => e.type === 'turn' && e.from.cellKey === '1,0');

      // 4-lane = 2 lanes per direction, 2 turn directions → 2 × 2 = 4 turn edges
      expect(turnEdges.length).toBe(4);

      for (const e of turnEdges) {
        expect(e.bezierControl).toBeDefined();
        expect(e.bezierControl!.length).toBe(1);
      }
    });
  });

  describe('Graph update on road changes', () => {
    it('should update graph when a road cell is added', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0']);

      const edgesBefore = graph.getAllEdges().length;

      // Add cell (2,0) extending the road
      cells.set('1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST });
      cells.set('2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST });
      graph.updateCells(makeGridLookup(cells), ['1,0', '2,0']);

      const edgesAfter = graph.getAllEdges().length;
      expect(edgesAfter).toBeGreaterThan(edgesBefore);
    });

    it('should remove edges when a road cell is demolished', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      const edgesBefore = graph.getAllEdges().length;
      expect(edgesBefore).toBeGreaterThan(0);

      // Remove cell (1,0)
      cells.set('1,0', { roadType: RoadType.NONE, roadFlags: 0 });
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: 0 }); // no connections
      cells.set('2,0', { roadType: RoadType.TWO_LANE, roadFlags: 0 });
      graph.updateCells(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      const points = graph.getConnectionPoints('1,0');
      expect(points.length).toBe(0);

      // Edges connecting through (1,0) should be gone
      const edgesThrough = graph.getEdgesBetween('0,0', '1,0');
      expect(edgesThrough.length).toBe(0);
    });
  });

  describe('Edge queries', () => {
    it('getEdgesFrom should return all edges starting from a connection point', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      // Get an exit point from cell (0,0) going east
      const points = graph.getConnectionPoints('0,0');
      const exitEast = points.find(p => p.type === 'exit' && p.direction === 'east');
      expect(exitEast).toBeDefined();

      const edges = graph.getEdgesFrom(exitEast!.id);
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });

    it('getEdgesTo should return all edges ending at a connection point', () => {
      const cells = new Map([
        ['0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST }],
        ['2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

      // Get an entry point at cell (1,0) from the west
      const points = graph.getConnectionPoints('1,0');
      const entryWest = points.find(p => p.type === 'entry' && p.direction === 'west');
      expect(entryWest).toBeDefined();

      const edges = graph.getEdgesTo(entryWest!.id);
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('All-to-all cross-cell edges at intersections', () => {
    it('FOUR_LANE intersection should connect all exit lanes to TWO_LANE neighbor', () => {
      // T-junction: FOUR_LANE E-W, TWO_LANE south
      const cells = new Map([
        ['0,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST | RoadDirection.SOUTH }],
        ['2,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
        ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,2']);

      // Cross-cell edges from intersection (1,1) south to TWO_LANE (1,2)
      const crossEdges = graph.getAllEdges().filter(
        e => e.from.cellKey === '1,1' && e.to.cellKey === '1,2' && e.type === 'straight'
      );

      // Both exit:0 AND exit:1 should connect to TWO_LANE's entry:0
      expect(crossEdges.length).toBe(2);
      const fromLanes = new Set(crossEdges.map(e => e.from.lane));
      expect(fromLanes.has(0)).toBe(true);
      expect(fromLanes.has(1)).toBe(true);
    });

    it('FOUR_LANE intersection should have all-to-all edges to FOUR_LANE neighbor', () => {
      const cells = new Map([
        ['0,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST | RoadDirection.SOUTH | RoadDirection.NORTH }],
        ['2,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
        ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.SOUTH }],
        ['1,2', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.NORTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

      // Cross-cell edges from intersection east to FOUR_LANE neighbor
      const crossEdges = graph.getAllEdges().filter(
        e => e.from.cellKey === '1,1' && e.to.cellKey === '2,1' && e.type === 'straight'
      );

      // 2 exit lanes × 2 entry lanes = 4 cross-cell edges
      expect(crossEdges.length).toBe(4);
    });
  });
});

describe('LANE_GEOMETRY constants', () => {
  it('lane width should be a small positive number', () => {
    expect(LANE_GEOMETRY.LANE_WIDTH).toBeGreaterThan(0);
    expect(LANE_GEOMETRY.LANE_WIDTH).toBeLessThan(1);
  });

  it('bezier samples should be a positive integer', () => {
    expect(LANE_GEOMETRY.BEZIER_SAMPLES).toBeGreaterThan(0);
    expect(Number.isInteger(LANE_GEOMETRY.BEZIER_SAMPLES)).toBe(true);
  });
});
