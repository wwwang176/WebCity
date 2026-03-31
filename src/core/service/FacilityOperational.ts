import type { InfraType } from '../building/InfraConfig';

export type UtilityChecker = (x: number, y: number) => boolean;

/** Infrastructure types exempt from needing power (they generate it). */
const POWER_EXEMPT: ReadonlySet<InfraType> = new Set(['power']);

/** Infrastructure types exempt from needing water (they handle water/sewage). */
const WATER_EXEMPT: ReadonlySet<InfraType> = new Set(['water', 'sewage']);

/**
 * Check if a civic facility at (x, y) is operational based on power + water supply.
 * A facility needs BOTH power AND water to operate, with exemptions:
 * - Power plants don't need power (they generate it)
 * - Water pumps / sewage plants don't need water (they handle water)
 */
export function isFacilityOperational(
  x: number, y: number,
  infraType: InfraType,
  isPowered: UtilityChecker,
  isWaterSupplied: UtilityChecker,
): boolean {
  const hasPower = POWER_EXEMPT.has(infraType) || isPowered(x, y);
  const hasWater = WATER_EXEMPT.has(infraType) || isWaterSupplied(x, y);
  return hasPower && hasWater;
}

export function isPowerExempt(infraType: InfraType): boolean {
  return POWER_EXEMPT.has(infraType);
}

export function isWaterExempt(infraType: InfraType): boolean {
  return WATER_EXEMPT.has(infraType);
}
