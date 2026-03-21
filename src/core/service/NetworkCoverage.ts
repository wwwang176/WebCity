import { Grid } from '../grid/Grid';
import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';

/**
 * Shared network coverage algorithm used by both PowerGrid and WaterNetwork.
 * Implements Euclidean radius coverage + BFS relay through roads/buildings.
 *
 * 1. All cells within Euclidean distance ≤ `range` are added to `coverageSet`.
 * 2. Relay-capable cells (roads/buildings) on the circle edge relay coverage
 *    `relayRange` further via BFS.
 *
 * @param grid         The game grid
 * @param px           Plant X position
 * @param py           Plant Y position
 * @param range        Euclidean coverage radius
 * @param relayRange   BFS relay range through roads/buildings
 * @param coverageSet  Mutable set to accumulate covered cell keys
 * @param infra        Optional set of infrastructure position keys
 */
export function calculateNetworkCoverage(
  grid: Grid,
  px: number,
  py: number,
  range: number,
  relayRange: number,
  coverageSet: Set<string>,
  infra?: Set<string>,
): void {
  const r = range;
  const r2 = r * r;
  const relaySeeds: [number, number][] = [];

  // Phase 1: Euclidean circle coverage
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = px + dx;
      const ny = py + dy;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;
      coverageSet.add(toPosKey(nx, ny));

      // Collect relay-capable cells on the circle edge (distance > r-1)
      if (dx * dx + dy * dy > (r - 1) * (r - 1)) {
        const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(toPosKey(nx, ny));
        if (isRelay) relaySeeds.push([nx, ny]);
      }
    }
  }

  // Phase 2: BFS relay from edge relay cells
  if (relaySeeds.length === 0) return;
  const relayMap = new Map<string, number>();
  const queue: [number, number, number][] = [];
  for (const [sx, sy] of relaySeeds) {
    const key = toPosKey(sx, sy);
    relayMap.set(key, relayRange);
    queue.push([sx, sy, relayRange]);
  }
  while (queue.length > 0) {
    const [x, y, remaining] = queue.shift()!;
    for (const [ddx, ddy] of FOUR_NEIGHBORS) {
      const nx = x + ddx!;
      const ny = y + ddy!;
      const key = toPosKey(nx, ny);
      if (coverageSet.has(key)) continue;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;
      const isRelay = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(key);
      // Roads/buildings keep range at relayRange (never decreases below it)
      const newRange = Math.max(isRelay ? relayRange : 0, remaining - 1);
      if (newRange <= 0) continue;
      const prev = relayMap.get(key) ?? 0;
      if (newRange <= prev) continue;
      relayMap.set(key, newRange);
      coverageSet.add(key);
      queue.push([nx, ny, newRange]);
    }
  }
}

// ── Shared BFS utilities for PowerGrid / WaterNetwork ──────────────

/** Check if a cell can relay utility network connectivity. */
function canRelay(
  cell: { roadType: number; buildingId: number },
  key: string,
  infra?: Set<string>,
): boolean {
  return cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || (infra?.has(key) ?? false);
}

/**
 * Pure BFS flood through roads/buildings from a starting position.
 * Adds all reachable cells to the given set. No budget limit.
 * Shared between PowerGrid and WaterNetwork (eliminates duplicate bfsRoadNetwork).
 */
export function bfsRoadNetworkFlood(
  grid: Grid,
  startX: number,
  startY: number,
  coverage: Set<string>,
  infra?: Set<string>,
): void {
  const startKey = toPosKey(startX, startY);
  if (coverage.has(startKey)) return;
  coverage.add(startKey);
  const queue: [number, number][] = [[startX, startY]];
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      const key = toPosKey(nx, ny);
      if (coverage.has(key)) continue;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;
      if (!canRelay(cell, key, infra)) {
        // Zoned cells receive coverage from adjacent relay cells but don't relay
        if (cell.zoneType !== 0) coverage.add(key);
        continue;
      }
      coverage.add(key);
      queue.push([nx, ny]);
    }
  }
}

/** Minimal plant shape needed by bfsBudgetDrainFlood. */
export interface UtilityPlant {
  x: number;
  y: number;
  output: number;
}

/**
 * BFS from a single plant through roads/buildings, draining budget per cell demand.
 * Cells already in `supplied` set are skipped (no double-drain).
 * `getDemand(x, y)` returns the demand for the cell at (x, y).
 * Shared between PowerGrid and WaterNetwork (eliminates duplicate bfsBudgetDrain).
 */
export function bfsBudgetDrainFlood(
  grid: Grid,
  plant: UtilityPlant,
  supplied: Set<string>,
  getDemand: (x: number, y: number) => number,
  infra?: Set<string>,
): void {
  let budget = plant.output;
  const startKey = toPosKey(plant.x, plant.y);
  const visited = new Set<string>();
  visited.add(startKey);
  supplied.add(startKey);
  const queue: [number, number][] = [[plant.x, plant.y]];
  while (queue.length > 0) {
    if (budget <= 0) break;
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      const key = toPosKey(nx, ny);
      if (visited.has(key)) continue;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;
      if (!canRelay(cell, key, infra)) {
        // Zoned cells receive supply from adjacent relay cells but don't relay
        if (cell.zoneType !== 0) {
          visited.add(key);
          if (!supplied.has(key)) {
            const demand = getDemand(nx, ny);
            if (demand > 0) {
              if (budget < demand) continue;
              budget -= demand;
            }
            supplied.add(key);
          }
        }
        continue;
      }
      visited.add(key);

      if (!supplied.has(key)) {
        const demand = getDemand(nx, ny);
        if (demand > 0) {
          if (budget < demand) continue;
          budget -= demand;
        }
        supplied.add(key);
      }

      queue.push([nx, ny]);
    }
  }
}
