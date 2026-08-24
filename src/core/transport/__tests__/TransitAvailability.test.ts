import { describe, it, expect } from 'vitest';
import { availableTransitFor } from './availableTransitFor';
import { getRouteDailyRiders, getRouteRiders, type TransitSystemInfo } from '../TransitAvailability';
import { openFieldReach } from './openFieldReach';
import { computeCycleTime, computeDailyCapacity, computeHeadway, expectedWait } from '../RouteLoad';

const WALK_SPEED = 1;
const WAIT_FACTOR = 0.5;
const TICKS_PER_DAY = 24;
import { TransportType, type TransportStop } from '../types';

function makeStop(x: number, y: number, id = 1): TransportStop {
  return { id, x, y, type: TransportType.BUS, passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0 };
}

/**
 * Waiting time for this route.
 *
 * The ride-distance tests below subtract it to isolate the ride. Computed from the same
 * public functions rather than assumed to be zero: headway is cycle time / vehicle count
 * and cannot be set to zero.
 */
function waitOf(sys: TransitSystemInfo): number {
  const route = sys.routes[0]!;
  const segDists = sys.getSegmentDistances?.(route.id) ?? null;
  const cycle = computeCycleTime(route.stops, segDists, sys.speed);
  return expectedWait(computeHeadway(cycle, route.vehicles), WAIT_FACTOR, 0);
}

