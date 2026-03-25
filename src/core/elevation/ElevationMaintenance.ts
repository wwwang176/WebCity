import { type ElevationManager } from './ElevationManager';
import { ROAD_CONFIGS, RoadType } from '../road/types';
import { RAIL, RailType } from '../rail/types';
import { ELEVATION_COST } from './types';

/** Per-tick maintenance rate as fraction of construction cost. */
const MAINTENANCE_RATE = 0.01;

/**
 * Calculate total maintenance cost for all elevated segments.
 * Called once per simulation tick from the expense calculator.
 */
export function calculateElevatedMaintenance(em: ElevationManager): number {
  let total = 0;
  const entries = em.toJSON(); // iterate all segments
  for (const entry of entries) {
    const { data } = entry;
    if (data.roadType !== RoadType.NONE) {
      const baseCost = ROAD_CONFIGS[data.roadType as RoadType]?.cost ?? 0;
      total += baseCost * MAINTENANCE_RATE * ELEVATION_COST.MAINTENANCE;
    }
    if (data.railType !== RailType.NONE) {
      total += RAIL.COST_PER_CELL * MAINTENANCE_RATE * ELEVATION_COST.MAINTENANCE;
    }
  }
  return total;
}
