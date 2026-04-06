/**
 * PathWorkerClient — promise-based wrapper for the pathfinding Worker.
 *
 * Handles INIT_GRAPH and BATCH_REQUEST message sending, and resolves
 * promises when the Worker responds with READY / BATCH_RESULT.
 */

import type { WorkerRequest, WorkerResponse, BatchRequestItem, BatchResultItem } from './PathfindingWorkerHandler';

export { type BatchRequestItem, type BatchResultItem };

export class PathWorkerClient {
  private worker: Worker;
  private nextBatchId = 1;
  private pendingBatches = new Map<number, {
    resolve: (results: BatchResultItem[]) => void;
    reject: (err: Error) => void;
  }>();
  private initResolve: (() => void) | null = null;

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e.data);
  }

  /** Initialize the worker with a SharedArrayBuffer graph. Resolves on READY. */
  initGraph(graphSAB: SharedArrayBuffer, maxPoints: number, maxEdges: number): Promise<void> {
    return new Promise((resolve) => {
      this.initResolve = resolve;
      const msg: WorkerRequest = { type: 'INIT_GRAPH', graphSAB, maxPoints, maxEdges };
      this.worker.postMessage(msg);
    });
  }

  /** Send a batch of pathfinding requests. Resolves with results. */
  batchRequest(requests: BatchRequestItem[]): Promise<BatchResultItem[]> {
    const batchId = this.nextBatchId++;
    return new Promise((resolve, reject) => {
      this.pendingBatches.set(batchId, { resolve, reject });
      const msg: WorkerRequest = { type: 'BATCH_REQUEST', batchId, requests };
      this.worker.postMessage(msg);
    });
  }

  /** Number of pending batch requests. */
  get pendingCount(): number {
    return this.pendingBatches.size;
  }

  private handleMessage(data: WorkerResponse): void {
    switch (data.type) {
      case 'READY': {
        if (this.initResolve) {
          this.initResolve();
          this.initResolve = null;
        }
        break;
      }
      case 'BATCH_RESULT': {
        const pending = this.pendingBatches.get(data.batchId!);
        if (pending) {
          this.pendingBatches.delete(data.batchId!);
          pending.resolve(data.results ?? []);
        }
        break;
      }
    }
  }
}
