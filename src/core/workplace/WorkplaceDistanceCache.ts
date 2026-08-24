import type { WorkplaceDistanceClient } from './WorkplaceDistanceClient';
import type { WorkplacePosition } from './WorkplaceDistanceTypes';
import { WorkplaceDistanceTable, type WorkplaceDistanceBuffers } from './WorkplaceDistanceTable';
import { graphBufferNodeCount } from '../road/RoadCellGraphBuffer';
import { parsePosKey } from '../grid/GridHelpers';

export enum CacheStatus {
  EMPTY = 'empty',
  COMPUTING = 'computing',
  READY = 'ready',
}

/**
 * Caches precomputed road distances from workplaces to all reachable cells.
 * Invalidated via observer pattern — call invalidate() when roads or buildings change.
 * Computation is done in a web worker; main thread only does O(1) lookups.
 *
 * ## Invalidation is not discarding, but it depends on what changed
 *
 * `status` says whether the table is **current**; `table` says whether there is a usable one.
 * Two different things.
 *
 * **A building change** — growth, an upgrade, a fire, abandonment — changes no road distance. It
 * changes only which cells count as workplaces, and the caller's own candidate set filters that.
 * Continuing with the old table only makes it slightly stale.
 *
 * **A road change** is different: after a road is demolished, a one-way direction is reversed or
 * a road type is upgraded, the old table calls unreachable workplaces reachable, assigning
 * citizens to shifts they cannot drive to, or excludes newly connected ones. That is not stale
 * but wrong, so `invalidateTopology()` discards the table and refuses a result computed midway,
 * which was computed against the old network.
 *
 * The reasoning is measured. On a 40k save, `runJobRelocation` runs about every 13 seconds while
 * `invalidate()`'s triggers — houses growing, upgrading, burning, being abandoned, roads changing
 * — happen constantly in a live city, leaving the cache READY for only 6-8 seconds. Falling in a
 * gap drops back to a synchronous Dijkstra at a **measured 2,684ms** against 161ms through the
 * cache, and where it falls is luck.
 *
 * One house upgrading does not change road distances. A table one round behind is a far smaller
 * error than freezing the main thread for 2.7 seconds.
 */
export class WorkplaceDistanceCache {
  private status: CacheStatus = CacheStatus.EMPTY;
  /** Set to true if invalidate() is called while status === CacheStatus.COMPUTING. */
  private invalidatedDuringBuild = false;
  /** The road network changed during the recompute, so that result is against the old network
   *  and cannot be accepted. */
  private topologyChangedDuringBuild = false;
  /** The per-cell CSR table. `null` means no computation has ever succeeded. */
  private table: WorkplaceDistanceTable | null = null;
  private client: WorkplaceDistanceClient | null = null;

  constructor(client?: WorkplaceDistanceClient) {
    this.client = client ?? null;
  }

  /**
   * A building changed: the table is no longer current but is still usable, because road
   * distances have not changed.
   */
  invalidate(): void {
    if (this.status === CacheStatus.COMPUTING) {
      this.invalidatedDuringBuild = true;
    } else {
      this.status = CacheStatus.EMPTY;
    }
  }

  /**
   * The **road network** changed: the table is now wrong and is discarded.
   *
   * A computation in flight is marked for rejection too, since it ran against the old network and
   * accepting it would install wrong reachability as fresh.
   */
  invalidateTopology(): void {
    this.table = null;
    this.topologyChangedDuringBuild = this.status === CacheStatus.COMPUTING;
    if (this.status !== CacheStatus.COMPUTING) this.status = CacheStatus.EMPTY;
  }

  /** Force full reset (e.g. on game load). */
  reset(): void {
    this.status = CacheStatus.EMPTY;
    this.table = null;
    this.invalidatedDuringBuild = false;
    this.topologyChangedDuringBuild = false;
  }

