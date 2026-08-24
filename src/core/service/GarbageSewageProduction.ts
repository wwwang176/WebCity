/**
 * GarbageSewageProduction — Extracted from ServiceRegistry (OCP/DRY).
 *
 * Replaces inline zone-type switch chains with data-driven lookup via
 * calculateZoneDemand (shared with PowerGrid/WaterNetwork).
 * Adding a new zone type only requires updating the config tables.
 */

import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { getBuildingType } from '../building/types';
import { isActiveZoneCell } from '../building/BuildingQueries';
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
  /** Required: a ruin produces nothing, and this is how one is recognised. */
  reserved: number;
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
  /**
   * Multiplier on garbage produced at this cell — the Encourage Recycling
   * district policy. Defaults to 1 so callers with no districts are unaffected.
   */
  getGarbageMultiplier: OccupancyLookup = () => 1,
  /**
   * This cell's sewage multiplier, from the sewage treatment standard. Defaults to 1, so callers
   * without an ordinance are unaffected.
   *
   * Per cell like refuse: discharge happens at buildings, and a city-wide ordinance simply gives
   * every cell the same number.
   */
  getSewageMultiplier: OccupancyLookup = () => 1,
): { sewage: number } {
  let sewage = 0;
  sewageService.clearSewageCells();

  forEachCell((cell, x, y) => {
    if (cell.buildingId <= 0) return;
    // A ruin produces nothing, for the same reason it consumes nothing
    // (BUG-131). Sewage is derived from the building TYPE's resident count
    // rather than from occupancy, so without this a burnt-out house kept
    // reporting its full pre-fire sewage — and the same plant capacity was
    // being spent against two different definitions of demand: ruins in for
    // getConnectedTreatmentCapacity, ruins out for the coverage flood. The
    // ruin's sewage cell was then supplied for free, so getPollutionSources
    // skipped it and its sewage emitted no water pollution at all (BUG-156).
    if (!isActiveZoneCell(cell)) return;
    const bt = getBuildingType(cell.buildingId);
    if (!bt) return;

    const zt = cell.zoneType as ZoneType;

    // Garbage: uses actual occupancy, not building capacity
    const actualResidents = isResidentialZone(zt) ? getResidents(x, y) : 0;
    const actualWorkers = !isResidentialZone(zt) ? getWorkers(x, y) : 0;
    const garbageAmount = calculateZoneDemand(GARBAGE_PRODUCTION, zt, actualResidents, actualWorkers)
      * getGarbageMultiplier(x, y);
    if (garbageAmount > 0) {
      garbageService.reportGarbage(x, y, garbageAmount);
    }

    // Sewage: uses building capacity (pipe sizing based on spec)
    const waterDemand = calculateZoneDemand(WATER_CONSUMPTION, zt, bt.residents, bt.workers);
    const sewageRate = SEWAGE_ZONE_RATE[cell.zoneType] ?? 0;
    const sewageAmount = waterDemand * sewageRate * getSewageMultiplier(x, y);
    if (sewageAmount > 0) {
      sewageService.reportSewage(x, y, sewageAmount);
    }
    sewage += sewageAmount;
  });

  return { sewage: Math.floor(sewage) };
}

