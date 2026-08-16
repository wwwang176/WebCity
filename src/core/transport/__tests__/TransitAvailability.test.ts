import { describe, it, expect } from 'vitest';
import { findAvailableTransit, getRouteDailyRiders, getRouteRiders, type TransitSystemInfo } from '../TransitAvailability';
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
 * 這條路線的等車時間。
 *
 * 底下驗乘車距離的那幾條要把它扣掉才比得出乘車那一段。刻意用同一組公開函式算出來，
 * 而不是假裝等車是 0 —— 班距現在由「整圈時間 ÷ 車輛數」決定，沒有辦法設成零。
 */
function waitOf(sys: TransitSystemInfo): number {
  const route = sys.routes[0]!;
  const segDists = sys.getSegmentDistances?.(route.id) ?? null;
  const cycle = computeCycleTime(route.stops, segDists, sys.speed);
  return expectedWait(computeHeadway(cycle, route.vehicles), WAIT_FACTOR, 0);
}

describe('findAvailableTransit', () => {
  it('returns empty array when no transit systems exist', () => {
    const result = findAvailableTransit([], { x: 0, y: 0 }, { x: 10, y: 10 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 1, y: 1 }, { x: 5, y: 5 }, 2, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 0 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 3, y: 4 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 5, y: 5 }, { x: 0, y: 0 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 0 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime - waitOf(systems[0]!)).toBeCloseTo(5);
  });

  it('still charges the walk when origin and dest map to the same stop', () => {
    // 同一站上下車等於沒搭到，但走到站牌的那段路仍然花掉了。舊行為回報 0，
    // 也就是「這條路線免費又瞬間」—— 它因此永遠贏過任何其他走法。
    const stops = [makeStop(0, 0, 1), makeStop(10, 0, 2)];
    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 }],
      getSegmentDistances: () => [10, 10],
    }];
    // Both origin and dest are closest to stop at (0,0)
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 0, y: 1 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
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
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 8, y: 8 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime - waitOf(systems[0]!)).toBeCloseTo(15 / 0.375);
  });

  // ── Capacity filtering tests ──────────────────────────────────
  //
  // 人次都由模型自己算出來，不寫死 —— 容量的定義是「車輛數 × 座位 × 一天跑幾圈」，
  // 寫死數字的話，調一次常數就得回來改一輪魔術數字，而且看不出改的是哪一個假設。

  const SEATS = 50;
  const busStops = () => [makeStop(1, 1, 1), makeStop(9, 9, 2)];

  /** 這條路線一天載得動幾人次。 */
  function dailyCapacityOf(stops: TransportStop[], vehicles: number, speed = 2): number {
    return computeDailyCapacity(vehicles, SEATS, computeCycleTime(stops, null, speed), TICKS_PER_DAY);
  }

  function busSystemWith(stops: TransportStop[], vehicles: number): TransitSystemInfo {
    return {
      type: TransportType.BUS, speed: 2, vehicleCapacity: SEATS,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles, operatingCost: 100 }],
    };
  }

  function offeredFor(stops: TransportStop[], vehicles: number) {
    return findAvailableTransit(
      [busSystemWith(stops, vehicles)], { x: 0, y: 0 }, { x: 10, y: 10 },
      5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY,
    );
  }

  it('filters out a route nobody can squeeze onto', () => {
    const stops = busStops();
    stops[0]!.dailyRiders = dailyCapacityOf(stops, 3) * 2;
    expect(offeredFor(stops, 3)).toEqual([]);
  });

  it('returns route with remaining capacity', () => {
    const stops = busStops();
    stops[0]!.dailyRiders = dailyCapacityOf(stops, 3) * 0.3;
    const result = offeredFor(stops, 3);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe(TransportType.BUS);
  });

  it('adding vehicles increases route capacity (allows more riders)', () => {
    const stops = busStops();
    // 3 台車擠爆的人數，5 台車就吃得下
    stops[0]!.dailyRiders = dailyCapacityOf(stops, 3) * 1.6;

    expect(offeredFor(stops, 3), '3 台車還撐得住').toEqual([]);
    expect(offeredFor(stops, 5), '加了兩台車還是擠不上去').toHaveLength(1);
  });

  it('should make waiting shorter as well, not just raise the ceiling', () => {
    // 加車買到的不只是容量。班距 = 整圈時間 ÷ 車輛數，車多就班次密。
    const stops = busStops();
    stops[0]!.dailyRiders = dailyCapacityOf(stops, 2) * 0.3;
    const two = offeredFor(stops, 2)[0]!.estimatedTime;
    const four = offeredFor(stops, 4)[0]!.estimatedTime;
    expect(four, '加車沒有讓等車變短').toBeLessThan(two);
  });

  it('should make waiting longer as the route fills up', () => {
    const stops = busStops();
    stops[0]!.dailyRiders = dailyCapacityOf(stops, 3) * 0.2;
    const quiet = offeredFor(stops, 3)[0]!.estimatedTime;

    const packedStops = busStops();
    packedStops[0]!.dailyRiders = dailyCapacityOf(packedStops, 3) * 1.2;
    const packed = offeredFor(packedStops, 3)[0]!.estimatedTime;

    expect(packed, '擠成這樣還是等一樣久').toBeGreaterThan(quiet);
  });

  it('filters only full routes, keeps routes with capacity from same system', () => {
    const stopsA = busStops();
    stopsA[0]!.dailyRiders = dailyCapacityOf(stopsA, 2) * 2;

    const stopsB = [makeStop(2, 2, 3), makeStop(8, 8, 4)];
    stopsB[0]!.dailyRiders = dailyCapacityOf(stopsB, 2) * 0.1;

    const systems: TransitSystemInfo[] = [{
      type: TransportType.BUS,
      speed: 2,
      vehicleCapacity: SEATS,
      routes: [
        { id: 1, type: TransportType.BUS, stops: stopsA, vehicles: 2, operatingCost: 100 },
        { id: 2, type: TransportType.BUS, stops: stopsB, vehicles: 2, operatingCost: 100 },
      ],
    }];
    const result = findAvailableTransit(systems, { x: 0, y: 0 }, { x: 10, y: 10 }, 5, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY);
    expect(result).toHaveLength(1);
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
    // dailyRiders 每天歸零。直接拿它當載重的話，每天早上每條路線看起來都是空的，
    // 擁擠代價要到傍晚才出現，然後隔天再歸零 —— 一個看得見的鋸齒。
    const stops = [makeStop(0, 0, 1), makeStop(5, 5, 2)];
    stops[0]!.smoothedDailyRiders = 300;
    stops[0]!.dailyRiders = 5; // 今天才剛開始
    const route = { id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 };

    expect(getRouteRiders(route), '一天剛開始就把這條線當成空的').toBe(300);
  });

  it('should use today when today is busier than usual', () => {
    // 新開的線、或今天突然爆量 —— 平滑值還跟不上，要用今天的實數。
    const stops = [makeStop(0, 0, 1), makeStop(5, 5, 2)];
    stops[0]!.smoothedDailyRiders = 20;
    stops[0]!.dailyRiders = 400;
    const route = { id: 1, type: TransportType.BUS, stops, vehicles: 1, operatingCost: 100 };

    expect(getRouteRiders(route), '今天爆量卻還在看昨天的平均').toBe(400);
  });
});
