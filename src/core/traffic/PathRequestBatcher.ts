/**
 * PathRequestBatcher — collects pathfinding requests, deduplicates by routeKey,
 * dispatches batches to the pathfinding Worker, and delivers results via callback.
 *
 * Main thread calls:
 *   batcher.enqueue(routeKey, starts, ends, endPos)  — per cache miss
 *   batcher.flush(limit?)                            — once per tick
 *
 * When the Worker responds:
 *   batcher.onResult(routeKey, edgeIndexVariants)    — callback to write into routeIndex
 */

import type { WorkerRequest, WorkerResponse, BatchRequestItem } from './PathfindingWorkerHandler';
import type { GraphMapping } from './LaneGraphBuffer';

interface QueuedRequest {
  routeKey: string;
  startPointIndices: number[];
  endPointIndices: number[];
  endPos: { x: number; y: number };
}

export class PathRequestBatcher {
  private worker: Worker;
  private mapping: GraphMapping;
  private nextBatchId = 1;
  private nextRequestId = 1;

  // Queued requests waiting to be flushed
  private queue: QueuedRequest[] = [];
  private queuedKeys = new Set<string>();

  // Pending routeKeys (sent to worker, awaiting response)
  private pendingKeys = new Set<string>();

  // In-flight batches: batchId → request id → routeKey mapping
  private inflightBatches = new Map<number, Map<number, string>>();

  /** Called when worker returns results. */
  onResult: ((routeKey: string, variants: number[][]) => void) | null = null;

  constructor(worker: Worker, mapping: GraphMapping) {
    this.worker = worker;
    this.mapping = mapping;
    this.worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
      this.handleMessage(e.data);
    });
  }

  /** Update mapping after graph rebuild. */
  updateMapping(mapping: GraphMapping): void {
    this.mapping = mapping;
  }

  /** Enqueue a pathfinding request. Deduplicates by routeKey. */
  enqueue(
    routeKey: string,
    startPointIndices: number[],
    endPointIndices: number[],
    endPos: { x: number; y: number },
  ): void {
    if (this.queuedKeys.has(routeKey) || this.pendingKeys.has(routeKey)) return;
    this.queue.push({ routeKey, startPointIndices, endPointIndices, endPos });
    this.queuedKeys.add(routeKey);
    this.pendingKeys.add(routeKey);
  }

  /** Is a routeKey currently pending (queued or in-flight)? */
  isPending(routeKey: string): boolean {
    return this.pendingKeys.has(routeKey);
  }

  /** Number of requests waiting to be flushed. */
  get queueSize(): number {
    return this.queue.length;
  }

  /**
   * Send queued requests to the worker as a BATCH_REQUEST.
   * @param limit Max requests to send in this batch (default: all).
   */
  flush(limit?: number): void {
    if (this.queue.length === 0) return;

    const count = limit ? Math.min(limit, this.queue.length) : this.queue.length;
    const batch = this.queue.splice(0, count);
    for (const req of batch) {
      this.queuedKeys.delete(req.routeKey);
    }

    const batchId = this.nextBatchId++;
    const idToRouteKey = new Map<number, string>();
    const requests: BatchRequestItem[] = [];

    for (const req of batch) {
      const id = this.nextRequestId++;
      idToRouteKey.set(id, req.routeKey);
      requests.push({
        id,
        startPointIndices: req.startPointIndices,
        endPointIndices: req.endPointIndices,
        endPos: req.endPos,
        variantCount: 3,
      });
    }

    this.inflightBatches.set(batchId, idToRouteKey);

    const msg: WorkerRequest = { type: 'BATCH_REQUEST', batchId, requests };
    this.worker.postMessage(msg);
  }

  /** Clear all pending state (e.g., on road change / graph rebuild). */
  clearPending(): void {
    this.queue.length = 0;
    this.queuedKeys.clear();
    this.pendingKeys.clear();
    this.inflightBatches.clear();
  }

  private handleMessage(data: WorkerResponse): void {
    if (data.type !== 'BATCH_RESULT') return;

    const idToRouteKey = this.inflightBatches.get(data.batchId!);
    if (!idToRouteKey) return;
    this.inflightBatches.delete(data.batchId!);

    for (const result of data.results ?? []) {
      const routeKey = idToRouteKey.get(result.id);
      if (!routeKey) continue;
      this.pendingKeys.delete(routeKey);
      if (this.onResult) {
        this.onResult(routeKey, result.variants);
      }
    }
  }
}
