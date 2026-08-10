import type { WorkplaceDistanceClient } from './WorkplaceDistanceClient';
import type { WorkplaceDistanceEntry, WorkplacePosition } from './WorkplaceDistanceTypes';
import { graphBufferNodeCount } from '../road/RoadCellGraphBuffer';

export enum CacheStatus {
  EMPTY = 'empty',
  COMPUTING = 'computing',
  READY = 'ready',
}

/**
 * Caches precomputed road distances from workplaces to all reachable cells.
 * Invalidated via observer pattern — call invalidate() when roads or buildings change.
 * Computation is done in a web worker; main thread only does O(1) lookups.
 */
export class WorkplaceDistanceCache {
  private status: CacheStatus = CacheStatus.EMPTY;
  /** Set to true if invalidate() is called while status === CacheStatus.COMPUTING. */
  private invalidatedDuringBuild = false;
  /** workplace pos → (cell pos → cost) */
  private table = new Map<string, Map<string, number>>();
  private client: WorkplaceDistanceClient | null = null;

  constructor(client?: WorkplaceDistanceClient) {
    this.client = client ?? null;
  }

  /** Mark cache as invalid. If computing, the result will be discarded. */
  invalidate(): void {
    if (this.status === CacheStatus.COMPUTING) {
      this.invalidatedDuringBuild = true;
    } else {
      this.status = CacheStatus.EMPTY;
    }
  }

  /** Force full reset (e.g. on game load). */
  reset(): void {
    this.status = CacheStatus.EMPTY;
    this.table.clear();
    this.invalidatedDuringBuild = false;
  }

  /**
   * Trigger async recomputation if not already computing. Returns false if skipped.
   *
   * @param graphBuffer 序列化的**轉置** RoadCellGraph（見 `WDWorkerRequest`）。
   */
  requestUpdate(
    gridWidth: number,
    gridHeight: number,
    gridBuffer: SharedArrayBuffer | ArrayBuffer,
    graphBuffer: ArrayBuffer,
    workplaces: WorkplacePosition[],
    maxBudget: number,
  ): boolean {
    if (!this.client) return false;
    // 空圖代表城市還沒有路。送出去只會拿回一張空表，而空表會被 applyResult
    // 標成 READY —— 全城變成互相到不了。寧可維持 EMPTY 走同步 fallback。
    //
    // 看 header 的 nodeCount，不是 byteLength：空圖的 buffer 有 16 bytes 的
    // header 加一個 offsets[0]，長度是 20。
    if (graphBufferNodeCount(graphBuffer) === 0) return false;
    if (this.status === CacheStatus.COMPUTING) return false;
    this.status = CacheStatus.COMPUTING;
    this.invalidatedDuringBuild = false;

    this.client.compute(gridWidth, gridHeight, gridBuffer, graphBuffer, workplaces, maxBudget)
      .then(entries => this.applyResult(entries))
      .catch(() => {
        // Worker error — reset to empty so next tick retries
        this.status = CacheStatus.EMPTY;
        this.invalidatedDuringBuild = false;
      });
    return true;
  }

  /** Apply worker result — called internally from the promise callback. */
  private applyResult(entries: WorkplaceDistanceEntry[]): void {
    if (this.invalidatedDuringBuild) {
      // Data changed while computing → discard and wait for next request
      this.invalidatedDuringBuild = false;
      this.status = CacheStatus.EMPTY;
      return;
    }
    this.table.clear();
    for (const e of entries) {
      this.table.set(e.workplacePos, new Map(Object.entries(e.distances).map(
        ([k, v]) => [k, v as number],
      )));
    }
    this.status = CacheStatus.READY;
  }

  /** For testing: synchronously populate the cache from pre-built entries. */
  populateSync(entries: WorkplaceDistanceEntry[]): void {
    this.table.clear();
    for (const e of entries) {
      this.table.set(e.workplacePos, new Map(Object.entries(e.distances).map(
        ([k, v]) => [k, v as number],
      )));
    }
    this.status = CacheStatus.READY;
    this.invalidatedDuringBuild = false;
  }

  /** O(1) lookup: road cost from home cell to workplace cell. */
  getDistance(homePos: string, workplacePos: string): number | undefined {
    return this.table.get(workplacePos)?.get(homePos);
  }

  /** Get all reachable workplaces from a home position. */
  getReachableWorkplaces(homePos: string): Set<string> {
    const result = new Set<string>();
    for (const [wpPos, distMap] of this.table) {
      if (distMap.has(homePos)) result.add(wpPos);
    }
    return result;
  }

  /** Build distance map from home to specified workplaces (replaces roadDistanceToTargets). */
  getDistancesFromHome(homePos: string, workplacePositions: Iterable<string>): Map<string, number> {
    const result = new Map<string, number>();
    for (const wpPos of workplacePositions) {
      const cost = this.table.get(wpPos)?.get(homePos);
      if (cost !== undefined) result.set(wpPos, cost);
    }
    return result;
  }

  get isReady(): boolean { return this.status === CacheStatus.READY; }
  get isStale(): boolean { return this.status === CacheStatus.EMPTY; }
  getStatus(): CacheStatus { return this.status; }
}
