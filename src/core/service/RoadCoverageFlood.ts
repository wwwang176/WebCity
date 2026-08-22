/**
 * RoadCoverageFlood — Dijkstra flood fill along road network for civic service coverage.
 *
 * Level-aware: uses UnifiedRoadLookup to traverse both ground and elevated roads.
 * Elevated roads only relay through compatible neighbors (via ramps).
 *
 * Cost per road tile = BASE_COST / (speedLimit * laneFactor).
 * Faster/wider roads extend coverage further.
 */

import { RoadType } from '../road/types';
import { FOUR_NEIGHBORS, toPosKey, parsePosKeyUnsafe } from '../grid/GridHelpers';
import type { ReadableGrid, SizedGrid } from '../grid/GridHelpers';
import { ZONE_ROAD_REACH } from '../grid/constants';
import { GridCoverageArray, decodeCostRatio } from './GridCoverageArray';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';
import {
  buildRoadCellGraph, floodRoadCellGraph, seedNodesFor, attachAtSettledNode,
  type RoadCellGraph,
} from '../road/RoadCellGraph';

// 成本與預算的唯一來源在 `core/road/roadCost.ts`（worker 也引用同一份）。
// 這裡轉出去只是為了不動到既有的 import 路徑。
export { ROAD_COVERAGE } from '../road/roadCost';
import { roadTileCost } from '../road/roadCost';
export { roadTileCost };

// ── MinHeap (internal) ──────────────────────────────────────────────

interface HeapEntry { key: string; cost: number }

class MinHeap {
  private h: HeapEntry[] = [];

  push(key: string, cost: number): void {
    this.h.push({ key, cost });
    this.up(this.h.length - 1);
  }

  pop(): HeapEntry | undefined {
    if (this.h.length === 0) return undefined;
    const top = this.h[0]!;
    const last = this.h.pop()!;
    if (this.h.length > 0) {
      this.h[0] = last;
      this.down(0);
    }
    return top;
  }

  get size(): number { return this.h.length; }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[i]!.cost >= this.h[p]!.cost) break;
      [this.h[i], this.h[p]] = [this.h[p]!, this.h[i]!];
      i = p;
    }
  }

  private down(i: number): void {
    const n = this.h.length;
    while (true) {
      let m = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.h[l]!.cost < this.h[m]!.cost) m = l;
      if (r < n && this.h[r]!.cost < this.h[m]!.cost) m = r;
      if (m === i) break;
      [this.h[i], this.h[m]] = [this.h[m]!, this.h[i]!];
      i = m;
    }
  }
}

// ── Flood Fill ──────────────────────────────────────────────────────

/**
 * Level-aware Dijkstra flood fill along road tiles from given facility positions.
 * Adjacent road cells (at all compatible levels) are used as starting points (cost 0).
 * Returns Map<posKey, cost> of all reachable positions within budget.
 * When a position is reached at multiple levels, the lowest cost is kept.
 */
