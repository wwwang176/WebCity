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
    forEachCell, isZoneBuilding, getBuildingLevel,
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
