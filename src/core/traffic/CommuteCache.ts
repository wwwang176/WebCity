import type { LaneEdge } from './LaneGraph';
import { collectEdgeCells } from './CommuteCacheHelpers';

export interface CachedRoute {
  citizenId: number;
  homeId: string;
  workplaceId: string;
  morningPath: LaneEdge[] | null;
  eveningPath: LaneEdge[] | null;
  status: 'pending' | 'ready' | 'failed';
  /** The road generation when this route was computed. */
  generation: number;
  /** Tick at which this route should be recalculated (set lazily on generation mismatch). */
  recalcAtTick?: number;
}

/**
 * Caches commute paths (LaneEdge[]) for citizens.
 * Supports cell-based invalidation so road changes only recalculate affected routes.
 */
/** Default spread window (ticks) for staggered recalculation after road changes. */
export const RECALC_SPREAD_TICKS = 10;

export class CommuteCache {
  private cache = new Map<number, CachedRoute>();
  private dirtySet = new Set<number>();

  // cellKey -> set of citizenIds whose paths pass through that cell
  private cellIndex = new Map<string, Set<number>>();

  // Shared route pool: routeKey -> LaneEdge[][] (lane path variants)
  private routeIndex = new Map<string, LaneEdge[][]>();

  /**
   * Commute routes computed in this road generation and **known to have no path**.
   *
   * "Not computed yet" and "computed, and there is no path" are different answers. Recording
   * only the first means the worker's empty array is discarded, the route's retry counter
   * climbs past its quota, and every subsequent sweep recomputes the same impossible route on
   * the main thread. Measured on a 41k save: 3,362 such routes and 9,838 wasted synchronous A*
   * runs, 0 of them successful (BUG-369).
   *
   * Same lifecycle as `routeIndex`, so it is cleared in the same place:
   * `findLanePathVariants` is deterministic for a given lane graph, so an unchanged network
   * yields no new answer, and `bumpGeneration()` invalidates both together.
   */
  private unroutable = new Set<string>();

  // cellKey -> set of routeKeys that pass through that cell
  private routeCellIndex = new Map<string, Set<string>>();

  // routeKey -> number of citizens currently using this route
  private routeRefCount = new Map<string, number>();

  /** Reusable Set for collectRouteCells — avoids per-call allocation. */
  private reusableCellSet = new Set<string>();

  /** Current road network generation — incremented on every road build/demolish. */
  roadGeneration = 0;

  /**
   * Increment road generation and retire the shared route pool so stale routes
   * are recalculated.
   *
   * routeRefCount is deliberately NOT cleared. The cached per-citizen routes
   * survive this call and still logically hold their references; zeroing the
   * map made each citizen's next set() run adjustRefCounts(old, -1) against it,
   * driving the counter negative, deleting the key, and then restoring it to
   * exactly 1 — so N citizens sharing a route collapsed to 1 permanently and
   * every downstream flow/density figure was undercounted (BUG-061).
   * Clearing routeIndex/routeCellIndex already achieves the retirement goal;
   * counts for routes absent from routeIndex are simply not iterated.
   */
  bumpGeneration(): void {
    this.roadGeneration++;
    this.routeIndex.clear();
    this.routeCellIndex.clear();
    this.unroutable.clear();
  }

  /** Whether this route was computed in this road generation and has no path. */
  markUnroutable(routeKey: string): void {
    this.unroutable.add(routeKey);
  }

  isUnroutable(routeKey: string): boolean {
    return this.unroutable.has(routeKey);
  }

  get(citizenId: number): CachedRoute | undefined {
    return this.cache.get(citizenId);
  }

  set(citizenId: number, route: CachedRoute): void {
    // Remove old cell index entries if replacing
    const old = this.cache.get(citizenId);
    if (old) {
      this.removeCellIndexEntries(citizenId, old);
      if (old.status === 'ready') {
        this.adjustRefCounts(old, -1);
      }
    }

    this.cache.set(citizenId, route);
    this.dirtySet.delete(citizenId);

    // Register cells in cellIndex when path is ready
    if (route.status === 'ready') {
      this.registerCellIndex(citizenId, route);
      this.adjustRefCounts(route, 1);
    }
  }

  markDirty(citizenId: number): void {
    this.dirtySet.add(citizenId);
  }

  isDirty(citizenId: number): boolean {
    return this.dirtySet.has(citizenId);
  }

  invalidateCell(cellKey: string): void {
    // 1. Mark citizens whose paths pass through this cell as dirty
    const citizenIds = this.cellIndex.get(cellKey);
    if (citizenIds) {
      for (const id of citizenIds) {
        this.dirtySet.add(id);
      }
    }

    // 2. Remove affected routes from shared pool
    // routeCellIndex maps cellKey → Set<routeKey>, so we can find which routes pass through this cell
    // Iterating Set directly is safe — we only modify routeIndex, not routeCellIndex.
    const routeKeys = this.routeCellIndex.get(cellKey);
    if (routeKeys) {
      for (const routeKey of routeKeys) {
        this.routeIndex.delete(routeKey);
      }
    }
  }

  getDirtyBatch(maxCount: number): number[] {
    const batch: number[] = [];
    for (const id of this.dirtySet) {
      if (batch.length >= maxCount) break;
      batch.push(id);
    }
    for (const id of batch) {
      this.dirtySet.delete(id);
    }
    return batch;
  }

  remove(citizenId: number): void {
    const route = this.cache.get(citizenId);
    if (route) {
      this.removeCellIndexEntries(citizenId, route);
      if (route.status === 'ready') {
        this.adjustRefCounts(route, -1);
      }
    }
    this.cache.delete(citizenId);
    this.dirtySet.delete(citizenId);
  }