export function roadFlood(
  grid: ReadableGrid,
  facilityPositions: { x: number; y: number }[],
  budget: number,
  roadLookup?: UnifiedRoadLookup | null,
  /**
   * Chebyshev radius around each facility cell to scan for seed road tiles.
   * 1 = 4-neighbor orthogonal ring (default, matches utility/strict adjacency).
   * 2 = allows civic services sitting one empty tile back from a road to still
   * seed the flood from nearby road cells.
   */
  seedReach: number = 1,
): Map<string, number> {
  const rl = roadLookup ?? null;
  // Internal costs tracked by cell key (with level)
  const cellCosts = new Map<string, number>();
  // Output costs by position key (min cost across all levels)
  const posCosts = new Map<string, number>();
  const pq = new MinHeap();

  // Seed: find road cells at or within seedReach of each facility cell (all levels).
  for (const pos of facilityPositions) {
    const seedPositions: { x: number; y: number }[] = [];
    for (let dy = -seedReach; dy <= seedReach; dy++) {
      for (let dx = -seedReach; dx <= seedReach; dx++) {
        seedPositions.push({ x: pos.x + dx, y: pos.y + dy });
      }
    }
    for (const sp of seedPositions) {
      if (rl) {
        const keys = rl.getAllKeysAtPosition(sp.x, sp.y);
        for (const k of keys) {
          if (!cellCosts.has(k)) {
            cellCosts.set(k, 0);
            pq.push(k, 0);
            const pk = toPosKey(sp.x, sp.y);
            posCosts.set(pk, 0);
          }
        }
      } else {
        // Fallback: ground-only
        const cell = grid.getCell(sp.x, sp.y);
        if (cell && cell.roadType !== RoadType.NONE) {
          const k = toPosKey(sp.x, sp.y);
          if (!cellCosts.has(k)) {
            cellCosts.set(k, 0);
            pq.push(k, 0);
            posCosts.set(k, 0);
          }
        }
      }
    }
  }

  // Dijkstra expansion (ground only)
  while (pq.size > 0) {
    const cur = pq.pop()!;
    const best = cellCosts.get(cur.key);
    if (best !== undefined && best < cur.cost) continue; // stale

    const { x, y } = parsePosKeyUnsafe(cur.key);

    // Get compatible neighbors via UnifiedRoadLookup
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;

      const neighborKeys = rl
        ? rl.getCompatibleNeighborKeys(cur.key, nx, ny)
        : [];

      // Fallback: ground-only when no lookup
      if (!rl) {
        const cell = grid.getCell(nx, ny);
        if (cell && cell.roadType !== RoadType.NONE) {
          const nk = toPosKey(nx, ny);
          const newCost = cur.cost + roadTileCost(cell.roadType);
          if (newCost > budget) continue;
          const prev = cellCosts.get(nk);
          if (prev === undefined || newCost < prev) {
            cellCosts.set(nk, newCost);
            pq.push(nk, newCost);
            const prevPos = posCosts.get(nk);
            if (prevPos === undefined || newCost < prevPos) {
              posCosts.set(nk, newCost);
            }
          }
        }
        continue;
      }

      for (const nk of neighborKeys) {
        const roadInfo = rl.getCellByKey(nk);
        if (!roadInfo) continue;
        const newCost = cur.cost + roadTileCost(roadInfo.roadType);
        if (newCost > budget) continue;

        const prev = cellCosts.get(nk);
        if (prev === undefined || newCost < prev) {
          cellCosts.set(nk, newCost);
          pq.push(nk, newCost);

          // Update position-level cost (min across all levels)
          const pk = toPosKey(nx, ny);
          const prevPos = posCosts.get(pk);
          if (prevPos === undefined || newCost < prevPos) {
            posCosts.set(pk, newCost);
          }
        }
      }
    }
  }

  return posCosts;
}

/**
 * Expand road coverage to include non-road cells within Chebyshev distance
 * `reach` of any covered road cell. This makes buildings near covered roads
 * also "covered", with each building inheriting the minimum cost among all
 * in-range road cells (so the nearest/cheapest station wins).
 *
 * reach defaults to ZONE_ROAD_REACH (=2) so buildings in the one-tile inner
 * ring — allowed by zone placement — are actually reachable by service coverage
 * and citizen commute pathfinding. Passing 1 recovers the legacy 4-neighbor
 * behaviour for edge cases / tests.
 */
export function expandCoverageToBuildings(
  grid: ReadableGrid,
  roadCoverage: Map<string, number>,
  reach: number = ZONE_ROAD_REACH,
): Map<string, number> {
  const result = new Map(roadCoverage);

  for (const [key, cost] of roadCoverage) {
    const { x, y } = parsePosKeyUnsafe(key);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        if (cell.roadType !== RoadType.NONE) continue; // skip other road cells
        const nk = toPosKey(nx, ny);
        const existing = result.get(nk);
        if (existing === undefined || cost < existing) {
          result.set(nk, cost);
        }
      }
    }
  }

  return result;
}

// ── RoadCoverageMap (cached, multi-facility) ────────────────────────

/**
 * RoadCoverageMap — precomputed road-distance coverage for civic services.
 * Internal storage uses GridCoverageArray (Uint8Array) for O(1) queries with zero GC.
 */
export class RoadCoverageMap {
  private main: GridCoverageArray | null = null;
  private previewArr: GridCoverageArray | null = null;
  private lastBudget = 0;
  /** Injected road lookup for level-aware Dijkstra (DIP). */
  private roadLookup: UnifiedRoadLookup | null = null;

  setRoadLookup(lookup: UnifiedRoadLookup): void {
    this.roadLookup = lookup;
  }

