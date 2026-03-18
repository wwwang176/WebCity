export const ECONOMY = {
  /** Base income per citizen for residential income tax ($0.50 per tick). */
  CITIZEN_BASE_INCOME: 0.5,
  /** Road maintenance cost per tile per budget tick. */
  ROAD_MAINTENANCE_PER_TILE: 0.1,
} as const;

/** Data-driven building density level multipliers for business tax. */
export const BUILDING_LEVEL_MULTIPLIERS: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 1.5,
  3: 2.0,
} as const;

/** Building density level multiplier for both residential and business tax. */
export function getBuildingLevelMultiplier(level: 1 | 2 | 3): number {
  return BUILDING_LEVEL_MULTIPLIERS[level] ?? 1.0;
}
