/**
 * The numbers in the transit panel's table.
 *
 * Extracted because the panel computed capacity a second time and got the units wrong: `vehicles x
 * seats` is an **instantaneous** seat count, compared against `smoothedDailyRiders`, a whole day's
 * accumulated trips. That is the mistake `computeDailyCapacity()` documents — fixed in the
 * simulation, not in the panel.
 *
 * In a 12,500-person save, one bus route at one moment showed three numbers: 100% on the collapsed
 * row, clamped by `Math.min`; 5,246% on the expanded row, with the wrong units; and 30,853% from the
 * simulation's own formula.
 *
 * The collapsed and expanded rows now take one path, through the simulation's functions.
 */

import {
  computeCycleTime, computeDailyCapacity, computeLoadFactor,
  formatRouteUsage, routeLoadStatus, type RouteLoadStatus,
} from '../../../core/transport/RouteLoad';
import { getRouteRiders } from '../../../core/transport/TransitAvailability';

/**
 * A system row's status.
 *
 * One more than a route's: `'none'`, meaning **no routes at all**. That is not a band of the load
 * factor but the absence of anything running, so it does not come from `routeLoadStatus()` and never
 * appears on a route row.
 */
export type SystemStatus = RouteLoadStatus | 'none';
import type { TransportRoute, TransportStop, TransportType } from '../../../core/transport/types';

/** What the panel needs from a transport system. Only this, not the whole `BaseTransportSystem`. */
export interface TransitSystemSource {
  type: TransportType;
  routes: readonly TransportRoute[];
  stops: readonly TransportStop[];
  /** Seats per vehicle. 0 means the system has no capacity limit. */
  seatsPerVehicle: number;
  speed: number;
  vehicleCount: number;
  operatingCost: number;
  segmentDistances(routeId: number): number[] | null;
}

export interface TransitRouteRow {
  id: number;
  stops: number;
  vehicles: number;
  /** Daily trips. */
  riders: number;
  /** Daily capacity in trips: seats times round trips per day. */
  capacity: number;
  loadFactor: number;
  usage: string;
  status: RouteLoadStatus;
  cost: number;
  suspended: boolean;
}

export interface TransitSystemRow {
  type: TransportType;
  routeCount: number;
  totalStops: number;
  totalVehicles: number;
  totalRiders: number;
  totalCapacity: number;
  loadFactor: number;
  usage: string;
  status: SystemStatus;
  totalCost: number;
  routeRows: TransitRouteRow[];
}

/**
 * Ridership comes from the simulation's function; counted again in the panel, the two silently part
 * company.
 *
 * The difference is not theoretical: `getRouteRiders()` takes the **greater** of today's running
 * total and the cross-day smoothed value, because `dailyRiders` resets each day and taken alone would
 * make every route look empty each morning. Reading the smoothed value alone, the panel showed a
 * lower percentage than the simulation used whenever the day's total ran past it.
 */
function ridersOf(stops: readonly TransportStop[]): number {
  return getRouteRiders({ stops });
}

export function buildTransitRows(
  systems: readonly TransitSystemSource[],
): TransitSystemRow[] {
  return systems.map((sys) => {
    const routeRows: TransitRouteRow[] = sys.routes.map((route) => {
      const riders = ridersOf(route.stops);
      // A suspended route is still listed: it is still costing the player money.
      const cycleTime = computeCycleTime(
        route.stops, sys.segmentDistances(route.id), sys.speed);
      const capacity = computeDailyCapacity(
        route.vehicles, sys.seatsPerVehicle, cycleTime);
      const loadFactor = computeLoadFactor(riders, capacity);
      return {
        id: route.id,
        stops: route.stops.length,
        vehicles: route.vehicles,
        riders,
        capacity,
        loadFactor,
        usage: formatRouteUsage(riders, capacity),
        status: routeLoadStatus(loadFactor),
        cost: route.operatingCost,
        suspended: !!route.suspended,
      };
    });

    const totalRiders = ridersOf(sys.stops);
    const totalCapacity = routeRows.reduce((s, r) => s + r.capacity, 0);
    const loadFactor = computeLoadFactor(totalRiders, totalCapacity);
    // A system with no routes has no load factor.
    //
    // Where stops are left behind — the player deletes the routes but not the stops — they still
    // remember yesterday's ridership against a capacity of 0, and `computeLoadFactor` returns
    // Infinity by definition, leaving the status hopeless and red until a route is opened again.
    // Nothing running and everything running full are two different things (BUG-349).
    const status: SystemStatus = sys.routes.length === 0 ? 'none' : routeLoadStatus(loadFactor);

    return {
      type: sys.type,
      routeCount: sys.routes.length,
      totalStops: routeRows.reduce((s, r) => s + r.stops, 0),
      totalVehicles: sys.vehicleCount,
      totalRiders,
      totalCapacity,
      loadFactor,
      usage: formatRouteUsage(totalRiders, totalCapacity),
      status,
      totalCost: sys.operatingCost,
      routeRows,
    };
  });
}
