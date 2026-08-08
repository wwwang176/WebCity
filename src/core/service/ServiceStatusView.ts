/**
 * The per-service coverage readout the building panel shows for one cell.
 *
 * Built in one place because it used to be built in two: `handleSelectClick`
 * and `handleSelectEmptyZone` each listed the services by hand, and the copies
 * drifted until the zone branch was missing `sewage`.
 */

/** Every service the panel can show. Order is the panel's display order. */
export const SERVICE_STATUS_KEYS = [
  'power', 'water', 'sewage', 'police', 'fire',
  'garbage', 'health', 'education', 'deathCare',
] as const;

export type ServiceStatusKey = (typeof SERVICE_STATUS_KEYS)[number];

/**
 * Per-service coverage for the selected building.
 *
 * Utilities are binary: 0 connected, NO_COVERAGE not. The rest carry a cost
 * ratio where 0 is best and 1 is worst, and NO_COVERAGE means out of range.
 */
export type ServiceStatus = Record<ServiceStatusKey, number>;

/** Out of range — distinct from a ratio of 0, which means "served, at no cost". */
export const NO_COVERAGE = -1;

interface UtilityCheck { isPowered(x: number, y: number): boolean }
interface SupplyCheck { isSupplied(x: number, y: number): boolean }
interface CoverageCost { getCostRatio(x: number, y: number): number }

export interface ServiceStatusSources {
  power: UtilityCheck;
  water: SupplyCheck;
  sewage: SupplyCheck;
  police: CoverageCost;
  fire: CoverageCost;
  garbage: CoverageCost;
  health: CoverageCost;
  education: CoverageCost;
  deathCare: CoverageCost;
}

export function buildServiceStatus(
  s: ServiceStatusSources, x: number, y: number,
): ServiceStatus {
  return {
    power: s.power.isPowered(x, y) ? 0 : NO_COVERAGE,
    water: s.water.isSupplied(x, y) ? 0 : NO_COVERAGE,
    sewage: s.sewage.isSupplied(x, y) ? 0 : NO_COVERAGE,
    police: s.police.getCostRatio(x, y),
    fire: s.fire.getCostRatio(x, y),
    garbage: s.garbage.getCostRatio(x, y),
    health: s.health.getCostRatio(x, y),
    education: s.education.getCostRatio(x, y),
    deathCare: s.deathCare.getCostRatio(x, y),
  };
}
