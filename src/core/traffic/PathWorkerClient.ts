import type { SerializedLaneEdge } from '../../workers/pathfinding.worker';

export interface BatchRequest {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  preferredLane: number;
}

export interface BatchResult {
  id: number;
  edgePath: SerializedLaneEdge[] | null;
}

/**
 * Client wrapper for communication with the pathfinding web worker.
 * Provides promise-based API for batch pathfinding requests.
 */
export class PathWorkerClient {
  private worker: Worker;
  private nextBatchId = 1;
  private pendingBatches = new Map<number, {
    resolve: (results: BatchResult[]) => void;
    reject: (err: Error) => void;
  }>();
  private laneGraphResolve: (() => void) | null = null;

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent) => this.handleMessage(e.data);
  }

  /**
   * Send a batch of pathfinding requests to the worker.
   * Returns a promise that resolves with the results.
   */
  batchRequest(requests: BatchRequest[]): Promise<BatchResult[]> {
    const batchId = this.nextBatchId++;
    return new Promise((resolve, reject) => {
      this.pendingBatches.set(batchId, { resolve, reject });
      this.worker.postMessage({
        type: 'BATCH_REQUEST',
        batchId,
        requests,
      });
    });
  }

  /**
   * Send SET_GRID to the worker.
   */
  setGrid(width: number, height: number, gridData: SharedArrayBuffer): void {
    this.worker.postMessage({
      type: 'SET_GRID',
      width,
      height,
      gridData,
    });
  }

  /**
   * Request the worker to rebuild the lane graph.
   * Resolves when the worker signals LANE_GRAPH_READY.
   */
  buildLaneGraph(): Promise<void> {
    return new Promise((resolve) => {
      this.laneGraphResolve = resolve;
      this.worker.postMessage({ type: 'BUILD_LANE_GRAPH' });
    });
  }

  /**
   * Number of pending batch requests.
   */
  get pendingCount(): number {
    return this.pendingBatches.size;
  }

  private handleMessage(data: any): void {
    switch (data.type) {
      case 'BATCH_RESULT': {
        const pending = this.pendingBatches.get(data.batchId);
        if (pending) {
          this.pendingBatches.delete(data.batchId);
          pending.resolve(data.results);
        }
        break;
      }
      case 'LANE_GRAPH_READY': {
        if (this.laneGraphResolve) {
          this.laneGraphResolve();
          this.laneGraphResolve = null;
        }
        break;
      }
    }
  }
}
