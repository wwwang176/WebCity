import { describe, it, expect, beforeEach } from 'vitest';
import { PathWorkerClient, type BatchRequestItem, type BatchResultItem } from '../PathWorkerClient';

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: any[] = [];

  postMessage(data: any): void {
    this.posted.push(data);
  }

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

  it('initGraph sends INIT_GRAPH and resolves on READY', async () => {
    const sab = new SharedArrayBuffer(1024);
    const promise = client.initGraph(sab, 128, 256);

    expect(mockWorker.posted.length).toBe(1);
    expect(mockWorker.posted[0].type).toBe('INIT_GRAPH');
    expect(mockWorker.posted[0].maxPoints).toBe(128);

    mockWorker.respond({ type: 'READY' });
    await promise;
  });

  it('batchRequest sends BATCH_REQUEST and resolves with BATCH_RESULT', async () => {
    const requests: BatchRequestItem[] = [{
      id: 1,
      startPointIndices: [0, 1],
      endPointIndices: [5, 6],
      endPos: { x: 5, y: 0 },
      variantCount: 3,
    }];

    const promise = client.batchRequest(requests);

    expect(mockWorker.posted.length).toBe(1);
    expect(mockWorker.posted[0].type).toBe('BATCH_REQUEST');

    const batchId = mockWorker.posted[0].batchId;
    const results: BatchResultItem[] = [{ id: 1, variants: [[10, 11, 12]] }];
    mockWorker.respond({ type: 'BATCH_RESULT', batchId, results });

    const resolved = await promise;
    expect(resolved).toEqual(results);
  });

  it('handles multiple concurrent batches', async () => {
    const p1 = client.batchRequest([{ id: 1, startPointIndices: [0], endPointIndices: [1], endPos: { x: 1, y: 0 }, variantCount: 1 }]);
    const p2 = client.batchRequest([{ id: 2, startPointIndices: [2], endPointIndices: [3], endPos: { x: 3, y: 0 }, variantCount: 1 }]);

    expect(mockWorker.posted.length).toBe(2);

    const batchId1 = mockWorker.posted[0].batchId;
    const batchId2 = mockWorker.posted[1].batchId;

    mockWorker.respond({ type: 'BATCH_RESULT', batchId: batchId1, results: [{ id: 1, variants: [[0]] }] });
    mockWorker.respond({ type: 'BATCH_RESULT', batchId: batchId2, results: [{ id: 2, variants: [[1]] }] });

    const r1 = await p1;
    const r2 = await p2;
    expect(r1[0]!.id).toBe(1);
    expect(r2[0]!.id).toBe(2);
  });

  it('tracks pending count', () => {
    expect(client.pendingCount).toBe(0);
    const p = client.batchRequest([{ id: 1, startPointIndices: [0], endPointIndices: [1], endPos: { x: 1, y: 0 }, variantCount: 1 }]);
    expect(client.pendingCount).toBe(1);

    const batchId = mockWorker.posted[0].batchId;
    mockWorker.respond({ type: 'BATCH_RESULT', batchId, results: [{ id: 1, variants: [] }] });

    return p.then(() => {
      expect(client.pendingCount).toBe(0);
    });
  });
});
