/**
 * PathfindingWorkerHandler — pure message handler logic for the pathfinding Worker.
 *
 * Extracted from the Worker so it's testable without a Worker thread.
 * The actual Worker (pathfinding.worker.ts) delegates to this handler.
 *
 * Protocol:
 *   INIT_GRAPH   → accepts SAB reference, creates GraphReader + PooledAStar → READY
 *   BATCH_REQUEST → computes paths for a batch of requests → BATCH_RESULT
 */

import { GraphReader } from './LaneGraphBuffer';
import { PooledAStar } from './PooledAStar';

// ── Message types ──

export interface BatchRequestItem {
  id: number;
  startPointIndices: number[];
  endPointIndices: number[];
  endPos: { x: number; y: number };
  variantCount: number;
}

export interface BatchResultItem {
  id: number;
  variants: number[][];   // each variant is an edge index array
}

export type WorkerRequest =
  | { type: 'INIT_GRAPH'; graphSAB: SharedArrayBuffer; maxPoints: number; maxEdges: number }
  | { type: 'BATCH_REQUEST'; batchId: number; requests: BatchRequestItem[] };

export type WorkerResponse =
  | { type: 'READY' }
  | { type: 'BATCH_RESULT'; batchId: number; results: BatchResultItem[] };

// ── Handler factory ──

export function createWorkerHandler() {
  let reader: GraphReader | null = null;
  let astar: PooledAStar | null = null;

  return function handle(
    msg: WorkerRequest,
    postMessage: (response: WorkerResponse) => void,
  ): void {
    switch (msg.type) {
      case 'INIT_GRAPH': {
        reader = new GraphReader(msg.graphSAB, msg.maxPoints, msg.maxEdges);
        astar = new PooledAStar(msg.maxPoints);
        postMessage({ type: 'READY' });
        break;
      }

      case 'BATCH_REQUEST': {
        if (!reader || !astar) {
          postMessage({ type: 'BATCH_RESULT', batchId: msg.batchId, results: [] });
          break;
        }

        const results: BatchResultItem[] = [];
        for (const req of msg.requests) {
          const variants = astar.findPathVariants(
            reader,
            req.startPointIndices,
            req.endPointIndices,
            req.endPos,
            req.variantCount,
          );
          results.push({ id: req.id, variants });
        }

        postMessage({ type: 'BATCH_RESULT', batchId: msg.batchId, results });
        break;
      }
    }
  };
}
