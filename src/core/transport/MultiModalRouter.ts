/**
 * Multi-modal transit router — finds routes that transfer between
 * different transit lines (up to MAX_TRIP_LEGS legs, walk counts as a leg).
 *
 * Uses pre-computed segment distances from each transit system,
 * so per-citizen search is just table-lookup + addition.
 */

import { TransportType, type TransportStop } from './types';
import { walkDistanceToStop, type StopReach } from '../traffic/StopWalkReach';
import type { StopProximityIndex } from './StopProximityIndex';
import { computeRideDistance, getRouteRiders, type TransitSystemInfo } from './TransitAvailability';
import { expectedWait, routeService } from './RouteLoad';

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
  /** How much of it is walking; charged an extra reluctance factor when comparing, not when reporting. */
  walkTime: number;
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
  /** Headway in ticks: cycle time / vehicle count. Adding vehicles shortens it. */
  headway: number;
  /** Load factor. Waiting time rises with it, with no cap and no refusal threshold. */
  loadFactor: number;
  /**
   * The source route itself, not a copy of its vehicle count.
   *
   * Copying `vehicles` in would leave two places recording it after the player adds a
   * vehicle, and one of them would go stale. This holds the reference and
   * `refreshRouteService()` reads it fresh.
   */
  source: { readonly stops: readonly TransportStop[]; readonly vehicles: number };
  seatsPerVehicle: number;
  /**
   * The current vehicle speed, which congestion changes; `refreshRouteService()` re-reads
   * it every tick.
   *
   * `speed` is only its last value. Without the re-read, estimates use the speed the
   * network had when it was built while the arterials are congested (BUG-343).
   *
   * Optional for the same reason as `TransitSystemInfo.speedOn`: fixtures that do not
   * simulate congestion need not supply one.
   */
  speedOn?: () => number;
}

// ── Helpers ─────────────────────────────────────────────────────

function sk(ri: number, si: number): string {
  return `${ri}:${si}`;
}

// ── flattenSystems ──────────────────────────────────────────────

export function flattenSystems(
  systems: readonly TransitSystemInfo[],
): FlatRoute[] {
  const result: FlatRoute[] = [];
  for (const sys of systems) {
    for (const route of sys.routes) {
      if (route.suspended) continue;
      const segDists = sys.getSegmentDistances?.(route.id) ?? null;
      // Speed including congestion. Ride time and headway both depend on it: a slower
      // vehicle takes longer per loop, which lengthens the headway, which sets loops per
      // day and therefore capacity.
      const speedOn = sys.speedOn ? () => sys.speedOn!(route.id) : undefined;
      const speed = speedOn?.() ?? sys.speed;
      result.push({
        routeId: route.id,
        type: sys.type,
        speed,
        stops: route.stops,
        segDists,
        source: route,
        seatsPerVehicle: sys.vehicleCapacity ?? 0,
        speedOn,
        ...routeService(
          route, getRouteRiders(route), sys.vehicleCapacity ?? 0, speed, segDists,
        ),
      });
    }
  }
  return result;
}

/**
 * Updates every flat route's headway and load factor to their **current** values.
 *
 * Computing them once in `flattenSystems()` is not enough: flat routes are only rebuilt
 * when the player changes the network topology, so ridership growth never reaches them.
 * Measured on a 12,500-citizen save, the stored load factor was 0.0000192 while
 * recomputing against current ridership gave **308**, which left the whole crowding model
 * inert — `expectedWait()`'s crowding term was always 1 — while `findAvailableTransit()`
 * computed the same quantity fresh, so the two paths disagreed by a factor of 16 million
 * (BUG-343).
 *
 * Mutates in place rather than rebuilding the array: `TransferGraph` and
 * `TransitAccessField` index back into it, and replacing the array would invalidate both
 * caches even though they store geometry that has not changed.
 */
