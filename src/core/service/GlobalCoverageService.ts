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
 * 加權隨機挑選時，一個地點依道路距離得到的權重。越近權重越高。
 *
 * 下限是**一格四線道的成本**，讓設施門口附近成為一塊等權重的平台 ——
 * 沒有下限的話成本 0 會是無限大權重，隔壁那格就永遠搶不到車。
 *
 * 下限必須與 `cost` 同尺度，所以用 `roadTileCost` 表達而不是寫死數字。
 * 成本整數化（`core/road/roadCost.ts`）時這裡漏掉了：舊制寫死的 `1` 恰好
 * 就是舊制一格四線道的成本，成本 ×18 之後那個 `1` 變成只夾得住成本 0，
 * 平台塌掉，垃圾車與靈車的挑選分布跟著變。
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
   * 待處理佇列被動過幾次。
   *
   * 給「從佇列導出來的東西」判斷自己過期了沒。快樂度每個 tick 都要一張「哪一格
   * 有幾筆待處理」的表，而佇列只在服務 tick（每 6 個）、跨日的死亡、以及玩家拆
   * 房子的時候會動。4 萬人的存檔實測:**24 547 筆待收垃圾只落在 311 個格子上**，
   * 六個 tick 裡有五個重數出來的結果一模一樣，而那一支佔掉主執行緒的 4.9%。
   *
   * 只保證**單調遞增**,不保證每次變動只加一 —— 讀的人只比對「跟上次一不一樣」。
   *
   * 漏掉一次遞增的後果是那張表晚幾個 tick 才更新，不是算錯。三個入口
   * （report / tick / clearPendingAt）各有一條測試釘著。
   */
  private pendingQueueVersion = 0;

  get pendingVersion(): number { return this.pendingQueueVersion; }

  /** 動過待處理佇列。 */
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
   * 涵蓋得到這一格的每一座，由近到遠。
   *
   * 這個類別不走基底的 `RoadCoverageMap`，但它本來就留著逐設施的距離圖 ——
   * 靈車就是靠它挑「還有空位的裡面最近的那一座」。
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
   * Collect pending items using weighted-random selection (closer = higher weight).
   * Each facility gets `collectionRate` budget per tick. Collected items are added
   * to the facility's `currentLoad` and `todayReceived`.
   *
   * Mutates `pending` in-place (removes collected items).
   */
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
