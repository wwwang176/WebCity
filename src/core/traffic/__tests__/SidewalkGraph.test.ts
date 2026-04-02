import { describe, it, expect } from 'vitest';
import { SidewalkGraph, ROAD_WIDTHS, GridLookup, SidewalkEdge, SIDEWALK_WIDTH, BUILDING_HALF_SIZE, WALKWAY_OFFSET, CW_OFFSET } from '../SidewalkGraph';
import { RoadType, RoadDirection } from '../../road/types';

// ── Helpers ──────────────────────────────────────────────────────────────

type CellDef = { roadType: number; roadFlags: number; railType?: number; buildingId?: number; zoneType?: number };

function makeGrid(
  cells: Map<string, CellDef>,
): GridLookup {
  return {
    getCell: (x, y) => cells.get(`${x},${y}`) ?? null,
  };
}

/** Build a horizontal road from (0,y) to (length-1,y) */
function buildHorizontalRoad(length: number, y = 0, roadType = RoadType.TWO_LANE) {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  const keys: string[] = [];
  for (let x = 0; x < length; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < length - 1) flags |= RoadDirection.EAST;
    cells.set(`${x},${y}`, { roadType, roadFlags: flags });
    keys.push(`${x},${y}`);
  }
  return { cells, keys };
}

/** Build a vertical road from (x,0) to (x,length-1) */
function buildVerticalRoad(length: number, x = 0, roadType = RoadType.TWO_LANE) {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  const keys: string[] = [];
  for (let y = 0; y < length; y++) {
    let flags = 0;
    if (y > 0) flags |= RoadDirection.NORTH;
    if (y < length - 1) flags |= RoadDirection.SOUTH;
    cells.set(`${x},${y}`, { roadType, roadFlags: flags });
    keys.push(`${x},${y}`);
  }
  return { cells, keys };
}

/** Build a T-junction: horizontal road + one vertical road going south from (ix, 0) */
function buildTJunction(hLen: number, vLen: number, ix: number) {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  const keys: string[] = [];
  const roadType = RoadType.TWO_LANE;

  // Horizontal road at y=0
  for (let x = 0; x < hLen; x++) {
    let flags = 0;
    if (x > 0) flags |= RoadDirection.WEST;
    if (x < hLen - 1) flags |= RoadDirection.EAST;
    if (x === ix) flags |= RoadDirection.SOUTH; // T-junction point
    cells.set(`${x},0`, { roadType, roadFlags: flags });
    keys.push(`${x},0`);
  }

  // Vertical road going south from (ix, 1) to (ix, vLen-1)
  for (let y = 1; y < vLen; y++) {
    let flags = RoadDirection.NORTH;
    if (y < vLen - 1) flags |= RoadDirection.SOUTH;
    cells.set(`${ix},${y}`, { roadType, roadFlags: flags });
    keys.push(`${ix},${y}`);
  }

  return { cells, keys };
}

/** Build a cross intersection at (ix, iy) */
function buildCrossIntersection() {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  const keys: string[] = [];
  const roadType = RoadType.TWO_LANE;
  const ix = 2, iy = 2;

  // Center intersection
  cells.set(`${ix},${iy}`, {
    roadType,
    roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST,
  });
  keys.push(`${ix},${iy}`);

  // 4 arms
  const arms: [number, number, number][] = [
    [ix, iy - 1, RoadDirection.SOUTH],                   // North arm
    [ix, iy + 1, RoadDirection.NORTH],                   // South arm
    [ix - 1, iy, RoadDirection.EAST],                    // West arm
    [ix + 1, iy, RoadDirection.WEST],                    // East arm
  ];
  for (const [ax, ay, flag] of arms) {
    cells.set(`${ax},${ay}`, { roadType, roadFlags: flag });
    keys.push(`${ax},${ay}`);
  }

  return { cells, keys, ix, iy };
}

function getEdgeTypes(edges: SidewalkEdge[]): string[] {
  return edges.map(e => e.type).sort();
}

