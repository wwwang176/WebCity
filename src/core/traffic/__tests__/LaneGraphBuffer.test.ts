import { describe, it, expect } from 'vitest';
import { LaneGraphBuffer, GRAPH_HEADER_BYTES, POINT_STRIDE, EDGE_STRIDE } from '../LaneGraphBuffer';
import { LaneGraph, type ConnectionPoint, type LaneEdge } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';
import { toPosKey } from '../../grid/GridHelpers';

// ── Helpers ──

/** Minimal GridLookup for building a small LaneGraph. */
function makeGridLookup(cells: Map<string, { roadType: number; roadFlags: number }>) {
  return {
    getCellByKey(key: string) {
      return cells.get(key) ?? null;
    },
    getCompatibleNeighborKeys(_sourceKey: string, nx: number, ny: number): string[] {
      const k = toPosKey(nx, ny);
      return cells.has(k) ? [k] : [];
    },
  };
}

/** Build a small LaneGraph with a horizontal 3-cell road: (0,0)-(1,0)-(2,0). */
function buildSmallGraph(): LaneGraph {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  // East-west road: 3 cells, TWO_LANE (1 lane per direction)
  const flags = RoadDirection.EAST | RoadDirection.WEST;
  cells.set(toPosKey(0, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
  cells.set(toPosKey(1, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
  cells.set(toPosKey(2, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });

  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);
  return graph;
}

// ── Tests ──

describe('LaneGraphBuffer', () => {
  describe('construction', () => {
    it('creates buffer with correct SAB size', () => {
      const buf = new LaneGraphBuffer(1024, 2048);
      const sab = buf.getBuffer();
      expect(sab).toBeInstanceOf(SharedArrayBuffer);
      const expectedSize = GRAPH_HEADER_BYTES
        + 1024 * POINT_STRIDE
        + 2048 * EDGE_STRIDE
        + 1024 * 4   // adjOffset (Uint32)
        + 1024 * 2   // adjCount (Uint16)
        + 2048 * 4;  // adjList (Uint32)
      expect(sab.byteLength).toBe(expectedSize);
    });

    it('initial version is 0, counts are 0', () => {
      const buf = new LaneGraphBuffer(128, 256);
      expect(buf.getVersion()).toBe(0);
      expect(buf.getPointCount()).toBe(0);
      expect(buf.getEdgeCount()).toBe(0);
    });
  });

  describe('writeFromGraph', () => {
    it('writes points and edges from a LaneGraph', () => {
      const graph = buildSmallGraph();
      const allEdges = graph.getAllEdges();
      const allPoints = new Set<string>();
      for (const e of allEdges) {
        allPoints.add(e.from.id);
        allPoints.add(e.to.id);
      }

      const buf = new LaneGraphBuffer(256, 512);
      const mapping = buf.writeFromGraph(graph);

      expect(buf.getPointCount()).toBe(allPoints.size);
      expect(buf.getEdgeCount()).toBe(allEdges.length);
      expect(buf.getVersion()).toBe(1);
      expect(mapping.pointIdToIndex.size).toBe(allPoints.size);
      expect(mapping.edgeOriginals.length).toBe(allEdges.length);
    });

    it('version increments on each write', () => {
      const graph = buildSmallGraph();
      const buf = new LaneGraphBuffer(256, 512);
      buf.writeFromGraph(graph);
      expect(buf.getVersion()).toBe(1);
      buf.writeFromGraph(graph);
      expect(buf.getVersion()).toBe(2);
    });
  });

  describe('GraphReader (read-only interface)', () => {
    it('reads back point data matching original graph', () => {
      const graph = buildSmallGraph();
      const buf = new LaneGraphBuffer(256, 512);
      const mapping = buf.writeFromGraph(graph);
      const reader = buf.createReader();

      const pointCount = reader.getPointCount();
      expect(pointCount).toBeGreaterThan(0);

      // Verify first point matches
      const firstPointId = [...mapping.pointIdToIndex.entries()][0]!;
      const idx = firstPointId[1];
      const point = reader.getPoint(idx);
      // Find original point from graph edges
      const allEdges = graph.getAllEdges();
      const originalPoint = allEdges.flatMap(e => [e.from, e.to]).find(p => p.id === firstPointId[0])!;

      expect(point.posX).toBeCloseTo(originalPoint.position.x, 2);
      expect(point.posY).toBeCloseTo(originalPoint.position.y, 2);
      expect(point.lane).toBe(originalPoint.lane);
    });

    it('reads adjacency: edges from a point', () => {
      const graph = buildSmallGraph();
      const buf = new LaneGraphBuffer(256, 512);
      const mapping = buf.writeFromGraph(graph);
      const reader = buf.createReader();

      // Find a point with outgoing edges
      let testPointIdx = -1;
      let expectedEdgeCount = 0;
      for (const [pointId, idx] of mapping.pointIdToIndex) {
        const graphEdges = graph.getEdgesFrom(pointId);
        if (graphEdges.length > 0) {
          testPointIdx = idx;
          expectedEdgeCount = graphEdges.length;
          break;
        }
      }

      expect(testPointIdx).toBeGreaterThanOrEqual(0);
      const edgeIndices = reader.getEdgesFrom(testPointIdx);
      expect(edgeIndices.length).toBe(expectedEdgeCount);
    });

    it('reads edge data: fromIdx, toIdx, length', () => {
      const graph = buildSmallGraph();
      const buf = new LaneGraphBuffer(256, 512);
      const mapping = buf.writeFromGraph(graph);
      const reader = buf.createReader();

      const edgeCount = reader.getEdgeCount();
      expect(edgeCount).toBeGreaterThan(0);

      // Every edge's fromIdx and toIdx should be valid point indices
      const pointCount = reader.getPointCount();
      for (let i = 0; i < edgeCount; i++) {
        const edge = reader.getEdge(i);
        expect(edge.fromIdx).toBeGreaterThanOrEqual(0);
        expect(edge.fromIdx).toBeLessThan(pointCount);
        expect(edge.toIdx).toBeGreaterThanOrEqual(0);
        expect(edge.toIdx).toBeLessThan(pointCount);
        expect(edge.length).toBeGreaterThan(0);
      }
    });
  });

  describe('capacity', () => {
    it('throws when point count exceeds maxPoints', () => {
      // Build a graph that has more points than buffer capacity
      const graph = buildSmallGraph();
      const buf = new LaneGraphBuffer(2, 512); // only 2 points max
      expect(() => buf.writeFromGraph(graph)).toThrow(/exceed/i);
    });

    it('throws when edge count exceeds maxEdges', () => {
      const graph = buildSmallGraph();
      const buf = new LaneGraphBuffer(256, 2); // only 2 edges max
      expect(() => buf.writeFromGraph(graph)).toThrow(/exceed/i);
    });
  });

  describe('point cellKey encoding', () => {
    it('encodes and decodes cellX/cellY correctly', () => {
      const graph = buildSmallGraph();
      const buf = new LaneGraphBuffer(256, 512);
      const mapping = buf.writeFromGraph(graph);
      const reader = buf.createReader();

      // All points from cell (1,0) should have cellX=1, cellY=0
      const cellKey = toPosKey(1, 0);
      for (const [pointId, idx] of mapping.pointIdToIndex) {
        if (pointId.startsWith(cellKey + ':')) {
          const point = reader.getPoint(idx);
          expect(point.cellX).toBe(1);
          expect(point.cellY).toBe(0);
        }
      }
    });
  });

  describe('edge speedLimit pre-fill', () => {
    it('stores speedLimit on points from RoadConfig', () => {
      const graph = buildSmallGraph();
      const buf = new LaneGraphBuffer(256, 512);
      buf.writeFromGraph(graph);
      const reader = buf.createReader();

      // TWO_LANE speedLimit = 50
      for (let i = 0; i < reader.getPointCount(); i++) {
        const point = reader.getPoint(i);
        expect(point.speedLimit).toBe(50);
      }
    });
  });
});
