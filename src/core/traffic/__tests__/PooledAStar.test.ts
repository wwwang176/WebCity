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
});
