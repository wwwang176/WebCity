/**
 * Tests for the pathfinding worker message handler (pure logic, no Worker thread).
 *
 * The handler is extracted as a testable function so we can verify:
 * - INIT_GRAPH: accepts SAB + maxPoints/maxEdges, creates GraphReader + PooledAStar
 * - BATCH_REQUEST: computes paths, returns edge index arrays
 * - Correct pending/result flow
 */

import { describe, it, expect } from 'vitest';
import { createWorkerHandler, type WorkerRequest, type WorkerResponse } from '../PathfindingWorkerHandler';
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

function buildStraightRoad(length: number) {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  const flags = RoadDirection.EAST | RoadDirection.WEST;
  for (let x = 0; x < length; x++) {
    cells.set(toPosKey(x, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);
  return graph;
}

function setupHandler(roadLength = 6) {
  const graph = buildStraightRoad(roadLength);
  const buf = new LaneGraphBuffer(1024, 2048);
  const mapping = buf.writeFromGraph(graph);

  const handler = createWorkerHandler();
  const responses: WorkerResponse[] = [];
  const postMessage = (msg: WorkerResponse) => responses.push(msg);

  // Init
  handler(
    { type: 'INIT_GRAPH', graphSAB: buf.getBuffer(), maxPoints: 1024, maxEdges: 2048 },
    postMessage,
  );

  return { handler, responses, postMessage, mapping, buf };
}

// ── Tests ──

describe('PathfindingWorkerHandler', () => {
  it('INIT_GRAPH responds with READY', () => {
    const { responses } = setupHandler();
    expect(responses).toHaveLength(1);
    expect(responses[0]!.type).toBe('READY');
  });

  it('BATCH_REQUEST returns results for valid paths', () => {
    const { handler, responses, postMessage, mapping } = setupHandler(6);

    // Collect start exit points at cell (0,0) and end entry points at cell (5,0)
    const startKey = toPosKey(0, 0);
    const endKey = toPosKey(5, 0);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const [pointId, idx] of mapping.pointIdToIndex) {
      if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
      if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
    }

    handler(
      {
        type: 'BATCH_REQUEST',
        batchId: 1,
        requests: [{
          id: 42,
          startPointIndices: starts,
          endPointIndices: ends,
          endPos: { x: 5, y: 0 },
          variantCount: 3,
        }],
      },
      postMessage,
    );

    // responses[0] = READY, responses[1] = BATCH_RESULT
    expect(responses).toHaveLength(2);
    const result = responses[1]!;
    expect(result.type).toBe('BATCH_RESULT');
    expect(result.batchId).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results![0]!.id).toBe(42);
    expect(result.results![0]!.variants!.length).toBeGreaterThanOrEqual(1);
    // Each variant is an array of edge indices
    for (const v of result.results![0]!.variants!) {
      expect(v.length).toBeGreaterThan(0);
      for (const edgeIdx of v) {
        expect(typeof edgeIdx).toBe('number');
      }
    }
  });

  it('BATCH_REQUEST returns empty variants for unreachable paths', () => {
    // Build two disconnected road segments
    const cells = new Map<string, { roadType: number; roadFlags: number }>();
    const flags = RoadDirection.EAST | RoadDirection.WEST;
    cells.set(toPosKey(0, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
    cells.set(toPosKey(1, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
    // Gap
    cells.set(toPosKey(5, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });
    cells.set(toPosKey(6, 0), { roadType: RoadType.TWO_LANE, roadFlags: flags });

    const graph = new LaneGraph();
    graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);
    const buf = new LaneGraphBuffer(1024, 2048);
    const mapping = buf.writeFromGraph(graph);

    const handler = createWorkerHandler();
    const responses: WorkerResponse[] = [];
    const postMessage = (msg: WorkerResponse) => responses.push(msg);

    handler(
      { type: 'INIT_GRAPH', graphSAB: buf.getBuffer(), maxPoints: 1024, maxEdges: 2048 },
      postMessage,
    );

    const startKey = toPosKey(0, 0);
    const endKey = toPosKey(6, 0);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const [pointId, idx] of mapping.pointIdToIndex) {
      if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
      if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
    }

    handler(
      {
        type: 'BATCH_REQUEST',
        batchId: 2,
        requests: [{
          id: 99,
          startPointIndices: starts,
          endPointIndices: ends,
          endPos: { x: 6, y: 0 },
          variantCount: 3,
        }],
      },
      postMessage,
    );

    const result = responses[1]!;
    expect(result.results![0]!.variants).toHaveLength(0);
  });

  it('handles multiple requests in one batch', () => {
    const { handler, responses, postMessage, mapping } = setupHandler(8);

    const collect = (cellX: number, suffix: string) => {
      const key = toPosKey(cellX, 0);
      const pts: number[] = [];
      for (const [pointId, idx] of mapping.pointIdToIndex) {
        if (pointId.startsWith(key + ':') && pointId.endsWith(':' + suffix)) pts.push(idx);
      }
      return pts;
    };

    handler(
      {
        type: 'BATCH_REQUEST',
        batchId: 3,
        requests: [
          { id: 1, startPointIndices: collect(0, 'exit'), endPointIndices: collect(3, 'entry'), endPos: { x: 3, y: 0 }, variantCount: 1 },
          { id: 2, startPointIndices: collect(4, 'exit'), endPointIndices: collect(7, 'entry'), endPos: { x: 7, y: 0 }, variantCount: 1 },
        ],
      },
      postMessage,
    );

    const result = responses[1]!;
    expect(result.results).toHaveLength(2);
    expect(result.results![0]!.id).toBe(1);
    expect(result.results![1]!.id).toBe(2);
    expect(result.results![0]!.variants!.length).toBeGreaterThanOrEqual(1);
    expect(result.results![1]!.variants!.length).toBeGreaterThanOrEqual(1);
  });

  it('INIT_GRAPH can be called again to update the graph', () => {
    const { handler, responses, postMessage } = setupHandler(4);

    // Build a new longer road and re-init
    const graph2 = buildStraightRoad(10);
    const buf2 = new LaneGraphBuffer(1024, 2048);
    buf2.writeFromGraph(graph2);

    handler(
      { type: 'INIT_GRAPH', graphSAB: buf2.getBuffer(), maxPoints: 1024, maxEdges: 2048 },
      postMessage,
    );

    // Should get a second READY
    expect(responses.filter(r => r.type === 'READY')).toHaveLength(2);
  });
});
