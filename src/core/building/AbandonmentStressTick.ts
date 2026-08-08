/**
 * AbandonmentStressTick — extracted from SimulationLoop (SRP).
 *
 * Iterates all active zone buildings and updates per-building abandonment stress.
 * Buildings with stress >= 100 are flagged for abandonment.
 * Returns a result struct so the caller handles grid mutation and callbacks.
 */

import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { calculateAbandonmentStress, ABANDONMENT, type AbandonmentConditions } from './BuildingAbandonment';
import { toPosKey } from '../grid/GridHelpers';
import { ABANDONED, BURNED } from './InfraPlacement';

// ── Dependency interface (DIP) ──────────────────────────────────────────────

export interface AbandonmentStressTickDeps {
  /** Grid cell iterator. */
  forEachCell(fn: (cell: { buildingId: number; zoneType: number; reserved: number }, x: number, y: number) => void): void;

  /** Single-cell lookup, used to prune stress recorded for cells that no longer hold a building. */
  getCell(x: number, y: number): { buildingId: number; reserved: number } | null;

  /** Building type checks. */
  isZoneBuilding(buildingId: number): boolean;
  getBuildingLevel(buildingId: number): number;

  /** Per-cell environment lookups. */
  getPollution(x: number, y: number): { ground: number; water: number };
  getCrimeReduction(x: number, y: number): number;
  getServiceScore(x: number, y: number, isResidential: boolean): number;

  /** Per-cell utility checks. */
  isPowered(x: number, y: number): boolean;
  isWatered(x: number, y: number): boolean;

  /** Freight status (commercial/industrial only). */
  getFreightSupplyRatio(x: number, y: number): number | undefined;
  getFreightSurplusRatio(): number | undefined;

  /** City-wide crime and tax rates. */
  baseCrime: number;
  businessTax: number;
  residentialTax: number;

  /** Mutable stress map — updated in place (zero GC). */
  stressMap: Map<string, number>;
}

// ── Result type ─────────────────────────────────────────────────────────────

export interface AbandonmentStressTickResult {
  /** True if any building reached abandonment threshold. */
  changed: boolean;
  /** Buildings that should be marked as abandoned. */
  abandoned: { x: number; y: number; zoneType: number; level: number }[];
}

// ── Main function ───────────────────────────────────────────────────────────

export function abandonmentStressTick(deps: AbandonmentStressTickDeps): AbandonmentStressTickResult {
  const {
    forEachCell, getCell, isZoneBuilding, getBuildingLevel,
    getPollution, getCrimeReduction, getServiceScore,
    isPowered, isWatered,
    getFreightSupplyRatio, getFreightSurplusRatio,
    baseCrime, businessTax, residentialTax,
    stressMap,
  } = deps;

  const result: AbandonmentStressTickResult = {
    changed: false,
    abandoned: [],
  };

  // Prune first: stress is keyed by position, and this sweep only visits live
  // zone buildings, so an entry for a cell that no longer holds one is never
  // revisited and is inherited by whatever grows there next. demolish() and
  // rezone clear it explicitly; applyDisasterDamage, the auto-demolition under
  // a facility footprint, and a building burning down never did. Pruning here
  // covers all five paths, and any future one, without another call site to
  // remember. Iterating the stress map costs O(stressed buildings), not O(grid).
  for (const key of [...stressMap.keys()]) {
    const comma = key.indexOf(',');
    const cell = getCell(Number(key.slice(0, comma)), Number(key.slice(comma + 1)));
    if (!cell || !isZoneBuilding(cell.buildingId)
      || cell.reserved === ABANDONED || cell.reserved === BURNED) {
      stressMap.delete(key);
    }
  }

  forEachCell((cell, x, y) => {
    if (!isZoneBuilding(cell.buildingId)) return;
    if (cell.reserved === ABANDONED || cell.reserved === BURNED) return;

    const level = getBuildingLevel(cell.buildingId);
    if (level === 0) return;

    const pollution = getPollution(x, y);
    const posKey = toPosKey(x, y);
    const localCrime = Math.max(0, baseCrime + getCrimeReduction(x, y));
    const isRes = isResidentialZone(cell.zoneType);
    const serviceScore = getServiceScore(x, y, isRes);

    const conditions: AbandonmentConditions = {
      businessTaxRate: businessTax,
      residentialTaxRate: residentialTax,
      isPowered: isPowered(x, y),
      isWatered: isWatered(x, y),
      crimeRate: localCrime,
      pollution: pollution.ground + pollution.water,
      buildingLevel: level,
      serviceScore,
      freightRatio: isCommercialZone(cell.zoneType) ? getFreightSupplyRatio(x, y) : undefined,
      freightSurplusRatio: cell.zoneType === ZoneType.INDUSTRIAL ? getFreightSurplusRatio() : undefined,
    };

    const { totalDelta } = calculateAbandonmentStress(cell.zoneType, conditions);

    // Per-building resilience: deterministic hash → 0.5~1.5 multiplier
    const resilience = 0.5 + ((x * 7919 + y * 104729) % 1000) / 1000;
    const adjustedDelta = totalDelta > 0 ? totalDelta / resilience : totalDelta;

    const current = stressMap.get(posKey) ?? 0;
    const next = Math.max(0, Math.min(100, current + adjustedDelta));

    if (next === 0) {
      stressMap.delete(posKey);
    } else {
      stressMap.set(posKey, next);
    }

    if (next >= ABANDONMENT.STRESS_ABANDON) {
      result.changed = true;
      result.abandoned.push({ x, y, zoneType: cell.zoneType, level });
    }
  });

  return result;
}
