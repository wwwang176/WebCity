import type { WorkplaceDistanceClient } from './WorkplaceDistanceClient';
import type { WorkplaceDistanceEntry, WorkplacePosition } from './WorkplaceDistanceTypes';

export type CacheStatus = 'empty' | 'computing' | 'ready';

/**
 * Caches precomputed road distances from workplaces to all reachable cells.
 * Invalidated via observer pattern — call invalidate() when roads or buildings change.
 * Computation is done in a web worker; main thread only does O(1) lookups.
 */
export class WorkplaceDistanceCache {
  private status: CacheStatus = 'empty';
  /** Set to true if invalidate() is called while status === 'computing'. */
  private invalidatedDuringBuild = false;
  /** workplace pos → (cell pos → cost) */
  private table = new Map<string, Map<string, number>>();
  private client: WorkplaceDistanceClient | null = null;

  constructor(client?: WorkplaceDistanceClient) {
    this.client = client ?? null;
  }

  /** Mark cache as invalid. If computing, the result will be discarded. */
  invalidate(): void {
    if (this.status === 'computing') {
      this.invalidatedDuringBuild = true;
    } else {
      this.status = 'empty';
    }
  }

  /** Force full reset (e.g. on game load). */
  reset(): void {
    this.status = 'empty';
    this.table.clear();
    this.invalidatedDuringBuild = false;
  }

  /** Trigger async recomputation if not already computing. Returns false if skipped. */
  requestUpdate(
    gridWidth: number,
    gridHeight: number,
    gridBuffer: SharedArrayBuffer | ArrayBuffer,
    workplaces: WorkplacePosition[],
    maxBudget: number,
  ): boolean {
    if (!this.client) return false;
    if (this.status === 'computing') return false;
    this.status = 'computing';
    this.invalidatedDuringBuild = false;

    this.client.compute(gridWidth, gridHeight, gridBuffer, workplaces, maxBudget)
      .then(entries => this.applyResult(entries))
      .catch(() => {
        // Worker error — reset to empty so next tick retries
        this.status = 'empty';
        this.invalidatedDuringBuild = false;
      });
    return true;
  }

  /** Apply worker result — called internally from the promise callback. */
  private applyResult(entries: WorkplaceDistanceEntry[]): void {
    if (this.invalidatedDuringBuild) {
      // Data changed while computing → discard and wait for next request
      this.invalidatedDuringBuild = false;
      this.status = 'empty';
      return;
    }
    this.table.clear();
    for (const e of entries) {
      this.table.set(e.workplacePos, new Map(Object.entries(e.distances).map(
        ([k, v]) => [k, v as number],
      )));
    }
    this.status = 'ready';
  }

  /** For testing: synchronously populate the cache from pre-built entries. */
  populateSync(entries: WorkplaceDistanceEntry[]): void {
    this.table.clear();
    for (const e of entries) {
      this.table.set(e.workplacePos, new Map(Object.entries(e.distances).map(
        ([k, v]) => [k, v as number],
      )));
    }
    this.status = 'ready';
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

  get isReady(): boolean { return this.status === 'ready'; }
  get isStale(): boolean { return this.status === 'empty'; }
  getStatus(): CacheStatus { return this.status; }
}
