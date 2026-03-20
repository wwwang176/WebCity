import { TransportType, type TransportRoute, type TransportStop } from './types';
import { manhattanDistance } from '../grid/GridHelpers';
import type { AvailableTransport } from './ModeChoice';

export interface TransitSystemInfo {
  type: TransportType;
  speed: number;
  /** Single-vehicle passenger capacity (e.g. 50 for bus). 0 or omitted = unlimited. */
  vehicleCapacity?: number;
  routes: readonly TransportRoute[];
  /** Return precomputed segment distances for a route (one per stop pair). */
  getSegmentDistances?: (routeId: number) => number[] | null;
}

/** Sum dailyRiders across all stops of a route (zero-alloc). */
export function getRouteDailyRiders(route: TransportRoute): number {
  let total = 0;
  for (let i = 0; i < route.stops.length; i++) {
    total += route.stops[i]!.dailyRiders;
  }
  return total;
}

/**
 * Find available transit options between origin and destination.
 * A transit route is "available" if it has stops within walkRange
 * of both origin and destination, AND has remaining capacity.
 *
 * Estimated time is computed from actual route distances when available,
 * falling back to euclidean stop-to-stop distance.
 */
export function findAvailableTransit(
  systems: readonly TransitSystemInfo[],
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  walkRange: number,
): AvailableTransport[] {
  const result: AvailableTransport[] = [];

  for (const sys of systems) {
    for (const route of sys.routes) {
      // Capacity check: full routes are unavailable
      const cap = sys.vehicleCapacity ?? 0;
      if (cap > 0 && getRouteDailyRiders(route) >= route.vehicles * cap) continue;

      // Find nearest origin and destination stops within walk range
      let bestOriginIdx = -1, bestOriginDist = Infinity;
      let bestDestIdx = -1, bestDestDist = Infinity;

      for (let i = 0; i < route.stops.length; i++) {
        const stop = route.stops[i]!;
        const dOrigin = manhattanDistance(stop.x, stop.y, origin.x, origin.y);
        const dDest = manhattanDistance(stop.x, stop.y, destination.x, destination.y);
        if (dOrigin <= walkRange && dOrigin < bestOriginDist) {
          bestOriginIdx = i;
          bestOriginDist = dOrigin;
        }
        if (dDest <= walkRange && dDest < bestDestDist) {
          bestDestIdx = i;
          bestDestDist = dDest;
        }
      }

      if (bestOriginIdx < 0 || bestDestIdx < 0) continue;
      if (bestOriginIdx === bestDestIdx) {
        result.push({ type: sys.type, estimatedTime: 0 });
        continue;
      }

      const segDists = sys.getSegmentDistances?.(route.id) ?? null;
      const rideDistance = computeRideDistance(
        route.stops, bestOriginIdx, bestDestIdx, segDists,
      );
      result.push({ type: sys.type, estimatedTime: rideDistance / sys.speed });
    }
  }

  return result;
}

/**
 * Compute ride distance along the route between two stop indices.
 * Picks the shorter direction around the circular route.
 */
function computeRideDistance(
  stops: readonly TransportStop[],
  fromIdx: number,
  toIdx: number,
  segDists: number[] | null,
): number {
  const n = stops.length;
  const forward = sumDirection(stops, fromIdx, toIdx, n, segDists);
  const backward = sumDirection(stops, toIdx, fromIdx, n, segDists);
  return Math.min(forward, backward);
}

/** Sum distances going forward from fromIdx to toIdx around the circular route. */
function sumDirection(
  stops: readonly TransportStop[],
  fromIdx: number,
  toIdx: number,
  n: number,
  segDists: number[] | null,
): number {
  let total = 0;
  let i = fromIdx;
  while (i !== toIdx) {
    const next = (i + 1) % n;
    if (segDists && i < segDists.length) {
      total += segDists[i]!;
    } else {
      // Fallback: euclidean distance between consecutive stops
      const a = stops[i]!;
      const b = stops[next]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    i = next;
  }
  return total;
}
