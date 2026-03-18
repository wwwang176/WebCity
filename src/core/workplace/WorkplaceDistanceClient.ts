import type { WDWorkerRequest, WDWorkerResponse, WorkplaceDistanceEntry, WorkplacePosition } from './WorkplaceDistanceTypes';

/**
 * Promise-based client for the workplace distance web worker.
 * Follows the same pattern as PathWorkerClient.
 */
export class WorkplaceDistanceClient {
  private worker: Worker;
  private nextRequestId = 1;
  private pending = new Map<number, {
    resolve: (entries: WorkplaceDistanceEntry[]) => void;
    reject: (err: Error) => void;
  }>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent<WDWorkerResponse>) => {
      const data = e.data;
      const p = this.pending.get(data.requestId);
      if (!p) return;
      this.pending.delete(data.requestId);
      if (data.type === 'RESULT') {
        p.resolve(data.entries);
      } else if (data.type === 'ERROR') {
        p.reject(new Error(data.message));
      }
    };
  }

  compute(
    gridWidth: number,
    gridHeight: number,
    gridBuffer: SharedArrayBuffer | ArrayBuffer,
    workplaces: WorkplacePosition[],
    maxBudget: number,
  ): Promise<WorkplaceDistanceEntry[]> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({
        type: 'COMPUTE',
        requestId,
        gridWidth,
        gridHeight,
        gridBuffer,
        workplaces,
        maxBudget,
      } satisfies WDWorkerRequest);
    });
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