export function refreshRouteService(routes: FlatRoute[]): void {
  for (const r of routes) {
    // Speed first: both values below are derived from it.
    if (r.speedOn) r.speed = r.speedOn();
    const { headway, loadFactor } = routeService(
      r.source, getRouteRiders(r.source), r.seatsPerVehicle, r.speed, r.segDists,
    );
    r.headway = headway;
    r.loadFactor = loadFactor;
  }
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

      // Transfers are walked too, so they are measured along the sidewalk graph. Two stops
      // separated only by a road are three tiles apart in a straight line but require a
      // detour to the junction. Leaving one of the four stop-picking sites on straight-line
      // distance leaves one place where they disagree.
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
      // Overloaded routes are not hidden; `expectedWait()` makes them slow enough to lose.

      const targetStop = targetRoute.stops[edge.toSI]!;
      const transferWalkTime = edge.walkDistance / walkSpeed;
      const transferWalkLeg: TransitLeg = {
        type: 'walk',
        fromX: alightStop.x, fromY: alightStop.y,
        toX: targetStop.x, toY: targetStop.y,
        estimatedTime: transferWalkTime,
      };

      const waitTime = expectedWait(targetRoute.headway, waitFactor, targetRoute.loadFactor);

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
    // As above: no refusal threshold, slowness is the penalty.

    for (let si = 0; si < route.stops.length; si++) {
      const entryStop = route.stops[si]!;
      const waitTime = expectedWait(route.headway, waitFactor, route.loadFactor);

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

export const MAX_RESULTS = 20;

/**
 * Finds transfer routes from the precomputed stop-to-stop cache.
 *
 * Cost per citizen is reachable-entries x reachable-exits lookups. A per-stop scan costs
 * city-stops + reachable-entries x city-stops instead, because the exit-side walk distance
 * is measured **inside** the entry loop even though it does not depend on the entry stop.
 * Measured on a synthetic city with 192 stops and 9.8 reachable per citizen: 2,005
 * walk-distance queries per citizen, 1,882 of them redundant.
 */
export function findMultiModalRoutes(
  routes: readonly FlatRoute[],
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  walkSpeed: number,
  _waitFactor: number,
  transferGraph: TransferGraph,
  _maxLegs: number,
  index: StopProximityIndex,
): MultiLegRoute[] {
  if (routes.length === 0) return [];

  // The index is already truncated to each transport type's walk limit and measured along
  // the sidewalk graph; straight-line distance cannot see roads and would walk households
  // to a stop across the street.
  const entries = index.at(origin.x, origin.y);
  if (entries.length === 0) return [];
  const exits = index.at(destination.x, destination.y);
  if (exits.length === 0) return [];

  const cache = transferGraph.stopRouteCache;
  const results: MultiLegRoute[] = [];

  for (const entry of entries) {
    const entryStop = routes[entry.routeIdx]?.stops[entry.stopIdx];
    if (entryStop === undefined) continue;

    const firstWalkTime = entry.walkDistance / walkSpeed;
    const firstWalkLeg: TransitLeg = {
      type: 'walk',
      fromX: origin.x, fromY: origin.y,
      toX: entryStop.x, toY: entryStop.y,
      estimatedTime: firstWalkTime,
    };

    for (const exit of exits) {
      const cached = cache.get(cacheKey(entry.routeIdx, entry.stopIdx, exit.routeIdx, exit.stopIdx));
      if (!cached) continue;
      const exitStop = routes[exit.routeIdx]?.stops[exit.stopIdx];
      if (exitStop === undefined) continue;

      const lastWalkTime = exit.walkDistance / walkSpeed;
      const lastWalkLeg: TransitLeg = {
        type: 'walk',
        fromX: exitStop.x, fromY: exitStop.y,
        toX: destination.x, toY: destination.y,
        estimatedTime: lastWalkTime,
      };

      const legs = [firstWalkLeg, ...cached.legs, lastWalkLeg];
      results.push({
        legs,
        totalTime: firstWalkTime + cached.totalTime + lastWalkTime,
        // The middle legs may include transfer walks, so every walk leg is summed rather
        // than only the first and last.
        walkTime: legs.reduce((s, l) => l.type === 'walk' ? s + l.estimatedTime : s, 0),
      });

      if (results.length >= MAX_RESULTS) break;
    }
    if (results.length >= MAX_RESULTS) break;
  }

  results.sort((a, b) => a.totalTime - b.totalTime);
  return results;
}
