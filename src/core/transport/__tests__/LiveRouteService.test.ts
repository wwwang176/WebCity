import { describe, it, expect } from 'vitest';
import {
  computeDailyCapacity, TRANSIT_SERVICE_TICKS_PER_DAY, CROWDING,
} from '../RouteLoad';
import { flattenSystems, refreshRouteService, type FlatRoute } from '../MultiModalRouter';
import type { TransitSystemInfo } from '../TransitAvailability';
import { TransportType, type TransportRoute, type TransportStop } from '../types';

/**
 * A route's headway and load factor must be the **current** numbers.
 *
 * Computing them once in `flattenSystems()` and storing them on `FlatRoute` is not enough:
 * flat routes are only rebuilt when the player changes the network topology, so ridership
 * growth never reaches them. Measured on a 12,500-citizen save: stored load factor
 * **0.0000192**, recomputed against current ridership **308**.
 *
 * That leaves the whole crowding model inert, with `expectedWait()`'s crowding term always
 * 0, while `findAvailableTransit()` computes the same quantity fresh — the two paths
 * disagreeing about the same route by a factor of 16 million.
 */

function stop(x: number, y: number, riders = 0): TransportStop {
  return {
    id: x * 1000 + y, x, y, type: TransportType.BUS, passengers: 0,
    dailyRiders: riders, lastDayRiders: riders, smoothedDailyRiders: riders,
  } as TransportStop;
}

/** A 100-tile loop: two stops 50 tiles apart, out and back. */
function busRoute(vehicles: number, riders: number): TransportRoute {
  return {
    id: 1, type: TransportType.BUS, vehicles, operatingCost: 100,
    stops: [stop(0, 0, riders), stop(50, 0, riders)],
  };
}

function busSystem(route: TransportRoute, seats = 50, speed = 2): TransitSystemInfo {
  return { type: TransportType.BUS, speed, vehicleCapacity: seats, routes: [route] };
}

describe('運能的刻度', () => {
  it('should measure a service day in its own ticks, not the calendar day', () => {
    // Vehicle speed was chosen to look right on screen; `ticksPerDay` is a calendar constant
    // driving ageing, wages and growth. Dividing cycle ticks by it treats the two clocks as
    // one: measured on a player save, a 282-tile bus route runs 0.17 loops per day, leaving
    // a 50-seat vehicle with 8.5 riders/day.
    const cycleTime = 50;   // 100 tiles / speed 2
    expect(computeDailyCapacity(1, 50, cycleTime))
      .toBeCloseTo(50 * (TRANSIT_SERVICE_TICKS_PER_DAY / cycleTime), 6);
  });

  it('should give a busy line an answer the player can actually act on', () => {
    // The reason the scale exists: the answer has to land in a range the player can reach
    // by adding vehicles.
    const cycleTime = 141;                       // the route from that save
    const perBus = computeDailyCapacity(1, 50, cycleTime);
    const needed = 2623 / perBus;                // 2,623 riders/day

    expect(needed, '一條線要幾百台車 —— 刻度沒有調到玩家做得到的範圍')
      .toBeLessThan(30);
    expect(needed, '一台車就吃得下全城 —— 運能等於不存在').toBeGreaterThan(2);
  });
});

describe('活的班距與載重率', () => {
  function flatten(route: TransportRoute): FlatRoute[] {
    return flattenSystems([busSystem(route)]);
  }

  it('should follow the riders that boarded after the routes were flattened', () => {
    const route = busRoute(1, 0);
    const routes = flatten(route);
    expect(routes[0]!.loadFactor, '一開始就不是零 —— 這個測試沒驗到東西').toBe(0);

    // Riders boarded. The network itself was not touched.
    for (const s of route.stops) { s.dailyRiders = 4000; s.smoothedDailyRiders = 4000; }
    refreshRouteService(routes);

    expect(routes[0]!.loadFactor, '扁平路線還記著人還沒上車時的載重率')
      .toBeGreaterThan(CROWDING.HOPELESS_LOAD);
  });

  it('should shorten the headway without waiting for a re-flatten', () => {
    // Headway is as live as load factor. Refreshing only the load factor leaves the waiting
    // column stale after the player adds a vehicle, and waiting time is what decides whether
    // a citizen rides.
    const route = busRoute(1, 0);
    const routes = flatten(route);
    const before = routes[0]!.headway;

    route.vehicles = 4;
    refreshRouteService(routes);

    expect(routes[0]!.headway, '加了三台車，班距沒有跟著變短').toBeCloseTo(before / 4, 6);
  });

  it('should shorten the headway when the player adds a vehicle', () => {
    // What extra vehicles buy: a shorter headway. It is also the player's only remedy for
    // crowding.
    const one = flatten(busRoute(1, 0))[0]!.headway;
    const four = flatten(busRoute(4, 0))[0]!.headway;

    expect(four, '加了三台車，班距一秒都沒有變短').toBeCloseTo(one / 4, 6);
  });

  it('should relieve the load when the player adds a vehicle', () => {
    const route = busRoute(1, 4000);
    const routes = flatten(route);
    refreshRouteService(routes);
    const before = routes[0]!.loadFactor;

    route.vehicles = 8;
    refreshRouteService(routes);

    expect(routes[0]!.loadFactor, '加車沒有降低載重率').toBeCloseTo(before / 8, 6);
  });

  it('should leave a system with no seat limit alone', () => {
    // Zero seats means the system is not capacity-limited; airports use a separate model.
    const route = busRoute(1, 100_000);
    const routes = flattenSystems([busSystem(route, 0)]);
    refreshRouteService(routes);

    expect(routes[0]!.loadFactor, '不受運能限制的系統被算出了載重').toBe(0);
  });
});