  /** Ensure arrays are allocated for the given grid dimensions. */
  private ensureArrays(width: number, height: number): void {
    if (!this.main || this.main.width !== width || this.main.height !== height) {
      this.main = new GridCoverageArray(width, height);
      this.previewArr = new GridCoverageArray(width, height);
    }
  }

  /**
   * Chebyshev seed reach around each facility cell when looking for road tiles
   * to start the coverage flood from. Civic services with roadReach=2 set this
   * to 2 so facilities placed one empty tile back from a road still seed the flood.
   */
  private seedReach = 1;

  setSeedReach(reach: number): void {
    this.seedReach = reach;
  }

  /** Recalculate coverage from all facilities. Call when facilities or roads change.
   *  @param getSize Optional per-facility size resolver (for rotation-aware footprints).
   */
  recalculate(
    facilities: readonly { x: number; y: number }[],
    grid: SizedGrid,
    budget: number,
    facilityWidth = 1,
    facilityHeight = 1,
    getSize?: (f: { x: number; y: number }) => { w: number; h: number },
  ): void {
    this.ensureArrays(grid.width, grid.height);
    this.main!.clear();
    this.lastBudget = budget;

    // 索引一起帶下去 —— 每一格記得住是被哪一座用最低成本涵蓋的（BUG-362）。
    for (let i = 0; i < facilities.length; i++) {
      const f = facilities[i]!;
      const size = getSize ? getSize(f) : { w: facilityWidth, h: facilityHeight };
      const positions = expandFootprint(f.x, f.y, size.w, size.h);
      const roadCov = roadFlood(grid, positions, budget, this.roadLookup, this.seedReach);
      const fullCov = expandCoverageToBuildings(grid, roadCov);
      this.main!.applyFlood(fullCov, budget, i);
    }
  }

  /** Compute coverage preview for a single position (drag preview), without existing coverage. */
  preview(
    position: { x: number; y: number },
    grid: ReadableGrid,
    budget: number,
    facilityWidth = 1,
    facilityHeight = 1,
  ): Map<string, number> {
    const positions = expandFootprint(position.x, position.y, facilityWidth, facilityHeight);
    const roadCov = roadFlood(grid, positions, budget, this.roadLookup, this.seedReach);
    return expandCoverageToBuildings(grid, roadCov);
  }

  /** Compute coverage preview merged with existing coverage (min cost per cell). */
  previewMerged(
    position: { x: number; y: number },
    grid: ReadableGrid,
    budget: number,
    facilityWidth = 1,
    facilityHeight = 1,
  ): Map<string, number> {
    const newCov = this.preview(position, grid, budget, facilityWidth, facilityHeight);
    // Merge existing coverage from array: reconstruct cost per covered cell
    if (this.main) {
      this.main.forEachCovered((x, y, ratio) => {
        const key = toPosKey(x, y);
        const cost = ratio * this.lastBudget;
        const prev = newCov.get(key);
        if (prev === undefined || cost < prev) {
          newCov.set(key, cost);
        }
      });
    }
    return newCov;
  }

  /** Update the reusable preview array (no Map allocation). */
  updatePreview(
    position: { x: number; y: number },
    grid: SizedGrid,
    budget: number,
    facilityWidth = 1,
    facilityHeight = 1,
  ): void {
    this.ensureArrays(grid.width, grid.height);
    const positions = expandFootprint(position.x, position.y, facilityWidth, facilityHeight);
    const roadCov = roadFlood(grid, positions, budget, this.roadLookup, this.seedReach);
    const fullCov = expandCoverageToBuildings(grid, roadCov);
    this.previewArr!.applyMerged(fullCov, this.main!, budget);
  }

  hasCoverage(x: number, y: number): boolean {
    return this.main?.hasCoverage(x, y) ?? false;
  }

  /** Cost ratio: 0.0 (nearest) to 1.0 (farthest). Returns -1 if uncovered. */
  getCostRatio(x: number, y: number): number {
    if (!this.main) return -1;
    const raw = this.main.getRaw(x, y);
    if (raw === 0) return -1;
    return decodeCostRatio(raw);
  }

  getCost(x: number, y: number): number {
    if (!this.main) return Infinity;
    const raw = this.main.getRaw(x, y);
    if (raw === 0) return Infinity;
    return decodeCostRatio(raw) * this.lastBudget;
  }

  getCoverageCount(x: number, y: number): number {
    return this.main?.getCoverageCount(x, y) ?? 0;
  }

