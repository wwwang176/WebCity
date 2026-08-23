import { Grid } from '../grid/Grid';
import { toPosKey, parsePosKeyUnsafe, parseLevelFromKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { CoverageBits } from './CoverageBits';
import { UtilityFloodScratch, GROUP_NONE } from './UtilityFloodScratch';
import { RoadType } from '../road/types';
import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { type UnifiedRoadLookup } from '../road/UnifiedRoadLookup';

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
  let head = 0;
  while (head < queue.length) {
    const [curKey, remaining] = queue[head++]!;
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
function canRelay(roadType: number, buildingId: number, isInfra: boolean): boolean {
  return roadType !== RoadType.NONE || buildingId !== 0 || isInfra;
}

const DX = [0, 0, -1, 1] as const;
const DY = [-1, 1, 0, 0] as const;

/** `"x,y"` 或 `"x,y,level"` → 節點編號。界外回 -1。 */
function nodeOfKey(key: string, width: number, height: number, totalCells: number): number {
  const { x, y } = parsePosKeyUnsafe(key);
  if (x < 0 || y < 0 || x >= width || y >= height) return -1;
  return parseLevelFromKey(key) * totalCells + y * width + x;
}

/** 節點 → `UnifiedRoadLookup` 認得的字串鍵。只有真的碰到高架時才會走到。 */
function keyOfNode(x: number, y: number, level: number): string {
  return level === 0 ? toPosKey(x, y) : `${x},${y},${level}`;
}

/**
 * 走到隔壁那一格的地面道路上 —— `getCompatibleNeighborKeys` 在「來源在地面、
 * 鄰居沒有高架」時的特化，兩支 flood 各用一次。
 *
 * 那條通用路徑每個鄰居都要:解析來源字串鍵三次（層級、座標、是不是匝道）、配一個
 * 結果陣列、再配一個十四欄位的格子物件。而 `isCompatible(0, false, 0, false)`
 * 恆為真、`sourceIsRamp` 為假，所以在這個情形下它的答案就只是「鄰居是不是地面
 * 道路」。規則本身留在 `UnifiedRoadLookup` 裡，這裡只是繞過它。
 *
 * 200x200 全蓋滿、24 座廠的測資:光是電力那一輪，帶 lookup 3 102ms、完全不帶
 * lookup 1 555ms —— 那一半就是這裡。
 */

/**
 * Pure BFS flood through roads/buildings from a starting position.
 * Adds all reachable cells to the given coverage bitmap. No budget limit.
 * Level-aware when UnifiedRoadLookup is set; falls back to ground-only otherwise.
 * Shared between PowerGrid, WaterNetwork and SewageService.
 *
 * `scratch` 帶著走訪狀態與這一輪的基礎設施位置;呼叫端要先 `beginPass`。
 */
export function bfsRoadNetworkFlood(
  grid: Grid,
  startX: number,
  startY: number,
  coverage: CoverageBits,
  scratch: UtilityFloodScratch,
  roadLookup?: UnifiedRoadLookup | null,
): void {
  const rl = roadLookup ?? null;
  const { width, height, totalCells } = scratch;
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return;

  const startIdx = startY * width + startX;
  if (coverage.hasIdx(startIdx)) return;

  scratch.beginFlood();
  // Always seed from start position (plant/facility is always a source)
  scratch.markVisited(startIdx);
  scratch.push(startIdx);
  coverage.addIdx(startIdx);

  // Also seed elevated road keys at start position (level-aware)
  if (rl) {
    for (const k of rl.getAllKeysAtPosition(startX, startY)) {
      const node = nodeOfKey(k, width, height, totalCells);
      if (node >= 0 && scratch.markVisited(node)) scratch.push(node);
    }
  }

  while (scratch.hasQueued) {
    const node = scratch.shift();
    const level = (node / totalCells) | 0;
    const idx = node - level * totalCells;
    const x = idx % width;
    const y = (idx / width) | 0;

    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nidx = ny * width + nx;

      // Level-aware: get compatible road neighbors
      if (rl) {
        if (level > 0 || rl.hasElevatedAt(nx, ny)) {
          const compatibleKeys = rl.getCompatibleNeighborKeys(keyOfNode(x, y, level), nx, ny);
          for (const nk of compatibleKeys) {
            const nnode = nodeOfKey(nk, width, height, totalCells);
            if (nnode < 0 || !scratch.markVisited(nnode)) continue;
            coverage.addIdx(nidx);
            scratch.push(nnode);
          }
        } else if (!scratch.hasVisited(nidx)
          && grid.getField(nx, ny, 'roadType') !== RoadType.NONE) {
          scratch.markVisited(nidx);
          coverage.addIdx(nidx);
          scratch.push(nidx);
        }
      }

      // Ground-level cells: buildings, infra, zones (and roads when no lookup)
      if (!scratch.hasVisited(nidx)) {
        if (canRelay(grid.getField(nx, ny, 'roadType'),
                     grid.getField(nx, ny, 'buildingId'), scratch.isInfra(nidx))) {
          scratch.markVisited(nidx);
          coverage.addIdx(nidx);
          scratch.push(nidx);
        } else if (grid.getField(nx, ny, 'zoneType') !== 0) {
          // Zoned cells receive coverage from adjacent relay cells but don't relay
          coverage.addIdx(nidx);
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
 * Cells already in `supplied` are skipped (no double-drain).
 * Level-aware when UnifiedRoadLookup is set; falls back to ground-only otherwise.
 * `getDemand(x, y)` returns the demand for the cell at (x, y).
 * Shared between PowerGrid, WaterNetwork and SewageService.
 *
 * Multi-cell facilities settle as ONE unit. Their whole consumption sits on the
 * primary cell and the secondaries report 0 (that is what keeps the city-wide
 * total honest — see calculateUtilityCellDemand). Draining cell by cell then
 * made those zero-demand secondaries free: a plant that could not afford a 2x2
 * police station skipped the primary but supplied — and RELAYED THROUGH — the
 * other three, so the station showed 3/4 powered and passed power to whatever
 * lay beyond it. Charging is keyed by footprint instead: paid once, all or none.
 *
 * 已付款的 footprint 記在 `scratch` 上，**跨這一輪所有的廠共用** —— 因為
 * `supplied` 也是。每座廠各記一份的話:A 在主格付掉最後一塊預算、`budget <= 0`
 * 在主格出隊之前就 break，另外三格沒被供應;B 走到附屬格，`supplied` 裡沒有它、
 * 自己那份新的已付清單裡也沒有，於是整棟再付一次 —— 那正是 BUG-070 修掉的重複
 * 計費，換成跨廠又犯一次。
 */
export function bfsBudgetDrainFlood(
  grid: Grid,
  plant: UtilityPlant,
  supplied: CoverageBits,
  getDemand: (x: number, y: number) => number,
  scratch: UtilityFloodScratch,
  roadLookup?: UnifiedRoadLookup | null,
): void {
  const rl = roadLookup ?? null;
  const { width, height, totalCells } = scratch;
  if (plant.x < 0 || plant.y < 0 || plant.x >= width || plant.y >= height) return;

  let budget = plant.output;
  const startIdx = plant.y * width + plant.x;

  /**
   * Charge for a cell and record it as supplied. Returns false when the budget
   * cannot cover it — the caller must then neither supply nor relay through it.
   */
  const trySupply = (x: number, y: number, idx: number): boolean => {
    if (supplied.hasIdx(idx)) return true;
    const group = scratch.chargeOf(grid, idx, x, y, getDemand);
    if (group !== GROUP_NONE && scratch.isPaid(group)) {
      supplied.addIdx(idx);
      return true;
    }
    const demand = scratch.demandAt(idx);
    if (demand > 0) {
      if (budget < demand) return false;
      budget -= demand;
    }
    if (group !== GROUP_NONE) scratch.markPaid(group);
    supplied.addIdx(idx);
    return true;
  };

  scratch.beginFlood();
  // Always seed from plant position (plant is always a source)
  scratch.markVisited(startIdx);
  scratch.push(startIdx);
  supplied.addIdx(startIdx);

  // Also seed elevated road keys at plant position (level-aware)
  if (rl) {
    for (const k of rl.getAllKeysAtPosition(plant.x, plant.y)) {
      const node = nodeOfKey(k, width, height, totalCells);
      if (node >= 0 && scratch.markVisited(node)) scratch.push(node);
    }
  }

  while (scratch.hasQueued) {
    if (budget <= 0) break;
    const node = scratch.shift();
    const level = (node / totalCells) | 0;
    const idx = node - level * totalCells;
    const x = idx % width;
    const y = (idx / width) | 0;

    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nidx = ny * width + nx;

      // Level-aware: get compatible road neighbors
      let processedAsRoad = false;
      if (rl) {
        if (level > 0 || rl.hasElevatedAt(nx, ny)) {
          const compatibleKeys = rl.getCompatibleNeighborKeys(keyOfNode(x, y, level), nx, ny);
          for (const nk of compatibleKeys) {
            const nnode = nodeOfKey(nk, width, height, totalCells);
            if (nnode < 0 || !scratch.markVisited(nnode)) continue;
            processedAsRoad = true;

            if (!trySupply(nx, ny, nidx)) continue;

            scratch.push(nnode);
          }
        } else if (!scratch.hasVisited(nidx)
          && grid.getField(nx, ny, 'roadType') !== RoadType.NONE) {
          scratch.markVisited(nidx);
          processedAsRoad = true;
          if (trySupply(nx, ny, nidx)) scratch.push(nidx);
        }
      }

      // Ground-level cells: buildings, infra, zones (and roads when no lookup)
      if (!processedAsRoad && !scratch.hasVisited(nidx)) {
        if (canRelay(grid.getField(nx, ny, 'roadType'),
                     grid.getField(nx, ny, 'buildingId'), scratch.isInfra(nidx))) {
          scratch.markVisited(nidx);
          // An unaffordable cell is not supplied AND must not relay: that is
          // how an unpaid facility footprint used to conduct power onward.
          if (!trySupply(nx, ny, nidx)) continue;
          scratch.push(nidx);
        } else if (grid.getField(nx, ny, 'zoneType') !== 0) {
          // Zoned cells receive supply from adjacent relay cells but don't relay
          scratch.markVisited(nidx);
          trySupply(nx, ny, nidx);
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
