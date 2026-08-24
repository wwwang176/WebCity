import { describe, it, expect } from 'vitest';
import { buildTransitRows, type TransitSystemSource } from '../transitRows';
import { TransportType, type TransportRoute, type TransportStop } from '../../../../core/transport/types';
import { TRANSIT_SERVICE_TICKS_PER_DAY } from '../../../../core/transport/RouteLoad';

/**
 * The panel's Usage column.
 *
 * In a 12,500-person save, one bus route at one moment showed three numbers: 100% on the collapsed
 * row, 5,246% on the expanded row and 30,853% from the simulation's own formula. Two faults:
 *
 * 1. The panel computed capacity as `vehicles x seats`, an **instantaneous** seat count, and compared
 *    it against a whole day's accumulated trips. That is the mistake `computeDailyCapacity()`
 *    documents, fixed in the simulation.
 * 2. The collapsed row clamped at 100% through `Math.min`, while `formatRouteUsage()` carries a whole
 *    paragraph saying not to clamp: a route at 105% and one at 400% have to look different, as that
 *    is the player's only basis for deciding how many vehicles to add.
 */

/** Capacity's own measure, which is not a calendar day; see `TRANSIT_SERVICE_TICKS_PER_DAY`. */
const SERVICE_TICKS = TRANSIT_SERVICE_TICKS_PER_DAY;

function stop(x: number, y: number, riders = 0): TransportStop {
  return {
    id: x * 1000 + y, x, y, type: TransportType.BUS, passengers: 0,
    dailyRiders: riders, lastDayRiders: riders, smoothedDailyRiders: riders,
  } as TransportStop;
}

function route(id: number, stops: TransportStop[], vehicles: number): TransportRoute {
  return { id, type: TransportType.BUS, stops, vehicles, operatingCost: 100 };
}

/** A loop 100 cells long: two stops 50 cells apart, exactly 100 there and back. */
function loopOf100(riders: number): TransportStop[] {
  return [stop(0, 0, riders), stop(50, 0, riders)];
}

function busSystem(routes: TransportRoute[], seats: number, speed: number): TransitSystemSource {
  const stops = routes.flatMap(r => r.stops);
  return {
    type: TransportType.BUS,
    routes,
    stops,
    seatsPerVehicle: seats,
    speed,
    vehicleCount: routes.reduce((s, r) => s + r.vehicles, 0),
    operatingCost: routes.reduce((s, r) => s + r.operatingCost, 0),
    segmentDistances: () => null,
  };
}

