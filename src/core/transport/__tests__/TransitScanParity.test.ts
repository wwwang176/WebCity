import { describe, it, expect } from 'vitest';
import {
  buildTransferGraph, buildStopRouteCache, findMultiModalRoutes, MAX_RESULTS,
  type FlatRoute, type MultiLegRoute, type TransferGraph,
} from '../MultiModalRouter';
import { computeRideDistance, findAvailableTransit } from '../TransitAvailability';
import { StopProximityIndex } from '../StopProximityIndex';
import { expectedWait } from '../RouteLoad';
import { walkRangeFor, WALK_RANGE_BY_TYPE } from '../WalkRange';
import { walkDistanceToStop, type StopReach } from '../../traffic/StopWalkReach';
import { openFieldReach } from './openFieldReach';
import type { AvailableTransport } from '../ModeChoice';
import { TransportType, type TransportStop } from '../types';

/**
 * Both functions pick stops by **scanning every stop**, measuring a walk distance per city
 * stop per citizen asked. The per-cell index replaces that with a lookup, and this kind of
 * data-structure swap fails silently: a missing route, a tie broken the other way, a
 * different candidate ordering — none turns an existing test red, yet each leaves some
 * citizens unable to reach transit.
 *
 * The per-stop scan is therefore retained here as a **reference implementation** and
 * compared trip by trip against random cities. The reference reads the same fields as
 * production (`FlatRoute` headway, load factor, speed); the only difference is how
 * candidate stops are found, which is exactly what is under test.
 */

// ── Reference implementation: per-stop scan ─────────────────────

function naiveAvailable(
  routes: readonly FlatRoute[],
  origin: { x: number; y: number }, destination: { x: number; y: number },
  reach: StopReach, walkSpeed: number, waitFactor: number,
): AvailableTransport[] {
  const result: AvailableTransport[] = [];
  for (const route of routes) {
    const walkRange = walkRangeFor(route.type);
    let bestOriginIdx = -1, bestOriginDist = Infinity;
    let bestDestIdx = -1, bestDestDist = Infinity;
    for (let i = 0; i < route.stops.length; i++) {
      const stop = route.stops[i]!;
      const scan = WALK_RANGE_BY_TYPE.WIDEST;
      const dOrigin = walkDistanceToStop(reach, stop.x, stop.y, origin.x, origin.y, scan);
      const dDest = walkDistanceToStop(reach, stop.x, stop.y, destination.x, destination.y, scan);
      if (dOrigin <= walkRange && dOrigin < bestOriginDist) { bestOriginIdx = i; bestOriginDist = dOrigin; }
      if (dDest <= walkRange && dDest < bestDestDist) { bestDestIdx = i; bestDestDist = dDest; }
    }
    if (bestOriginIdx < 0 || bestDestIdx < 0) continue;

    const walkTime = (bestOriginDist + bestDestDist) / walkSpeed;
    const boardStop = route.stops[bestOriginIdx]!;
    const alightStop = route.stops[bestDestIdx]!;
    if (bestOriginIdx === bestDestIdx) {
      result.push({ type: route.type, estimatedTime: walkTime, walkTime, boardStop, alightStop });
      continue;
    }
    const rideDistance = computeRideDistance(route.stops, bestOriginIdx, bestDestIdx, route.segDists);
    result.push({
      type: route.type,
      estimatedTime: walkTime + expectedWait(route.headway, waitFactor, route.loadFactor)
        + rideDistance / route.speed,
      walkTime, boardStop, alightStop,
    });
  }
  return result;
}

