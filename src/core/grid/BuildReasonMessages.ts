/**
 * Shared human-readable messages for build failure reasons.
 * Used by both road and rail building error handlers (DRY).
 */
export const BUILD_REASON_MESSAGES: Record<string, string> = {
  WATER_TILE: 'Cannot build on water',
  MOUNTAIN_TILE: 'mountain in the way',
  BUILDING_EXISTS: 'building in the way',
  INFRASTRUCTURE_EXISTS: 'infrastructure in the way',
  OUT_OF_BOUNDS: 'Out of bounds',
  INSUFFICIENT_FUNDS: 'insufficient funds',
  TILE_OCCUPIED: 'Tile is occupied',
  NO_GROUNDWATER: 'No groundwater here — build near rivers',
  UNKNOWN_TYPE: 'Unknown building type',
  NEED_RAIL_TRACK: 'Train station must be built on rail track',
  AIRPORT_OUT_OF_BOUNDS: 'Airport area is out of bounds',
  AIRPORT_AREA_OCCUPIED: 'Airport area is not fully clear',
};

/** Get a user-friendly message for a build failure reason, falling back to the raw reason. */
export function getBuildReasonMessage(reason: string): string {
  return BUILD_REASON_MESSAGES[reason] ?? reason;
}
