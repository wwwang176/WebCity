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
 * One cell's situation with respect to one service.
 *
 * Two dimensions, because they call for different actions: **too far** calls for a nearer
 * facility and **too full** for another to share the load. Distance alone reports a cell next to
 * a hospital at twice capacity as being in the best possible state (BUG-362).
 */
export interface ServiceCellStatus {
  /**
   * The road-following cost over the budget. 0 is best, 1 is worst, `NO_COVERAGE` is out of
   * range. The utilities are binary: 0 is connected, `NO_COVERAGE` is not.
   */
  cost: number;
  /**
   * How full **the facility serving this cell** is. 1.0 is exactly full and 2.0 is demand at
   * twice capacity. `NO_COVERAGE` means unavailable: uncovered, or a service with no notion of
   * load.
   *
   * Not clamped to 1; exceeding 1 is meaningful.
   */
  load: number;
}

export type ServiceStatus = Record<ServiceStatusKey, ServiceCellStatus>;

/** Out of range — distinct from a ratio of 0, which means "served, at no cost". */
export const NO_COVERAGE = -1;

interface UtilityCheck { isPowered(x: number, y: number): boolean }
interface SupplyCheck { isSupplied(x: number, y: number): boolean }
interface CoverageCost {
  getCostRatio(x: number, y: number): number;
  /** Load over capacity for the facility serving this cell. */
  getLoadRatioAt(x: number, y: number): number;
}

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

/** The three utilities have no per-cell notion of load: connected is connected. */
function utility(connected: boolean): ServiceCellStatus {
  return { cost: connected ? 0 : NO_COVERAGE, load: NO_COVERAGE };
}

function covered(src: CoverageCost, x: number, y: number): ServiceCellStatus {
  return { cost: src.getCostRatio(x, y), load: src.getLoadRatioAt(x, y) };
}

export function buildServiceStatus(
  s: ServiceStatusSources, x: number, y: number,
): ServiceStatus {
  return {
    power: utility(s.power.isPowered(x, y)),
    water: utility(s.water.isSupplied(x, y)),
    sewage: utility(s.sewage.isSupplied(x, y)),
    police: covered(s.police, x, y),
    fire: covered(s.fire, x, y),
    garbage: covered(s.garbage, x, y),
    health: covered(s.health, x, y),
    education: covered(s.education, x, y),
    deathCare: covered(s.deathCare, x, y),
  };
}
