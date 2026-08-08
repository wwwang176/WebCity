/**
 * Shared human-readable messages for build failure reasons.
 * Used by both road and rail building error handlers (DRY).
 */
export const BUILD_REASON_MESSAGES: Record<string, string> = {
  WATER_TILE: 'Cannot build on water',
  MOUNTAIN_TILE: 'Mountain in the way',
  BUILDING_EXISTS: 'Building in the way',
  INFRASTRUCTURE_EXISTS: 'Infrastructure in the way',
  OUT_OF_BOUNDS: 'Out of bounds',
  INSUFFICIENT_FUNDS: 'Insufficient funds',
  TILE_OCCUPIED: 'Tile is occupied',
  NO_GROUNDWATER: 'No groundwater here — build near rivers',
  UNKNOWN_TYPE: 'Unknown building type',
  NEED_RAIL_TRACK: 'Train station must be built on rail track',
  NEED_ADJACENT_WATER: 'Ferry dock must be built next to water',
  AIRPORT_OUT_OF_BOUNDS: 'Airport area is out of bounds',
  AIRPORT_AREA_OCCUPIED: 'Airport area is not fully clear',
  NOT_ADJACENT_TO_ROAD: 'Must be built adjacent to a road',
  // Elevated / ramp reasons
  START_NOT_ON_ROAD: 'Must start on an existing road',
  PATH_TOO_SHORT: 'Not enough space for ramp',
  LEVEL_OCCUPIED: 'Elevation level already occupied',
  RAMP_OCCUPIED: 'Cannot build over existing ramp',
  RAMP_ON_WATER: 'Cannot build ramp on water',
  RAMP_OVER_ROAD: 'Road underneath — no room for ramp',
  RAMP_OVER_ELEVATED: 'Elevated road underneath — no room for ramp',
  RAMP_ABOVE: 'Ramp above — cannot build here',
  WATER_CROSSING_NO_TURN: 'Bridge over water must be straight',
  // Road / rail reasons
  PARALLEL_RAIL: 'Cannot run parallel to rail',
  PARALLEL_ROAD: 'Cannot run parallel to road',
  EMPTY_PATH: 'No path to build',
};

/** Get a user-friendly message for a build failure reason, falling back to the raw reason. */
export function getBuildReasonMessage(reason: string): string {
  return BUILD_REASON_MESSAGES[reason] ?? reason;
}

/**
 * A build failure that says WHAT failed, not only why.
 *
 * Road and rail failures already read "Cannot build road: ...". The three
 * placement paths — civic/utility infrastructure, transit stops, airports —
 * passed the bare reason, so dropping a water plant inland produced "No
 * groundwater here — build near rivers" floating on its own with no indication
 * of what had been refused. Several reasons are ambiguous without a subject:
 * "Tile is occupied", "Must be built adjacent to a road" and "Out of bounds"
 * say nothing about which of twenty tools just rejected the click.
 */
export function formatBuildFailure(subject: string, reason: string): string {
  const why = getBuildReasonMessage(reason);
  return subject ? `Cannot place ${subject}: ${why}` : why;
}
