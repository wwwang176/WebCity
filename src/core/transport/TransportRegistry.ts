import { TransportMode, TransportType } from './types';
import type { BaseTransportSystem } from './BaseTransportSystem';

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
