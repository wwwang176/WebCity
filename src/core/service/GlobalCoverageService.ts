/**
 * GlobalCoverageService — intermediate base for services that use
 * unlimited-range BFS (global road coverage) with weighted-random collection.
 *
 * Provides:
 * - Per-facility distance maps + merged min-distance map
 * - getCoverage / getCostRatio / getCoveredCellsWithCost / previewCoverage overrides
 * - collectPending(): weighted-random, budget-based collection from pending queue
 *
 * Subclasses: GarbageService, DeathCareService
 */

import { roadFlood, expandCoverageToBuildings, expandFootprint } from './RoadCoverageFlood';
import { RoadCoverageService, type Facility } from './RoadCoverageService';
import { toPosKey } from '../grid/GridHelpers';
import type { SizedGrid } from '../grid/GridHelpers';
import type { UnifiedRoadLookup } from '../road/UnifiedRoadLookup';

/** Minimal pending item: location + age. */
export interface PendingItem {
  x: number;
  y: number;
  waitTicks: number;
}

/** Facility that supports load-based collection. */
export interface LoadFacility extends Facility {
  capacity: number;
  currentLoad: number;
  todayReceived: number;
}

export abstract class GlobalCoverageService<F extends LoadFacility> extends RoadCoverageService<F> {
  /** Per-facility distance maps: facilityId → Map<posKey, roadCost> */
  protected facilityDistanceMaps = new Map<string, Map<string, number>>();
  /** Merged min-distance map across all facilities */
  protected mergedDistanceMap = new Map<string, number>();
  /** Injected road lookup for level-aware Dijkstra (DIP). */
  protected roadLookup: UnifiedRoadLookup | null = null;

  /** Set the road lookup for level-aware flood fill. Call after construction. */
  setRoadLookup(lookup: UnifiedRoadLookup): void {
    this.roadLookup = lookup;
  }

  // ── Coverage (global, per-facility BFS) ───────────────────────────

  override recalculateCoverage(grid: SizedGrid): void {
    this.updateConnectedFacilities(grid);
    this.recomputeDistanceMaps(grid);
  }

  protected recomputeDistanceMaps(grid: SizedGrid): void {
    this.facilityDistanceMaps.clear();
    this.mergedDistanceMap.clear();

    const active = this.operationalIds
      ? this.facilities.filter(f => this.operationalIds!.has(f.id))
      : this.facilities;

    for (const fac of active) {
      if (!this.connectedFacilityIds.has(fac.id)) continue;
      const positions = expandFootprint(fac.x, fac.y, this.defaultFacilityWidth, this.defaultFacilityHeight);
      const roadCov = roadFlood(grid, positions, Infinity, this.roadLookup);
      const fullCov = expandCoverageToBuildings(grid, roadCov);
      this.facilityDistanceMaps.set(fac.id, fullCov);

      for (const [key, cost] of fullCov) {
        const prev = this.mergedDistanceMap.get(key);
        if (prev === undefined || cost < prev) {
          this.mergedDistanceMap.set(key, cost);
        }
      }
    }
  }

  override getCoverage(x: number, y: number): boolean {
    return this.mergedDistanceMap.has(toPosKey(x, y));
  }

  override getCostRatio(x: number, y: number): number {
    const cost = this.mergedDistanceMap.get(toPosKey(x, y));
    if (cost === undefined) return -1;
    return Math.min(cost / this.coverageBudget, 1.0);
  }

  override getCoveredCellsWithCost(): ReadonlyMap<string, number> {
    return this.mergedDistanceMap;
  }

  override previewCoverage(
    position: { x: number; y: number },
    grid: SizedGrid,
    facilityWidth = this.defaultFacilityWidth,
    facilityHeight = this.defaultFacilityHeight,
  ): Map<string, number> {
    const positions = expandFootprint(position.x, position.y, facilityWidth, facilityHeight);
    const roadCov = roadFlood(grid, positions, Infinity, this.roadLookup);
    return expandCoverageToBuildings(grid, roadCov);
  }

  // ── Weighted-random collection ────────────────────────────────────

  /**
   * Collect pending items using weighted-random selection (closer = higher weight).
   * Each facility gets `collectionRate` budget per tick. Collected items are added
   * to the facility's `currentLoad` and `todayReceived`.
   *
   * Mutates `pending` in-place (removes collected items).
   */
  protected collectPending(pending: PendingItem[], collectionRate: number): void {
    if (pending.length === 0) return;

    // Track budget and room per facility
    const facState = new Map<string, { fac: F; budget: number; room: number }>();
    for (const fac of this.facilities) {
      if (!this.connectedFacilityIds.has(fac.id) || !this.isFacilityOperationalById(fac.id)) continue;
      const room = fac.capacity - fac.currentLoad;
      if (room <= 0) continue;
      facState.set(fac.id, { fac, budget: collectionRate, room });
    }
    if (facState.size === 0) return;

    // Group pending items by position with weight from nearest facility distance
    const positions = new Map<string, { x: number; y: number; count: number; weight: number }>();
    for (const item of pending) {
      const key = toPosKey(item.x, item.y);
      const entry = positions.get(key);
      if (entry) {
        entry.count++;
      } else {
        const cost = this.mergedDistanceMap.get(key);
        if (cost === undefined) continue;
        positions.set(key, { x: item.x, y: item.y, count: 1, weight: 1 / Math.max(1, cost) });
      }
    }
    if (positions.size === 0) return;

    // Total budget across all facilities
    let totalBudget = 0;
    for (const s of facState.values()) totalBudget += s.budget;

    const entries = [...positions.values()];
    while (totalBudget > 0 && entries.length > 0) {
      let totalWeight = 0;
      for (const e of entries) totalWeight += e.weight;
      if (totalWeight <= 0) break;

      // Weighted random: pick a position
      let roll = Math.random() * totalWeight;
      let picked = -1;
      for (let i = 0; i < entries.length; i++) {
        roll -= entries[i]!.weight;
        if (roll <= 0) { picked = i; break; }
      }
      if (picked === -1) picked = entries.length - 1;
      const pos = entries[picked]!;
      const posKey = toPosKey(pos.x, pos.y);

      // Find nearest facility with room + budget
      let bestId: string | null = null;
      let bestCost = Infinity;
      for (const [id, state] of facState) {
        if (state.budget <= 0 || state.room <= 0) continue;
        const distMap = this.facilityDistanceMaps.get(id);
        if (!distMap) continue;
        const cost = distMap.get(posKey);
        if (cost !== undefined && cost < bestCost) {
          bestCost = cost;
          bestId = id;
        }
      }

      if (!bestId) {
        entries.splice(picked, 1);
        continue;
      }

      const state = facState.get(bestId)!;
      const take = Math.min(pos.count, state.budget, state.room);

      let removed = 0;
      for (let i = pending.length - 1; i >= 0 && removed < take; i--) {
        if (pending[i]!.x === pos.x && pending[i]!.y === pos.y) {
          pending.splice(i, 1);
          removed++;
        }
      }

      state.fac.currentLoad += removed;
      state.fac.todayReceived += removed;
      state.budget -= removed;
      state.room -= removed;
      totalBudget -= removed;

      pos.count -= removed;
      if (pos.count <= 0) {
        entries.splice(picked, 1);
      }
    }
  }

  /** Remove distance map entry for a facility (call on removal). */
  protected removeDistanceMap(id: string): void {
    this.facilityDistanceMaps.delete(id);
  }
}
