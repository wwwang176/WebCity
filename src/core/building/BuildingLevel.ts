/** Shared building level constants and utility. */
export const BUILDING_LEVEL = {
  MIN: 1,
  MAX: 3,
  DIVISOR: 3,
} as const;

/** Clamp service coverage to a valid building level (1-3). */
export function clampBuildingLevel(serviceCoverage: number): 1 | 2 | 3 {
  const raw = Math.ceil(serviceCoverage / BUILDING_LEVEL.DIVISOR) || 1;
  return Math.max(BUILDING_LEVEL.MIN, Math.min(BUILDING_LEVEL.MAX, raw)) as 1 | 2 | 3;
}