describe('findAvailableTransit', () => {
  it('returns empty array when no transit systems exist', () => {
    const result = availableTransitFor([], { x: 0, y: 0 }, { x: 10, y: 10 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toEqual([]);
  });

  it('returns empty array when no route has stops near both origin and destination', () => {
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{
        id: 1, type: TransportType.BUS, stops: [makeStop(50, 50), makeStop(60, 60)],
        vehicles: 1, operatingCost: 100,
      }],
    }];
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toEqual([]);
  });

  it('returns transport option when route has stops near both origin and destination', () => {
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{
        id: 1, type: TransportType.BUS,
        stops: [makeStop(1, 1, 1), makeStop(9, 9, 2)],
        vehicles: 1, operatingCost: 100,
      }],
    }];
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe(TransportType.BUS);
    expect(result[0]!.estimatedTime).toBeGreaterThan(0);
  });

  it('returns multiple transport options from different systems', () => {
    const systems: TransitSystemInfo[] = [
      {
        type: TransportType.BUS,
        speed: 2,
        routes: [{
          id: 1, type: TransportType.BUS,
          stops: [makeStop(1, 1, 1), makeStop(9, 9, 2)],
          vehicles: 1, operatingCost: 100,
        }],
      },
      {
        type: TransportType.METRO,
        speed: 3,
        routes: [{
          id: 2, type: TransportType.METRO,
          stops: [makeStop(0, 2, 3), makeStop(8, 10, 4)],
          vehicles: 1, operatingCost: 300,
        }],
      },
    ];
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(2);
    const types = result.map(r => r.type);
    expect(types).toContain(TransportType.BUS);
    expect(types).toContain(TransportType.METRO);
  });

  it('metro is faster than bus due to higher speed and euclidean distance', () => {
    // Same stops, but metro speed=3 vs bus speed=2, and metro uses euclidean (shorter)
    const stops = [makeStop(0, 0, 1), makeStop(10, 10, 2)];
    const systems: TransitSystemInfo[] = [
      {
        type: TransportType.BUS,
        speed: 2,
        routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 }],
      },
      {
        type: TransportType.METRO,
        speed: 3,
        routes: [{ id: 2, type: TransportType.METRO, stops, vehicles: 1, operatingCost: 300 }],
      },
    ];
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    const bus = result.find(r => r.type === TransportType.BUS)!;
    const metro = result.find(r => r.type === TransportType.METRO)!;
    expect(metro.estimatedTime).toBeLessThan(bus.estimatedTime);
  });

  it('only considers stops within walk range', () => {
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{
        id: 1, type: TransportType.BUS,
        stops: [makeStop(0, 0, 1), makeStop(10, 10, 2)],
        vehicles: 1, operatingCost: 100,
      }],
    }];
    const result = availableTransitFor(systems, { x: 1, y: 1 }, { x: 5, y: 5 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(0);
  });

  // ── Route-based distance tests ─────────────────────────────────

  it('uses segment distances when provided (bus with detour)', () => {
    // Bus route with 3 stops, segment distances show a detour
    const stops = [makeStop(0, 0, 1), makeStop(5, 0, 2), makeStop(10, 0, 3)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 }],
      // Segment distances: stop0→stop1 = 20 (detour!), stop1→stop2 = 15, stop2→stop0 = 10
      getSegmentDistances: (routeId: number) => routeId === 1 ? [20, 15, 10] : null,
    }];
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 10, y: 0 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(1);
    // Forward: stop0→stop1→stop2 = 20+15 = 35, backward: stop2→stop0 = 10
    // Picks shorter direction: 10 / speed=2 = 5
    expect(result[0]!.estimatedTime - waitOf(systems[0]!)).toBeCloseTo(5);
  });

  it('falls back to euclidean stop-to-stop distance when no segment distances', () => {
    // Metro with no segment distances — should use euclidean between stops
    const stops = [makeStop(0, 0, 1), makeStop(3, 4, 2)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.METRO,
      speed: 3,
      routes: [{ id: 1, type: TransportType.METRO, stops, vehicles: 1, operatingCost: 300 }],
    }];
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 3, y: 4 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(1);
    // Euclidean distance = 5, speed = 3 → time = 5/3
    expect(result[0]!.estimatedTime - waitOf(systems[0]!)).toBeCloseTo(5 / 3);
  });

  it('handles circular route forward traversal correctly', () => {
    // Route: A(0,0) → B(5,0) → C(5,5) → back to A
    // Passenger from near C to near A should go C→A (one segment), not C→A→B→C
    const stops = [makeStop(0, 0, 1), makeStop(5, 0, 2), makeStop(5, 5, 3)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 }],
      // seg0: A→B = 10, seg1: B→C = 8, seg2: C→A = 12
      getSegmentDistances: (routeId: number) => routeId === 1 ? [10, 8, 12] : null,
    }];
    // Origin near C (5,5), destination near A (0,0) → forward: C→A = seg2 = 12
    const result = availableTransitFor(systems, { x: 5, y: 5 }, { x: 0, y: 0 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(1);
    // Forward from C(idx=2) to A(idx=0): seg2 = 12, time = 12/2 = 6
    expect(result[0]!.estimatedTime - waitOf(systems[0]!)).toBeCloseTo(6);
  });

  it('picks the shorter direction around circular route', () => {
    // Route: A(0,0) → B(10,0) → C(10,10) → back to A
    // seg0: A→B = 10, seg1: B→C = 10, seg2: C→A = 10
    const stops = [makeStop(0, 0, 1), makeStop(10, 0, 2), makeStop(10, 10, 3)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 }],
      getSegmentDistances: (routeId: number) => routeId === 1 ? [10, 10, 10] : null,
    }];
    // Origin near A(0,0), dest near B(10,0)
    // Forward A→B = seg0 = 10, backward A←C←B = seg2+seg1 = 20
    // Should pick forward = 10, time = 10/2 = 5
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 10, y: 0 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime - waitOf(systems[0]!)).toBeCloseTo(5);
  });

  it('still charges the walk when origin and dest map to the same stop', () => {
    // Boarding and alighting at the same stop is not a ride, but the walk to it was still
    // spent. Reporting 0 would make the route free and instantaneous, so it would beat
    // every other option.
    const stops = [makeStop(0, 0, 1), makeStop(10, 0, 2)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 }],
      getSegmentDistances: () => [10, 10],
    }];
    // Both origin and dest are closest to stop at (0,0)
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 0, y: 1 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime, '同站上下車卻免費').toBe(1);
  });

  it('ferry uses segment distances from water path cache', () => {
    const stops = [makeStop(0, 0, 1), makeStop(8, 8, 2)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.FERRY,
      speed: 0.375,
      routes: [{ id: 1, type: TransportType.FERRY, stops, vehicles: 1, operatingCost: 200 }],
      // Water path distance = 15 (longer than euclidean ~11.3)
      getSegmentDistances: (routeId: number) => routeId === 1 ? [15, 15] : null,
    }];
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 8, y: 8 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime - waitOf(systems[0]!)).toBeCloseTo(15 / 0.375);
  });

  // ── Capacity filtering tests ──────────────────────────────────
  //
  // Rider counts are derived from the model rather than hardcoded. Capacity is
  // vehicles * seats * loops per day, so literal numbers would need updating on every
  // constant change and would hide which assumption moved.

  const SEATS = 50;
  const busStops = () => [makeStop(1, 1, 1), makeStop(9, 9, 2)];

  /** Riders this route can carry per day. */
  function dailyCapacityOf(stops: TransportStop[], vehicles: number, speed = 2): number {
    return computeDailyCapacity(vehicles, SEATS, computeCycleTime(stops, null, speed));
  }

  function busSystemWith(stops: TransportStop[], vehicles: number): TransitSystemInfo {
    return {
      type: TransportType.BUS, speed: 2, vehicleCapacity: SEATS,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles, operatingCost: 100 }],
    };
  }

  function offeredFor(stops: TransportStop[], vehicles: number) {
    return availableTransitFor(
      [busSystemWith(stops, vehicles)], { x: 0, y: 0 }, { x: 10, y: 10 },
      openFieldReach, WALK_SPEED, WAIT_FACTOR);
  }

  it('punishes a route nobody can squeeze onto with time, not silence', () => {
    // There is no refusal threshold. An overloaded route is still listed; its waiting time
    // grows until it loses on its own. A cliff produces a limit cycle, observed on a
    // 12,600-citizen save.
    const stops = busStops();
    stops[0]!.lastDayRiders = dailyCapacityOf(stops, 3) * 2;
    const packed = offeredFor(stops, 3);
    expect(packed, '擠爆的路線被整條藏起來了').toHaveLength(1);

    // Load 2 means half the queue cannot board, i.e. **one whole extra headway** on
    // average. The walking and riding legs are unchanged, so the difference is exactly that
    // headway. Comparing ratios would be meaningless: walking and riding dilute them.
    const quiet = busStops();
    const empty = offeredFor(quiet, 3)[0]!.estimatedTime;
    const headway = computeHeadway(computeCycleTime(quiet, null, 2), 3);
    expect(packed[0]!.estimatedTime - empty, '擠成這樣跟空車一樣快')
      .toBeCloseTo(headway, 6);
  });

  it('returns route with remaining capacity', () => {
    const stops = busStops();
    stops[0]!.lastDayRiders = dailyCapacityOf(stops, 3) * 0.3;
    const result = offeredFor(stops, 3);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe(TransportType.BUS);
  });

  it('adding vehicles makes an overloaded route usable again', () => {
    // What extra vehicles buy is **time**: at 3 vehicles passengers wait several headways,
    // at 5 the route absorbs them.
    const stops = busStops();
    stops[0]!.lastDayRiders = dailyCapacityOf(stops, 3) * 1.6;

    const three = offeredFor(stops, 3)[0]!.estimatedTime;
    const five = offeredFor(stops, 5)[0]!.estimatedTime;
    expect(five, '加了兩台車，通勤時間一秒都沒有變短').toBeLessThan(three);
  });

  it('should make waiting shorter as well, not just raise the ceiling', () => {
    // Extra vehicles buy more than capacity: headway is cycle time / vehicle count, so more
    // vehicles means more frequent service.
    const stops = busStops();
    stops[0]!.lastDayRiders = dailyCapacityOf(stops, 2) * 0.3;
    const two = offeredFor(stops, 2)[0]!.estimatedTime;
    const four = offeredFor(stops, 4)[0]!.estimatedTime;
    expect(four, '加車沒有讓等車變短').toBeLessThan(two);
  });

  it('should make waiting longer as the route fills up', () => {
    const stops = busStops();
    stops[0]!.lastDayRiders = dailyCapacityOf(stops, 3) * 0.2;
    const quiet = offeredFor(stops, 3)[0]!.estimatedTime;

    const packedStops = busStops();
    packedStops[0]!.lastDayRiders = dailyCapacityOf(packedStops, 3) * 1.2;
    const packed = offeredFor(packedStops, 3)[0]!.estimatedTime;

    expect(packed, '擠成這樣還是等一樣久').toBeGreaterThan(quiet);
  });

  it('does not offer a route that is suspended', () => {
    // Suspended means the route's road was demolished and no vehicle is running
    // (`BusSystem.onRoadChanged`). The transfer path already skips it via
    // `if (route.suspended) continue` in `flattenSystems`; the single-mode path must too,
    // otherwise one path calls the same suspended bus unreachable while the other offers it
    // and credits riders to it.
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{
        id: 1, type: TransportType.BUS,
        stops: [makeStop(1, 1, 1), makeStop(9, 9, 2)],
        vehicles: 1, operatingCost: 100, suspended: true,
      }],
    }];
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toEqual([]);
  });

  it('prefers the route with room over the packed one in the same system', () => {
    const stopsA = busStops();
    stopsA[0]!.lastDayRiders = dailyCapacityOf(stopsA, 2) * 2;

    const stopsB = [makeStop(2, 2, 3), makeStop(8, 8, 4)];
    stopsB[0]!.lastDayRiders = dailyCapacityOf(stopsB, 2) * 0.1;

    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      vehicleCapacity: SEATS,
      routes: [
        { id: 1, type: TransportType.BUS, stops: stopsA, vehicles: 2, operatingCost: 100 },
        { id: 2, type: TransportType.BUS, stops: stopsB, vehicles: 2, operatingCost: 100 },
      ],
    }];
    const result = availableTransitFor(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    // Both are listed, but the emptier one is faster, and mode choice picks the fastest.
    expect(result).toHaveLength(2);
    const packed = result.find(r => r.boardStop?.id === stopsA[0]!.id)!;
    const roomy = result.find(r => r.boardStop?.id === stopsB[0]!.id)!;
    expect(roomy.estimatedTime, '有位子的那條反而比較慢')
      .toBeLessThan(packed.estimatedTime);
  });
});

