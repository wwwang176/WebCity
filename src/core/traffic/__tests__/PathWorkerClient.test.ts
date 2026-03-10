import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PathWorkerClient, type BatchRequest, type BatchResult } from '../PathWorkerClient';

/** Mock Worker class that captures postMessage calls and allows simulating responses. */
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: any[] = [];

  postMessage(data: any): void {
    this.posted.push(data);
  }

  /** Simulate a response from the worker. */
  respond(data: any): void {
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

describe('PathWorkerClient', () => {
  let mockWorker: MockWorker;
  let client: PathWorkerClient;

  beforeEach(() => {
    mockWorker = new MockWorker();
    client = new PathWorkerClient(mockWorker as unknown as Worker);
  });

  it('should send BATCH_REQUEST and resolve with BATCH_RESULT', async () => {
    const requests: BatchRequest[] = [
      { id: 1, from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, preferredLane: 0 },
      { id: 2, from: { x: 1, y: 1 }, to: { x: 3, y: 3 }, preferredLane: 0 },
    ];

    const promise = client.batchRequest(requests);

    // Verify a BATCH_REQUEST was sent
    expect(mockWorker.posted.length).toBe(1);
    expect(mockWorker.posted[0].type).toBe('BATCH_REQUEST');
    expect(mockWorker.posted[0].requests).toEqual(requests);

    // Simulate the worker response (include batchId from the posted message)
    const batchId = mockWorker.posted[0].batchId;
    const results: BatchResult[] = [
      { id: 1, edgePath: [{ id: 'e1', from: {} as any, to: {} as any, length: 1, type: 'straight' }] },
      { id: 2, edgePath: null },
    ];
    mockWorker.respond({ type: 'BATCH_RESULT', batchId, results });

    const resolved = await promise;
    expect(resolved).toEqual(results);
  });

  it('should handle multiple concurrent batch requests', async () => {
    const req1: BatchRequest[] = [{ id: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, preferredLane: 0 }];
    const req2: BatchRequest[] = [{ id: 2, from: { x: 2, y: 2 }, to: { x: 3, y: 3 }, preferredLane: 0 }];

    const p1 = client.batchRequest(req1);
    const p2 = client.batchRequest(req2);

    expect(mockWorker.posted.length).toBe(2);

    // Respond to both (using batchId from the posted messages)
    const batchId1 = mockWorker.posted[0].batchId;
    const batchId2 = mockWorker.posted[1].batchId;

    mockWorker.respond({ type: 'BATCH_RESULT', batchId: batchId1, results: [{ id: 1, edgePath: null }] });
    mockWorker.respond({ type: 'BATCH_RESULT', batchId: batchId2, results: [{ id: 2, edgePath: null }] });

    const r1 = await p1;
    const r2 = await p2;
    expect(r1[0]!.id).toBe(1);
    expect(r2[0]!.id).toBe(2);
  });

  it('should forward SET_GRID to the worker', () => {
    const buf = new ArrayBuffer(100);
    client.setGrid(10, 10, buf as unknown as SharedArrayBuffer);
    expect(mockWorker.posted.length).toBe(1);
    expect(mockWorker.posted[0].type).toBe('SET_GRID');
    expect(mockWorker.posted[0].width).toBe(10);
    expect(mockWorker.posted[0].height).toBe(10);
  });

  it('should forward BUILD_LANE_GRAPH to the worker and resolve on LANE_GRAPH_READY', async () => {
    const promise = client.buildLaneGraph();
    expect(mockWorker.posted.length).toBe(1);
    expect(mockWorker.posted[0].type).toBe('BUILD_LANE_GRAPH');

    mockWorker.respond({ type: 'LANE_GRAPH_READY' });
    await promise; // Should resolve without error
  });

  it('should track pending batch count', () => {
    expect(client.pendingCount).toBe(0);
    const req: BatchRequest[] = [{ id: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, preferredLane: 0 }];
    const p = client.batchRequest(req);
    expect(client.pendingCount).toBe(1);

    const batchId = mockWorker.posted[0].batchId;
    mockWorker.respond({ type: 'BATCH_RESULT', batchId, results: [{ id: 1, edgePath: null }] });

    return p.then(() => {
      expect(client.pendingCount).toBe(0);
    });
  });
});
