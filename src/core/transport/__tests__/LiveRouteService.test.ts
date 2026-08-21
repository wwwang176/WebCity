import { describe, it, expect } from 'vitest';
import {
  computeDailyCapacity, TRANSIT_SERVICE_TICKS_PER_DAY, CROWDING,
} from '../RouteLoad';
import { flattenSystems, refreshRouteService, type FlatRoute } from '../MultiModalRouter';
import type { TransitSystemInfo } from '../TransitAvailability';
import { TransportType, type TransportRoute, type TransportStop } from '../types';

/**
 * 路線的班距與載重率必須是**當下**的數字。
 *
 * 它們原本在 `flattenSystems()` 時算好、寫進 `FlatRoute`，而扁平路線只有玩家動到
 * 路網拓樸時才重建 —— 搭乘人數之後怎麼漲都回不到這裡。玩家 12 500 人的存檔實測:
 * 記著的載重率 **0.0000192**，照當下人數重算是 **308**。
 *
 * 後果是整套擁擠模型形同不存在:`expectedWait()` 的擁擠加成永遠是 0。而同一份判斷在
 * `findAvailableTransit()` 裡是**每次現算**的 —— 兩條路徑對同一條路線的看法差了
 * 一千六百萬倍。
 */

function stop(x: number, y: number, riders = 0): TransportStop {
  return {
    id: x * 1000 + y, x, y, type: TransportType.BUS, passengers: 0,
    dailyRiders: riders, lastDayRiders: riders, smoothedDailyRiders: riders,
  } as TransportStop;
}

/** 一條長 100 格的環狀路線 —— 兩站相距 50 格，來回剛好 100。 */
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
    // 車速是挑出來讓畫面好看的，`ticksPerDay` 是日曆常數（老化、薪資、成長都用它）。
    // 拿後者去除「一圈幾個 tick」等於把兩個時鐘當成同一個 —— 玩家存檔實測，
    // 一條 282 格的公車路線一天只跑 0.17 圈，50 座的車一天運能剩 8.5 人次。
    const cycleTime = 50;   // 100 格 ÷ 速度 2
    expect(computeDailyCapacity(1, 50, cycleTime))
      .toBeCloseTo(50 * (TRANSIT_SERVICE_TICKS_PER_DAY / cycleTime), 6);
  });

  it('should give a busy line an answer the player can actually act on', () => {
    // 這是刻度存在的理由:數字要落在「加幾台車」答得出來的範圍。
    const cycleTime = 141;                       // 玩家那條路線
    const perBus = computeDailyCapacity(1, 50, cycleTime);
    const needed = 2623 / perBus;                // 每日 2 623 人次

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

    // 有人搭車了。路網一根手指都沒動過。
    for (const s of route.stops) { s.dailyRiders = 4000; s.smoothedDailyRiders = 4000; }
    refreshRouteService(routes);

    expect(routes[0]!.loadFactor, '扁平路線還記著人還沒上車時的載重率')
      .toBeGreaterThan(CROWDING.HOPELESS_LOAD);
  });

  it('should shorten the headway without waiting for a re-flatten', () => {
    // 班距跟載重率一樣是活的。只更新載重率的話，玩家加了車，「等多久」那一欄
    // 還是舊的 —— 而等車時間直接決定他要不要搭。
    const route = busRoute(1, 0);
    const routes = flatten(route);
    const before = routes[0]!.headway;

    route.vehicles = 4;
    refreshRouteService(routes);

    expect(routes[0]!.headway, '加了三台車，班距沒有跟著變短').toBeCloseTo(before / 4, 6);
  });

  it('should shorten the headway when the player adds a vehicle', () => {
    // 加車買到的東西:班距變短。這也是玩家對擁擠唯一的解法。
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
    // 座位數 0 代表這個系統不受運能限制（機場走的是另一套模型）。
    const route = busRoute(1, 100_000);
    const routes = flattenSystems([busSystem(route, 0)]);
    refreshRouteService(routes);

    expect(routes[0]!.loadFactor, '不受運能限制的系統被算出了載重').toBe(0);
  });
});
