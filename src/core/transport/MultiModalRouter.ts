/**
 * Multi-modal transit router — finds routes that transfer between
 * different transit lines (up to MAX_TRIP_LEGS legs, walk counts as a leg).
 *
 * Uses pre-computed segment distances from each transit system,
 * so per-citizen search is just table-lookup + addition.
 */

import { TransportType, type TransportStop } from './types';
import { manhattanDistance } from '../grid/GridHelpers';
import { computeRideDistance, getRouteDailyRiders, type TransitSystemInfo } from './TransitAvailability';

// ── Types ───────────────────────────────────────────────────────

export interface TransitLeg {
  type: 'walk' | 'ride';
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Walk legs: walk time. Ride legs: wait time + ride time. */
  estimatedTime: number;
  /** Ride legs only */
  transitType?: TransportType;
  /** Index into the FlatRoute[] array passed to findMultiModalRoutes */
  routeIdx?: number;
  /** Boarding stop index within route.stops[] */
  boardStopIdx?: number;
  /** Alighting stop index within route.stops[] */
  alightStopIdx?: number;
}

export interface MultiLegRoute {
  legs: TransitLeg[];
  /** Sum of all legs' estimatedTime */
  totalTime: number;
}

export interface TransferEdge {
  /** Target route array index */
  toRI: number;
  /** Target stop array index */
  toSI: number;
  walkDistance: number;
}

export interface TransferGraph {
  /** Key: stopKey(routeArrayIdx, stopArrayIdx) → transfer edges */
  byStop: Map<string, TransferEdge[]>;
}

export interface FlatRoute {
  routeId: number;
  type: TransportType;
  speed: number;
  stops: readonly TransportStop[];
  segDists: number[] | null;
  frequency: number;
  isFull: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────

function sk(ri: number, si: number): string {
  return `${ri}:${si}`;
}

// ── flattenSystems ──────────────────────────────────────────────

export function flattenSystems(systems: readonly TransitSystemInfo[]): FlatRoute[] {
  const result: FlatRoute[] = [];
  for (const sys of systems) {
    for (const route of sys.routes) {
      if (route.suspended) continue;
      const cap = sys.vehicleCapacity ?? 0;
      const isFull = cap > 0 && getRouteDailyRiders(route) >= route.vehicles * cap;
      result.push({
        routeId: route.id,
        type: sys.type,
        speed: sys.speed,
        stops: route.stops,
        segDists: sys.getSegmentDistances?.(route.id) ?? null,
        frequency: route.frequency,
        isFull,
      });
    }
  }
  return result;
}

// ── Transfer Graph ──────────────────────────────────────────────

export function buildTransferGraph(
  routes: readonly FlatRoute[],
  transferRange: number,
): TransferGraph {
  const byStop = new Map<string, TransferEdge[]>();

  // Collect all (routeIdx, stopIdx, stop) triples
  const all: Array<{ ri: number; si: number; stop: TransportStop }> = [];
  for (let ri = 0; ri < routes.length; ri++) {
    const r = routes[ri]!;
    for (let si = 0; si < r.stops.length; si++) {
      all.push({ ri, si, stop: r.stops[si]! });
    }
  }

  // Pairwise check — different routes only
  for (let i = 0; i < all.length; i++) {
    const a = all[i]!;
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j]!;
      if (a.ri === b.ri) continue; // same route → skip

      const dist = manhattanDistance(a.stop.x, a.stop.y, b.stop.x, b.stop.y);
      if (dist > transferRange) continue;

      // Bidirectional edges
      const keyA = sk(a.ri, a.si);
      let edgesA = byStop.get(keyA);
      if (!edgesA) { edgesA = []; byStop.set(keyA, edgesA); }
      edgesA.push({ toRI: b.ri, toSI: b.si, walkDistance: dist });

      const keyB = sk(b.ri, b.si);
      let edgesB = byStop.get(keyB);
      if (!edgesB) { edgesB = []; byStop.set(keyB, edgesB); }
      edgesB.push({ toRI: a.ri, toSI: a.si, walkDistance: dist });
    }
  }

  return { byStop };
}

// ── Multi-Modal Route Search ────────────────────────────────────

const MAX_RESULTS = 20;

