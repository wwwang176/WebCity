/**
 * UtilityCellDemand — Shared utility demand calculation for PowerGrid and WaterNetwork (DRY).
 *
 * Extracts the duplicated getCellDemand pattern:
 * zone building → calculateZoneDemand, excluded plant → 0, infra building → lookup table.
 */

import { getBuildingType } from '../building/types';
import { getInfraConfigById, isZoneBuilding } from '../building/InfraConfig';
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
 */
export function calculateUtilityCellDemand(
  config: UtilityCellDemandConfig,
  buildingId: number,
  zoneType: ZoneType,
  residents: number,
  workers: number,
): number {
  if (buildingId <= 0) return 0;

  // Zone building: use zone consumption table
  if (isZoneBuilding(buildingId)) {
    return calculateZoneDemand(config.zoneConsumption, zoneType, residents, workers);
  }

  // Excluded plant (e.g. power plant doesn't consume power)
  if (buildingId === config.excludedBuildingId) return 0;

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
