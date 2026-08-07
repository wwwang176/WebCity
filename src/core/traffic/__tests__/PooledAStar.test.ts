import { describe, it, expect } from 'vitest';
import { PooledAStar } from '../PooledAStar';
import { LaneGraphBuffer } from '../LaneGraphBuffer';
import { LaneGraph } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';
import { toPosKey } from '../../grid/GridHelpers';

// ── Helpers ──

function makeGridLookup(cells: Map<string, { roadType: number; roadFlags: number }>) {
  return {
    getCellByKey(key: string) { return cells.get(key) ?? null; },
    getCompatibleNeighborKeys(_sourceKey: string, nx: number, ny: number): string[] {
      const k = toPosKey(nx, ny);
      return cells.has(k) ? [k] : [];
    },
  };
}

/** Straight horizontal road: (0,0) to (length-1, 0). */
function buildStraightRoad(length: number): { graph: LaneGraph; cells: Map<string, { roadType: number; roadFlags: number }> } {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  const flags = RoadDirection.EAST | RoadDirection.WEST;
  for (let x = 0; x < length; x++) {
    cells.set(toPosKey(x, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);
  return { graph, cells };
}

/** L-shaped road: horizontal (0,0)-(cx,0) then vertical (cx,0)-(cx,cy). */
function buildLShapedRoad(cx: number, cy: number): { graph: LaneGraph; cells: Map<string, { roadType: number; roadFlags: number }> } {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  // Horizontal segment
  for (let x = 0; x <= cx; x++) {
    const existing = cells.get(toPosKey(x, 0));
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === cx) flags |= RoadDirection.SOUTH;
    cells.set(toPosKey(x, 0), { roadType: RoadType.TWO_LANE, roadFlags: existing ? existing.roadFlags | flags : flags });
  }
  // Vertical segment
  for (let y = 0; y <= cy; y++) {
    const key = toPosKey(cx, y);
    const existing = cells.get(key);
    let flags = RoadDirection.NORTH | RoadDirection.SOUTH;
    if (y === 0) flags |= RoadDirection.EAST | RoadDirection.WEST;
    cells.set(key, { roadType: RoadType.TWO_LANE, roadFlags: existing ? existing.roadFlags | flags : flags });
  }
  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);
  return { graph, cells };
}

function buildBufferAndAStar(graph: LaneGraph, maxPoints = 1024, maxEdges = 2048) {
  const buf = new LaneGraphBuffer(maxPoints, maxEdges);
  const mapping = buf.writeFromGraph(graph);
  const reader = buf.createReader();
  const astar = new PooledAStar(maxPoints);
  return { buf, mapping, reader, astar };
}

// ── Tests ──

