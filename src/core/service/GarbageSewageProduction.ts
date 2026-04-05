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
import type { GarbageService } from './GarbageService';
import type { SewageService } from './SewageService';

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

/** Occupancy lookup: returns actual residents or workers at a position. */
export type OccupancyLookup = (x: number, y: number) => number;

/**
 * Report per-cell garbage to GarbageService and calculate total sewage production.
 * Garbage uses actual occupancy (residents/workers living/working at the building).
 * Sewage still uses building capacity (pipe sizing is based on building spec).
 */
export function produceGarbageAndSewage(
  forEachCell: (fn: (cell: CellLike, x: number, y: number) => void) => void,
  garbageService: GarbageService,
  sewageService: SewageService,
  getResidents: OccupancyLookup,
  getWorkers: OccupancyLookup,
): { sewage: number } {
  let sewage = 0;
  sewageService.clearSewageCells();

  forEachCell((cell, x, y) => {
    if (cell.buildingId <= 0) return;
    const bt = getBuildingType(cell.buildingId);
    if (!bt) return;

    const zt = cell.zoneType as ZoneType;

    // Garbage: uses actual occupancy, not building capacity
    const actualResidents = isResidentialZone(zt) ? getResidents(x, y) : 0;
    const actualWorkers = !isResidentialZone(zt) ? getWorkers(x, y) : 0;
    const garbageAmount = calculateZoneDemand(GARBAGE_PRODUCTION, zt, actualResidents, actualWorkers);
    if (garbageAmount > 0) {
      garbageService.reportGarbage(x, y, garbageAmount);
    }

    // Sewage: uses building capacity (pipe sizing based on spec)
    const waterDemand = calculateZoneDemand(WATER_CONSUMPTION, zt, bt.residents, bt.workers);
    const sewageRate = SEWAGE_ZONE_RATE[cell.zoneType] ?? 0;
    const sewageAmount = waterDemand * sewageRate;
    if (sewageAmount > 0) {
      sewageService.reportSewage(x, y, sewageAmount);
    }
    sewage += sewageAmount;
  });

  return { sewage: Math.floor(sewage) };
}