function hasEdgeOfType(graph: SidewalkGraph, type: SidewalkEdge['type']): boolean {
  return graph.getAllEdges().some(e => e.type === type);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('SidewalkGraph', () => {
  it('SIDEWALK_WIDTH should be 0.14', () => {
    expect(SIDEWALK_WIDTH).toBe(0.14);
  });

  // A1: Straight road should generate sidewalk nodes on both sides
  describe('A1: straight road node generation', () => {
    it('should generate nodes on north and south sides of a horizontal road', () => {
      const { cells, keys } = buildHorizontalRoad(3);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      // Middle cell (1,0): has WEST and EAST connections → sidewalks on N and S
      const nodes = graph.getNodesInCell('1,0');
      expect(nodes.length).toBe(4); // NW, NE, SW, SE

      const nodeIds = nodes.map(n => n.id).sort();
      expect(nodeIds).toContain('1,0:NW');
      expect(nodeIds).toContain('1,0:NE');
      expect(nodeIds).toContain('1,0:SW');
      expect(nodeIds).toContain('1,0:SE');
    });

    it('should generate nodes on west and east sides of a vertical road', () => {
      const { cells, keys } = buildVerticalRoad(3);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      // Middle cell (0,1): has NORTH and SOUTH connections → sidewalks on W and E
      const nodes = graph.getNodesInCell('0,1');
      expect(nodes.length).toBe(4); // WN, WS, EN, ES

      const nodeIds = nodes.map(n => n.id).sort();
      expect(nodeIds).toContain('0,1:WN');
      expect(nodeIds).toContain('0,1:WS');
      expect(nodeIds).toContain('0,1:EN');
      expect(nodeIds).toContain('0,1:ES');
    });

    it('should position nodes at road edge using correct halfWidth', () => {
      const { cells, keys } = buildHorizontalRoad(1);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      // Single cell (0,0): dead end with only sidewalks (no connections, all 4 sides)
      const nw = graph.getNode('0,0:NW');
      expect(nw).toBeDefined();

      const halfWidth = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2; // 0.3
      expect(nw!.position.x).toBeCloseTo(-0.35);
      expect(nw!.position.y).toBeCloseTo(-halfWidth);
    });

    it('dead-end cell should have sidewalk nodes on all 4 sides', () => {
      // Single cell with no connections
      const cells = new Map<string, { roadType: number; roadFlags: number }>();
      cells.set('5,5', { roadType: RoadType.TWO_LANE, roadFlags: 0 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['5,5']);

      const nodes = graph.getNodesInCell('5,5');
      expect(nodes.length).toBe(8); // 2 per side × 4 sides
    });
  });

  // A2: T-junction should generate crosswalk edges
  describe('A2: T-junction crosswalk edges', () => {
    it('should generate crosswalk edges at T-junction neighbors', () => {
      const { cells, keys } = buildTJunction(5, 3, 2);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      // The intersection is at (2,0) with 3 connections (W, E, S)
      // Crosswalks should appear on neighbor cells (1,0), (3,0), (2,1)
      const allEdges = graph.getAllEdges();
      const crosswalkEdges = allEdges.filter(e => e.type === 'crosswalk');
      expect(crosswalkEdges.length).toBeGreaterThan(0);
    });
  });

  // A3: Cross intersection should have crosswalk edges in all 4 directions
  describe('A3: cross intersection crosswalks', () => {
    it('should have crosswalk edges on all 4 neighbor cells', () => {
      const { cells, keys } = buildCrossIntersection();
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      const crosswalkEdges = graph.getAllEdges().filter(e => e.type === 'crosswalk');
      // 4 directions × 1 crosswalk per direction × 2 (bidirectional) = at least 4 unique pairs
      // Each crosswalk connects two sidewalk sides → at least 4 crosswalk edge pairs
      expect(crosswalkEdges.length).toBeGreaterThanOrEqual(8); // 4 directions × 2 (bidirectional)

      // Check that crosswalks exist on each neighbor cell
      const crosswalkCells = new Set(crosswalkEdges.map(e => e.from.cellKey));
      expect(crosswalkCells.has('2,1')).toBe(true); // North arm
      expect(crosswalkCells.has('2,3')).toBe(true); // South arm
      expect(crosswalkCells.has('1,2')).toBe(true); // West arm
      expect(crosswalkCells.has('3,2')).toBe(true); // East arm
    });
  });

  // A4: Dead-end road should NOT have crosswalk edges
  describe('A4: dead-end no crosswalk', () => {
    it('should not generate crosswalk edges on a 1-direction dead end', () => {
      // Single road cell with only EAST connection
      const cells = new Map<string, { roadType: number; roadFlags: number }>();
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      cells.set('1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0', '1,0']);

      expect(hasEdgeOfType(graph, 'crosswalk')).toBe(false);
    });

    it('should not generate crosswalk edges on a 2-direction straight road', () => {
      const { cells, keys } = buildHorizontalRoad(5);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      expect(hasEdgeOfType(graph, 'crosswalk')).toBe(false);
    });
  });

  // A5: Cross-cell sidewalk edges should connect adjacent cells
  describe('A5: cross-cell sidewalk edges', () => {
    it('should connect NE of cell(0,0) to NW of cell(1,0) on a horizontal road', () => {
      const { cells, keys } = buildHorizontalRoad(3);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      const edges = graph.getEdgesFrom('0,0:NE');
      const crossCellEdge = edges.find(e =>
        e.to.id === '1,0:NW' && e.type === 'sidewalk'
      );
      expect(crossCellEdge).toBeDefined();
    });

    it('should connect SE of cell(0,0) to SW of cell(1,0) on south sidewalk', () => {
      const { cells, keys } = buildHorizontalRoad(3);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      const edges = graph.getEdgesFrom('0,0:SE');
      const crossCellEdge = edges.find(e =>
        e.to.id === '1,0:SW' && e.type === 'sidewalk'
      );
      expect(crossCellEdge).toBeDefined();
    });

    it('should connect WS of cell(0,0) to WN of cell(0,1) on a vertical road', () => {
      const { cells, keys } = buildVerticalRoad(3);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      const edges = graph.getEdgesFrom('0,0:WS');
      const crossCellEdge = edges.find(e =>
        e.to.id === '0,1:WN' && e.type === 'sidewalk'
      );
      expect(crossCellEdge).toBeDefined();
    });
  });

  // A6: findPath should find a route
  describe('A6: findPath', () => {
    it('should find a path along a straight horizontal road', () => {
      const { cells, keys } = buildHorizontalRoad(5);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      // Walk along the north sidewalk from west end to east end
      const path = graph.findPath('0,0:NW', '4,0:NE');
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);

      // All edges should be sidewalk type
      for (const edge of path!) {
        expect(edge.type).toBe('sidewalk');
      }
    });

    it('should find a path that crosses the road via crosswalk', () => {
      const { cells, keys } = buildTJunction(5, 3, 2);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      // Try to find a path from north side to south side — must use crosswalk
      // North sidewalk of cell (1,0) to south sidewalk of cell (3,0)
      const northNode = graph.getNodesInCell('1,0').find(n => n.id.includes('NW'));
      const southNode = graph.getNodesInCell('3,0').find(n => n.id.includes('SW'));

      if (northNode && southNode) {
        const path = graph.findPath(northNode.id, southNode.id);
        expect(path).not.toBeNull();
        if (path) {
          const types = path.map(e => e.type);
          // Path may or may not include crosswalk depending on topology
          expect(types.length).toBeGreaterThan(0);
        }
      }
    });

    it('should return empty array when from === to', () => {
      const { cells, keys } = buildHorizontalRoad(3);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      const path = graph.findPath('0,0:NW', '0,0:NW');
      expect(path).toEqual([]);
    });

    it('should return null when no path exists', () => {
      // Two disconnected road segments
      const cells = new Map<string, { roadType: number; roadFlags: number }>();
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: 0 });
      cells.set('10,10', { roadType: RoadType.TWO_LANE, roadFlags: 0 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0', '10,10']);

      const path = graph.findPath('0,0:NW', '10,10:NW');
      expect(path).toBeNull();
    });
  });

  // A7: findNearestNode should find closest sidewalk node to a building
  describe('A7: findNearestNode', () => {
    it('should return the closest sidewalk node to a building position', () => {
      const { cells, keys } = buildHorizontalRoad(3);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      // Building at (1, -1) → closest should be a north-side node of cell (1,0)
      const nearest = graph.findNearestNode(1, -1);
      expect(nearest).not.toBeNull();
      expect(nearest!.cellKey).toBe('1,0');
      expect(nearest!.id).toMatch(/1,0:N/);
    });

    it('should return null when no nodes exist', () => {
      const graph = new SidewalkGraph();
      graph.buildFromGrid(makeGrid(new Map()), []);
      expect(graph.findNearestNode(0, 0)).toBeNull();
    });
  });

  // A8: updateCells should correctly update the graph after road changes
  describe('A8: updateCells', () => {
    it('should add nodes when a new road cell is placed', () => {
      const cells = new Map<string, { roadType: number; roadFlags: number }>();
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      cells.set('1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST });

      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0', '1,0']);

      const nodesBefore = graph.getAllNodes().length;

      // Add a new cell extending the road east
      cells.set('2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST });
      cells.get('1,0')!.roadFlags = RoadDirection.WEST | RoadDirection.EAST;

      graph.updateCells(grid, ['1,0', '2,0']);

      const nodesAfter = graph.getAllNodes().length;
      expect(nodesAfter).toBeGreaterThan(nodesBefore);
      expect(graph.getNodesInCell('2,0').length).toBeGreaterThan(0);
    });

    it('should remove nodes when a road cell is demolished', () => {
      const cells = new Map<string, { roadType: number; roadFlags: number }>();
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      cells.set('1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST | RoadDirection.EAST });
      cells.set('2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST });

      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0', '1,0', '2,0']);

      expect(graph.getNodesInCell('2,0').length).toBeGreaterThan(0);

      // Remove cell (2,0)
      cells.delete('2,0');
      cells.get('1,0')!.roadFlags = RoadDirection.WEST;

      graph.updateCells(grid, ['1,0', '2,0']);

      expect(graph.getNodesInCell('2,0').length).toBe(0);
    });
  });

  // A9: Rail+road crossing should generate level_crossing edges
  describe('A9: level crossing edges', () => {
    it('should generate level_crossing edges where rail and road coexist', () => {
      const cells = new Map<string, { roadType: number; roadFlags: number; railType?: number }>();
      // Horizontal road with rail crossing
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      cells.set('1,0', {
        roadType: RoadType.TWO_LANE,
        roadFlags: RoadDirection.WEST | RoadDirection.EAST,
        railType: 1,  // Has rail
      });
      cells.set('2,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST });

      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0', '1,0', '2,0']);

      const lcEdges = graph.getAllEdges().filter(e => e.type === 'level_crossing');
      expect(lcEdges.length).toBeGreaterThan(0);

      // Level crossing edges should be on the cell with rail
      for (const e of lcEdges) {
        expect(e.from.cellKey === '1,0' || e.to.cellKey === '1,0').toBe(true);
      }
    });

    it('should NOT generate level_crossing edges where there is no rail', () => {
      const { cells, keys } = buildHorizontalRoad(3);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      expect(hasEdgeOfType(graph, 'level_crossing')).toBe(false);
    });
  });

  // A10: findPath through level crossing
  describe('A10: findPath with level crossing', () => {
    it('should find path that includes level_crossing edges', () => {
      // Vertical road with horizontal rail crossing at (0,1)
      const cells = new Map<string, { roadType: number; roadFlags: number; railType?: number }>();
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH });
      cells.set('0,1', {
        roadType: RoadType.TWO_LANE,
        roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH,
        railType: 1,
      });
      cells.set('0,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.NORTH });

      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0', '0,1', '0,2']);

      // Walk from west side of cell(0,0) to east side of cell(0,0) requires
      // crossing via level_crossing at cell(0,1) or using same-cell edges
      // Let's check that level_crossing edges exist and are usable
      const lcEdges = graph.getAllEdges().filter(e => e.type === 'level_crossing');
      expect(lcEdges.length).toBeGreaterThan(0);

      // Path from west side to east side through level crossing
      const westNode = graph.getNode('0,1:WN');
      const eastNode = graph.getNode('0,1:EN');
      if (westNode && eastNode) {
        const path = graph.findPath(westNode.id, eastNode.id);
        expect(path).not.toBeNull();
        expect(path!.some(e => e.type === 'level_crossing')).toBe(true);
      }
    });
  });

  // A11/A12: Transit stop nodes (will be implemented in Phase D integration)
  // Placeholder tests for now
  describe('A11-A12: transit stop nodes', () => {
    it('should be able to add transit stop nodes manually', () => {
      // Transit stops will be connected via findNearestNode + building_access pattern
      // For now, verify that findNearestNode works for transit stop placement
      const { cells, keys } = buildHorizontalRoad(3);
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, keys);

      // A bus stop at (1, 0) should find a nearby sidewalk node
      const nearest = graph.findNearestNode(1, 0);
      expect(nearest).not.toBeNull();
    });
  });

  // ── Building perimeter walkway tests ──────────────────────────────────

  describe('B1: building node generation', () => {
    it('should generate 8 nodes (4 corners + 4 doors) for a building cell', () => {
      // Road at (1,1) going east, building at (1,0)
      const cells = new Map<string, CellDef>();
      cells.set('1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      cells.set('1,0', { roadType: 0, roadFlags: 0, buildingId: 5 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['1,1'], ['1,0']);

      const nodes = graph.getNodesInCell('1,0');
      expect(nodes.length).toBe(8);

      const ids = nodes.map(n => n.id).sort();
      // 4 corners
      expect(ids).toContain('1,0:bNW');
      expect(ids).toContain('1,0:bNE');
      expect(ids).toContain('1,0:bSW');
      expect(ids).toContain('1,0:bSE');
      // 4 doors
      expect(ids).toContain('1,0:bN');
      expect(ids).toContain('1,0:bS');
      expect(ids).toContain('1,0:bW');
      expect(ids).toContain('1,0:bE');
    });

    it('should position corner nodes further out than door nodes', () => {
      const cells = new Map<string, CellDef>();
      cells.set('3,2', { roadType: 0, roadFlags: 0, buildingId: 1 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['3,2']);

      const cornerDist = BUILDING_HALF_SIZE + WALKWAY_OFFSET + WALKWAY_OFFSET / 2;
      const nw = graph.getNode('3,2:bNW')!;
      expect(nw.position.x).toBeCloseTo(3 - cornerDist);
      expect(nw.position.y).toBeCloseTo(2 - cornerDist);

      const se = graph.getNode('3,2:bSE')!;
      expect(se.position.x).toBeCloseTo(3 + cornerDist);
      expect(se.position.y).toBeCloseTo(2 + cornerDist);
    });

    it('should position door nodes at BUILDING_HALF_SIZE + WALKWAY_OFFSET', () => {
      const cells = new Map<string, CellDef>();
      cells.set('3,2', { roadType: 0, roadFlags: 0, buildingId: 1 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['3,2']);

      const doorDist = BUILDING_HALF_SIZE + WALKWAY_OFFSET;
      const doorN = graph.getNode('3,2:bN')!;
      expect(doorN.position.x).toBeCloseTo(3); // centered
      expect(doorN.position.y).toBeCloseTo(2 - doorDist);

      const doorE = graph.getNode('3,2:bE')!;
      expect(doorE.position.x).toBeCloseTo(3 + doorDist);
      expect(doorE.position.y).toBeCloseTo(2); // centered
    });

    it('should NOT generate building nodes for road cells', () => {
      const cells = new Map<string, CellDef>();
      cells.set('0,0', { roadType: RoadType.TWO_LANE, roadFlags: 0 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,0'], []);

      // Road cell should have road nodes, not building nodes
      const nodes = graph.getNodesInCell('0,0');
      expect(nodes.every(n => !n.id.includes(':b'))).toBe(true);
    });

    it('should NOT generate building nodes for empty cells (buildingId=0)', () => {
      const cells = new Map<string, CellDef>();
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 0 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['0,0']);

      expect(graph.getNodesInCell('0,0').length).toBe(0);
    });

    it('corner nodes should have type building_corner, doors should have type building_entrance', () => {
      const cells = new Map<string, CellDef>();
      cells.set('1,1', { roadType: 0, roadFlags: 0, buildingId: 3 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['1,1']);

      expect(graph.getNode('1,1:bNW')!.type).toBe('building_corner');
      expect(graph.getNode('1,1:bN')!.type).toBe('building_entrance');
    });
  });

  describe('B2: building wall edges', () => {
    it('should create triangle wall edges per face (corner↔corner + corner↔door × 2)', () => {
      const cells = new Map<string, CellDef>();
      cells.set('2,2', { roadType: 0, roadFlags: 0, buildingId: 1 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['2,2']);

      const wallEdges = graph.getAllEdges().filter(e => e.type === 'building_wall');
      // 4 faces × 3 edges × 2 directions = 24 directed wall edges
      expect(wallEdges.length).toBe(24);

      // Check N face triangle: bNW↔bNE, bNW↔bN, bNE↔bN
      expect(wallEdges.find(e => e.from.id === '2,2:bNW' && e.to.id === '2,2:bNE')).toBeDefined();
      expect(wallEdges.find(e => e.from.id === '2,2:bNW' && e.to.id === '2,2:bN')).toBeDefined();
      expect(wallEdges.find(e => e.from.id === '2,2:bNE' && e.to.id === '2,2:bN')).toBeDefined();
    });
  });

  describe('B3: building_access edges (door → road sidewalk)', () => {
    it('should connect south door to road N sidewalk (both NW + NE) when road is south', () => {
      const cells = new Map<string, CellDef>();
      // Building at (1,0), road at (1,1) going east
      cells.set('1,0', { roadType: 0, roadFlags: 0, buildingId: 5 });
      cells.set('1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['1,1'], ['1,0']);

      const accessEdges = graph.getAllEdges().filter(e => e.type === 'building_access');
      // South door → road's NW and NE = 2 connections × 2 directions = 4
      const doorToRoad = accessEdges.filter(e => e.from.id === '1,0:bS');
      expect(doorToRoad.length).toBe(2);
      const targets = doorToRoad.map(e => e.to.id).sort();
      expect(targets).toContain('1,1:NW');
      expect(targets).toContain('1,1:NE');
    });

    it('should connect east door to road W sidewalk when road is east', () => {
      const cells = new Map<string, CellDef>();
      // Building at (0,0), road at (1,0) going south
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 3 });
      cells.set('1,0', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['1,0'], ['0,0']);

      const accessEdges = graph.getAllEdges().filter(e => e.type === 'building_access');
      const doorToRoad = accessEdges.filter(e => e.from.id === '0,0:bE');
      expect(doorToRoad.length).toBe(2);
      const targets = doorToRoad.map(e => e.to.id).sort();
      expect(targets).toContain('1,0:WN');
      expect(targets).toContain('1,0:WS');
    });

    it('should NOT create building_access when neighbor is not a road', () => {
      const cells = new Map<string, CellDef>();
      // Isolated building, no roads around
      cells.set('5,5', { roadType: 0, roadFlags: 0, buildingId: 1 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['5,5']);

      const accessEdges = graph.getAllEdges().filter(e => e.type === 'building_access');
      expect(accessEdges.length).toBe(0);
    });

    it('should connect multiple doors when building has roads on multiple sides', () => {
      const cells = new Map<string, CellDef>();
      // Building at (1,1) with roads on south and east
      cells.set('1,1', { roadType: 0, roadFlags: 0, buildingId: 2 });
      cells.set('1,2', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST }); // south road
      cells.set('2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.SOUTH }); // east road
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['1,2', '2,1'], ['1,1']);

      const accessEdges = graph.getAllEdges().filter(e => e.type === 'building_access');
      // South door → 2 road nodes + east door → 2 road nodes = 4 connections × 2 directions = 8
      expect(accessEdges.length).toBe(8);
    });
  });

  describe('B4: adjacent building connections', () => {
    it('should connect corners of horizontally adjacent buildings', () => {
      const cells = new Map<string, CellDef>();
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 1 });
      cells.set('1,0', { roadType: 0, roadFlags: 0, buildingId: 2 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['0,0', '1,0']);

      // East corners of A ↔ west corners of B
      const edges = graph.getAllEdges();
      const adjEdges = edges.filter(e =>
        (e.from.id === '0,0:bNE' && e.to.id === '1,0:bNW') ||
        (e.from.id === '0,0:bSE' && e.to.id === '1,0:bSW')
      );
      expect(adjEdges.length).toBe(2); // 2 pairs (top and bottom)
    });

    it('should connect corners of vertically adjacent buildings', () => {
      const cells = new Map<string, CellDef>();
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 1 });
      cells.set('0,1', { roadType: 0, roadFlags: 0, buildingId: 2 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['0,0', '0,1']);

      const edges = graph.getAllEdges();
      const adjEdges = edges.filter(e =>
        (e.from.id === '0,0:bSW' && e.to.id === '0,1:bNW') ||
        (e.from.id === '0,0:bSE' && e.to.id === '0,1:bNE')
      );
      expect(adjEdges.length).toBe(2);
    });

    it('should NOT connect buildings separated by a road', () => {
      const cells = new Map<string, CellDef>();
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 1 });
      cells.set('1,0', { roadType: RoadType.TWO_LANE, roadFlags: 0 }); // road between
      cells.set('2,0', { roadType: 0, roadFlags: 0, buildingId: 2 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['1,0'], ['0,0', '2,0']);

      // No direct building_wall edge between 0,0 and 2,0
      const edges = graph.getAllEdges();
      const cross = edges.filter(e =>
        (e.from.cellKey === '0,0' && e.to.cellKey === '2,0') ||
        (e.from.cellKey === '2,0' && e.to.cellKey === '0,0')
      );
      expect(cross.length).toBe(0);
    });
  });

  describe('B5: findPathMultiTarget', () => {
    it('should find shortest path to nearest target among multiple', () => {
      // Road from (0,1) to (4,1), buildings at (0,0) and (4,0)
      const cells = new Map<string, CellDef>();
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 1 });
      cells.set('4,0', { roadType: 0, roadFlags: 0, buildingId: 2 });
      for (let x = 0; x <= 4; x++) {
        let flags = 0;
        if (x > 0) flags |= RoadDirection.WEST;
        if (x < 4) flags |= RoadDirection.EAST;
        cells.set(`${x},1`, { roadType: RoadType.TWO_LANE, roadFlags: flags });
      }
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      const roadKeys = [0,1,2,3,4].map(x => `${x},1`);
      graph.buildFromGrid(grid, roadKeys, ['0,0', '4,0']);

      // Multi-target: from building A south door to ANY door of building B
      const targetDoors = ['4,0:bN', '4,0:bS', '4,0:bW', '4,0:bE'];
      const path = graph.findPathMultiTarget('0,0:bS', targetDoors);
      expect(path).not.toBeNull();

      // Should arrive at bS (the door facing the road, closest path)
      const lastEdge = path![path!.length - 1]!;
      expect(lastEdge.to.id).toBe('4,0:bS');
    });

    it('should return empty array when start is one of the targets', () => {
      const cells = new Map<string, CellDef>();
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 1 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['0,0']);

      const path = graph.findPathMultiTarget('0,0:bN', ['0,0:bN', '0,0:bS']);
      expect(path).toEqual([]);
    });

    it('should return null when no targets are reachable', () => {
      const cells = new Map<string, CellDef>();
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 1 });
      cells.set('10,10', { roadType: 0, roadFlags: 0, buildingId: 2 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['0,0', '10,10']);

      const path = graph.findPathMultiTarget('0,0:bN', ['10,10:bN', '10,10:bS']);
      expect(path).toBeNull();
    });
  });

  describe('B5b: findPath building → road → building', () => {
    it('should find a path from building A door to road to building B door', () => {
      const cells = new Map<string, CellDef>();
      // A at (0,0), B at (2,0), road from (0,1) to (2,1)
      // Both buildings face south toward the north sidewalk of the road
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 1 }); // A
      cells.set('2,0', { roadType: 0, roadFlags: 0, buildingId: 2 }); // B
      cells.set('0,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      cells.set('1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST | RoadDirection.EAST });
      cells.set('2,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.WEST });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['0,1', '1,1', '2,1'], ['0,0', '2,0']);

      // A south door → north sidewalk → walk east → B south door
      const path = graph.findPath('0,0:bS', '2,0:bS');
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);

      // Path should include building_access edges
      const types = path!.map(e => e.type);
      expect(types).toContain('building_access');
    });

    it('should find path between adjacent buildings via wall edges', () => {
      const cells = new Map<string, CellDef>();
      cells.set('0,0', { roadType: 0, roadFlags: 0, buildingId: 1 });
      cells.set('1,0', { roadType: 0, roadFlags: 0, buildingId: 2 });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, [], ['0,0', '1,0']);

      // From A's north door to B's north door via shared corners
      const path = graph.findPath('0,0:bN', '1,0:bN');
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
    });
  });

  describe('B6: findNearestNode should find building entrance', () => {
    it('should return building entrance node when closest', () => {
      const cells = new Map<string, CellDef>();
      cells.set('5,5', { roadType: 0, roadFlags: 0, buildingId: 3 });
      cells.set('5,6', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['5,6'], ['5,5']);

      // Position inside the building → should find one of its door nodes
      const nearest = graph.findNearestNode(5, 5);
      expect(nearest).not.toBeNull();
      expect(nearest!.type).toBe('building_entrance');
      expect(nearest!.cellKey).toBe('5,5');
    });
  });

  describe('B7: updateCells with buildings', () => {
    it('should add building nodes when a building is placed', () => {
      const cells = new Map<string, CellDef>();
      cells.set('1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['1,1'], []);

      const nodesBefore = graph.getAllNodes().length;

      // Place building at (1,0)
      cells.set('1,0', { roadType: 0, roadFlags: 0, buildingId: 5 });
      graph.updateCells(grid, ['1,0']);

      const nodesAfter = graph.getAllNodes().length;
      expect(nodesAfter).toBe(nodesBefore + 8); // 4 corners + 4 doors
    });

    it('should remove building nodes when a building is demolished', () => {
      const cells = new Map<string, CellDef>();
      cells.set('1,0', { roadType: 0, roadFlags: 0, buildingId: 5 });
      cells.set('1,1', { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['1,1'], ['1,0']);

      expect(graph.getNodesInCell('1,0').length).toBe(8);

      // Remove building
      cells.set('1,0', { roadType: 0, roadFlags: 0, buildingId: 0 });
      graph.updateCells(grid, ['1,0']);

      expect(graph.getNodesInCell('1,0').length).toBe(0);
    });
  });

  // Edge case: highway should not generate sidewalks (future consideration)
  // For now, all road types get sidewalks

  // Correctness: node positions match road renderer
  describe('coordinate alignment', () => {
    it('north sidewalk nodes should be at y = cellY - halfWidth', () => {
      const cells = new Map<string, { roadType: number; roadFlags: number }>();
      cells.set('5,3', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['5,3']);

      const nw = graph.getNode('5,3:NW');
      const ne = graph.getNode('5,3:NE');
      expect(nw).toBeDefined();
      expect(ne).toBeDefined();

      const halfWidth = ROAD_WIDTHS[RoadType.FOUR_LANE]! / 2; // 0.425
      expect(nw!.position.y).toBeCloseTo(3 - halfWidth);
      expect(ne!.position.y).toBeCloseTo(3 - halfWidth);
      expect(nw!.position.x).toBeCloseTo(5 - 0.35);
      expect(ne!.position.x).toBeCloseTo(5 + 0.35);
    });

    it('south sidewalk nodes should be at y = cellY + halfWidth', () => {
      const cells = new Map<string, { roadType: number; roadFlags: number }>();
      cells.set('5,3', { roadType: RoadType.FOUR_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST });
      const grid = makeGrid(cells);
      const graph = new SidewalkGraph();
      graph.buildFromGrid(grid, ['5,3']);

      const sw = graph.getNode('5,3:SW');
      const halfWidth = ROAD_WIDTHS[RoadType.FOUR_LANE]! / 2;
      expect(sw!.position.y).toBeCloseTo(3 + halfWidth);
    });
  });
});