describe('getRouteDailyRiders', () => {
  it('sums dailyRiders across all stops', () => {
    const stops = [makeStop(0, 0, 1), makeStop(5, 5, 2), makeStop(10, 10, 3)];
    stops[0]!.dailyRiders = 10;
    stops[1]!.dailyRiders = 25;
    stops[2]!.dailyRiders = 15;
    const route = { id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 };
    expect(getRouteDailyRiders(route)).toBe(50);
  });

  it('returns 0 for route with no riders', () => {
    const stops = [makeStop(0, 0, 1), makeStop(5, 5, 2)];
    const route = { id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 };
    expect(getRouteDailyRiders(route)).toBe(0);
  });
});

describe('getRouteRiders', () => {
  it('should fall back to the cross-day average early in the day', () => {
    // dailyRiders resets each day. Using it directly for load makes every route look empty
    // each morning, delays the crowding penalty until evening, and resets again the next
    // day — a visible saw-tooth.
    const stops = [makeStop(0, 0, 1), makeStop(5, 5, 2)];
    stops[0]!.smoothedDailyRiders = 300;
    stops[0]!.lastDayRiders = 5; // yesterday happened to be quiet
    const route = { id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 };

    expect(getRouteRiders(route), '昨天的一次低點就把整條線當成空的').toBe(300);
  });

  it('should use yesterday when yesterday was busier than usual', () => {
    // A route that spiked yesterday: the smoothed value has not caught up, so yesterday's
    // actual count is used.
    //
    // The window is a **complete day** rather than "today so far", because capacity is per
    // day and the two units must match. Today's running total makes load saw-tooth once per
    // game day (measured at 5.56 to 47.34 on a player save).
    const stops = [makeStop(0, 0, 1), makeStop(5, 5, 2)];
    stops[0]!.smoothedDailyRiders = 20;
    stops[0]!.lastDayRiders = 400;
    const route = { id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 };

    expect(getRouteRiders(route), '昨天暴增卻還在看好幾天的平均').toBe(400);
  });
});
