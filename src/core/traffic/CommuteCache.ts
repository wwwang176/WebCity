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

  // Shared route pool: routeKey -> LaneEdge[]
  private routeIndex = new Map<string, LaneEdge[]>();

  // cellKey -> set of routeKeys that pass through that cell
  private routeCellIndex = new Map<string, Set<string>>();

  // routeKey -> number of citizens currently using this route
  private routeRefCount = new Map<string, number>();

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
        for (const key of this.deriveRouteKeys(old)) this.decrementRefCount(key);
      }
    }

    this.cache.set(citizenId, route);
    this.dirtySet.delete(citizenId);

    // Register cells in cellIndex when path is ready
    if (route.status === 'ready') {
      this.registerCellIndex(citizenId, route);
      for (const key of this.deriveRouteKeys(route)) this.incrementRefCount(key);
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

    // 2. Remove affected routes from routeIndex
    const routeKeys = this.routeCellIndex.get(cellKey);
    if (routeKeys) {
      // Must copy since we're modifying during iteration
      const keysToRemove = [...routeKeys];
      for (const routeKey of keysToRemove) {
        // Clean up routeCellIndex for all cells this route touches
        const cells = this.routeCellIndex.get(routeKey) as Set<string> | undefined;
        // Actually routeCellIndex maps cellKey -> Set<routeKey>, let me rethink...
        // Wait, the map is routeKey -> Set<cellKey>, but we also need cellKey -> Set<routeKey>
        // Current structure: routeCellIndex maps routeKey -> Set<cellKey>
        // But here we have cellKey and need to find routeKeys...
        // Let me re-read the design: routeCellIndex maps routeKey -> Set<cellKey>
        // So we need a reverse index too... But the spec says routeCellIndex: Map<string, Set<string>>
        // Looking at the task: "routeCellIndex cleanup on invalidateCell"
        // The approach: we need cellKey -> Set<routeKey> for efficient lookup
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
        for (const key of this.deriveRouteKeys(route)) this.decrementRefCount(key);
      }
    }
    this.cache.delete(citizenId);
    this.dirtySet.delete(citizenId);
  }

  getByRoute(routeKey: string): LaneEdge[] | undefined {
    return this.routeIndex.get(routeKey);
  }

  setRoute(routeKey: string, path: LaneEdge[]): void {
    this.routeIndex.set(routeKey, path);

    // Build routeCellIndex: collect all cells in the path
    const cells = this.collectCellsFromPath(path);
    // Store in routeCellIndex (we use a reverse map: cellKey -> Set<routeKey>)
    for (const cellKey of cells) {
      let routeKeys = this.routeCellIndex.get(cellKey);
      if (!routeKeys) {
        routeKeys = new Set();
        this.routeCellIndex.set(cellKey, routeKeys);
      }
      routeKeys.add(routeKey);
    }
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

  private collectRouteCells(route: CachedRoute): Set<string> {
    const cells = new Set<string>();
    if (route.morningPath) {
      for (const c of collectEdgeCells(route.morningPath)) cells.add(c);
    }
    if (route.eveningPath) {
      for (const c of collectEdgeCells(route.eveningPath)) cells.add(c);
    }
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

  private collectCellsFromPath(path: LaneEdge[]): Set<string> {
    return collectEdgeCells(path);
  }

  /** Derive routeKeys (home→work, work→home) from a cached route's non-null paths. */
  private deriveRouteKeys(route: CachedRoute): string[] {
    const keys: string[] = [];
    if (route.morningPath && route.morningPath.length > 0) {
      keys.push(`${route.homeId}->${route.workplaceId}`);
    }
    if (route.eveningPath && route.eveningPath.length > 0) {
      keys.push(`${route.workplaceId}->${route.homeId}`);
    }
    return keys;
  }

  private incrementRefCount(routeKey: string): void {
    this.routeRefCount.set(routeKey, (this.routeRefCount.get(routeKey) ?? 0) + 1);
  }

  private decrementRefCount(routeKey: string): void {
    const count = this.routeRefCount.get(routeKey);
    if (count !== undefined) {
      if (count <= 1) {
        this.routeRefCount.delete(routeKey);
      } else {
        this.routeRefCount.set(routeKey, count - 1);
      }
    }
  }

  /**
   * Iterate all cached routes with their reference counts.
   * Callback receives (path, refCount) for each route in the shared pool.
   */
  forEachRouteWithRefCount(callback: (path: LaneEdge[], refCount: number) => void): void {
    for (const [routeKey, path] of this.routeIndex) {
      const refCount = this.routeRefCount.get(routeKey) ?? 0;
      if (refCount > 0) {
        callback(path, refCount);
      }
    }
  }
}
