/**
 * Tests for PathRequestBatcher — collects pathfinding requests, deduplicates by routeKey,
 * dispatches to worker, and writes results back into CommuteCache.routeIndex.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PathRequestBatcher } from '../PathRequestBatcher';
import { LaneGraphBuffer, type GraphMapping } from '../LaneGraphBuffer';
import { LaneGraph, type LaneEdge } from '../LaneGraph';
import { RoadType, RoadDirection } from '../../road/types';
import { toPosKey } from '../../grid/GridHelpers';
import type { WorkerRequest, WorkerResponse, BatchResultItem } from '../PathfindingWorkerHandler';

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
  return { graph, cells };
}

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: WorkerRequest[] = [];

  postMessage(data: any): void {
    this.posted.push(data);
  }

  respond(data: WorkerResponse): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  terminate(): void {}

  addEventListener(type: string, handler: any): void {
    if (type === 'message') {
      this.onmessage = (e: MessageEvent) => handler(e);
    }
  }

  removeEventListener(): void {}
}

// ── Tests ──

describe('PathRequestBatcher', () => {
  let mockWorker: MockWorker;
  let batcher: PathRequestBatcher;
  let mapping: GraphMapping;

  beforeEach(() => {
    const { graph } = buildStraightRoad(8);
    const buf = new LaneGraphBuffer(1024, 2048);
    mapping = buf.writeFromGraph(graph);

    mockWorker = new MockWorker();
    batcher = new PathRequestBatcher(mockWorker as unknown as Worker, mapping);
  });

  function collectPoints(cellX: number, suffix: 'exit' | 'entry'): number[] {
    const key = toPosKey(cellX, 0);
    const pts: number[] = [];
    for (const [pointId, idx] of mapping.pointIdToIndex) {
      if (pointId.startsWith(key + ':') && pointId.endsWith(':' + suffix)) pts.push(idx);
    }
    return pts;
  }

  it('enqueue adds a request and marks routeKey as pending', () => {
    const routeKey = '0,0->7,0';
    batcher.enqueue(routeKey, collectPoints(0, 'exit'), collectPoints(7, 'entry'), { x: 7, y: 0 });
    expect(batcher.isPending(routeKey)).toBe(true);
    expect(batcher.queueSize).toBe(1);
  });

  it('enqueue deduplicates same routeKey', () => {
    const routeKey = '0,0->7,0';
    batcher.enqueue(routeKey, collectPoints(0, 'exit'), collectPoints(7, 'entry'), { x: 7, y: 0 });
    batcher.enqueue(routeKey, collectPoints(0, 'exit'), collectPoints(7, 'entry'), { x: 7, y: 0 });
    expect(batcher.queueSize).toBe(1);
  });

  it('flush sends BATCH_REQUEST to worker', () => {
    const routeKey = '0,0->7,0';
    batcher.enqueue(routeKey, collectPoints(0, 'exit'), collectPoints(7, 'entry'), { x: 7, y: 0 });
    batcher.flush();
    expect(mockWorker.posted.length).toBe(1);
    expect(mockWorker.posted[0]!.type).toBe('BATCH_REQUEST');
  });

  it('flush clears the queue', () => {
    batcher.enqueue('0,0->7,0', collectPoints(0, 'exit'), collectPoints(7, 'entry'), { x: 7, y: 0 });
    batcher.flush();
    expect(batcher.queueSize).toBe(0);
    // routeKey is still pending (waiting for worker result)
    expect(batcher.isPending('0,0->7,0')).toBe(true);
  });

  it('flush does nothing when queue is empty', () => {
    batcher.flush();
    expect(mockWorker.posted.length).toBe(0);
  });

  it('onResult callback fires when worker responds', () => {
    const results: { routeKey: string; variants: number[][] }[] = [];
    batcher.onResult = (routeKey, variants) => {
      results.push({ routeKey, variants });
    };

    const routeKey = '0,0->7,0';
    batcher.enqueue(routeKey, collectPoints(0, 'exit'), collectPoints(7, 'entry'), { x: 7, y: 0 });
    batcher.flush();

    // Simulate worker response
    const batchReq = mockWorker.posted[0] as Extract<WorkerRequest, { type: 'BATCH_REQUEST' }>;
    mockWorker.respond({
      type: 'BATCH_RESULT',
      batchId: batchReq.batchId,
      results: [{
        id: batchReq.requests[0]!.id,
        variants: [[1, 2, 3]],
      }],
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.routeKey).toBe(routeKey);
    expect(results[0]!.variants).toEqual([[1, 2, 3]]);
    expect(batcher.isPending(routeKey)).toBe(false);
  });

  it('handles multiple requests in a single batch', () => {
    const results: { routeKey: string; variants: number[][] }[] = [];
    batcher.onResult = (routeKey, variants) => {
      results.push({ routeKey, variants });
    };

    batcher.enqueue('0,0->3,0', collectPoints(0, 'exit'), collectPoints(3, 'entry'), { x: 3, y: 0 });
    batcher.enqueue('4,0->7,0', collectPoints(4, 'exit'), collectPoints(7, 'entry'), { x: 7, y: 0 });
    batcher.flush();

    const batchReq = mockWorker.posted[0] as Extract<WorkerRequest, { type: 'BATCH_REQUEST' }>;
    expect(batchReq.requests).toHaveLength(2);

    mockWorker.respond({
      type: 'BATCH_RESULT',
      batchId: batchReq.batchId,
      results: [
        { id: batchReq.requests[0]!.id, variants: [[10, 11]] },
        { id: batchReq.requests[1]!.id, variants: [[20, 21]] },
      ],
    });

    expect(results).toHaveLength(2);
    expect(batcher.isPending('0,0->3,0')).toBe(false);
    expect(batcher.isPending('4,0->7,0')).toBe(false);
  });

  it('flushLimit caps the number of requests per batch', () => {
    for (let i = 0; i < 5; i++) {
      batcher.enqueue(`${i},0->${i + 1},0`, collectPoints(i, 'exit'), collectPoints(i + 1, 'entry'), { x: i + 1, y: 0 });
    }
    batcher.flush(3);

    const batchReq = mockWorker.posted[0] as Extract<WorkerRequest, { type: 'BATCH_REQUEST' }>;
    expect(batchReq.requests).toHaveLength(3);
    expect(batcher.queueSize).toBe(2); // remaining
  });
});
