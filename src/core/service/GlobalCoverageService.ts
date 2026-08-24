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
import { roadTileCost } from '../road/roadCost';
import { RoadType } from '../road/types';

/**
 * The weight a location gets from its road distance during weighted-random selection. Nearer is
 * heavier.
 *
 * The floor is **the cost of one four-lane tile**, making the area around a facility's door a
 * plateau of equal weight. Without a floor, cost 0 is infinite weight and the cell next door
 * never gets a vehicle.
 *
 * The floor must be on the same scale as `cost`, so it is expressed through `roadTileCost`
 * rather than as a literal. It was missed when costs became integers
 * (`core/road/roadCost.ts`): the old literal `1` happened to be one four-lane tile's cost under
 * the old scale, and after costs were multiplied by 18 that `1` clamped only cost 0, collapsing
 * the plateau and changing which locations bin lorries and hearses picked.
 */
export function distanceWeight(cost: number): number {
  return 1 / Math.max(roadTileCost(RoadType.FOUR_LANE), cost);
}

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

  /**
   * How many times the pending queue has been touched.
   *
   * Lets anything derived from the queue tell whether it is stale. Happiness needs a per-cell
   * count of pending items every tick, while the queue changes only on a service tick (one in
   * six), on a death at the day boundary, and when the player demolishes a building. Measured on
   * a 40k save: **24,547 pending refuse items across only 311 cells**, with five of every six
   * recounts producing an identical result, at 4.9% of the main thread.
   *
   * Only **monotonic increase** is guaranteed, not one increment per change: readers compare
   * against the previous value.
   *
   * A missed increment delays that table by a few ticks; it does not make it wrong. Each of the
   * three entry points — report, tick, clearPendingAt — has a test pinning it.
   */
  private pendingQueueVersion = 0;

  get pendingVersion(): number { return this.pendingQueueVersion; }

  /** Records that the pending queue was touched. */
  protected bumpPendingVersion(): void { this.pendingQueueVersion++; }

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

    const seedReach = this.roadReach;
    for (const fac of active) {
      if (!this.connectedFacilityIds.has(fac.id)) continue;
      const positions = expandFootprint(fac.x, fac.y, this.defaultFacilityWidth, this.defaultFacilityHeight);
      const roadCov = roadFlood(grid, positions, Infinity, this.roadLookup, seedReach);
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

  /**
   * Every facility covering this cell, nearest first.
   *
   * This class does not use the base's `RoadCoverageMap`, but it already keeps per-facility
   * distance maps: they are how hearses pick the nearest facility with room.
   */
  override getCoveringFacilityIds(x: number, y: number): { id: string; cost: number }[] {
    const key = toPosKey(x, y);
    const out: { id: string; cost: number }[] = [];
    for (const [id, distMap] of this.facilityDistanceMaps) {
      const cost = distMap.get(key);
      if (cost === undefined) continue;
      if (!this.facilities.some(f => f.id === id)) continue;
      out.push({ id, cost });
    }
    out.sort((a, b) => a.cost - b.cost);
    return out;
  }

  override previewCoverage(
    position: { x: number; y: number },
    grid: SizedGrid,
    facilityWidth = this.defaultFacilityWidth,
    facilityHeight = this.defaultFacilityHeight,
  ): Map<string, number> {
    const positions = expandFootprint(position.x, position.y, facilityWidth, facilityHeight);
    const roadCov = roadFlood(grid, positions, Infinity, this.roadLookup, this.roadReach);
    return expandCoverageToBuildings(grid, roadCov);
  }

  // ── Weighted-random collection ────────────────────────────────────

  /**
   * Facilities that actually work: road-connected AND powered/watered.
   *
   * getOperationalFacilities() from the base class only asks the second half.
   * collectPending and processFacilities require both, so any caller using the
   * looser test disagreed with what the service actually does — see
   * GarbageService.getPollutionSources.
   */
  getActiveFacilities(): F[] {
    return this.facilities.filter(
      f => this.connectedFacilityIds.has(f.id) && this.isFacilityOperationalById(f.id),
    );
  }

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

    // Group pending items by position with weight from nearest facility distance,
    // and bucket their INDICES in the same pass.
    //
    // Collection used to remove items with a full backwards scan of `pending`
    // per round: O(rounds x pending). With COLLECTION_RATE 140 across a few
    // landfills and DECOMPOSE_TICKS 600 letting the queue grow into the tens of
    // thousands when service is short, that is hundreds of millions of
    // comparisons on the main thread every service tick — precisely when the
    // city is already struggling. Buckets make removal O(take) (BUG-110).
    const positions = new Map<string, { x: number; y: number; count: number; weight: number }>();
    const indicesByPos = new Map<string, number[]>();
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]!;
      const key = toPosKey(item.x, item.y);
      const entry = positions.get(key);
      if (entry) {
        entry.count++;
        indicesByPos.get(key)!.push(i);
      } else {
        const cost = this.mergedDistanceMap.get(key);
        if (cost === undefined) continue;
        positions.set(key, { x: item.x, y: item.y, count: 1, weight: distanceWeight(cost) });
        indicesByPos.set(key, [i]);
      }
    }
    if (positions.size === 0) return;

    // Deferred removal: mark indices, compact once at the end. Splicing inside
    // the loop also invalidated every bucket index after the removal point.
    const collected = new Uint8Array(pending.length);

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

      const bucket = indicesByPos.get(posKey)!;
      let removed = 0;
      while (removed < take && bucket.length > 0) {
        collected[bucket.pop()!] = 1;
        removed++;
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

    // Single in-place compaction — `pending` is the caller's array.
    let write = 0;
    for (let read = 0; read < pending.length; read++) {
      if (!collected[read]) pending[write++] = pending[read]!;
    }
    pending.length = write;
  }

  /** Remove distance map entry for a facility (call on removal). */
  protected removeDistanceMap(id: string): void {
    this.facilityDistanceMaps.delete(id);
  }
}
