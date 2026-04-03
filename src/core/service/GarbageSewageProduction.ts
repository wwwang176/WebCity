/**
 * GarbageSewageProduction — Extracted from ServiceRegistry (OCP/DRY).
 *
 * Replaces inline zone-type switch chains with data-driven lookup via
 * calculateZoneDemand (shared with PowerGrid/WaterNetwork).
 * Adding a new zone type only requires updating the config tables.
 */

import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { getBuildingType } from '../building/types';
import { calculateZoneDemand } from './NetworkCoverage';
import { GARBAGE_PRODUCTION } from './GarbageService';
import { WATER_CONSUMPTION } from './WaterNetwork';
import { SEWAGE } from './SewageService';

/** Per-zone sewage rate lookup (OCP: add new zone type → add entry). */
const SEWAGE_ZONE_RATE: Record<number, number> = {
  [ZoneType.RESIDENTIAL_LOW]: SEWAGE.SEWAGE_RATE.RESIDENTIAL,
  [ZoneType.RESIDENTIAL_HIGH]: SEWAGE.SEWAGE_RATE.RESIDENTIAL,
  [ZoneType.COMMERCIAL_LOW]: SEWAGE.SEWAGE_RATE.COMMERCIAL,
  [ZoneType.COMMERCIAL_HIGH]: SEWAGE.SEWAGE_RATE.COMMERCIAL,
  [ZoneType.INDUSTRIAL]: SEWAGE.SEWAGE_RATE.INDUSTRIAL,
  [ZoneType.OFFICE]: SEWAGE.SEWAGE_RATE.OFFICE,
};

interface CellLike {
  buildingId: number;
  zoneType: number;
}

/**
 * Calculate total garbage and sewage production from all buildings on the grid.
 * Pure function — no side effects.
 */
export function calculateGarbageSewageProduction(
  forEachCell: (fn: (cell: CellLike, x: number, y: number) => void) => void,
): { garbage: number; sewage: number } {
  let garbage = 0;
  let sewage = 0;

  forEachCell((cell) => {
    if (cell.buildingId <= 0) return;
    const bt = getBuildingType(cell.buildingId);
    if (!bt) return;

    const zt = cell.zoneType as ZoneType;

    // Garbage: uses same ZoneConsumptionConfig pattern as PowerGrid/WaterNetwork
    garbage += calculateZoneDemand(GARBAGE_PRODUCTION, zt, bt.residents, bt.workers);

    // Sewage: water demand × per-zone sewage rate
    const waterDemand = calculateZoneDemand(WATER_CONSUMPTION, zt, bt.residents, bt.workers);
    const sewageRate = SEWAGE_ZONE_RATE[cell.zoneType] ?? 0;
    sewage += waterDemand * sewageRate;
  });

  return { garbage: Math.floor(garbage), sewage: Math.floor(sewage) };
}