export function findMultiModalRoutes(
  routes: readonly FlatRoute[],
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  walkRange: number,
  walkSpeed: number,
  waitFactor: number,
  transferGraph: TransferGraph,
  maxLegs: number,
): MultiLegRoute[] {
  if (routes.length === 0) return [];
  const maxRides = Math.floor((maxLegs - 1) / 2);
  if (maxRides < 1) return [];

  // Index: which stops are near the destination?
  const nearDest = new Map<string, number>(); // sk → walkDist
  for (let ri = 0; ri < routes.length; ri++) {
    const r = routes[ri]!;
    for (let si = 0; si < r.stops.length; si++) {
      const d = manhattanDistance(r.stops[si]!.x, r.stops[si]!.y, destination.x, destination.y);
      if (d <= walkRange) nearDest.set(sk(ri, si), d);
    }
  }

  // Index: which stops have outgoing transfer edges?
  const hasTransferEdges = new Set<string>(transferGraph.byStop.keys());

  const results: MultiLegRoute[] = [];

  /**
   * After alighting at (alightRI, alightSI), either complete the trip
   * (walk to destination) or transfer to another route and recurse.
   */
  function tryCompleteOrTransfer(
    alightRI: number,
    alightSI: number,
    timeSoFar: number,
    legsSoFar: TransitLeg[],
    usedRoutes: Set<number>,
    rideNum: number,
  ): void {
    if (results.length >= MAX_RESULTS) return;

    const key = sk(alightRI, alightSI);
    const alightStop = routes[alightRI]!.stops[alightSI]!;

    // ── Try to complete: walk to destination ──
    const destDist = nearDest.get(key);
    if (destDist !== undefined) {
      const walkTime = destDist / walkSpeed;
      results.push({
        legs: [...legsSoFar, {
          type: 'walk' as const,
          fromX: alightStop.x, fromY: alightStop.y,
          toX: destination.x, toY: destination.y,
          estimatedTime: walkTime,
        }],
        totalTime: timeSoFar + walkTime,
      });
    }

    // ── Try to transfer ──
    if (rideNum >= maxRides) return;
    if (!hasTransferEdges.has(key)) return;
    if (results.length >= MAX_RESULTS) return;

    const edges = transferGraph.byStop.get(key)!;
    for (const edge of edges) {
      if (usedRoutes.has(edge.toRI)) continue;
      if (results.length >= MAX_RESULTS) return;

      const targetRoute = routes[edge.toRI]!;
      if (targetRoute.isFull) continue;

      const targetStop = targetRoute.stops[edge.toSI]!;
      const transferWalkTime = edge.walkDistance / walkSpeed;
      const transferWalkLeg: TransitLeg = {
        type: 'walk',
        fromX: alightStop.x, fromY: alightStop.y,
        toX: targetStop.x, toY: targetStop.y,
        estimatedTime: transferWalkTime,
      };

      const waitTime = targetRoute.frequency * waitFactor;

      // Ride the target route — only alight at useful stops
      for (let ai = 0; ai < targetRoute.stops.length; ai++) {
        if (ai === edge.toSI) continue;

        const nextKey = sk(edge.toRI, ai);
        const isNearDest = nearDest.has(nextKey);
        const canTransferMore = rideNum + 1 < maxRides && hasTransferEdges.has(nextKey);
        if (!isNearDest && !canTransferMore) continue;

        const nextStop = targetRoute.stops[ai]!;
        const rideTime = computeRideDistance(
          targetRoute.stops, edge.toSI, ai, targetRoute.segDists,
        ) / targetRoute.speed;

        const rideLeg: TransitLeg = {
          type: 'ride',
          fromX: targetStop.x, fromY: targetStop.y,
          toX: nextStop.x, toY: nextStop.y,
          estimatedTime: waitTime + rideTime,
          transitType: targetRoute.type,
          routeIdx: edge.toRI,
          boardStopIdx: edge.toSI,
          alightStopIdx: ai,
        };

        const newUsed = new Set(usedRoutes);
        newUsed.add(edge.toRI);

        tryCompleteOrTransfer(
          edge.toRI, ai,
          timeSoFar + transferWalkTime + waitTime + rideTime,
          [...legsSoFar, transferWalkLeg, rideLeg],
          newUsed, rideNum + 1,
        );

        if (results.length >= MAX_RESULTS) return;
      }
    }
  }

  // ── Main search: first ride from each entry stop ──────────────

  for (let ri = 0; ri < routes.length; ri++) {
    const route = routes[ri]!;
    if (route.isFull) continue;

    for (let si = 0; si < route.stops.length; si++) {
      const entryStop = route.stops[si]!;
      const walkDist = manhattanDistance(entryStop.x, entryStop.y, origin.x, origin.y);
      if (walkDist > walkRange) continue;

      const walkToEntry = walkDist / walkSpeed;
      const firstWalkLeg: TransitLeg = {
        type: 'walk',
        fromX: origin.x, fromY: origin.y,
        toX: entryStop.x, toY: entryStop.y,
        estimatedTime: walkToEntry,
      };

      const waitTime = route.frequency * waitFactor;

      // Ride to each useful alight stop
      for (let ai = 0; ai < route.stops.length; ai++) {
        if (ai === si) continue;

        const alightKey = sk(ri, ai);
        const isNearDest = nearDest.has(alightKey);
        const hasTransfer = maxRides >= 2 && hasTransferEdges.has(alightKey);
        if (!isNearDest && !hasTransfer) continue;

        const alightStop = route.stops[ai]!;
        const rideTime = computeRideDistance(route.stops, si, ai, route.segDists) / route.speed;

        const rideLeg: TransitLeg = {
          type: 'ride',
          fromX: entryStop.x, fromY: entryStop.y,
          toX: alightStop.x, toY: alightStop.y,
          estimatedTime: waitTime + rideTime,
          transitType: route.type,
          routeIdx: ri,
          boardStopIdx: si,
          alightStopIdx: ai,
        };

        tryCompleteOrTransfer(
          ri, ai,
          walkToEntry + waitTime + rideTime,
          [firstWalkLeg, rideLeg],
          new Set([ri]),
          1,
        );

        if (results.length >= MAX_RESULTS) break;
      }
      if (results.length >= MAX_RESULTS) break;
    }
    if (results.length >= MAX_RESULTS) break;
  }

  results.sort((a, b) => a.totalTime - b.totalTime);
  return results;
}
