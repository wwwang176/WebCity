/**
 * Workplace Distance Worker — floods backwards from each workplace to find every building cell's road
 * cost to it.
 *
 * Main to worker: { type: 'COMPUTE', requestId, gridWidth, gridHeight, gridBuffer,
 *                   graphBuffer, workplaces, maxBudget }
 * Worker to main: { type: 'RESULT', requestId, entries }
 *
 * **The worker has no Dijkstra of its own.** It shares `floodRoadCellGraph` with the synchronous
 * queries, which is the root fix for BUG-109: given a flat cell buffer the worker could not see
 * elevated roads, and erring towards slow rather than wrong meant one elevated cell disabled the cache
 * for the whole city.
 */

import { deserializeRoadCellGraph } from '../core/road/RoadCellGraphBuffer';
import { floodRoadCellGraph, seedNodesFor, attachAtSettledNode } from '../core/road/RoadCellGraph';
import type { RoadCellGraph } from '../core/road/RoadCellGraph';
import { ZONE_ROAD_REACH } from '../core/grid/constants';
import type {
  WDWorkerRequest, WDWorkerResponse, WorkplacePosition,
} from '../core/workplace/WorkplaceDistanceTypes';
import {
  WorkplaceDistanceTable, WorkplaceDistanceTableBuilder,
  type WorkplaceDistanceBuffers,
} from '../core/workplace/WorkplaceDistanceTable';

const BYTES_PER_CELL = 12;

// ── Core computation (exported for tests) ──────────────────────────

/**
 * Floods backwards from one workplace, writing every building cell's road cost to it into `out`.
 *
 * `graph` **has to be the transposed graph**: the cost is charged at the destination cell, and
 * spreading backwards through the forward graph pays the source cell's price instead (BUG-237).
 *
 * It takes a **built graph** rather than a buffer: deserialising allocates a string key per road node
 * and fills a `Map`, which is not a zero-cost view. One graph is shared across a batch of workplaces;
 * see `computeWorkplaceDistances`.
 *
 * @param out Length `width * height`. The caller fills it with -1 before each workplace.
 */
export function reverseFloodFromGraph(
  graph: RoadCellGraph,
  wp: WorkplacePosition,
  maxBudget: number,
  width: number,
  height: number,
  isBuilding: (x: number, y: number) => boolean,
  out: Int32Array,
): void {
  const seeds = seedNodesFor(graph, wp.x, wp.y, ZONE_ROAD_REACH);
  if (seeds.length === 0) return;

  floodRoadCellGraph(graph, seeds, maxBudget, (node, cost) => {
    attachAtSettledNode(graph, node, cost, ZONE_ROAD_REACH, width, height, isBuilding, out);
    return false;   // the reverse flood covers the whole budget; there is no target set to stop early on
  });
}

/**
 * The distance tables for a whole batch of workplaces. **The graph is deserialised once** (BUG-334):
 * done inside the per-workplace loop it costs O(workplaces x road cells) string allocations on top of
 * the flood itself.
 *
 * One scratch dense array is shared across the batch and refilled with -1 per workplace: 60x60 is 3,600
 * writes, far cheaper than allocating a fresh array for each.
 */
export function computeWorkplaceDistances(
  graphBuffer: ArrayBuffer,
  workplaces: readonly WorkplacePosition[],
  maxBudget: number,
  width: number,
  height: number,
  isBuilding: (x: number, y: number) => boolean,
): WorkplaceDistanceBuffers {
  const graph = deserializeRoadCellGraph(graphBuffer);
  const builder = new WorkplaceDistanceTableBuilder(width, height);
  const scratch = new Int32Array(width * height);
  for (const wp of workplaces) {
    scratch.fill(-1);
    reverseFloodFromGraph(graph, wp, maxBudget, width, height, isBuilding, scratch);
    builder.addWorkplace(wp.pos, scratch);
  }
  return builder.build();
}

// ── Worker message handler ─────────────────────────────────────────

/* istanbul ignore next -- worker entry point, not executed in test environment */
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (self as any).onmessage = (e: MessageEvent<WDWorkerRequest>) => {
    const msg = e.data;
    if (msg.type !== 'COMPUTE') return;

    try {
      // The cell buffer is still sent: the worker uses it to decide which cells to attach to, since
      // what is not road is building. The graph says how to travel; the cells say what is on them.
      const view = new DataView(msg.gridBuffer);
      const isBuilding = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= msg.gridWidth || y >= msg.gridHeight) return false;
        return view.getUint8((y * msg.gridWidth + x) * BYTES_PER_CELL + 5) === 0;
      };

      const table = computeWorkplaceDistances(
        msg.graphBuffer, msg.workplaces, msg.maxBudget,
        msg.gridWidth, msg.gridHeight, isBuilding);

      // The three views are moved through the transfer list rather than copied. Without it, reading
      // `e.data` alone takes the main thread a second: 1,057-1,131 ms measured on a 40,000-person
      // save.
      (self as unknown as Worker).postMessage({
        type: 'RESULT',
        requestId: msg.requestId,
        table,
      } satisfies WDWorkerResponse, WorkplaceDistanceTable.transferables(table));
    } catch (err) {
      (self as unknown as Worker).postMessage({
        type: 'ERROR',
        requestId: msg.requestId,
        message: String(err),
      } satisfies WDWorkerResponse);
    }
  };
}
