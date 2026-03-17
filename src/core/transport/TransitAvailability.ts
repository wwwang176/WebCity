import { TransportType, type TransportRoute } from './types';
import { manhattanDistance } from '../grid/GridHelpers';
import type { AvailableTransport } from './ModeChoice';

export interface TransitSystemInfo {
  type: TransportType;
  routes: readonly TransportRoute[];
}

/**
 * Data-driven time factor per transport type (OCP).
 * `true` = uses the railTimeFactor discount; `false` = factor 1.0.
 * Adding a new fast transport type only requires adding an entry here.
 */
const USES_RAIL_TIME_FACTOR: Record<TransportType, boolean> = {
  [TransportType.BUS]: false,
  [TransportType.METRO]: true,
  [TransportType.RAIL]: true,
  [TransportType.FERRY]: false,
  [TransportType.AIRPORT]: false,
};

/**
 * Find available transit options between origin and destination.
 * A transit route is "available" if it has stops within walkRange
 * of both origin and destination.
 *
 * @param railTimeFactor - Time discount factor for fast transit types (e.g. 0.8 = 20% faster)
 */
export function findAvailableTransit(
  systems: readonly TransitSystemInfo[],
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  walkRange: number,
  railTimeFactor = 1.0,
): AvailableTransport[] {
  const result: AvailableTransport[] = [];

  for (const sys of systems) {
    for (const route of sys.routes) {
      let nearOrigin = false;
      let nearDest = false;
      for (const stop of route.stops) {
        if (manhattanDistance(stop.x, stop.y, origin.x, origin.y) <= walkRange) nearOrigin = true;
        if (manhattanDistance(stop.x, stop.y, destination.x, destination.y) <= walkRange) nearDest = true;
      }
      if (nearOrigin && nearDest) {
        const dist = manhattanDistance(origin.x, origin.y, destination.x, destination.y);
        const timeFactor = USES_RAIL_TIME_FACTOR[sys.type] ? railTimeFactor : 1.0;
        result.push({ type: sys.type, estimatedTime: dist * timeFactor });
      }
    }
  }

  return result;
}