  /**
   * Trigger async recomputation if not already computing. Returns false if skipped.
   *
   * @param graphBuffer The serialised **transposed** RoadCellGraph (see `WDWorkerRequest`).
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
    // An empty graph means the city has no roads yet. Sending it returns an empty table, which
    // applyResult marks READY, and the whole city becomes mutually unreachable. Staying EMPTY and
    // falling back to the synchronous path is better.
    //
    // The header's nodeCount rather than byteLength: an empty graph's buffer is a 16-byte header
    // plus one offsets[0], a length of 20.
    if (graphBufferNodeCount(graphBuffer) === 0) return false;
    if (this.status === CacheStatus.COMPUTING) return false;
    this.status = CacheStatus.COMPUTING;
    this.invalidatedDuringBuild = false;

    this.client.compute(gridWidth, gridHeight, gridBuffer, graphBuffer, workplaces, maxBudget)
      .then(entries => this.applyResult(entries))
      .catch(() => this.onComputeFailed());
    return true;
  }

  /**
   * Worker error — reset to empty so next tick retries.
   *
   * **Both flags are cleared.** Leaving `topologyChangedDuringBuild` set makes `applyResult`
   * discard the next result, correctly computed against the **new** network, as one computed
   * against the old, and READY arrives only on the third request.
   */
  private onComputeFailed(): void {
    this.status = CacheStatus.EMPTY;
    this.invalidatedDuringBuild = false;
    this.topologyChangedDuringBuild = false;
  }

  /** Apply worker result — called internally from the promise callback. */
  private applyResult(buffers: WorkplaceDistanceBuffers): void {
    if (this.topologyChangedDuringBuild) {
      // Computed against the **old road network**. Accepting it installs wrong reachability as
      // fresh.
      this.topologyChangedDuringBuild = false;
      this.invalidatedDuringBuild = false;
      this.status = CacheStatus.EMPTY;
      return;
    }
    // A building change is **always accepted**: this result is not current, but it is still newer
    // than the one in hand, and discarding it means answering from an older one.
    this.table = new WorkplaceDistanceTable(buffers);
    if (this.invalidatedDuringBuild) {
      this.invalidatedDuringBuild = false;
      this.status = CacheStatus.EMPTY;   // the next round requests again
      return;
    }
    this.status = CacheStatus.READY;
  }

  /** For testing: synchronously populate the cache from a pre-built table. */
  populateSync(buffers: WorkplaceDistanceBuffers): void {
    this.table = new WorkplaceDistanceTable(buffers);
    this.status = CacheStatus.READY;
    this.invalidatedDuringBuild = false;
    this.topologyChangedDuringBuild = false;
  }

  /** O(1) lookup: road cost from home cell to workplace cell. */
  getDistance(homePos: string, workplacePos: string): number | undefined {
    const p = parsePosKey(homePos);
    if (!p || !this.table) return undefined;
    return this.table.costAt(p.x, p.y, workplacePos);
  }

  /** Get all reachable workplaces from a home position. */
  getReachableWorkplaces(homePos: string): Set<string> {
    const p = parsePosKey(homePos);
    if (!p || !this.table) return new Set();
    return this.table.reachableWorkplacesAt(p.x, p.y);
  }

  /** Build distance map from home to specified workplaces (replaces roadDistanceToTargets). */
  getDistancesFromHome(homePos: string, workplacePositions: Iterable<string>): Map<string, number> {
    const p = parsePosKey(homePos);
    if (!p || !this.table) return new Map();
    const targets = workplacePositions instanceof Set
      ? workplacePositions as ReadonlySet<string>
      : new Set(workplacePositions);
    return this.table.distancesAt(p.x, p.y, targets);
  }

  /** Whether the table is **current**. */
  get isReady(): boolean { return this.status === CacheStatus.READY; }
  /**
   * Whether there is a usable table, which may be stale.
   *
   * Almost every caller wants this rather than `isReady`: the synchronous fallback is expensive
   * enough to freeze the display, and a table one round behind beats freezing for 2.7 seconds.
   */
  get hasTable(): boolean { return this.table !== null; }
  get isStale(): boolean { return this.status === CacheStatus.EMPTY; }
  getStatus(): CacheStatus { return this.status; }
}
