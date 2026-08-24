import { describe, it, expect } from 'vitest';
import {
  LaneGraph,
  ConnectionPoint,
  LaneEdge,
  LANE_GEOMETRY,
} from '../LaneGraph';
import { RoadType, RoadDirection, getLaneWidth } from '../../road/types';
import { makeGridLookup } from '../../../../tests/helpers/makeGridLookup';

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
    it('should create cross-intersection turn edges at a cross intersection', () => {
      // Cross intersection at (1,1) — generates its own points and edges
      // Turn edges now span from approach cell to departure cell (cross-intersection)
      const cells = new Map([
        ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
        ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
        ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

      // Intersection cell HAS connection points (it is NOT transparent)
      const intersectionPoints = graph.getConnectionPoints('1,1');
      // 4 directions × 1 lane × 2 (entry+exit) = 8 points
      expect(intersectionPoints.length).toBe(8);

      // Within-cell edges at intersection are now straight-through only (no turns)
      const intersectionEdges = graph.getAllEdges().filter(
        e => e.from.cellKey === '1,1' && e.to.cellKey === '1,1'
      );
      const withinCellTurns = intersectionEdges.filter(e => e.type === 'turn');
      expect(withinCellTurns.length).toBe(0);

      // Turn edges are now cross-intersection: neighbor → neighbor
      const allTurns = graph.getAllEdges().filter(e => e.type === 'turn');
      // 4 neighbors, each has 2 turn targets × 1 lane = 8 cross-intersection turn edges
      expect(allTurns.length).toBe(8);

      // Cross-cell straight edges still connect neighbors TO the intersection
      const edgesToIntersection = graph.getEdgesBetween('0,1', '1,1');
      expect(edgesToIntersection.length).toBeGreaterThanOrEqual(1);

      const edgesFromIntersection = graph.getEdgesBetween('1,1', '2,1');
      expect(edgesFromIntersection.length).toBeGreaterThanOrEqual(1);
    });

    it('should create cross-intersection turn edges at a T-junction (3 directions only)', () => {
      // T-junction at (1,1): EAST, WEST, SOUTH (no NORTH)
      // Neighbors must have flags toward intersection
      const cells = new Map([
        ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
        ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
        ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,2']);

      const allEdges = graph.getAllEdges();
      const turnEdges = allEdges.filter(e => e.type === 'turn');

      // 3 neighbors: each has 1 turn target (not counting straight-through)
      // (0,1)→(1,2) turn, (2,1)→(1,2) turn, (1,2)→(0,1) turn, (1,2)→(2,1) turn
      // Wait: (0,1) exits east → targets are south(1,2) [turn] and east(2,1) [straight]
      // (2,1) exits west → targets are south(1,2) [turn] and west(0,1) [straight]
      // (1,2) exits north → targets are east(2,1) [turn] and west(0,1) [turn]
      // Total turn edges: 1 + 1 + 2 = 4
      expect(turnEdges.length).toBe(4);
    });

    it('should create turn edges with Bezier control points for 90° turns', () => {
      const cells = new Map([
        ['0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST }],
        ['2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST }],
        ['1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }],
        ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
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
      // Cross-intersection turn edges span neighbor → neighbor through L-bend
      // east→south: from (2,0) exit to (1,1) entry; south→east: from (1,1) exit to (2,0) entry
      const turnEdges = allEdges.filter(e => e.type === 'turn');
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
      // Cross-intersection turn edges: 2 lanes × 2 turn directions = 4
      const turnEdges = allEdges.filter(e => e.type === 'turn');
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

  describe('Intersection with mixed road widths', () => {
    it('FOUR_LANE through intersection to TWO_LANE: cross-intersection turn edges', () => {
      // T-junction: FOUR_LANE E-W, TWO_LANE south
      // Cross-intersection turn edges go (0,1) → (1,2) directly with Bézier
      const cells = new Map([
        ['0,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST | RoadDirection.SOUTH }],
        ['2,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
        ['1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,2']);

      // Cross-intersection turn edges from (0,1) → (1,2) now exist (min lanes = 1)
      const directCrossEdges = graph.getAllEdges().filter(
        e => e.from.cellKey === '0,1' && e.to.cellKey === '1,2'
      );
      expect(directCrossEdges.length).toBe(1); // min(2, 2, 1) = 1 lane

      // Cross-cell straight edges still connect (0,1) → (1,1) (2 lanes)
      const toIntersection = graph.getEdgesBetween('0,1', '1,1');
      expect(toIntersection.length).toBe(2);
      const fromLanes = new Set(toIntersection.map(e => e.from.lane));
      expect(fromLanes.has(0)).toBe(true);
      expect(fromLanes.has(1)).toBe(true);

      // No within-cell turn edges (replaced by cross-intersection edges)
      const intersectionTurns = graph.getAllEdges().filter(
        e => e.from.cellKey === '1,1' && e.to.cellKey === '1,1' && e.type === 'turn'
      );
      expect(intersectionTurns.length).toBe(0);

      // And (1,1) → (1,2) cross-cell edges still exist
      const fromIntersection = graph.getEdgesBetween('1,1', '1,2');
      expect(fromIntersection.length).toBeGreaterThanOrEqual(1);
    });

    it('FOUR_LANE through intersection to FOUR_LANE: edges route via intersection cell', () => {
      const cells = new Map([
        ['0,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST }],
        ['1,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST | RoadDirection.SOUTH | RoadDirection.NORTH }],
        ['2,1', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.WEST }],
        ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.SOUTH }],
        ['1,2', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.NORTH }],
      ]);
      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), ['0,1', '1,1', '2,1', '1,0', '1,2']);

      // No direct cross-intersection edges from (0,1) → (2,1) anymore
      const directCrossEdges = graph.getAllEdges().filter(
        e => e.from.cellKey === '0,1' && e.to.cellKey === '2,1'
      );
      expect(directCrossEdges.length).toBe(0);

      // Instead: (0,1) → (1,1) cross-cell edges (2 lanes)
      const toIntersection = graph.getEdgesBetween('0,1', '1,1');
      expect(toIntersection.length).toBe(2);

      // (1,1) has within-cell straight-through edges (west:entry → east:exit)
      const throughEdges = graph.getAllEdges().filter(
        e => e.from.cellKey === '1,1' && e.to.cellKey === '1,1' && e.type === 'straight'
      );
      expect(throughEdges.length).toBeGreaterThan(0);

      // (1,1) → (2,1) cross-cell edges (2 lanes)
      const fromIntersection = graph.getEdgesBetween('1,1', '2,1');
      expect(fromIntersection.length).toBe(2);
    });
  });
});

describe('LANE_GEOMETRY constants', () => {
  it('lane width should be a small positive number', () => {
    // Lane width is not a constant here: it varies by road type (`getLaneWidth`), because
    // computing it independently of road width puts a six-lane road's outermost lane off the
    // asphalt. The per-road-type checks live in `LaneWidthFitsRoad.test.ts`.
    for (const t of [RoadType.TWO_LANE, RoadType.FOUR_LANE, RoadType.SIX_LANE]) {
      expect(getLaneWidth(t)).toBeGreaterThan(0);
      expect(getLaneWidth(t)).toBeLessThan(1);
    }
  });

  it('bezier samples should be a positive integer', () => {
    expect(LANE_GEOMETRY.BEZIER_SAMPLES).toBeGreaterThan(0);
    expect(Number.isInteger(LANE_GEOMETRY.BEZIER_SAMPLES)).toBe(true);
  });
});

// BUG-054: updateCells' border-neighbour repair pass deleted every edge leaving
// a border cell, including the cross-intersection turn edges the affected-cell
// pass had just created — and generateEdgesForCell(border) cannot recreate a
// turn that merely *originates* there and passes through a neighbouring cell.
describe('LaneGraph.updateCells — cross-intersection turn preservation', () => {
  /** L bend: (0,0)..(3,0) east-west, then (3,0)..(3,3) north-south. */
  function lBendCells() {
    const E = RoadDirection.EAST, W = RoadDirection.WEST;
    const N = RoadDirection.NORTH, S = RoadDirection.SOUTH;
    return new Map<string, { roadType: RoadType; roadFlags: number }>([
      ['0,0', { roadType: RoadType.FOUR_LANE, roadFlags: E }],
      ['1,0', { roadType: RoadType.FOUR_LANE, roadFlags: E | W }],
      ['2,0', { roadType: RoadType.FOUR_LANE, roadFlags: E | W }],
      ['3,0', { roadType: RoadType.FOUR_LANE, roadFlags: W | S }],
      ['3,1', { roadType: RoadType.FOUR_LANE, roadFlags: N | S }],
      ['3,2', { roadType: RoadType.FOUR_LANE, roadFlags: N | S }],
      ['3,3', { roadType: RoadType.FOUR_LANE, roadFlags: N }],
    ]);
  }

  const KEYS = ['0,0', '1,0', '2,0', '3,0', '3,1', '3,2', '3,3'];

  function edgeIds(graph: LaneGraph): string[] {
    return graph.getAllEdges().map(e => e.id).sort();
  }

  it('should keep cross-intersection turn edges when a border cell is rebuilt', () => {
    const cells = lBendCells();
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), KEYS);

    const xtBefore = graph.getAllEdges().filter(e => e.id.startsWith('xt:')).map(e => e.id).sort();
    expect(xtBefore.length).toBeGreaterThan(0);

    graph.updateCells(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

    const xtAfter = graph.getAllEdges().filter(e => e.id.startsWith('xt:')).map(e => e.id).sort();
    expect(xtAfter).toEqual(xtBefore);
  });

  it('should leave the whole graph identical to a fresh buildFromGrid', () => {
    const cells = lBendCells();

    const incremental = new LaneGraph();
    incremental.buildFromGrid(makeGridLookup(cells), KEYS);
    incremental.updateCells(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

    const fresh = new LaneGraph();
    fresh.buildFromGrid(makeGridLookup(cells), KEYS);

    expect(edgeIds(incremental)).toEqual(edgeIds(fresh));
  });

  it('should not strand the branch beyond the bend', () => {
    const cells = lBendCells();
    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), KEYS);
    graph.updateCells(makeGridLookup(cells), ['0,0', '1,0', '2,0']);

    // Every point in the south arm must still have a way out.
    const southExits = graph.getConnectionPoints('3,1').filter(p => p.type === 'entry');
    expect(southExits.length).toBeGreaterThan(0);
    const reachable = southExits.some(p => graph.getEdgesFrom(p.id).length > 0);
    expect(reachable).toBe(true);
  });

  it('should stay identical to buildFromGrid for a 4-way intersection rebuild', () => {
    const E = RoadDirection.EAST, W = RoadDirection.WEST;
    const N = RoadDirection.NORTH, S = RoadDirection.SOUTH;
    const cells = new Map<string, { roadType: RoadType; roadFlags: number }>([
      ['1,3', { roadType: RoadType.FOUR_LANE, roadFlags: E }],
      ['2,3', { roadType: RoadType.FOUR_LANE, roadFlags: E | W }],
      ['3,3', { roadType: RoadType.FOUR_LANE, roadFlags: E | W | N | S }],
      ['4,3', { roadType: RoadType.FOUR_LANE, roadFlags: W }],
      ['3,1', { roadType: RoadType.FOUR_LANE, roadFlags: S }],
      ['3,2', { roadType: RoadType.FOUR_LANE, roadFlags: N | S }],
      ['3,4', { roadType: RoadType.FOUR_LANE, roadFlags: N }],
    ]);
    const keys = [...cells.keys()];

    const incremental = new LaneGraph();
    incremental.buildFromGrid(makeGridLookup(cells), keys);
    incremental.updateCells(makeGridLookup(cells), ['1,3', '2,3']);

    const fresh = new LaneGraph();
    fresh.buildFromGrid(makeGridLookup(cells), keys);

    expect(edgeIds(incremental)).toEqual(edgeIds(fresh));
  });
});