  /**
   * 用最低成本涵蓋這一格的設施，是上一次 `recalculate()` 收到的清單裡的第幾個。
   * `-1` = 沒有人涵蓋。
   */
  getOwnerIndex(x: number, y: number): number {
    return this.main?.getOwner(x, y) ?? -1;
  }

  /** Backward-compatible: build Map from array. Prefer forEachCovered() for new code. */
  getCoveredCells(): ReadonlyMap<string, number> {
    const map = new Map<string, number>();
    if (!this.main) return map;
    const budget = this.lastBudget;
    this.main.forEachCovered((x, y, ratio) => {
      map.set(toPosKey(x, y), ratio * budget);
    });
    return map;
  }

  /** Efficient iteration over all covered cells with cost ratio. */
  forEachCovered(callback: (x: number, y: number, costRatio: number) => void): void {
    this.main?.forEachCovered(callback);
  }

  /** Efficient iteration over preview covered cells with cost ratio. */
  forEachPreviewCovered(callback: (x: number, y: number, costRatio: number) => void): void {
    this.previewArr?.forEachCovered(callback);
  }

  /** Check if preview covers a cell. */
  hasPreviewCoverage(x: number, y: number): boolean {
    return this.previewArr?.hasCoverage(x, y) ?? false;
  }

  /** Get preview cost ratio (0.0–1.0) for a cell. */
  getPreviewCostRatio(x: number, y: number): number {
    return this.previewArr?.getCostRatio(x, y) ?? 0;
  }
}

/**
 * 家 → 一組目標的道路距離，**只看地面**。
 *
 * 給只有 `ReadableGrid` 的呼叫端 —— 那個介面只有 `getCell`（`GridHelpers.ts`），
 * 沒有 width/height/forEachCell，建不出 `UnifiedRoadLookup`，也就建不出
 * `RoadCellGraph`。全 repo 有十幾個這樣的呼叫端，所以這不是遷移殘骸，
 * 是這個 API 的另一半契約。
 *
 * 有 lookup 時請用 `roadDistanceToTargets` —— 它走圖，而且是樓層感知的。
 * 兩者在沒有高架的世界裡必須逐格相等，由 `RoadDistanceParity.test.ts` 持續守著。
 *
 * 目標（建築）不一定在路格上 —— 當某個展開到的路格與目標的 Chebyshev 距離
 * ≤ ZONE_ROAD_REACH (=2) 時才被發現。這與 zone 放置的 reach 一致。
 *
 * 找齊目標或超過 maxBudget 就停。
 */
