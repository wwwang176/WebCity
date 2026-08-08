/**
 * Integration tests for the pathfinding worker pipeline:
 *   LaneGraphBuffer → PathfindingWorkerHandler → PathRequestBatcher → routeIndex
 *
 * Verifies the complete flow:
 * 1. Build graph → write to SAB → init handler
 * 2. Enqueue requests via batcher
 * 3. Flush → worker processes → results flow back via callback
 * 4. Edge indices convert back to original LaneEdge objects
 */

import { describe, it, expect } from 'vitest';
import { LaneGraphBuffer, type GraphMapping } from '../LaneGraphBuffer';
import { LaneGraph, type LaneEdge } from '../LaneGraph';
import { createWorkerHandler, type WorkerRequest, type WorkerResponse } from '../PathfindingWorkerHandler';
import { RoadType, RoadDirection } from '../../road/types';
import { toPosKey } from '../../grid/GridHelpers';

/**
 * Narrow a response to BATCH_RESULT.
 *
 * `WorkerResponse` is a union of READY and BATCH_RESULT, so `r.results` does
 * not exist on the union. The cases reached through it anyway and papered over
 * the gap with `!`, which meant a handler that returned READY where a batch was
 * expected produced "Cannot read properties of undefined" instead of a
 * legible failure.
 */
function batchResult(r: WorkerResponse): Extract<WorkerResponse, { type: 'BATCH_RESULT' }> {
  expect(r.type).toBe('BATCH_RESULT');
  if (r.type !== 'BATCH_RESULT') throw new Error('not a batch result');
  return r;
}


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
  return { graph, cells };
}

describe('Pathfinding Worker Integration', () => {
  it('full pipeline: graph → SAB → handler → edge indices → original LaneEdge[]', () => {
    // 1. Build graph and write to SAB
    const { graph } = buildStraightRoad(6);
    const buf = new LaneGraphBuffer(1024, 2048);
    const mapping = buf.writeFromGraph(graph);

    // 2. Init handler (simulates Worker receiving SAB)
    const handler = createWorkerHandler();
    const responses: WorkerResponse[] = [];
    handler(
      { type: 'INIT_GRAPH', graphSAB: buf.getBuffer(), maxPoints: 1024, maxEdges: 2048 },
      r => responses.push(r),
    );
    expect(responses[0]!.type).toBe('READY');

    // 3. Collect start/end points
    const startKey = toPosKey(0, 0);
    const endKey = toPosKey(5, 0);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const [pointId, idx] of mapping.pointIdToIndex) {
      if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
      if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
    }

    // 4. Send batch request
    handler(
      {
        type: 'BATCH_REQUEST',
        batchId: 1,
        requests: [{
          id: 1,
          startPointIndices: starts,
          endPointIndices: ends,
          endPos: { x: 5, y: 0 },
          variantCount: 3,
        }],
      },
      r => responses.push(r),
    );

    const batch = batchResult(responses[1]!);
    const variants = batch.results[0]!.variants;
    expect(variants.length).toBeGreaterThanOrEqual(1);

    // 5. Convert edge indices back to original LaneEdge objects
    const firstVariant = variants[0]!;
    const edgePath: LaneEdge[] = firstVariant.map(idx => mapping.edgeOriginals[idx]!);

    // Verify the path is valid
    expect(edgePath.length).toBeGreaterThan(0);
    // First edge should start near (0, 0)
    expect(edgePath[0]!.from.cellKey).toMatch(/^0,0/);
    // Last edge should end near (5, 0)
    expect(edgePath[edgePath.length - 1]!.to.cellKey).toMatch(/^5,0/);
    // Every edge should be a real LaneEdge with bezier/length data
    for (const edge of edgePath) {
      expect(edge.length).toBeGreaterThan(0);
      expect(typeof edge.id).toBe('string');
      expect(edge.from.position).toBeDefined();
      expect(edge.to.position).toBeDefined();
    }
  });

  it('handles graph update: write new graph → re-init → paths still work', () => {
    const { graph: graph1 } = buildStraightRoad(4);
    const buf = new LaneGraphBuffer(1024, 2048);
    buf.writeFromGraph(graph1);

    const handler = createWorkerHandler();
    const responses: WorkerResponse[] = [];
    handler(
      { type: 'INIT_GRAPH', graphSAB: buf.getBuffer(), maxPoints: 1024, maxEdges: 2048 },
      r => responses.push(r),
    );

    // Write a longer road to the same SAB
    const { graph: graph2 } = buildStraightRoad(8);
    const mapping2 = buf.writeFromGraph(graph2);
    expect(buf.getVersion()).toBe(2);

    // Re-init handler (it reads the updated SAB)
    handler(
      { type: 'INIT_GRAPH', graphSAB: buf.getBuffer(), maxPoints: 1024, maxEdges: 2048 },
      r => responses.push(r),
    );

    // Path should work on the new, longer road
    const startKey = toPosKey(0, 0);
    const endKey = toPosKey(7, 0);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const [pointId, idx] of mapping2.pointIdToIndex) {
      if (pointId.startsWith(startKey + ':') && pointId.endsWith(':exit')) starts.push(idx);
      if (pointId.startsWith(endKey + ':') && pointId.endsWith(':entry')) ends.push(idx);
    }

    handler(
      {
        type: 'BATCH_REQUEST',
        batchId: 1,
        requests: [{
          id: 1,
          startPointIndices: starts,
          endPointIndices: ends,
          endPos: { x: 7, y: 0 },
          variantCount: 1,
        }],
      },
      r => responses.push(r),
    );

    const lastResult = batchResult(responses[responses.length - 1]!);
    expect(lastResult.results[0]!.variants.length).toBeGreaterThanOrEqual(1);
  });
});
