/**
 * Pathfinding Worker — zero-GC A* pathfinding off the main thread.
 *
 * Reads LaneGraph data from a SharedArrayBuffer (written by main thread's
 * LaneGraphBuffer.writeFromGraph). Uses PooledAStar for pre-allocated,
 * garbage-free A* search.
 *
 * Protocol (Main → Worker):
 *   { type: 'INIT_GRAPH', graphSAB: SharedArrayBuffer, maxPoints, maxEdges }
 *   { type: 'BATCH_REQUEST', batchId, requests: BatchRequestItem[] }
 *
 * Protocol (Worker → Main):
 *   { type: 'READY' }
 *   { type: 'BATCH_RESULT', batchId, results: BatchResultItem[] }
 */

import { createWorkerHandler, type WorkerRequest, type WorkerResponse } from '../core/traffic/PathfindingWorkerHandler';

const handle = createWorkerHandler();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  handle(e.data, (response: WorkerResponse) => {
    (self as unknown as Worker).postMessage(response);
  });
};
