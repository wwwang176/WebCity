/**
 * TransferStatsQuery — pure query functions for multi-modal transfer statistics.
 *
 * Extracted from SimulationLoop for SRP — transfer statistics computation
 * is transport analysis logic, not simulation orchestration.
 */

import type { WalkingTripPool } from '../traffic/PedestrianManager';
import { PedestrianTripType } from '../traffic/PedestrianAgent';

/** Shared transit type → icon mapping (DRY: used by multiple modules). */
export const TRANSIT_ICONS: Record<string, string> = {
  BUS: '\uD83D\uDE8C',
  METRO: '\uD83D\uDE87',
  RAIL: '\uD83D\uDE82',
  FERRY: '\u26F4',
};

/** Minimal interface for TransferTracker queries (DIP). */
export interface TransferTrackerQuery {
  getPedsSnapshot(): number;
  getAllWeeklyTotals(): Map<string, number>;
}

/** Cached route entry from MultiModalRouter. */
export interface CachedRouteEntry {
  totalTime: number;
  legs: ReadonlyArray<{
    type: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    transitType?: string;
  }>;
}

export interface TransferStatsInput {
  transferTracker: TransferTrackerQuery;
  walkingTripPool: WalkingTripPool;
  stopRouteCache: ReadonlyMap<string, CachedRouteEntry>;
  totalActivePeds: number;
  transferEdgeCount: number;
}

export interface TransferStats {
  activeTransferPeds: number;
  totalActivePeds: number;
  transferTrips: number;
  cachedRoutes: number;
  multiRideRoutes: number;
  transferEdges: number;
  routeBreakdown: Array<{
    label: string;
    rides: number;
    count: number;
    avgTime: number;
    weeklyUse: number;
  }>;
}

/** Build a label from ride legs using transit icons. */
function buildRouteLabel(rideLegs: ReadonlyArray<{ transitType?: string }>): string {
  return rideLegs.map(l => TRANSIT_ICONS[l.transitType ?? ''] ?? l.transitType ?? '?').join('\u2192');
}

/**
 * Compute transfer statistics from the transfer graph and tracker.
 * Pure function — no side effects.
 */
export function computeTransferStats(input: TransferStatsInput): TransferStats {
  const { transferTracker, walkingTripPool, stopRouteCache, totalActivePeds, transferEdgeCount } = input;

  const activeTransferPeds = transferTracker.getPedsSnapshot();

  let transferTrips = 0;
  for (const t of walkingTripPool.trips) {
    if (t.tripType === PedestrianTripType.TRANSFER_WALK) transferTrips += t.count;
  }

  let multiRideRoutes = 0;
  const groups = new Map<string, { count: number; totalTime: number }>();

  stopRouteCache.forEach(route => {
    const rideLegs = route.legs.filter(l => l.type === 'ride');
    if (rideLegs.length >= 2) multiRideRoutes++;
    const label = buildRouteLabel(rideLegs);
    const g = groups.get(label);
    if (g) { g.count++; g.totalTime += route.totalTime; }
    else groups.set(label, { count: 1, totalTime: route.totalTime });
  });

  const weeklyTotals = transferTracker.getAllWeeklyTotals();

  const routeBreakdown: TransferStats['routeBreakdown'] = [];
  groups.forEach((g, label) => {
    const rides = (label.match(/\u2192/g) || []).length + 1;
    const weeklyUse = weeklyTotals.get(label) ?? 0;
    routeBreakdown.push({ label, rides, count: g.count, avgTime: g.totalTime / g.count, weeklyUse });
  });
  routeBreakdown.sort((a, b) => b.weeklyUse - a.weeklyUse);

  return {
    activeTransferPeds,
    totalActivePeds,
    transferTrips,
    cachedRoutes: stopRouteCache.size,
    multiRideRoutes,
    transferEdges: transferEdgeCount,
    routeBreakdown,
  };
}

/**
 * Find stop coordinates for a specific transfer route label (for map overlay).
 * Pure function — no side effects.
 */
export function findTransferRouteStops(
  stopRouteCache: ReadonlyMap<string, CachedRouteEntry>,
  label: string,
): Array<{ x: number; y: number; type: string }> {
  const stops: Array<{ x: number; y: number; type: string }> = [];

  for (const route of stopRouteCache.values()) {
    const rideLegs = route.legs.filter(l => l.type === 'ride');
    if (rideLegs.length < 2) continue;
    const routeLabel = buildRouteLabel(rideLegs);
    if (routeLabel !== label) continue;

    for (const leg of route.legs) {
      stops.push({ x: leg.fromX, y: leg.fromY, type: leg.type });
      stops.push({ x: leg.toX, y: leg.toY, type: leg.type });
    }
    break;
  }

  return stops;
}
