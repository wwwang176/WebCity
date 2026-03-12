/**
 * RoadCoverageFlood — Dijkstra flood fill along road network for civic service coverage.
 *
 * Replaces radius-based coverage with road-distance-based coverage.
 * Cost per road tile = BASE_COST / (speedLimit * laneFactor).
 * Faster/wider roads extend coverage further.
 */

import { ROAD_CONFIGS, RoadType } from '../road/types';
import { FOUR_NEIGHBORS, toPosKey, parsePosKeyUnsafe } from '../grid/GridHelpers';
import type { ReadableGrid } from '../grid/GridHelpers';

/** Service coverage budget constants */
export const ROAD_COVERAGE = {
  BASE_COST: 100,
  GARBAGE_BUDGET: 30,
  POLICE_BUDGET: 30,
  FIRE_BUDGET: 30,
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
 * Dijkstra flood fill along road tiles from given facility cell positions.
 * Adjacent road cells of the positions are used as starting points (cost 0).
 * Returns Map<posKey, cost> of all reachable road cells within budget.
 */
export function roadFlood(
  grid: ReadableGrid,
  facilityPositions: { x: number; y: number }[],
  budget: number,
): Map<string, number> {
  const costs = new Map<string, number>();
  const pq = new MinHeap();

  // Seed: find road cells at or adjacent to each facility cell
  for (const pos of facilityPositions) {
    const self = grid.getCell(pos.x, pos.y);
    if (self && self.roadType !== RoadType.NONE) {
      const key = toPosKey(pos.x, pos.y);
      if (!costs.has(key)) { costs.set(key, 0); pq.push(key, 0); }
    }
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = pos.x + dx!;
      const ny = pos.y + dy!;
      const cell = grid.getCell(nx, ny);
      if (cell && cell.roadType !== RoadType.NONE) {
        const key = toPosKey(nx, ny);
        if (!costs.has(key)) { costs.set(key, 0); pq.push(key, 0); }
      }
    }
  }

  // Dijkstra expansion
  while (pq.size > 0) {
    const cur = pq.pop()!;
    const best = costs.get(cur.key);
    if (best !== undefined && best < cur.cost) continue; // stale

    const { x, y } = parsePosKeyUnsafe(cur.key);
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      const cell = grid.getCell(nx, ny);
      if (!cell || cell.roadType === RoadType.NONE) continue;

      const newCost = cur.cost + roadTileCost(cell.roadType);
      if (newCost > budget) continue;

      const nk = toPosKey(nx, ny);
      const prev = costs.get(nk);
      if (prev === undefined || newCost < prev) {
        costs.set(nk, newCost);
        pq.push(nk, newCost);
      }
    }
  }

  return costs;
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
 * Replaces RadiusCoverageMap. O(1) coverage queries after recalculation.
 */
export class RoadCoverageMap {
  private coverageMap = new Map<string, number>();
  private coverageCount = new Map<string, number>();

  /** Recalculate coverage from all facilities. Call when facilities or roads change. */
  recalculate(
    facilities: readonly { x: number; y: number }[],
    grid: ReadableGrid,
    budget: number,
    facilityWidth = 1,
    facilityHeight = 1,
  ): void {
    this.coverageMap.clear();
    this.coverageCount.clear();

    for (const f of facilities) {
      const positions = expandFootprint(f.x, f.y, facilityWidth, facilityHeight);
      const roadCov = roadFlood(grid, positions, budget);
      const fullCov = expandCoverageToBuildings(grid, roadCov);

      for (const [key, cost] of fullCov) {
        const existing = this.coverageMap.get(key);
        if (existing === undefined || cost < existing) {
          this.coverageMap.set(key, cost);
        }
        this.coverageCount.set(key, (this.coverageCount.get(key) ?? 0) + 1);
      }
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
    // Merge existing coverage: take min cost per cell
    for (const [key, cost] of this.coverageMap) {
      const prev = newCov.get(key);
      if (prev === undefined || cost < prev) {
        newCov.set(key, cost);
      }
    }
    return newCov;
  }

  hasCoverage(x: number, y: number): boolean {
    return this.coverageMap.has(toPosKey(x, y));
  }

  getCost(x: number, y: number): number {
    return this.coverageMap.get(toPosKey(x, y)) ?? Infinity;
  }

  getCoverageCount(x: number, y: number): number {
    return this.coverageCount.get(toPosKey(x, y)) ?? 0;
  }

  getCoveredCells(): ReadonlyMap<string, number> {
    return this.coverageMap;
  }
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