export function roadDistanceToTargetsOnGrid(
  grid: ReadableGrid,
  home: { x: number; y: number },
  targets: Set<string>,
  maxBudget: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (targets.size === 0) return result;

  // Internal costs tracked by cell key (with level)
  const cellCosts = new Map<string, number>();
  const pq = new MinHeap();
  let foundCount = 0;

  // Helper: check Chebyshev(ZONE_ROAD_REACH) neighbors of a road cell for
  // target buildings (picks up both directly-adjacent and inner-ring targets).
  const checkNeighborsForTargets = (x: number, y: number, cost: number): void => {
    for (let dy = -ZONE_ROAD_REACH; dy <= ZONE_ROAD_REACH; dy++) {
      for (let dx = -ZONE_ROAD_REACH; dx <= ZONE_ROAD_REACH; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const nk = toPosKey(nx, ny);
        if (targets.has(nk) && !result.has(nk)) {
          result.set(nk, cost);
          foundCount++;
        }
      }
    }
  };

  // Seed: home itself + every cell within Chebyshev(ZONE_ROAD_REACH) of home.
  // A home in the inner ring sits up to ZONE_ROAD_REACH tiles away from a road,
  // so we must scan that far to find the seed road cells.
  const seedPositions: { x: number; y: number }[] = [];
  for (let dy = -ZONE_ROAD_REACH; dy <= ZONE_ROAD_REACH; dy++) {
    for (let dx = -ZONE_ROAD_REACH; dx <= ZONE_ROAD_REACH; dx++) {
      seedPositions.push({ x: home.x + dx, y: home.y + dy });
    }
  }

  for (const sp of seedPositions) {
    const cell = grid.getCell(sp.x, sp.y);
    if (cell && cell.roadType !== RoadType.NONE) {
      const k = toPosKey(sp.x, sp.y);
      if (!cellCosts.has(k)) {
        cellCosts.set(k, 0);
        pq.push(k, 0);
      }
    }
  }

  // Check seeds for adjacent targets
  for (const [key] of cellCosts) {
    const { x, y } = parsePosKeyUnsafe(key);
    const pk = toPosKey(x, y);
    checkNeighborsForTargets(x, y, 0);
    // Also check if the road cell itself is a target
    if (targets.has(pk) && !result.has(pk)) {
      result.set(pk, 0);
      foundCount++;
    }
  }
  if (foundCount >= targets.size) return result;

  // Dijkstra expansion (ground only)
  while (pq.size > 0) {
    const cur = pq.pop()!;
    const best = cellCosts.get(cur.key);
    if (best !== undefined && best < cur.cost) continue; // stale

    const { x, y } = parsePosKeyUnsafe(cur.key);

    // Targets are recorded when their road cell is SETTLED (popped), not when
    // it is relaxed. Tentative relax-time costs meant whichever road cell
    // happened to touch a target first won permanently, and road tiers differ by
    // up to 6.7x (RURAL 60 vs HIGHWAY 9) — a rural lane at the door beat a
    // motorway two cells away, and JobRelocation scored the commute on the wrong
    // figure. Popping in increasing-cost order makes the first settled road cell
    // adjacent to a target the cheapest one, so this is both correct and still
    // compatible with the early exit (BUG-102). Reachability was never affected:
    // an over-priced target was still in the map.
    const curPk = toPosKey(x, y);
    if (targets.has(curPk) && !result.has(curPk)) {
      result.set(curPk, cur.cost);
      foundCount++;
    }
    checkNeighborsForTargets(x, y, cur.cost);
    if (foundCount >= targets.size) return result;

    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      const cell = grid.getCell(nx, ny);
      if (!cell || cell.roadType === RoadType.NONE) continue;
      const nk = toPosKey(nx, ny);
      const newCost = cur.cost + roadTileCost(cell.roadType);
      if (newCost > maxBudget) continue;
      const prev = cellCosts.get(nk);
      if (prev === undefined || newCost < prev) {
        cellCosts.set(nk, newCost);
        pq.push(nk, newCost);
      }
    }
  }

  return result;
}

/** Expand a facility's top-left (x, y) into all occupied cell positions. */
export function expandFootprint(
  x: number, y: number, width: number, height: number,
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      positions.push({ x: x + dx, y: y + dy });
    }
  }
  return positions;
}

/**
 * 家 → 一組目標的道路距離。
 *
 * 走 `RoadCellGraph`，與 workplace-distance worker **同一個 flood 核心** ——
 * 兩條路不可能給出不同的決策（BUG-109 的成因正是它們是兩份實作）。
 *
 * `graph` 傳進來時直接用。**應該要傳** —— 這個函式每個市民呼叫一次
 * （`JobRelocation` 的換工作迴圈），而建圖是 O(路格數 × 4)；圖只在路網改變時
 * 才變，由呼叫端（`SimulationLoop`，以 `commuteCache.roadGeneration` 為鍵）
 * 持有才不會被乘上市民數。不傳時自己建一張，正確但慢。
 *
 * 沒有 `roadLookup` 就沒有樓層資訊，退回只看地面的
 * `roadDistanceToTargetsOnGrid` —— `ReadableGrid` 只有 `getCell`，建不出 lookup。
 *
 * 找齊目標就提早結束。少了它同步路徑會永遠跑滿預算。
 */
export function roadDistanceToTargets(
  grid: ReadableGrid,
  home: { x: number; y: number },
  targets: Set<string>,
  maxBudget: number,
  roadLookup?: UnifiedRoadLookup | null,
  graph?: RoadCellGraph,
): Map<string, number> {
  if (!roadLookup) return roadDistanceToTargetsOnGrid(grid, home, targets, maxBudget);

  const result = new Map<string, number>();
  if (targets.size === 0) return result;

  const g = graph ?? buildRoadCellGraph(roadLookup);
  const seeds = seedNodesFor(g, home.x, home.y, ZONE_ROAD_REACH);
  if (seeds.length === 0) return result;

  floodRoadCellGraph(g, seeds, maxBudget, (node, cost) => {
    attachAtSettledNode(g, node, cost, ZONE_ROAD_REACH,
      (x, y) => targets.has(toPosKey(x, y)), result);
    return result.size >= targets.size;   // 找齊就停
  });
  return result;
}
