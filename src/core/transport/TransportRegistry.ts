import { TransportMode, TransportType } from './types';
import type { BaseTransportSystem } from './BaseTransportSystem';
import type { UtilityChecker } from '../service/FacilityOperational';
import type { InfraType } from '../building/InfraConfig';
import type { AirportSystem } from './AirportSystem';

export interface TransitSystems {
  bus: BaseTransportSystem;
  metro: BaseTransportSystem;
  rail: BaseTransportSystem;
  ferry: BaseTransportSystem;
}

/**
 * Single source of truth for the TransportMode/Type → system mapping.
 * To add a new transit system, add one entry here (OCP).
 */
const TRANSIT_MAP: readonly { mode: TransportMode; type: TransportType; key: keyof TransitSystems }[] = [
  { mode: TransportMode.BUS, type: TransportType.BUS, key: 'bus' },
  { mode: TransportMode.METRO, type: TransportType.METRO, key: 'metro' },
  { mode: TransportMode.RAIL, type: TransportType.RAIL, key: 'rail' },
  { mode: TransportMode.FERRY, type: TransportType.FERRY, key: 'ferry' },
];

/** Get the transport system for a given TransportMode. Returns undefined for WALK/DRIVE. */
export function getSystemForMode(systems: TransitSystems, mode: TransportMode): BaseTransportSystem | undefined {
  const entry = TRANSIT_MAP.find(e => e.mode === mode);
  return entry ? systems[entry.key] : undefined;
}

/** Get all transit systems paired with their TransportType. */
export function getTransitSystems(systems: TransitSystems): { type: TransportType; system: BaseTransportSystem }[] {
  return TRANSIT_MAP.map(e => ({ type: e.type, system: systems[e.key] }));
}

/**
 * All transport system keys that have getOperatingCost(). Includes airport.
 *
 * `airport` is typed by the one method this actually uses rather than as a
 * BaseTransportSystem: AirportSystem does not extend that class, so requiring it
 * made every call site pass GameState against an unsatisfiable constraint.
 */
export interface AllTransportSystems extends TransitSystems {
  airport: { getOperatingCost(): number; tick(): void };
}

const ALL_TRANSPORT_KEYS: readonly (keyof AllTransportSystems)[] = [
  'bus', 'metro', 'rail', 'ferry', 'airport',
];

/**
 * Combined structural revision of every transit system.
 *
 * Consumers that cache anything derived from the transit network (the
 * multi-modal transfer graph) compare this instead of relying on each mutation
 * site remembering to call an invalidation hook.
 */
export function getTransitNetworkVersion(systems: TransitSystems): number {
  let sum = 0;
  for (const { system } of getTransitSystems(systems)) sum += system.getNetworkVersion();
  return sum;
}

/** Combined stop/route topology revision, ignoring vehicle-count changes. */
export function getTransitTopologyVersion(systems: TransitSystems): number {
  let sum = 0;
  for (const { system } of getTransitSystems(systems)) sum += system.getTopologyVersion();
  return sum;
}

/** Sum getOperatingCost() across all transport systems. */
export function getTotalTransportOperatingCost(systems: AllTransportSystems): number {
  return ALL_TRANSPORT_KEYS.reduce((sum, key) => sum + systems[key].getOperatingCost(), 0);
}

/** Transport system key → InfraType mapping for operational checks. */
const TRANSPORT_INFRA_TYPE: Record<keyof TransitSystems, InfraType> = {
  bus: 'bus_stop',
  metro: 'metro_station',
  rail: 'train_station',
  ferry: 'ferry_dock',
};

/** Update operational status for all transport systems, then tick. */
export function tickAllTransportSystems(
  systems: AllTransportSystems,
  isPowered?: UtilityChecker,
  isWaterSupplied?: UtilityChecker,
): void {
  // Update operational status if utility checkers are provided
  if (isPowered && isWaterSupplied) {
    for (const [key, infraType] of Object.entries(TRANSPORT_INFRA_TYPE) as [keyof TransitSystems, InfraType][]) {
      systems[key].updateOperationalStatus(isPowered, isWaterSupplied, infraType);
    }
    (systems.airport as unknown as AirportSystem).updateOperationalStatus(isPowered, isWaterSupplied);
  }
  for (const key of ALL_TRANSPORT_KEYS) {
    systems[key].tick();
  }
}
