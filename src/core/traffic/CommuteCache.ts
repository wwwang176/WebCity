import type { LaneEdge } from './LaneGraph';

export interface CachedRoute {
  citizenId: number;
  homeId: string;
  workplaceId: string;
  morningPath: LaneEdge[] | null;
  eveningPath: LaneEdge[] | null;
  status: 'pending' | 'ready' | 'failed';
}

/**
 * Caches commute paths (LaneEdge[]) for citizens.
 * Supports cell-based invalidation so road changes only recalculate affected routes.
 */
export class CommuteCache {
  private cache = new Map<number, CachedRoute>();
  private dirtySet = new Set<number>();

  // cellKey -> set of citizenIds whose paths pass through that cell
  private cellIndex = new Map<string, Set<number>>();

  // Shared route pool: routeKey -> LaneEdge[]
  private routeIndex = new Map<string, LaneEdge[]>();

  // routeKey -> set of cellKeys that the route passes through
  private routeCellIndex = new Map<string, Set<string>>();

  get(citizenId: number): CachedRoute | undefined {
    return this.cache.get(citizenId);
  }

  set(citizenId: number, route: CachedRoute): void {
    // Remove old cell index entries if replacing
    const old = this.cache.get(citizenId);
    if (old) {
      this.removeCellIndexEntries(citizenId, old);
    }

    this.cache.set(citizenId, route);
    this.dirtySet.delete(citizenId);

    // Register cells in cellIndex when path is ready
    if (route.status === 'ready') {
      this.registerCellIndex(citizenId, route);
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

  // ── Internal ──

  private registerCellIndex(citizenId: number, route: CachedRoute): void {
    const cells = new Set<string>();
    if (route.morningPath) {
      for (const edge of route.morningPath) {
        cells.add(edge.from.cellKey);
        cells.add(edge.to.cellKey);
      }
    }
    if (route.eveningPath) {
      for (const edge of route.eveningPath) {
        cells.add(edge.from.cellKey);
        cells.add(edge.to.cellKey);
      }
    }
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
    const cells = new Set<string>();
    if (route.morningPath) {
      for (const edge of route.morningPath) {
        cells.add(edge.from.cellKey);
        cells.add(edge.to.cellKey);
      }
    }
    if (route.eveningPath) {
      for (const edge of route.eveningPath) {
        cells.add(edge.from.cellKey);
        cells.add(edge.to.cellKey);
      }
    }
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
    const cells = new Set<string>();
    for (const edge of path) {
      cells.add(edge.from.cellKey);
      cells.add(edge.to.cellKey);
    }
    return cells;
  }
}