describe('PooledAStar', () => {
  it('finds path on a straight road', () => {
    const { graph } = buildStraightRoad(5);
    const { mapping, reader, astar } = buildBufferAndAStar(graph);

    // Find exit points at cell (0,0) and entry points at cell (4,0)
    const startKey = toPosKey(0, 0);
    const endKey = toPosKey(4, 0);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const [pointId, idx] of mapping.pointIdToIndex) {
      if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
      if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
    }

    expect(starts.length).toBeGreaterThan(0);
    expect(ends.length).toBeGreaterThan(0);

    const result = astar.findPath(reader, starts, ends, { x: 4, y: 0 });
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
  });

  it('returns null when no path exists (disconnected points)', () => {
    // Build two separate roads with no connection
    const cells = new Map<string, { roadType: number; roadFlags: number }>();
    const flags = RoadDirection.EAST | RoadDirection.WEST;
    cells.set(toPosKey(0, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
    cells.set(toPosKey(1, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
    // Gap at (2,0)
    cells.set(toPosKey(3, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
    cells.set(toPosKey(4, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });

    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);
    const { mapping, reader, astar } = buildBufferAndAStar(graph);

    const startKey = toPosKey(0, 0);
    const endKey = toPosKey(4, 0);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const [pointId, idx] of mapping.pointIdToIndex) {
      if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
      if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
    }

    const result = astar.findPath(reader, starts, ends, { x: 4, y: 0 });
    expect(result).toBeNull();
  });

  it('finds path on L-shaped road', () => {
    const { graph } = buildLShapedRoad(3, 3);
    const { mapping, reader, astar } = buildBufferAndAStar(graph);

    const startKey = toPosKey(0, 0);
    const endKey = toPosKey(3, 3);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const [pointId, idx] of mapping.pointIdToIndex) {
      if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
      if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
    }

    const result = astar.findPath(reader, starts, ends, { x: 3, y: 3 });
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
  });

  it('reuses internal arrays without GC (multiple sequential calls)', () => {
    const { graph } = buildStraightRoad(5);
    const { mapping, reader, astar } = buildBufferAndAStar(graph);

    const startKey = toPosKey(0, 0);
    const endKey = toPosKey(4, 0);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const [pointId, idx] of mapping.pointIdToIndex) {
      if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
      if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
    }

    // Run 100 times — should not throw or leak
    for (let i = 0; i < 100; i++) {
      const result = astar.findPath(reader, starts, ends, { x: 4, y: 0 });
      expect(result).not.toBeNull();
    }
  });

  it('returns empty array for empty starts/ends', () => {
    const { graph } = buildStraightRoad(3);
    const { reader, astar } = buildBufferAndAStar(graph);

    expect(astar.findPath(reader, [], [0], { x: 2, y: 0 })).toBeNull();
    expect(astar.findPath(reader, [0], [], { x: 2, y: 0 })).toBeNull();
  });

  describe('findPathVariants', () => {
    it('generates multiple variants with penalty method', () => {
      const { graph } = buildStraightRoad(5);
      const { mapping, reader, astar } = buildBufferAndAStar(graph);

      const startKey = toPosKey(0, 0);
      const endKey = toPosKey(4, 0);
      const starts: number[] = [];
      const ends: number[] = [];
      for (const [pointId, idx] of mapping.pointIdToIndex) {
        if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
        if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
      }

      const variants = astar.findPathVariants(reader, starts, ends, { x: 4, y: 0 }, 3);
      expect(variants.length).toBeGreaterThanOrEqual(1);
      // Each variant should be a valid path
      for (const v of variants) {
        expect(v.length).toBeGreaterThan(0);
      }
    });

    it('cleans up penalty state between calls', () => {
      const { graph } = buildStraightRoad(5);
      const { mapping, reader, astar } = buildBufferAndAStar(graph);

      const startKey = toPosKey(0, 0);
      const endKey = toPosKey(4, 0);
      const starts: number[] = [];
      const ends: number[] = [];
      for (const [pointId, idx] of mapping.pointIdToIndex) {
        if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
        if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
      }

      // Two independent findPathVariants calls should give consistent results
      const v1 = astar.findPathVariants(reader, starts, ends, { x: 4, y: 0 }, 3);
      const v2 = astar.findPathVariants(reader, starts, ends, { x: 4, y: 0 }, 3);
      expect(v1.length).toBe(v2.length);
      expect(v1[0]!.length).toBe(v2[0]!.length);
    });
  });

  describe('findPathVariants with cell-level route diversity', () => {
    /**
     * Build a road network with two clearly separated alternative routes.
     * The bottom route goes 3 rows below to avoid cross-connections with the top.
     *
     *   (0,0)─(1,0)─(2,0)─(3,0)─(4,0)─(5,0)─(6,0)─(7,0)   top route
     *               |                             |
     *             (2,1)                         (6,1)          vertical links
     *               |                             |
     *             (2,2)                         (6,2)
     *               |                             |
     *             (2,3)─(3,3)─(4,3)─(5,3)─(6,3)             bottom route
     */
    function buildDiamondRoad() {
      const cells = new Map<string, { roadType: number; roadFlags: number }>();
      const E = RoadDirection.EAST, W = RoadDirection.WEST;
      const N = RoadDirection.NORTH, S = RoadDirection.SOUTH;

      // Top horizontal: (0,0) to (7,0)
      cells.set(toPosKey(0, 0), { roadType: RoadType.TWO_LANE, roadFlags: E });
      for (let x = 1; x <= 6; x++) {
        let flags = E | W;
        if (x === 2) flags |= S; // fork south
        if (x === 6) flags |= S; // merge south
        cells.set(toPosKey(x, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
      }
      cells.set(toPosKey(7, 0), { roadType: RoadType.TWO_LANE, roadFlags: W });

      // Left vertical link: (2,1), (2,2)
      cells.set(toPosKey(2, 1), { roadType: RoadType.TWO_LANE, roadFlags: N | S });
      cells.set(toPosKey(2, 2), { roadType: RoadType.TWO_LANE, roadFlags: N | S });

      // Right vertical link: (6,1), (6,2)
      cells.set(toPosKey(6, 1), { roadType: RoadType.TWO_LANE, roadFlags: N | S });
      cells.set(toPosKey(6, 2), { roadType: RoadType.TWO_LANE, roadFlags: N | S });

      // Bottom horizontal: (2,3) to (6,3)
      cells.set(toPosKey(2, 3), { roadType: RoadType.TWO_LANE, roadFlags: N | E });
      cells.set(toPosKey(3, 3), { roadType: RoadType.TWO_LANE, roadFlags: E | W });
      cells.set(toPosKey(4, 3), { roadType: RoadType.TWO_LANE, roadFlags: E | W });
      cells.set(toPosKey(5, 3), { roadType: RoadType.TWO_LANE, roadFlags: E | W });
      cells.set(toPosKey(6, 3), { roadType: RoadType.TWO_LANE, roadFlags: W | N });

      const graph = new LaneGraph();
      graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);
      return { graph, cells };
    }

    /** Collect unique cells (as "x,y" strings) from a variant's edge indices. */
    function collectVariantCells(reader: ReturnType<LaneGraphBuffer['createReader']>, variant: number[]): Set<string> {
      const cells = new Set<string>();
      for (const edgeIdx of variant) {
        const fromIdx = reader.getEdgeFromIdx(edgeIdx);
        const toIdx = reader.getEdgeToIdx(edgeIdx);
        const fp = reader.getPoint(fromIdx);
        const tp = reader.getPoint(toIdx);
        cells.add(`${fp.cellX},${fp.cellY}`);
        cells.add(`${tp.cellX},${tp.cellY}`);
      }
      return cells;
    }

    it('produces variants that use different cells when alternative routes exist', () => {
      const { graph } = buildDiamondRoad();
      const { mapping, reader, astar } = buildBufferAndAStar(graph, 2048, 4096);

      const startKey = toPosKey(0, 0);
      const endKey = toPosKey(7, 0);
      const starts: number[] = [];
      const ends: number[] = [];
      for (const [pointId, idx] of mapping.pointIdToIndex) {
        if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
        if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
      }

      const variants = astar.findPathVariants(reader, starts, ends, { x: 7, y: 0 }, 4);
      expect(variants.length).toBe(4);

      // Collect cells for each variant
      const cellSets = variants.map(v => collectVariantCells(reader, v));

      // At least two variants should use different intermediate cells:
      // Top route goes through y=0 middle (3,0)(4,0)(5,0), bottom goes through y=3 (3,3)(4,3)(5,3)
      const hasTopRoute = cellSets.some(cs => cs.has('4,0') && !cs.has('4,3'));
      const hasBottomRoute = cellSets.some(cs => cs.has('4,3') && !cs.has('4,0'));
      expect(hasTopRoute).toBe(true);
      expect(hasBottomRoute).toBe(true);
    });

    it('degrades gracefully to lane variants when only one route exists', () => {
      const { graph } = buildStraightRoad(5);
      const { mapping, reader, astar } = buildBufferAndAStar(graph);

      const startKey = toPosKey(0, 0);
      const endKey = toPosKey(4, 0);
      const starts: number[] = [];
      const ends: number[] = [];
      for (const [pointId, idx] of mapping.pointIdToIndex) {
        if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
        if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
      }

      // Even with only one route, should still produce variants (lane-level)
      const variants = astar.findPathVariants(reader, starts, ends, { x: 4, y: 0 }, 4);
      expect(variants.length).toBeGreaterThanOrEqual(2);
      for (const v of variants) {
        expect(v.length).toBeGreaterThan(0);
      }
    });
  });
});

// BUG-063: syncGraphToWorker rewrites the pathfinding SharedArrayBuffer in place
// while the worker may be mid-batch, and the reserved `version` field is written
// but never checked by any reader. A torn read can therefore produce a
// parentEdge chain containing a cycle, and reconstructPath walked it in an
// unbounded loop — wedging the worker permanently, with no watchdog and no
// synchronous fallback for spawnCommuteVehicles.
describe('PooledAStar.reconstructPath — bounded walk', () => {
  /** Build an astar whose parentEdge chain forms a 2-node cycle. */
  function withCyclicChain(maxPoints: number) {
    const astar = new PooledAStar(maxPoints) as unknown as {
      parentEdge: Int32Array;
      cachedReader: { getEdgeFromIdx(edgeIdx: number): number };
      reconstructPath(endIdx: number): number[];
    };
    // node 1 --edge 10--> node 2 --edge 20--> node 1 ...
    astar.parentEdge[1] = 10;
    astar.parentEdge[2] = 20;
    astar.cachedReader = {
      getEdgeFromIdx: (edgeIdx: number) => (edgeIdx === 10 ? 2 : 1),
    };
    return astar;
  }

  it('should terminate on a cyclic parentEdge chain instead of looping forever', () => {
    const astar = withCyclicChain(64);
    const started = 1;

    // If the walk is unbounded this never returns and the test times out.
    const result = astar.reconstructPath(started);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(64);
  });

  it('should not overflow the result buffer', () => {
    const astar = withCyclicChain(8);
    const result = astar.reconstructPath(1);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it('should still reconstruct a normal acyclic chain correctly', () => {
    const astar = new PooledAStar(64) as unknown as {
      parentEdge: Int32Array;
      cachedReader: { getEdgeFromIdx(edgeIdx: number): number };
      reconstructPath(endIdx: number): number[];
    };
    // node 3 <-edge 30- node 2 <-edge 20- node 1 (root, parentEdge -1)
    astar.parentEdge[3] = 30;
    astar.parentEdge[2] = 20;
    astar.cachedReader = {
      getEdgeFromIdx: (edgeIdx: number) => (edgeIdx === 30 ? 2 : 1),
    };

    expect(astar.reconstructPath(3)).toEqual([20, 30]);
  });
});
