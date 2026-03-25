import { Grid } from '../grid/Grid';
import { toPosKey, parsePosKeyUnsafe, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';
import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';

/** Module-level UnifiedRoadLookup reference, set once by Game.ts. */
let _roadLookup: UnifiedRoadLookup | null = null;

/** Set the shared UnifiedRoadLookup for all coverage BFS systems. */
export function setNetworkRoadLookup(lookup: UnifiedRoadLookup): void {
  _roadLookup = lookup;
}

/**
 * Shared network coverage algorithm used by both PowerGrid and WaterNetwork.
 * Implements Euclidean radius coverage + BFS relay through roads/buildings.
 *
 * Level-aware when UnifiedRoadLookup is set: BFS tracks cell keys (including
 * elevation level) so that elevated roads only relay through compatible
 * neighbors (via ramps). Falls back to ground-only when no lookup is set.
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
 * @param coverageSet  Mutable set to accumulate covered cell keys (always "x,y")
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
  // relaySeeds are cell keys (may include level) for level-aware BFS
  const relaySeeds: string[] = [];

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
        const posKey = toPosKey(nx, ny);
        if (cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || infra?.has(posKey)) {
          // Ground-level relay seed
          relaySeeds.push(posKey);
        }
        // Elevated road relay seeds at this position
        if (_roadLookup) {
          const allKeys = _roadLookup.getAllKeysAtPosition(nx, ny);
          for (const k of allKeys) {
            if (k !== posKey) relaySeeds.push(k);
          }
        }
      }
    }
  }

  // Phase 2: Level-aware BFS relay from edge relay cells
  if (relaySeeds.length === 0) return;
  const relayMap = new Map<string, number>();
  const queue: [string, number][] = []; // [cellKey, remainingRange]
  for (const seedKey of relaySeeds) {
    relayMap.set(seedKey, relayRange);
    queue.push([seedKey, relayRange]);
  }
  while (queue.length > 0) {
    const [curKey, remaining] = queue.shift()!;
    const { x, y } = parsePosKeyUnsafe(curKey);

    for (const [ddx, ddy] of FOUR_NEIGHBORS) {
      const nx = x + ddx!;
      const ny = y + ddy!;
      const posKey = toPosKey(nx, ny);
      if (coverageSet.has(posKey)) continue;
      const cell = grid.getCell(nx, ny);
      if (!cell) continue;

      // Determine if neighbor is a relay (road/building/infra)
      let isRelay: boolean;
      if (_roadLookup) {
        // Level-aware: check compatible road neighbors
        const compatKeys = _roadLookup.getCompatibleNeighborKeys(curKey, nx, ny);
        const hasCompatRoad = compatKeys.length > 0;
        isRelay = hasCompatRoad || cell.buildingId !== 0 || (infra?.has(posKey) ?? false);

        // Enqueue road keys for level-aware expansion
        if (hasCompatRoad) {
          const newRange = Math.max(relayRange, remaining - 1);
          if (newRange > 0) {
            for (const nk of compatKeys) {
              const prev = relayMap.get(nk) ?? 0;
              if (newRange > prev) {
                relayMap.set(nk, newRange);
                coverageSet.add(posKey);
                queue.push([nk, newRange]);
              }
            }
          }
          // If also a building/infra relay, enqueue the posKey too
          if (cell.buildingId !== 0 || (infra?.has(posKey) ?? false)) {
            const newRange2 = Math.max(relayRange, remaining - 1);
            if (newRange2 > 0) {
              const prev = relayMap.get(posKey) ?? 0;
              if (newRange2 > prev) {
                relayMap.set(posKey, newRange2);
                coverageSet.add(posKey);
                queue.push([posKey, newRange2]);
              }
            }
          }
          continue;
        }
      } else {
        // Fallback: ground-only
        isRelay = cell.roadType !== RoadType.NONE
          || cell.buildingId !== 0
          || (infra?.has(posKey) ?? false);
      }

      const newRange = Math.max(isRelay ? relayRange : 0, remaining - 1);
      if (newRange <= 0) continue;
      const prev = relayMap.get(posKey) ?? 0;
      if (newRange <= prev) continue;
      relayMap.set(posKey, newRange);
      coverageSet.add(posKey);
      queue.push([posKey, newRange]);
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
  return cell.roadType !== RoadType.NONE
    || cell.buildingId !== 0
    || (infra?.has(key) ?? false);
}

/**
 * Pure BFS flood through roads/buildings from a starting position.
 * Adds all reachable cells to the given set. No budget limit.
 * Level-aware when UnifiedRoadLookup is set; falls back to ground-only otherwise.
 * Shared between PowerGrid and WaterNetwork.
 */
export function bfsRoadNetworkFlood(
  grid: Grid,
  startX: number,
  startY: number,
  coverage: Set<string>,
  infra?: Set<string>,
): void {
  const startPosKey = toPosKey(startX, startY);
  if (coverage.has(startPosKey)) return;

  const visited = new Set<string>();
  const queue: string[] = [];

  // Always seed from start position (plant/facility is always a source)
  visited.add(startPosKey);
  queue.push(startPosKey);
  coverage.add(startPosKey);

  // Also seed elevated road keys at start position (level-aware)
  if (_roadLookup) {
    const startKeys = _roadLookup.getAllKeysAtPosition(startX, startY);
    for (const k of startKeys) {
      if (!visited.has(k)) {
        visited.add(k);
        queue.push(k);
      }
    }
  }

  while (queue.length > 0) {
    const curKey = queue.shift()!;
    const { x, y } = parsePosKeyUnsafe(curKey);

    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      const posKey = toPosKey(nx, ny);

      // Level-aware: get compatible road neighbors
      if (_roadLookup) {
        const compatibleKeys = _roadLookup.getCompatibleNeighborKeys(curKey, nx, ny);
        for (const nk of compatibleKeys) {
          if (visited.has(nk)) continue;
          visited.add(nk);
          coverage.add(posKey);
          queue.push(nk);
        }
      }

      // Ground-level cells: buildings, infra, zones (and roads when no lookup)
      if (!visited.has(posKey)) {
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        if (canRelay(cell, posKey, infra)) {
          visited.add(posKey);
          coverage.add(posKey);
          queue.push(posKey);
        } else if (cell.zoneType !== 0) {
          // Zoned cells receive coverage from adjacent relay cells but don't relay
          coverage.add(posKey);
        }
      }
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
 * Level-aware when UnifiedRoadLookup is set; falls back to ground-only otherwise.
 * `getDemand(x, y)` returns the demand for the cell at (x, y).
 * Shared between PowerGrid and WaterNetwork.
 */
export function bfsBudgetDrainFlood(
  grid: Grid,
  plant: UtilityPlant,
  supplied: Set<string>,
  getDemand: (x: number, y: number) => number,
  infra?: Set<string>,
): void {
  let budget = plant.output;
  const startPosKey = toPosKey(plant.x, plant.y);

  const visited = new Set<string>();
  const queue: string[] = [];

  // Always seed from plant position (plant is always a source)
  visited.add(startPosKey);
  queue.push(startPosKey);
  supplied.add(startPosKey);

  // Also seed elevated road keys at plant position (level-aware)
  if (_roadLookup) {
    const startKeys = _roadLookup.getAllKeysAtPosition(plant.x, plant.y);
    for (const k of startKeys) {
      if (!visited.has(k)) {
        visited.add(k);
        queue.push(k);
      }
    }
  }

  while (queue.length > 0) {
    if (budget <= 0) break;
    const curKey = queue.shift()!;
    const { x, y } = parsePosKeyUnsafe(curKey);

    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!;
      const ny = y + dy!;
      const posKey = toPosKey(nx, ny);

      // Level-aware: get compatible road neighbors
      let processedAsRoad = false;
      if (_roadLookup) {
        const compatibleKeys = _roadLookup.getCompatibleNeighborKeys(curKey, nx, ny);
        for (const nk of compatibleKeys) {
          if (visited.has(nk)) continue;
          visited.add(nk);
          processedAsRoad = true;

          if (!supplied.has(posKey)) {
            const demand = getDemand(nx, ny);
            if (demand > 0) {
              if (budget < demand) continue;
              budget -= demand;
            }
            supplied.add(posKey);
          }

          queue.push(nk);
        }
      }

      // Ground-level cells: buildings, infra, zones (and roads when no lookup)
      if (!processedAsRoad && !visited.has(posKey)) {
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        if (canRelay(cell, posKey, infra)) {
          visited.add(posKey);
          if (!supplied.has(posKey)) {
            const demand = getDemand(nx, ny);
            if (demand > 0) {
              if (budget < demand) continue;
              budget -= demand;
            }
            supplied.add(posKey);
          }
          queue.push(posKey);
        } else if (cell.zoneType !== 0) {
          // Zoned cells receive supply from adjacent relay cells but don't relay
          visited.add(posKey);
          if (!supplied.has(posKey)) {
            const demand = getDemand(nx, ny);
            if (demand > 0) {
              if (budget < demand) continue;
              budget -= demand;
            }
            supplied.add(posKey);
          }
        }
      }
    }
  }
}

// ── Shared zone demand calculation ──────────────

/** Per-zone consumption config: base + perCapita for each zone category. */
export interface ZoneConsumptionConfig {
  RESIDENTIAL: { base: number; perCapita: number };
  COMMERCIAL:  { base: number; perCapita: number };
  INDUSTRIAL:  { base: number; perCapita: number };
  OFFICE:      { base: number; perCapita: number };
}

/**
 * Calculate utility demand for a zone building.
 * Shared between PowerGrid and WaterNetwork (eliminates duplicate getZoneDemand).
 * Residential uses residents for perCapita; all others use workers.
 */
export function calculateZoneDemand(
  config: ZoneConsumptionConfig,
  zoneType: ZoneType,
  residents: number,
  workers: number,
): number {
  if (isResidentialZone(zoneType)) {
    return config.RESIDENTIAL.base + config.RESIDENTIAL.perCapita * residents;
  }
  if (isCommercialZone(zoneType)) {
    return config.COMMERCIAL.base + config.COMMERCIAL.perCapita * workers;
  }
  if (zoneType === ZoneType.INDUSTRIAL) {
    return config.INDUSTRIAL.base + config.INDUSTRIAL.perCapita * workers;
  }
  if (zoneType === ZoneType.OFFICE) {
    return config.OFFICE.base + config.OFFICE.perCapita * workers;
  }
  return 0;
}
