/**
 * Shared human-readable messages for build failure reasons.
 * Used by both road and rail building error handlers (DRY).
 */
export const BUILD_REASON_MESSAGES: Record<string, string> = {
  WATER_TILE: 'water in the way',
  MOUNTAIN_TILE: 'mountain in the way',
  BUILDING_EXISTS: 'building in the way',
  INFRASTRUCTURE_EXISTS: 'infrastructure in the way',
  OUT_OF_BOUNDS: 'out of bounds',
  INSUFFICIENT_FUNDS: 'insufficient funds',
};

/** Get a user-friendly message for a build failure reason, falling back to the raw reason. */
export function getBuildReasonMessage(reason: string): string {
  return BUILD_REASON_MESSAGES[reason] ?? reason;
}
