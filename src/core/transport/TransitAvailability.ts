import { TransportType, type TransportRoute, type TransportStop } from './types';
import { expectedWait } from './RouteLoad';
import type { FlatRoute } from './MultiModalRouter';
import type { NearbyStop, StopProximityIndex } from './StopProximityIndex';
import type { AvailableTransport } from './ModeChoice';

export interface TransitSystemInfo {
  type: TransportType;
  /** The configured speed, used as the fallback by systems without `speedOn`. */
  speed: number;
  /**
   * How fast this route actually runs right now, including congestion.
   *
   * Optional so callers that do not care about congestion (most tests) need not supply
   * one. Omitting it falls back to `speed`, which means "this system is unaffected by
   * congestion", not "nothing is congested right now".
   */
  speedOn?: (routeId: number) => number;
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
 * A route's steady-state ridership, used to judge crowding.
 *
 * Reads a **complete day**: the larger of yesterday's actual count and the cross-day
 * smoothed value. Capacity is measured in riders per day, so ridership must span a whole
 * day too.
 *
 * `dailyRiders` is the running total for today so far and resets each game day. Its unit
 * differs, which makes load factor saw-tooth daily: the route looks empty in the morning,
 * fills through the day, then resets. Measured on a 12,600-citizen save (one bus, 151
 * consecutive samples), load factor swung between **5.56 and 47.34** while today's running
 * count ran from **0 to 6,519** — the reported "usage oscillates between 80% and 100%".
 * It also destabilises demand: the route looks empty every morning, everyone picks it, and
 * it overloads by evening.
 *
 * Taking the larger of the two covers both directions: a route that spiked yesterday shows
 * up today (`lastDayRiders`), and a single quiet day does not read as empty (the smoothed
 * value). The cost is that a new route looks empty on its first day, since a day of data
 * takes a day.
 */
export function getRouteRiders(route: { stops: readonly TransportStop[] }): number {
  let lastDay = 0;
  let smoothed = 0;
  for (let i = 0; i < route.stops.length; i++) {
    const s = route.stops[i]!;
    lastDay += s.lastDayRiders;
    smoothed += s.smoothedDailyRiders;
  }
  return Math.max(lastDay, smoothed);
}

/**
 * Find available transit options between origin and destination.
 * A transit route is "available" if it has stops within walkRange
 * of both origin and destination, AND has remaining capacity.
 *
 * Reachability is answered by `StopProximityIndex`, which measures along the sidewalk
 * graph. Manhattan distance cannot see roads — a stop across the street is two tiles away —
 * so it counts households as served and sends pedestrians who then have to detour to a
 * junction to cross.
 *
 * A per-stop scan costs one measurement per city stop per end per citizen: 5.74µs per
 * citizen on a city with 3 routes and 19 stops, against 0.25µs for two index lookups.
 *
 * The estimate covers the **whole trip**: walk to the stop, wait, ride, walk to the
 * destination. Reporting only the ride would put a bus on a 40-tick headway with a stop
 * five tiles away on the same footing as one at the door running to the second, because
 * this number is compared directly against driving time. Such a bus beats driving almost
 * always, and also beats transfer routes that do include walking and waiting
 * (`chooseModeMultiModal` starts from single-mode options and only switches for something
 * faster), leaving the dispatching path charging nothing for walking distance with only
 * the hard `walkRange` limit standing between a citizen and a long walk to a bus.
 */
export function findAvailableTransit(
  routes: readonly FlatRoute[],
  index: StopProximityIndex,
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  walkSpeed: number,
  waitFactor: number,
): AvailableTransport[] {
  const fromNear = index.at(origin.x, origin.y);
  if (fromNear.length === 0) return [];
  const toNear = index.at(destination.x, destination.y);
  if (toNear.length === 0) return [];

  // Nearest stop per route. Ties keep the first one seen; the index is built in route then
  // stop order, so that is the earlier entry in the stops array.
  const nearestFrom = nearestPerRoute(fromNear);
  const nearestTo = nearestPerRoute(toNear);

  const result: AvailableTransport[] = [];
  for (const [routeIdx, a] of nearestFrom) {
    const b = nearestTo.get(routeIdx);
    if (b === undefined) continue;
    const route = routes[routeIdx];
    if (route === undefined) continue;

    const walkTime = (a.walkDistance + b.walkDistance) / walkSpeed;
    const boardStop = route.stops[a.stopIdx]!;
    const alightStop = route.stops[b.stopIdx]!;

    // Boarding and alighting at the same stop is not a ride, but the walk to it was still
    // spent.
    if (a.stopIdx === b.stopIdx) {
      result.push({ type: route.type, estimatedTime: walkTime, walkTime, boardStop, alightStop });
      continue;
    }

    // Headway and load factor are read off the flat route rather than recomputed here:
    // `refreshRouteService()` already computed them from identical inputs a few lines
    // earlier in the same tick, inside `tick()` before `spawnVehicles()`. Computing them
    // separately is the shape of BUG-343 — the two paths diverge on the same route, and no
    // test turns red at the moment they do.
    //
    // There is no refusal threshold. An overloaded route is still listed; its waiting time
    // grows until it loses on its own, and a cliff would produce a limit cycle.
    const rideDistance = computeRideDistance(route.stops, a.stopIdx, b.stopIdx, route.segDists);
    // Both stops travel back with the estimate. Re-picking "the nearest stop" at dispatch
    // lands on a different route while the time was estimated for these two, which credits
    // the citizen to a route they did not ride (BUG-283).
    result.push({
      type: route.type,
      estimatedTime: walkTime
        + expectedWait(route.headway, waitFactor, route.loadFactor)
        + rideDistance / route.speed,
      walkTime,
      boardStop,
      alightStop,
    });
  }

  return result;
}

/**
 * Keeps the nearest stop of each route.
 *
 * Route counts are in the single digits, so a `Map` beats a shared scratch array sized by
 * `routes.length`: a shared array would need either clearing each call (another full pass)
 * or generation stamps, neither of which pays for itself at this size.
 */
function nearestPerRoute(near: readonly NearbyStop[]): Map<number, NearbyStop> {
  const best = new Map<number, NearbyStop>();
  for (const n of near) {
    const seen = best.get(n.routeIdx);
    if (seen === undefined || n.walkDistance < seen.walkDistance) best.set(n.routeIdx, n);
  }
  return best;
}

/**
 * Compute ride distance along the route between two stop indices.
 * Picks the shorter direction around the circular route.
 */
export function computeRideDistance(
  stops: readonly TransportStop[],
  fromIdx: number,
  toIdx: number,
  segDists: number[] | null,
): number {
  const n = stops.length;
  // A cached segment list must line up 1:1 with the stops, otherwise it is stale
  // and indexing it by the CURRENT stop index silently returns another leg's
  // distance. Degrade to the euclidean fallback instead of lying (BUG-064).
  const safeDists = segDists && segDists.length === n ? segDists : null;
  const forward = sumDirection(stops, fromIdx, toIdx, n, safeDists);
  const backward = sumDirection(stops, toIdx, fromIdx, n, safeDists);
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