function naiveMultiModal(
  routes: readonly FlatRoute[],
  origin: { x: number; y: number }, destination: { x: number; y: number },
  walkSpeed: number, transferGraph: TransferGraph, reach: StopReach,
): MultiLegRoute[] {
  if (routes.length === 0) return [];
  const cache = transferGraph.stopRouteCache;
  const results: MultiLegRoute[] = [];

  for (let eri = 0; eri < routes.length; eri++) {
    const eRoute = routes[eri]!;
    for (let esi = 0; esi < eRoute.stops.length; esi++) {
      const entryStop = eRoute.stops[esi]!;
      const walkToEntry = walkDistanceToStop(
        reach, entryStop.x, entryStop.y, origin.x, origin.y, WALK_RANGE_BY_TYPE.WIDEST,
      );
      if (walkToEntry > walkRangeFor(eRoute.type)) continue;

      const firstWalkTime = walkToEntry / walkSpeed;
      const firstWalkLeg = {
        type: 'walk' as const,
        fromX: origin.x, fromY: origin.y, toX: entryStop.x, toY: entryStop.y,
        estimatedTime: firstWalkTime,
      };

      for (let xri = 0; xri < routes.length; xri++) {
        const xRoute = routes[xri]!;
        for (let xsi = 0; xsi < xRoute.stops.length; xsi++) {
          const exitStop = xRoute.stops[xsi]!;
          const walkFromExit = walkDistanceToStop(
            reach, exitStop.x, exitStop.y, destination.x, destination.y, WALK_RANGE_BY_TYPE.WIDEST,
          );
          if (walkFromExit > walkRangeFor(xRoute.type)) continue;
          const cached = cache.get(`${eri}:${esi}>${xri}:${xsi}`);
          if (!cached) continue;

          const lastWalkTime = walkFromExit / walkSpeed;
          const legs = [firstWalkLeg, ...cached.legs, {
            type: 'walk' as const,
            fromX: exitStop.x, fromY: exitStop.y, toX: destination.x, toY: destination.y,
            estimatedTime: lastWalkTime,
          }];
          results.push({
            legs,
            totalTime: firstWalkTime + cached.totalTime + lastWalkTime,
            walkTime: legs.reduce((s, l) => l.type === 'walk' ? s + l.estimatedTime : s, 0),
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

// ── Random cities ──────────────────────────────────────────────

const GRID = 40;
const WALK_SPEED = 0.3;
const WAIT_FACTOR = 0.5;
const TRANSFER_RANGE = 3;
const MAX_LEGS = 7;

function rngOf(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const TYPES = [TransportType.BUS, TransportType.METRO, TransportType.FERRY];

function randomCity(seed: number): FlatRoute[] {
  const rnd = rngOf(seed);
  const routeCount = 2 + Math.floor(rnd() * 4);
  const routes: FlatRoute[] = [];
  let stopId = 1;
  for (let r = 0; r < routeCount; r++) {
    const type = TYPES[Math.floor(rnd() * TYPES.length)]!;
    const stopCount = 2 + Math.floor(rnd() * 5);
    const stops: TransportStop[] = [];
    for (let i = 0; i < stopCount; i++) {
      stops.push({
        id: stopId++,
        x: Math.floor(rnd() * GRID), y: Math.floor(rnd() * GRID), type,
        passengers: 0, dailyRiders: 0,
        lastDayRiders: Math.floor(rnd() * 400), smoothedDailyRiders: Math.floor(rnd() * 400),
      });
    }
    routes.push({
      routeId: r + 1, type, speed: 1 + rnd() * 3, stops, segDists: null,
      headway: 4 + rnd() * 20, loadFactor: rnd() * 2,
      source: { stops, vehicles: 1 + Math.floor(rnd() * 4) },
      seatsPerVehicle: 50,
    });
  }
  return routes;
}

describe('逐格索引與逐站掃描回報同一件事', () => {
  for (let seed = 1; seed <= 6; seed++) {
    it(`agrees on every trip in city #${seed}`, () => {
      const routes = randomCity(seed);
      const graph = buildTransferGraph(routes, TRANSFER_RANGE, openFieldReach);
      buildStopRouteCache(routes, graph, WALK_SPEED, WAIT_FACTOR, MAX_LEGS);
      const index = StopProximityIndex.build(routes, openFieldReach);

      const rnd = rngOf(seed + 1000);
      let sawAvailable = 0, sawMulti = 0;
      for (let trip = 0; trip < 120; trip++) {
        const o = { x: Math.floor(rnd() * GRID), y: Math.floor(rnd() * GRID) };
        const d = { x: Math.floor(rnd() * GRID), y: Math.floor(rnd() * GRID) };

        const fast = findAvailableTransit(routes, index, o, d, WALK_SPEED, WAIT_FACTOR);
        const slow = naiveAvailable(routes, o, d, openFieldReach, WALK_SPEED, WAIT_FACTOR);
        expect(fast, `單一運具在 (${o.x},${o.y})→(${d.x},${d.y}) 分岔了`).toEqual(slow);
        sawAvailable += fast.length;

        const fastMM = findMultiModalRoutes(
          routes, o, d, WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS, index,
        );
        const slowMM = naiveMultiModal(routes, o, d, WALK_SPEED, graph, openFieldReach);
        expect(fastMM, `轉乘在 (${o.x},${o.y})→(${d.x},${d.y}) 分岔了`).toEqual(slowMM);
        sawMulti += fastMM.length;
      }

      // Two empty arrays also compare equal, so these guard against a city so sparse that
      // nothing was actually compared.
      expect(sawAvailable, '這座城市沒有任何一趟搭得到車，等於沒比').toBeGreaterThan(0);
      expect(sawMulti, '這座城市沒有任何一趟走得到轉乘路線，等於沒比').toBeGreaterThan(0);
    });
  }
});
