/**
 * BuildingGrowthTick — extracted from SimulationLoop (SRP).
 *
 * Pure-ish function that processes one round of building growth attempts.
 * Handles three cases per sampled cell:
 *   1. Burned buildings: random clearance
 *   2. Abandoned buildings: demolish + regrow if conditions met
 *   3. Empty zone cells: new growth
 *
 * Returns a result struct so the caller (SimulationLoop) can fire callbacks
 * and update dependent systems (sidewalk graph, workplace cache, etc.).
 */

import { ZoneType, zoneToRCI } from '../grid/types';
import { isZoneBuilding } from './InfraConfig';
import { BURNED, ABANDONED } from './InfraPlacement';
import { toPosKey } from '../grid/GridHelpers';

// ── Dependency interface (DIP) ──────────────────────────────────────────────

export interface BuildingGrowthTickDeps {
  /** Grid accessor (read cells + mutate via setCell). */
  grid: {
    readonly width: number;
    readonly height: number;
    getCell(x: number, y: number): { zoneType: number; buildingId: number; reserved: number } | null;
    setCell(x: number, y: number, patch: Record<string, unknown>): void;
  };

  /** Delegate to BuildingGrowth.tryGrow (mutates grid on success). */
  tryGrow(x: number, y: number, conditions: { hasPower: boolean; hasWater: boolean; rciDemand: { residential: number; commercial: number; industrial: number } }): boolean;

  /** Current RCI demand snapshot. */
  rciDemand: { residential: number; commercial: number; industrial: number };

  /** Per-cell utility checks. */
  isPowered(x: number, y: number): boolean;
  isWatered(x: number, y: number): boolean;

  /** District/policy restrictions. */
  getDistrictAt(x: number, y: number): { id: string } | null;
  canBuildInDistrict(districtId: string, zoneType: number): boolean;

  /** Side-effect hooks for cleaning up pending queues. */
  clearPendingDeathAt(x: number, y: number): void;
  clearPendingGarbageAt(x: number, y: number): void;

  /** Config: number of random cell samples per tick. */
  growthAttempts: number;
  /** Config: probability of clearing a burned building per attempt. */
  burnedClearanceChance: number;

  /** Lookup: building level by buildingId (for callback data). */
  getBuildingLevel(buildingId: number): number;

  /** Seeded RNG — keeps function deterministic in tests. */
  randomInt(max: number): number;
  randomFloat(): number;
}

// ── Result type ─────────────────────────────────────────────────────────────

export interface BuildingGrowthTickResult {
  /** True if any cell was modified. */
  changed: boolean;
  /** Cells that were modified (for sidewalk graph incremental update). */
  affectedCells: string[];
  /** Buildings removed (burned clearance or abandoned demolish). */
  removed: { x: number; y: number }[];
  /** Buildings added (new growth or regrowth after abandoned demolish). */
  added: { x: number; y: number; zoneType: number; level: number }[];
}

// ── Main function ──────────────────────────────────────────────────────────

export function buildingGrowthTick(deps: BuildingGrowthTickDeps): BuildingGrowthTickResult {
  const {
    grid, tryGrow, rciDemand, isPowered, isWatered,
    getDistrictAt, canBuildInDistrict,
    clearPendingDeathAt, clearPendingGarbageAt,
    growthAttempts, burnedClearanceChance,
    getBuildingLevel, randomInt, randomFloat,
  } = deps;

  const result: BuildingGrowthTickResult = {
    changed: false,
    affectedCells: [],
    removed: [],
    added: [],
  };

  const conditions = {
    hasPower: true,
    hasWater: true,
    rciDemand,
  };

  for (let i = 0; i < growthAttempts; i++) {
    const x = randomInt(grid.width);
    const y = randomInt(grid.height);
    const cell = grid.getCell(x, y);
    if (!cell || cell.zoneType === ZoneType.NONE) continue;

    // ── Case 1: Burned buildings — random clearance ──
    if (cell.reserved === BURNED && isZoneBuilding(cell.buildingId)) {
      if (randomFloat() < burnedClearanceChance) {
        grid.setCell(x, y, { buildingId: 0, reserved: 0 });
        clearPendingDeathAt(x, y);
        clearPendingGarbageAt(x, y);
        result.changed = true;
        result.affectedCells.push(toPosKey(x, y));
        result.removed.push({ x, y });
      }
      continue;
    }

    // ─ Case 2: Abandoned buildings — demolish + regrow ──
    if (cell.reserved === ABANDONED && isZoneBuilding(cell.buildingId)) {
      conditions.hasPower = isPowered(x, y);
      conditions.hasWater = isWatered(x, y);
      const rciType = zoneToRCI(cell.zoneType);
      if (!conditions.hasPower || !conditions.hasWater || !rciType || rciDemand[rciType] <= 0) continue;

      const district = getDistrictAt(x, y);
      if (district && !canBuildInDistrict(district.id, cell.zoneType)) continue;

      // Demolish abandoned
      const savedZoneType = cell.zoneType;
      grid.setCell(x, y, { buildingId: 0, reserved: 0 });
      clearPendingDeathAt(x, y);
      clearPendingGarbageAt(x, y);
      result.removed.push({ x, y });

      // Try regrow
      if (tryGrow(x, y, conditions)) {
        const grown = grid.getCell(x, y);
        if (grown) {
          const level = getBuildingLevel(grown.buildingId);
          result.added.push({ x, y, zoneType: savedZoneType, level });
        }
      }
      result.changed = true;
      result.affectedCells.push(toPosKey(x, y));
      continue;
    }

    // ── Case 3: Empty zone cell — new growth ──
    if (cell.buildingId === 0) {
      const district = getDistrictAt(x, y);
      if (district && !canBuildInDistrict(district.id, cell.zoneType)) continue;

      conditions.hasPower = isPowered(x, y);
      conditions.hasWater = isWatered(x, y);
      if (tryGrow(x, y, conditions)) {
        result.changed = true;
        result.affectedCells.push(toPosKey(x, y));
        const grown = grid.getCell(x, y);
        if (grown) {
          const level = getBuildingLevel(grown.buildingId);
          result.added.push({ x, y, zoneType: cell.zoneType, level });
        }
      }
    }
  }

  return result;
}
