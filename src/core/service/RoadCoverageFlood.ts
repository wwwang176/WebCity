/**
 * RoadCoverageFlood — Dijkstra flood fill along road network for civic service coverage.
 *
 * Level-aware: uses UnifiedRoadLookup to traverse both ground and elevated roads.
 * Elevated roads only relay through compatible neighbors (via ramps).
 *
 * Cost per road tile = BASE_COST / (speedLimit * laneFactor).
 * Faster/wider roads extend coverage further.
 */

import { ROAD_CONFIGS, RoadType } from '../road/types';
import { FOUR_NEIGHBORS, toPosKey, parsePosKeyUnsafe } from '../grid/GridHelpers';
import type { ReadableGrid, SizedGrid } from '../grid/GridHelpers';
import { GridCoverageArray, decodeCostRatio } from './GridCoverageArray';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';

/** Module-level UnifiedRoadLookup reference for road coverage flood. */
let _roadLookup: UnifiedRoadLookup | null = null;

/** Set the shared UnifiedRoadLookup for road coverage flood. */
export function setRoadCoverageRoadLookup(lookup: UnifiedRoadLookup): void {
  _roadLookup = lookup;
}

/** Service coverage budget constants */
export const ROAD_COVERAGE = {
  BASE_COST: 100,
  GARBAGE_BUDGET: 80,
  POLICE_BUDGET: 30,
  FIRE_BUDGET: 30,
  HEALTH_BUDGET: 40,
  DEATHCARE_BUDGET: 35,
  EDUCATION_ELEMENTARY_BUDGET: 20,
  EDUCATION_HIGHSCHOOL_BUDGET: 30,
  EDUCATION_UNIVERSITY_BUDGET: 45,
} as const;

