/**
 * Workplace Distance Worker — 從每個工作地點反向 flood，算出每個建築格到它的
 * 道路成本。
 *
 * Main → Worker: { type: 'COMPUTE', requestId, gridWidth, gridHeight, gridBuffer,
 *                  graphBuffer, workplaces, maxBudget }
 * Worker → Main: { type: 'RESULT', requestId, entries }
 *
 * **worker 不再有自己的 Dijkstra。** 它跟同步查詢共用 `floodRoadCellGraph`
 * ——那是 BUG-109 的治本：以前 worker 拿到的是一張平面的格子緩衝，看不到
 * 高架，於是「寧可慢也不要錯」，有一格高架就整城停用快取。
 */

import { deserializeRoadCellGraph } from '../core/road/RoadCellGraphBuffer';
import { floodRoadCellGraph, seedNodesFor, attachAtSettledNode } from '../core/road/RoadCellGraph';
import type { RoadCellGraph } from '../core/road/RoadCellGraph';
import { ZONE_ROAD_REACH } from '../core/grid/constants';
import type {
  WDWorkerRequest, WDWorkerResponse, WorkplaceDistanceEntry, WorkplacePosition,
} from '../core/workplace/WorkplaceDistanceTypes';

const BYTES_PER_CELL = 12;

// ── Core computation (exported for tests) ──────────────────────────

/**
 * 從一個工作地點反向 flood，回傳每個建築格到它的道路成本。
 *
 * `graph` **必須是轉置後的圖** —— 成本加在目的地那一格，直接用正向圖
 * 反向擴散會付成來源那格的價格（BUG-237）。
 *
 * 收的是**建好的圖**而不是 buffer:反序列化要為每個路網節點配一個字串鍵再塞進
 * `Map`，不是零成本視圖。整批工作地共用一張圖，見 `computeWorkplaceDistances`。
 */
export function reverseFloodFromGraph(
  graph: RoadCellGraph,
  wp: WorkplacePosition,
  maxBudget: number,
  isBuilding: (x: number, y: number) => boolean,
): Record<string, number> {
  const seeds = seedNodesFor(graph, wp.x, wp.y, ZONE_ROAD_REACH);
  if (seeds.length === 0) return {};

  const out = new Map<string, number>();
  floodRoadCellGraph(graph, seeds, maxBudget, (node, cost) => {
    attachAtSettledNode(graph, node, cost, ZONE_ROAD_REACH, isBuilding, out);
    return false;   // 反向要走完整個預算範圍，沒有目標集合可以早退
  });
  return Object.fromEntries(out);
}

/**
 * 一整批工作地的距離表。**圖只反序列化一次**（BUG-334）——以前這件事在逐工作地
 * 的迴圈裡做，成本是 O(工作地數 × 路格數) 次字串配置，疊在真正的 flood 之上。
 */
export function computeWorkplaceDistances(
  graphBuffer: ArrayBuffer,
  workplaces: readonly WorkplacePosition[],
  maxBudget: number,
  isBuilding: (x: number, y: number) => boolean,
): WorkplaceDistanceEntry[] {
  const graph = deserializeRoadCellGraph(graphBuffer);
  return workplaces.map(wp => ({
    workplacePos: wp.pos,
    distances: reverseFloodFromGraph(graph, wp, maxBudget, isBuilding),
  }));
}

// ── Worker message handler ─────────────────────────────────────────

/* istanbul ignore next -- worker entry point, not executed in test environment */
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (self as any).onmessage = (e: MessageEvent<WDWorkerRequest>) => {
    const msg = e.data;
    if (msg.type !== 'COMPUTE') return;

    try {
      // 格子緩衝仍然要送：worker 用它判斷附掛時哪些格子該收（不是路的才是
      // 建築）。圖說的是「怎麼走」，格子說的是「格子上有什麼」。
      const view = new DataView(msg.gridBuffer);
      const isBuilding = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= msg.gridWidth || y >= msg.gridHeight) return false;
        return view.getUint8((y * msg.gridWidth + x) * BYTES_PER_CELL + 5) === 0;
      };

      const entries = computeWorkplaceDistances(
        msg.graphBuffer, msg.workplaces, msg.maxBudget, isBuilding);

      (self as unknown as Worker).postMessage({
        type: 'RESULT',
        requestId: msg.requestId,
        entries,
      } satisfies WDWorkerResponse);
    } catch (err) {
      (self as unknown as Worker).postMessage({
        type: 'ERROR',
        requestId: msg.requestId,
        message: String(err),
      } satisfies WDWorkerResponse);
    }
  };
}
