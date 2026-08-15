/**
 * Multi-modal transit router — finds routes that transfer between
 * different transit lines (up to MAX_TRIP_LEGS legs, walk counts as a leg).
 *
 * Uses pre-computed segment distances from each transit system,
 * so per-citizen search is just table-lookup + addition.
 */

import { TransportType, type TransportStop } from './types';
import { walkDistanceToStop, type StopReach } from '../traffic/StopWalkReach';
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
  /** Pre-computed best route between every (entry, exit) stop pair.
   *  Key: "entryRI:entrySI>exitRI:exitSI" → middle legs + ride time. */
  stopRouteCache: Map<string, StopToStopRoute>;
}

/** Cached route between two stops (excludes first/last mile walks). */
export interface StopToStopRoute {
  /** ride + transfer_walk legs only */
  legs: TransitLeg[];
  /** Total time of ride(s) + wait(s) + transfer walk(s) */
  totalTime: number;
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
  reach: StopReach,
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

      // 轉乘也是用走的，一樣照人行道量 —— 只差一條馬路的兩個站牌，直線是三格，
      // 實際上得繞到路口。四個挑站的地方留一個用直線，就是留一個會不一致的縫。
      const dist = walkDistanceToStop(reach, a.stop.x, a.stop.y, b.stop.x, b.stop.y, transferRange);
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

  return { byStop, stopRouteCache: new Map() };
}

// ── Stop-to-Stop Route Cache ────────────────────────────────────

function cacheKey(entryRI: number, entrySI: number, exitRI: number, exitSI: number): string {
  return `${entryRI}:${entrySI}>${exitRI}:${exitSI}`;
}

/**
 * Pre-compute the best multi-modal route between every reachable
 * (entry stop, exit stop) pair. Called once when the transfer graph
 * is rebuilt; per-citizen search then becomes pure lookup.
 */
export function buildStopRouteCache(
  routes: readonly FlatRoute[],
  transferGraph: TransferGraph,
  walkSpeed: number,
  waitFactor: number,
  maxLegs: number,
): void {
  const cache = transferGraph.stopRouteCache;
  cache.clear();

  const maxRides = Math.floor((maxLegs - 1) / 2);
  if (maxRides < 1) return;

  const hasTransferEdges = new Set<string>(transferGraph.byStop.keys());

  function tryCache(
    entryRI: number, entrySI: number,
    exitRI: number, exitSI: number,
    legs: TransitLeg[], totalTime: number,
  ): void {
    const key = cacheKey(entryRI, entrySI, exitRI, exitSI);
    const existing = cache.get(key);
    if (!existing || totalTime < existing.totalTime) {
      cache.set(key, { legs: legs.slice(), totalTime });
    }
  }

  /** DFS: from an alight stop, try transfer + ride to reach more exits. */
  function exploreTransfers(
    entryRI: number, entrySI: number,
    alightRI: number, alightSI: number,
    timeSoFar: number, legsSoFar: TransitLeg[],
    usedRoutes: Set<number>, rideNum: number,
  ): void {
    if (rideNum >= maxRides) return;
    const key = sk(alightRI, alightSI);
    if (!hasTransferEdges.has(key)) return;

    const edges = transferGraph.byStop.get(key)!;
    const alightStop = routes[alightRI]!.stops[alightSI]!;

    for (const edge of edges) {
      if (usedRoutes.has(edge.toRI)) continue;
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

      for (let ai = 0; ai < targetRoute.stops.length; ai++) {
        if (ai === edge.toSI) continue;
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

        const newTime = timeSoFar + transferWalkTime + waitTime + rideTime;
        const newLegs = [...legsSoFar, transferWalkLeg, rideLeg];

        // Cache this exit
        tryCache(entryRI, entrySI, edge.toRI, ai, newLegs, newTime);

        // Recurse for more transfers
        if (rideNum + 1 < maxRides && hasTransferEdges.has(sk(edge.toRI, ai))) {
          const newUsed = new Set(usedRoutes);
          newUsed.add(edge.toRI);
          exploreTransfers(
            entryRI, entrySI, edge.toRI, ai,
            newTime, newLegs, newUsed, rideNum + 1,
          );
        }
      }
    }
  }

  // For each entry stop, explore all reachable exits
  for (let ri = 0; ri < routes.length; ri++) {
    const route = routes[ri]!;
    if (route.isFull) continue;

    for (let si = 0; si < route.stops.length; si++) {
      const entryStop = route.stops[si]!;
      const waitTime = route.frequency * waitFactor;

      // Single ride: board at (ri,si), alight at (ri,ai)
      for (let ai = 0; ai < route.stops.length; ai++) {
        if (ai === si) continue;
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

        tryCache(ri, si, ri, ai, [rideLeg], waitTime + rideTime);

        // Explore transfers from this alight stop
        if (maxRides >= 2 && hasTransferEdges.has(sk(ri, ai))) {
          exploreTransfers(
            ri, si, ri, ai,
            waitTime + rideTime, [rideLeg],
            new Set([ri]), 1,
          );
        }
      }
    }
  }
}

