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


/** Minimal reader surface needed to detect a mid-batch graph rewrite. */
export interface VersionedGraph {
  getVersion(): number;
}

/**
 * Run one batch of path requests, aborting if the shared graph is rewritten
 * underneath us.
 *
 * syncGraphToWorker writes the SharedArrayBuffer in place (header first, then
 * points/edges/adjacency) while this worker may be mid-batch. The format has
 * always reserved a `version` word and both writers bump it, but no reader ever
 * checked it — the designed guard was simply never wired up (BUG-063). Results
 * computed across a rewrite can mix old and new topology, so they are discarded.
 *
 * @returns the batch results, or null if the graph changed mid-batch.
 */
export function runBatch(
  reader: VersionedGraph,
  requests: readonly BatchRequestItem[],
  compute: (req: BatchRequestItem) => number[][],
): BatchResultItem[] | null {
  const startVersion = reader.getVersion();
  const results: BatchResultItem[] = [];

  for (const req of requests) {
    results.push({ id: req.id, variants: compute(req) });
    if (reader.getVersion() !== startVersion) return null;
  }

  return results;
}

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

        const boundReader = reader;
        const boundAstar = astar;
        const results = runBatch(reader, msg.requests, (req) =>
          boundAstar.findPathVariants(
            boundReader,
            req.startPointIndices,
            req.endPointIndices,
            req.endPos,
            req.variantCount,
          ),
        );

        // A null result means the main thread rewrote the shared graph while this
        // batch was running, so the answers may mix old and new topology.
        postMessage({ type: 'BATCH_RESULT', batchId: msg.batchId, results: results ?? [] });
        break;
      }
    }
  };
}