describe('面板的路線載重', () => {
  it('should count how many loops a vehicle makes in a day', () => {
    // One 50-seat vehicle on a 100-cell route at speed 2 is 50 ticks per round trip. Capacity is the
    // seat count times the round trips per day, not the seat count itself.
    const rows = buildTransitRows(
      [busSystem([route(1, loopOf100(0), 1)], 50, 2)]);

    expect(rows[0]!.routeRows[0]!.capacity, '運能沒有乘上「一天跑幾圈」')
      .toBeCloseTo(50 * (SERVICE_TICKS / 50), 6);
  });

  it('should not clamp the system row at 100%', () => {
    // Ten times capacity wanting to ride: the player has to see 1000%, which reads as ten more
    // vehicles. Clamped at 100% it looks identical to exactly full.
    const perStop = 50 * (SERVICE_TICKS / 50) * 10 / 2;
    const rows = buildTransitRows(
      [busSystem([route(1, loopOf100(perStop), 1)], 50, 2)]);

    expect(rows[0]!.usage, '收合列夾在 100%').toBe('1000%');
    expect(rows[0]!.routeRows[0]!.usage, '展開列跟收合列對不起來').toBe('1000%');
  });

  it('should judge the system row on the same thresholds as its routes', () => {
    // The collapsed row used its own 0.5 / 0.8 against the simulation's 0.8 / 0.9 / 1.5, so a route
    // genuinely turning people away looked merely somewhat full when collapsed.
    const perStop = 50 * (SERVICE_TICKS / 50) * 10 / 2;
    const rows = buildTransitRows(
      [busSystem([route(1, loopOf100(perStop), 1)], 50, 2)]);

    expect(rows[0]!.status, '收合列沒有照模擬的門檻判斷').toBe('hopeless');
    expect(rows[0]!.status).toBe(rows[0]!.routeRows[0]!.status);
  });

  it('should print a dash for a system with no capacity of its own', () => {
    // 0% reads as the route being empty.
    const rows = buildTransitRows(
      [busSystem([route(1, loopOf100(10), 1)], 0, 2)]);

    expect(rows[0]!.usage).toBe('—');
    expect(rows[0]!.routeRows[0]!.usage).toBe('—');
  });

  it('should add up riders and capacity across the routes of one system', () => {
    const rows = buildTransitRows(
      [busSystem([route(1, loopOf100(30), 1), route(2, loopOf100(10), 3)], 50, 2)]);

    const perLoop = 50 * (SERVICE_TICKS / 50);
    expect(rows[0]!.totalRiders, '人次沒有跨路線加總').toBeCloseTo(80, 6);
    expect(rows[0]!.totalCapacity, '運能沒有跨路線加總').toBeCloseTo(perLoop * 4, 6);
  });

  it('should count riders the same way the simulation does', () => {
    // The panel read `smoothedDailyRiders` alone while the simulation reads the greater of
    // yesterday's actual figure and the smoothed one — one number recorded in two places, which is
    // BUG-342 itself.
    const s = stop(0, 0, 0);
    s.smoothedDailyRiders = 10;
    s.lastDayRiders = 400;        // 昨天特別多人，平滑值還沒跟上
    const r = route(1, [s, stop(50, 0, 0)], 1);

    const rows = buildTransitRows([busSystem([r], 50, 2)]);

    expect(rows[0]!.routeRows[0]!.riders, '面板沒有讀模擬用的那個搭乘量').toBe(400);
    expect(rows[0]!.totalRiders, '收合列也要讀同一個').toBe(400);
  });

  it('should keep a suspended route visible and still count it', () => {
    // A suspended route is still costing the player money and the panel may not hide it.
    const suspended = { ...route(1, loopOf100(0), 1), suspended: true };
    const rows = buildTransitRows([busSystem([suspended], 50, 2)]);

    expect(rows[0]!.routeRows).toHaveLength(1);
    expect(rows[0]!.routeRows[0]!.suspended).toBe(true);
  });
});

describe('沒有路線的系統', () => {
  it('should not be called hopeless when there is nothing to ride', () => {
    // With the rail routes deleted the four stations remain, and the load factor is riders over zero
    // capacity, which is Infinity, leaving the status red throughout (BUG-349). No routes is absence,
    // not overload.
    const stops = [stop(0, 0, 3000), stop(50, 0, 3000)];
    const sys: TransitSystemSource = {
      type: TransportType.RAIL, routes: [], stops,
      seatsPerVehicle: 300, speed: 4, vehicleCount: 0, operatingCost: 0,
      segmentDistances: () => null,
    };

    const row = buildTransitRows([sys])[0]!;
    expect(row.routeCount).toBe(0);
    expect(row.status, '沒有路線卻說它擠爆了').toBe('none');
    expect(row.usage, '沒有運能就不該印百分比').toBe('\u2014');
  });

  it('should still call a route with riders and no capacity hopeless', () => {
    // The other side: the route remains with its vehicles withdrawn and people genuinely cannot get
    // aboard — that is hopeless, and fixing BUG-349 must not swallow it.
    const r = route(1, loopOf100(3000), 0);
    const row = buildTransitRows([busSystem([r], 50, 2)])[0]!;

    expect(row.routeCount).toBe(1);
    expect(row.status).toBe('hopeless');
  });

  it('should be quiet about a system that was never built', () => {
    const sys: TransitSystemSource = {
      type: TransportType.FERRY, routes: [], stops: [],
      seatsPerVehicle: 100, speed: 1, vehicleCount: 0, operatingCost: 0,
      segmentDistances: () => null,
    };

    expect(buildTransitRows([sys])[0]!.status).toBe('none');
  });
});