// ── Multi-Modal Route Search (cache-backed) ─────────────────────

const MAX_RESULTS = 20;

/**
 * Find multi-modal routes using the pre-computed stop-to-stop cache.
 * Per-citizen cost: iterate nearby stops × cache lookup (no DFS).
 */
export function findMultiModalRoutes(
  routes: readonly FlatRoute[],
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  walkRange: number,
  walkSpeed: number,
  _waitFactor: number,
  transferGraph: TransferGraph,
  _maxLegs: number,
  reach: StopReach,
): MultiLegRoute[] {
  if (routes.length === 0) return [];

  const cache = transferGraph.stopRouteCache;

  const results: MultiLegRoute[] = [];

  // For each entry stop near origin × each exit stop near destination, lookup cache
  for (let eri = 0; eri < routes.length; eri++) {
    const eRoute = routes[eri]!;
    if (eRoute.isFull) continue;
    for (let esi = 0; esi < eRoute.stops.length; esi++) {
      const entryStop = eRoute.stops[esi]!;
      // 沿人行道量，不是直線 —— 直線看不見馬路，會把住戶從對街「走」到站牌。
      const walkToEntry = walkDistanceToStop(
        reach, entryStop.x, entryStop.y, origin.x, origin.y, walkRange,
      );
      if (walkToEntry > walkRange) continue;

      const firstWalkTime = walkToEntry / walkSpeed;
      const firstWalkLeg: TransitLeg = {
        type: 'walk',
        fromX: origin.x, fromY: origin.y,
        toX: entryStop.x, toY: entryStop.y,
        estimatedTime: firstWalkTime,
      };

      for (let xri = 0; xri < routes.length; xri++) {
        const xRoute = routes[xri]!;
        for (let xsi = 0; xsi < xRoute.stops.length; xsi++) {
          const exitStop = xRoute.stops[xsi]!;
          const walkFromExit = walkDistanceToStop(
            reach, exitStop.x, exitStop.y, destination.x, destination.y, walkRange,
          );
          if (walkFromExit > walkRange) continue;

          const cached = cache.get(cacheKey(eri, esi, xri, xsi));
          if (!cached) continue;

          const lastWalkTime = walkFromExit / walkSpeed;
          const lastWalkLeg: TransitLeg = {
            type: 'walk',
            fromX: exitStop.x, fromY: exitStop.y,
            toX: destination.x, toY: destination.y,
            estimatedTime: lastWalkTime,
          };

          results.push({
            legs: [firstWalkLeg, ...cached.legs, lastWalkLeg],
            totalTime: firstWalkTime + cached.totalTime + lastWalkTime,
          });

          if (results.length >= MAX_RESULTS) break;
        }
        if (results.length >= MAX_RESULTS) break;
      }
      if (results.length >= MAX_RESULTS) break;
    }
    if (results.length >= MAX_RESULTS) break;
  }

  results.sort((a, b) => a.totalTime - b.totalTime);
  return results;
}