/** Calculate traversal cost of a single road tile based on its type. */
export function roadTileCost(roadType: number): number {
  const config = ROAD_CONFIGS[roadType as RoadType];
  if (!config || config.speedLimit === 0) return Infinity;
  const laneFactor = config.lanes / 2; // 2-lane = 1×
  return ROAD_COVERAGE.BASE_COST / (config.speedLimit * laneFactor);
}

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
): Map<string, number> {
  // Internal costs tracked by cell key (with level)
  const cellCosts = new Map<string, number>();
  // Output costs by position key (min cost across all levels)
  const posCosts = new Map<string, number>();
  const pq = new MinHeap();

  // Seed: find road cells at or adjacent to each facility cell (all levels)
  for (const pos of facilityPositions) {
    const seedPositions = [{ x: pos.x, y: pos.y }];
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      seedPositions.push({ x: pos.x + dx!, y: pos.y + dy! });
    }
    for (const sp of seedPositions) {
      if (_roadLookup) {
        const keys = _roadLookup.getAllKeysAtPosition(sp.x, sp.y);
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

  // Dijkstra expansion (level-aware)
  while (pq.size > 0) {
    const cur = pq.pop()!;
    const best = cellCosts.get(cur.key);
    if (best !== undefined && best < cur.cost) continue; // stale

    const { x, y } = parsePosKeyUnsafe(cur.key);

    // Get compatible neighbors via UnifiedRoadLookup
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;

      const neighborKeys = _roadLookup
        ? _roadLookup.getCompatibleNeighborKeys(cur.key, nx, ny)
        : [];

      // Fallback: ground-only when no lookup
      if (!_roadLookup) {
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
        const roadInfo = _roadLookup.getCellByKey(nk);
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
 * Expand road coverage to include non-road cells adjacent to covered road cells.
 * This makes buildings next to covered roads also "covered".
 */
export function expandCoverageToBuildings(
  grid: ReadableGrid,
  roadCoverage: Map<string, number>,
): Map<string, number> {
  const result = new Map(roadCoverage);

  for (const [key, cost] of roadCoverage) {
    const { x, y } = parsePosKeyUnsafe(key);
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;
      if (cell.roadType !== RoadType.NONE) continue; // already a road cell
      const nk = toPosKey(nx, ny);
      const existing = result.get(nk);
      if (existing === undefined || cost < existing) {
        result.set(nk, cost);
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

  /** Ensure arrays are allocated for the given grid dimensions. */
  private ensureArrays(width: number, height: number): void {
    if (!this.main || this.main.width !== width || this.main.height !== height) {
      this.main = new GridCoverageArray(width, height);
      this.previewArr = new GridCoverageArray(width, height);
    }
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

    for (const f of facilities) {
      const size = getSize ? getSize(f) : { w: facilityWidth, h: facilityHeight };
      const positions = expandFootprint(f.x, f.y, size.w, size.h);
      const roadCov = roadFlood(grid, positions, budget);
      const fullCov = expandCoverageToBuildings(grid, roadCov);
      this.main!.applyFlood(fullCov, budget);
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
    const roadCov = roadFlood(grid, positions, budget);
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
    const roadCov = roadFlood(grid, positions, budget);
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
 * Single-source Dijkstra from home along the road network.
 * Level-aware: uses UnifiedRoadLookup for compatible neighbor discovery.
 * Returns the road cost to reach each target position.
 * Targets (buildings) may not be on road cells — they are discovered
 * when a Dijkstra-expanded road cell has a target as a 4-neighbor.
 * Stops when all targets are found or maxBudget is exceeded.
 */
export function roadDistanceToTargets(
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

  // Helper: check 4-neighbors of a road cell for targets (by position)
  const checkNeighborsForTargets = (x: number, y: number, cost: number): void => {
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      const nk = toPosKey(nx, ny);
      if (targets.has(nk) && !result.has(nk)) {
        result.set(nk, cost);
        foundCount++;
      }
    }
  };

  // Seed: home itself + adjacent road cells (cost 0, all levels)
  const seedPositions = [{ x: home.x, y: home.y }];
  for (const [dx, dy] of FOUR_NEIGHBORS) {
    seedPositions.push({ x: home.x + dx!, y: home.y + dy! });
  }

  for (const sp of seedPositions) {
    if (_roadLookup) {
      const keys = _roadLookup.getAllKeysAtPosition(sp.x, sp.y);
      for (const k of keys) {
        if (!cellCosts.has(k)) {
          cellCosts.set(k, 0);
          pq.push(k, 0);
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
        }
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

  // Dijkstra expansion (level-aware)
  while (pq.size > 0) {
    const cur = pq.pop()!;
    const best = cellCosts.get(cur.key);
    if (best !== undefined && best < cur.cost) continue; // stale

    const { x, y } = parsePosKeyUnsafe(cur.key);

    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;

      const neighborKeys = _roadLookup
        ? _roadLookup.getCompatibleNeighborKeys(cur.key, nx, ny)
        : [];

      // Fallback: ground-only
      if (!_roadLookup) {
        const cell = grid.getCell(nx, ny);
        if (!cell || cell.roadType === RoadType.NONE) continue;
        const nk = toPosKey(nx, ny);
        const newCost = cur.cost + roadTileCost(cell.roadType);
        if (newCost > maxBudget) continue;
        const prev = cellCosts.get(nk);
        if (prev === undefined || newCost < prev) {
          cellCosts.set(nk, newCost);
          pq.push(nk, newCost);
          if (targets.has(nk) && !result.has(nk)) {
            result.set(nk, newCost);
            foundCount++;
            if (foundCount >= targets.size) return result;
          }
          checkNeighborsForTargets(nx, ny, newCost);
          if (foundCount >= targets.size) return result;
        }
        continue;
      }

      for (const nk of neighborKeys) {
        const roadInfo = _roadLookup.getCellByKey(nk);
        if (!roadInfo) continue;
        const newCost = cur.cost + roadTileCost(roadInfo.roadType);
        if (newCost > maxBudget) continue;

        const prev = cellCosts.get(nk);
        if (prev === undefined || newCost < prev) {
          cellCosts.set(nk, newCost);
          pq.push(nk, newCost);

          // Check position-level targets
          const pk = toPosKey(nx, ny);
          if (targets.has(pk) && !result.has(pk)) {
            result.set(pk, newCost);
            foundCount++;
            if (foundCount >= targets.size) return result;
          }

          // Check 4-neighbors for non-road targets
          checkNeighborsForTargets(nx, ny, newCost);
          if (foundCount >= targets.size) return result;
        }
      }
    }
  }

  return result;
}

/** Expand a facility's top-left (x, y) into all occupied cell positions. */
function expandFootprint(
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
