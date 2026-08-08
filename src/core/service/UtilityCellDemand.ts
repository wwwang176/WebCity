/**
 * UtilityCellDemand — Shared utility demand calculation for PowerGrid and WaterNetwork (DRY).
 *
 * Extracts the duplicated getCellDemand pattern:
 * zone building → calculateZoneDemand, excluded plant → 0, infra building → lookup table.
 */

import { getInfraConfigById, isZoneBuilding } from '../building/InfraConfig';
import { MULTI_CELL_OCCUPIED } from '../building/InfraPlacement';
import { isActiveZoneCell } from '../building/BuildingQueries';
import type { ZoneConsumptionConfig } from './NetworkCoverage';
import { calculateZoneDemand } from './NetworkCoverage';
import type { ZoneType } from '../grid/types';

export interface UtilityCellDemandConfig {
  /** Per-zone-type consumption rates (base + perCapita). */
  zoneConsumption: ZoneConsumptionConfig;
  /** Per-infra-type consumption (keyed by normalized string, e.g. 'police', 'health'). */
  infraConsumption: Record<string, number>;
  /** Map from InfraType to consumption key (e.g. 'hospital' → 'health'). */
  infraTypeToKey: Record<string, string>;
  /** BuildingId of the plant itself (excluded from demand — it produces, doesn't consume). */
  excludedBuildingId: number;
}

/**
 * Calculate utility demand for a single cell.
 * Handles zone buildings, infrastructure buildings, and excluded plants.
 *
 * @param config    Utility-specific consumption tables
 * @param buildingId  The building ID at this cell (0 = empty)
 * @param zoneType    The zone type at this cell
 * @param residents   Resident count from building type (for zone demand)
 * @param workers     Worker count from building type (for zone demand)
 * @param reserved    The cell's `reserved` flag — used to bill a multi-cell
 *                    building once instead of once per footprint cell
 */
export function calculateUtilityCellDemand(
  config: UtilityCellDemandConfig,
  buildingId: number,
  zoneType: ZoneType,
  residents: number,
  workers: number,
  reserved: number,
): number {
  if (buildingId <= 0) return 0;

  // Zone building: use zone consumption table.
  //
  // A ruin consumes nothing. Testing only isZoneBuilding left a burnt-out or
  // abandoned house drawing full power and water — and that phantom demand is
  // not merely a wrong total on the panel: bfsBudgetDrainFlood settles against
  // it, so ruins consumed plant budget and could starve LIVE houses further
  // along the flood. It also contradicted the service panel on the same screen,
  // which counts only working buildings (BUG-131).
  if (isZoneBuilding(buildingId)) {
    if (!isActiveZoneCell({ buildingId, reserved })) return 0;
    return calculateZoneDemand(config.zoneConsumption, zoneType, residents, workers);
  }

  // Excluded plant (e.g. power plant doesn't consume power)
  if (buildingId === config.excludedBuildingId) return 0;

  // The consumption tables below are per BUILDING, but placeInfraOnGrid stamps
  // the same buildingId onto every cell of the footprint and the demand sweeps
  // visit every cell. Billing each one multiplied a 2x2 police station by 4 and
  // a 3x3 university by 9 — inflating city-wide demand and, worse, draining the
  // plant budget in bfsBudgetDrainFlood so coverage was cut short. Charge the
  // primary cell only; secondary cells carry MULTI_CELL_OCCUPIED (BUG-070).
  if (reserved === MULTI_CELL_OCCUPIED) return 0;

  // Infrastructure building: lookup consumption by type
  const infraCfg = getInfraConfigById(buildingId);
  if (infraCfg) {
    const key = config.infraTypeToKey[infraCfg.type];
    if (key && config.infraConsumption[key] !== undefined) {
      return config.infraConsumption[key]!;
    }
  }

  return 0;
}
