/**
 * SyncFakeWorker — synchronous Worker substitute for tests.
 *
 * Uses createWorkerHandler() internally so postMessage() processes and
 * fires the message listener in the same call stack. This lets tests
 * get pathfinding results in a single flush() without real async.
 */

import { createWorkerHandler, type WorkerRequest, type WorkerResponse } from '../PathfindingWorkerHandler';

export class SyncFakeWorker {
  private handler = createWorkerHandler();
  private listeners: ((e: MessageEvent) => void)[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;

  addEventListener(type: string, handler: (e: MessageEvent) => void): void {
    if (type === 'message') this.listeners.push(handler);
  }

  removeEventListener(): void {}

  postMessage(data: WorkerRequest): void {
    this.handler(data, (response: WorkerResponse) => {
      const event = { data: response } as MessageEvent;
      for (const listener of this.listeners) {
        listener(event);
      }
      if (this.onmessage) {
        this.onmessage(event);
      }
    });
  }

  terminate(): void {}
}

/** Cast helper for type-safe usage with setPathfindingWorker(). */
export function createSyncFakeWorker(): Worker {
  return new SyncFakeWorker() as unknown as Worker;
}
