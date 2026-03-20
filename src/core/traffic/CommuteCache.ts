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

  // cellKey -> set of routeKeys that pass through that cell
  private routeCellIndex = new Map<string, Set<string>>();

  // routeKey -> number of citizens currently using this route
  private routeRefCount = new Map<string, number>();

  /** Reusable Set for collectRouteCells — avoids per-call allocation. */
  private reusableCellSet = new Set<string>();

  /** Current road network generation — incremented on every road build/demolish. */
  roadGeneration = 0;

  /** Increment road generation and clear shared route pool so stale routes are recalculated. */
  bumpGeneration(): void {
    this.roadGeneration++;
    this.routeIndex.clear();
    this.routeCellIndex.clear();
    this.routeRefCount.clear();
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

  /** @deprecated Use setRouteVariants instead. */
  setRoute(routeKey: string, path: LaneEdge[]): void {
    this.setRouteVariants(routeKey, [path]);
  }

  /** Store lane path variants for a shared route. */
  setRouteVariants(routeKey: string, variants: LaneEdge[][]): void {
    this.routeIndex.set(routeKey, variants);

    // Build routeCellIndex using first variant (all variants share the same cells)
    if (variants.length > 0) {
      const cells = collectEdgeCells(variants[0]!);
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
    for (const [routeKey, variants] of this.routeIndex) {
      const refCount = this.routeRefCount.get(routeKey) ?? 0;
      if (refCount > 0 && variants.length > 0) {
        const perVariant = refCount / variants.length;
        for (const variant of variants) {
          callback(variant, perVariant);
        }
      }
    }
  }
}