  /** Get first variant for backward compatibility. */
  getByRoute(routeKey: string): LaneEdge[] | undefined {
    const variants = this.routeIndex.get(routeKey);
    return variants?.[0];
  }

  /** Get all lane path variants for a route. */
  getRouteVariants(routeKey: string): LaneEdge[][] | undefined {
    return this.routeIndex.get(routeKey);
  }

  /** Store lane path variants for a shared route. */
  setRouteVariants(routeKey: string, variants: LaneEdge[][]): void {
    this.routeIndex.set(routeKey, variants);

    // Build routeCellIndex from ALL variants (different variants may use different cells)
    if (variants.length > 0) {
      // Storing a real route clears any unroutable mark. Two records contradicting each other
      // is the hardest kind of breakage to trace, so one write point decides the answer.
      this.unroutable.delete(routeKey);
      const cells = this.reusableCellSet;
      cells.clear();
      for (const variant of variants) {
        collectEdgeCells(variant, cells);
      }
      for (const cellKey of cells) {
        let routeKeys = this.routeCellIndex.get(cellKey);
        if (!routeKeys) {
          routeKeys = new Set();
          this.routeCellIndex.set(cellKey, routeKeys);
        }
        routeKeys.add(routeKey);
      }
    }
  }

  /** Get citizen IDs whose commute paths pass through a given cell. */
  getCitizensByCell(cellKey: string): ReadonlySet<number> | undefined {
    return this.cellIndex.get(cellKey);
  }

  get size(): number {
    return this.cache.size;
  }

  get dirtyCount(): number {
    return this.dirtySet.size;
  }

  /**
   * Check if a cached route needs recalculation due to road network changes.
   * Returns true when the route's generation is outdated AND its randomly
   * assigned recalcAtTick has arrived. On first detection of staleness,
   * assigns a random recalcAtTick within RECALC_SPREAD_TICKS window.
   */
  isExpired(route: CachedRoute, currentTick: number): boolean {
    if (route.generation === this.roadGeneration) return false;
    // First time detecting staleness — assign a random recalculation tick
    if (route.recalcAtTick === undefined) {
      route.recalcAtTick = currentTick + Math.floor(Math.random() * RECALC_SPREAD_TICKS);
      return false;
    }
    return currentTick >= route.recalcAtTick;
  }

  // ── Internal ──

  /** Collect unique cells from a route's paths into the reusable Set (caller must not hold reference). */
  private collectRouteCells(route: CachedRoute): Set<string> {
    const cells = this.reusableCellSet;
    cells.clear();
    if (route.morningPath) collectEdgeCells(route.morningPath, cells);
    if (route.eveningPath) collectEdgeCells(route.eveningPath, cells);
    return cells;
  }

  private registerCellIndex(citizenId: number, route: CachedRoute): void {
    const cells = this.collectRouteCells(route);
    for (const cellKey of cells) {
      let set = this.cellIndex.get(cellKey);
      if (!set) {
        set = new Set();
        this.cellIndex.set(cellKey, set);
      }
      set.add(citizenId);
    }
  }

  private removeCellIndexEntries(citizenId: number, route: CachedRoute): void {
    const cells = this.collectRouteCells(route);
    for (const cellKey of cells) {
      const set = this.cellIndex.get(cellKey);
      if (set) {
        set.delete(citizenId);
        if (set.size === 0) {
          this.cellIndex.delete(cellKey);
        }
      }
    }
  }

  /** Adjust ref counts for a route's keys inline (no array allocation).
   *  delta = +1 for increment, -1 for decrement. */
  private adjustRefCounts(route: CachedRoute, delta: number): void {
    if (route.morningPath && route.morningPath.length > 0) {
      this.applyRefDelta(`${route.homeId}->${route.workplaceId}`, delta);
    }
    if (route.eveningPath && route.eveningPath.length > 0) {
      this.applyRefDelta(`${route.workplaceId}->${route.homeId}`, delta);
    }
  }

  private applyRefDelta(routeKey: string, delta: number): void {
    const count = (this.routeRefCount.get(routeKey) ?? 0) + delta;
    if (count <= 0) {
      this.routeRefCount.delete(routeKey);
    } else {
      this.routeRefCount.set(routeKey, count);
    }
  }

  /**
   * Iterate all cached routes with their reference counts.
   * Callback receives (path, refCount) for each variant in the shared pool.
   * RefCount is distributed evenly across variants.
   */
  forEachRouteWithRefCount(callback: (path: LaneEdge[], refCount: number) => void): void {
    for (const routeKey of this.routeIndex.keys()) {
      this.forRouteKey(routeKey, callback);
    }
  }

  /**
   * The keys of routes currently carrying riders, filled into the caller's array without
   * allocating.
   *
   * For callers sweeping across ticks: routes added or removed mid-sweep do not affect the list
   * in hand, and `forRouteKey` skips the ones that have gone.
   */
  routeKeysWithRiders(out: string[]): string[] {
    out.length = 0;
    for (const [routeKey, variants] of this.routeIndex) {
      if (variants.length > 0 && (this.routeRefCount.get(routeKey) ?? 0) > 0) out.push(routeKey);
    }
    return out;
  }

  /**
   * Each variant of this route and the number of riders assigned to it.
   *
   * The callback is not invoked when the route is gone — cleared by `invalidateCell`, or left
   * with no riders.
   */
  forRouteKey(routeKey: string, callback: (path: LaneEdge[], refCount: number) => void): void {
    const variants = this.routeIndex.get(routeKey);
    if (variants === undefined || variants.length === 0) return;
    const refCount = this.routeRefCount.get(routeKey) ?? 0;
    if (refCount <= 0) return;
    const perVariant = refCount / variants.length;
    for (const variant of variants) callback(variant, perVariant);
  }
}
