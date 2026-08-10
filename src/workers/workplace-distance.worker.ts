/**
 * Workplace Distance Worker — computes reverse Dijkstra from each workplace outward.
 *
 * Main → Worker: { type: 'COMPUTE', requestId, gridWidth, gridHeight, gridBuffer, workplaces, maxBudget }
 * Worker → Main: { type: 'RESULT', requestId, entries }
 */

import { RoadType } from '../core/road/types';
// 成本函式與主執行緒共用同一份 —— worker 曾經有一份手抄複本，兩邊分別改
// 就會悄悄分岔。`roadCost.ts` 是葉模組，不會把服務層拖進 worker bundle。
import { roadTileCost } from '../core/road/roadCost';
import { ZONE_ROAD_REACH } from '../core/grid/constants';
import type { WDWorkerRequest, WDWorkerResponse, WorkplaceDistanceEntry, WorkplacePosition } from '../core/workplace/WorkplaceDistanceTypes';

const BYTES_PER_CELL = 12;
const FOUR_DIRS: readonly [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// ── MinHeap ────────────────────────────────────────────────────────

interface HeapEntry { idx: number; cost: number }

class MinHeap {
  private h: HeapEntry[] = [];
  push(idx: number, cost: number): void {
    this.h.push({ idx, cost });
    this.up(this.h.length - 1);
  }
  pop(): HeapEntry | undefined {
    if (this.h.length === 0) return undefined;
    const top = this.h[0]!;
    const last = this.h.pop()!;
    if (this.h.length > 0) { this.h[0] = last; this.down(0); }
    return top;
  }
  get size(): number { return this.h.length; }
  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[i]!.cost >= this.h[p]!.cost) break;
      [this.h[i], this.h[p]] = [this.h[p]!, this.h[i]!];
      i = p;
    }
  }
  private down(i: number): void {
    const n = this.h.length;
    while (true) {
      let m = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.h[l]!.cost < this.h[m]!.cost) m = l;
      if (r < n && this.h[r]!.cost < this.h[m]!.cost) m = r;
      if (m === i) break;
      [this.h[i], this.h[m]] = [this.h[m]!, this.h[i]!];
      i = m;
    }
  }
}

// ── Core computation (exported for tests) ──────────────────────────

/**
 * Reverse Dijkstra from a single workplace position outward along the road network.
 * Returns all reachable cell posKeys with their road cost.
 * Non-road cells adjacent to covered road cells are included (buildings).
 */
export function reverseFloodFromWorkplace(
  view: DataView,
  width: number,
  height: number,
  wp: WorkplacePosition,
  maxBudget: number,
): Record<string, number> {
  const totalCells = width * height;
  // Use flat Float32Array for costs: -1 = unvisited
  const costArr = new Float32Array(totalCells).fill(-1);
  const pq = new MinHeap();

  const idx = (x: number, y: number) => y * width + x;
  const inBounds = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;
  const getRoadType = (x: number, y: number): number => {
    const offset = (y * width + x) * BYTES_PER_CELL;
    return view.getUint8(offset + 5);
  };

  // Seed: workplace cell + every road cell within Chebyshev(ZONE_ROAD_REACH)
  // of it. Matches the inner-ring zone/civic model so a workplace in the inner
  // ring still attaches to nearby roads.
  const seedCells: number[] = [];
  for (let dy = -ZONE_ROAD_REACH; dy <= ZONE_ROAD_REACH; dy++) {
    for (let dx = -ZONE_ROAD_REACH; dx <= ZONE_ROAD_REACH; dx++) {
      const nx = wp.x + dx, ny = wp.y + dy;
      if (!inBounds(nx, ny)) continue;
      if (getRoadType(nx, ny) === RoadType.NONE) continue;
      const i = idx(nx, ny);
      if (costArr[i]! < 0) {
        costArr[i] = 0;
        pq.push(i, 0);
        seedCells.push(i);
      }
    }
  }

  // Dijkstra expansion
  while (pq.size > 0) {
    const cur = pq.pop()!;
    if (costArr[cur.idx]! < cur.cost) continue; // stale

    const cx = cur.idx % width;
    const cy = (cur.idx - cx) / width;

    for (const [dx, dy] of FOUR_DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const rt = getRoadType(nx, ny);
      if (rt === RoadType.NONE) continue;

      const newCost = cur.cost + roadTileCost(rt);
      if (newCost > maxBudget) continue;

      const ni = idx(nx, ny);
      if (costArr[ni]! < 0 || newCost < costArr[ni]!) {
        costArr[ni] = newCost;
        pq.push(ni, newCost);
      }
    }
  }

  // Build result: include covered road cells + non-road cells within
  // Chebyshev(ZONE_ROAD_REACH) of any covered road cell (buildings in the
  // inner ring attach to the cheapest reachable road).
  const result: Record<string, number> = {};

  for (let i = 0; i < totalCells; i++) {
    const cost = costArr[i]!;
    if (cost < 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    result[`${x},${y}`] = cost;

    for (let dy = -ZONE_ROAD_REACH; dy <= ZONE_ROAD_REACH; dy++) {
      for (let dx = -ZONE_ROAD_REACH; dx <= ZONE_ROAD_REACH; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        if (getRoadType(nx, ny) !== RoadType.NONE) continue; // skip road cells
        const nk = `${nx},${ny}`;
        if (!(nk in result) || cost < result[nk]!) {
          result[nk] = cost;
        }
      }
    }
  }

  return result;
}

/**
 * Compute distance tables for all workplaces.
 */
export function computeAllDistances(
  view: DataView,
  width: number,
  height: number,
  workplaces: WorkplacePosition[],
  maxBudget: number,
): WorkplaceDistanceEntry[] {
  return workplaces.map(wp => ({
    workplacePos: wp.pos,
    distances: reverseFloodFromWorkplace(view, width, height, wp, maxBudget),
  }));
}

// ── Worker message handler ─────────────────────────────────────────

/* istanbul ignore next -- worker entry point, not executed in test environment */
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
(self as any).onmessage = (e: MessageEvent<WDWorkerRequest>) => {
  const msg = e.data;
  if (msg.type !== 'COMPUTE') return;

  try {
    const view = new DataView(msg.gridBuffer);
    const entries = computeAllDistances(
      view, msg.gridWidth, msg.gridHeight, msg.workplaces, msg.maxBudget,
    );

    (self as unknown as Worker).postMessage({
      type: 'RESULT',
      requestId: msg.requestId,
      entries,
    } satisfies WDWorkerResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: 'ERROR',
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WDWorkerResponse);
  }
};
}
