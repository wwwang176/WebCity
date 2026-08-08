import { Grid } from '../grid/Grid';
import { toPosKey, parsePosKeyUnsafe, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';
import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';
import { MULTI_CELL_OCCUPIED, isPrimaryCellReserved, findPrimaryCell } from '../building/InfraPlacement';

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
  roadLookup?: UnifiedRoadLookup | null,
): void {
  const rl = roadLookup ?? null;
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
        if (rl) {
          const allKeys = rl.getAllKeysAtPosition(nx, ny);
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
      if (rl) {
        // Level-aware: check compatible road neighbors
        const compatKeys = rl.getCompatibleNeighborKeys(curKey, nx, ny);
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
  roadLookup?: UnifiedRoadLookup | null,
): void {
  const rl = roadLookup ?? null;
  const startPosKey = toPosKey(startX, startY);
  if (coverage.has(startPosKey)) return;

  const visited = new Set<string>();
  const queue: string[] = [];

  // Always seed from start position (plant/facility is always a source)
  visited.add(startPosKey);
  queue.push(startPosKey);
  coverage.add(startPosKey);

  // Also seed elevated road keys at start position (level-aware)
  if (rl) {
    const startKeys = rl.getAllKeysAtPosition(startX, startY);
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
      if (rl) {
        const compatibleKeys = rl.getCompatibleNeighborKeys(curKey, nx, ny);
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

/** What reaching one cell costs: its footprint group (null = settles alone) and demand. */
export interface CellCharge {
  group: string | null;
  demand: number;
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
 *
 * Multi-cell facilities settle as ONE unit. Their whole consumption sits on the
 * primary cell and the secondaries report 0 (that is what keeps the city-wide
 * total honest — see calculateUtilityCellDemand). Draining cell by cell then
 * made those zero-demand secondaries free: a plant that could not afford a 2x2
 * police station skipped the primary but supplied — and RELAYED THROUGH — the
 * other three, so the station showed 3/4 powered and passed power to whatever
 * lay beyond it. Charging is keyed by footprint instead: paid once, all or none.
 */
export function bfsBudgetDrainFlood(
  grid: Grid,
  plant: UtilityPlant,
  supplied: Set<string>,
  getDemand: (x: number, y: number) => number,
  infra?: Set<string>,
  roadLookup?: UnifiedRoadLookup | null,
  /** Shared across the plants of one pass — see the comment on `paid` below. */
  paidGroups?: Set<string>,
  /** Shared per-position charge memo for one pass. */
  chargeCache?: Map<string, CellCharge>,
): void {
  const rl = roadLookup ?? null;
  let budget = plant.output;
  const startPosKey = toPosKey(plant.x, plant.y);

  /**
   * Footprints already paid for, keyed by primary-cell position.
   *
   * SHARED across the plants of one coverage pass, because `supplied` is too.
   * Per-plant, a footprint left partially supplied by plant A was charged again
   * in full by plant B: A pays at the primary, its budget lands on exactly 0,
   * the `budget <= 0` break fires before the primary is dequeued, and the other
   * three cells are never supplied. B then reaches a secondary, sees neither
   * that cell in `supplied` nor the group in its own fresh set, and pays the
   * whole facility a second time — draining 10 for something getDemand() counts
   * as 5. That is the double-count BUG-070 removed, reintroduced across plants.
   */
  const paid = paidGroups ?? new Set<string>();

  /**
   * Resolve what reaching (x, y) actually costs.
   *
   * `group` is null for ordinary cells (each settles on its own) and the
   * primary cell's key for any cell of a multi-cell facility.
   *
   * Memoised: findPrimaryCell scans an O(max(w,h)^2) box — 81 lookups per
   * secondary cell of a Large Airport — and Grid.getCell allocates. Without the
   * cache that ran per cell, per plant, and again for power, water and sewage
   * on the same slow slot. The grid cannot change during a coverage pass, so
   * one entry per position is safe for the whole pass.
   */
  const chargeFor = (x: number, y: number, posKey: string): CellCharge => {
    const hit = chargeCache?.get(posKey);
    if (hit) return hit;
    const cell = grid.getCell(x, y);
    let result: CellCharge;
    if (!cell || cell.buildingId === 0
      || (cell.reserved !== MULTI_CELL_OCCUPIED && !isPrimaryCellReserved(cell.reserved))) {
      result = { group: null, demand: getDemand(x, y) };
    } else {
      const primary = findPrimaryCell(grid, x, y);
      result = primary
        ? { group: toPosKey(primary.x, primary.y), demand: getDemand(primary.x, primary.y) }
        : { group: null, demand: getDemand(x, y) };
    }
    chargeCache?.set(posKey, result);
    return result;
  };

  /**
   * Charge for a cell and record it as supplied. Returns false when the budget
   * cannot cover it — the caller must then neither supply nor relay through it.
   */
  const trySupply = (x: number, y: number, posKey: string): boolean => {
    if (supplied.has(posKey)) return true;
    const { group, demand } = chargeFor(x, y, posKey);
    if (group !== null && paid.has(group)) {
      supplied.add(posKey);
      return true;
    }
    if (demand > 0) {
      if (budget < demand) return false;
      budget -= demand;
    }
    if (group !== null) paid.add(group);
    supplied.add(posKey);
    return true;
  };

  const visited = new Set<string>();
  const queue: string[] = [];

  // Always seed from plant position (plant is always a source)
  visited.add(startPosKey);
  queue.push(startPosKey);
  supplied.add(startPosKey);

  // Also seed elevated road keys at plant position (level-aware)
  if (rl) {
    const startKeys = rl.getAllKeysAtPosition(plant.x, plant.y);
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
      if (rl) {
        const compatibleKeys = rl.getCompatibleNeighborKeys(curKey, nx, ny);
        for (const nk of compatibleKeys) {
          if (visited.has(nk)) continue;
          visited.add(nk);
          processedAsRoad = true;

          if (!trySupply(nx, ny, posKey)) continue;

          queue.push(nk);
        }
      }

      // Ground-level cells: buildings, infra, zones (and roads when no lookup)
      if (!processedAsRoad && !visited.has(posKey)) {
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        if (canRelay(cell, posKey, infra)) {
          visited.add(posKey);
          // An unaffordable cell is not supplied AND must not relay: that is
          // how an unpaid facility footprint used to conduct power onward.
          if (!trySupply(nx, ny, posKey)) continue;
          queue.push(posKey);
        } else if (cell.zoneType !== 0) {
          // Zoned cells receive supply from adjacent relay cells but don't relay
          visited.add(posKey);
          trySupply(nx, ny, posKey);
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
