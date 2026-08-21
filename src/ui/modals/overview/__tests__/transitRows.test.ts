import { describe, it, expect } from 'vitest';
import { buildTransitRows, type TransitSystemSource } from '../transitRows';
import { TransportType, type TransportRoute, type TransportStop } from '../../../../core/transport/types';
import { TRANSIT_SERVICE_TICKS_PER_DAY } from '../../../../core/transport/RouteLoad';

/**
 * 面板上那一欄 Usage。
 *
 * 玩家 12 500 人的存檔回報:同一條公車路線，同一個時刻，三個數字 —— 收合列 100%、
 * 展開列 5 246%、模擬自己的公式 30 853%。兩個錯:
 *
 * 1. 面板算的容量是 `車輛數 × 座位數`，那是**瞬間**的座位數，卻拿去比一整天的累計
 *    人次。`computeDailyCapacity()` 的說明裡寫的就是這個錯 —— 模擬那邊修好了。
 * 2. 收合列夾在 100%（`Math.min`），而 `formatRouteUsage()` 上面有一整段說明寫著
 *    不要夾:一條 105% 跟一條 400% 的路線要看得出差別，那是玩家決定該加幾台車的
 *    唯一依據。
 */

/** 運能自己那把尺 —— 不是日曆上的一天，見 `TRANSIT_SERVICE_TICKS_PER_DAY`。 */
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

/** 一條長 100 格的環狀路線:兩站相距 50 格，來回剛好 100。 */
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
    // 一台 50 座的車，路線 100 格、車速 2 → 一圈 50 tick。運能是座位數乘上
    // 「一天跑幾圈」，不是座位數本身。
    const rows = buildTransitRows(
      [busSystem([route(1, loopOf100(0), 1)], 50, 2)]);

    expect(rows[0]!.routeRows[0]!.capacity, '運能沒有乘上「一天跑幾圈」')
      .toBeCloseTo(50 * (SERVICE_TICKS / 50), 6);
  });

  it('should not clamp the system row at 100%', () => {
    // 運能的十倍要搭 —— 玩家要看到的是 1000%，那是「該加十台車」。
    // 夾在 100% 的話它跟剛好滿載長得一模一樣。
    const perStop = 50 * (SERVICE_TICKS / 50) * 10 / 2;
    const rows = buildTransitRows(
      [busSystem([route(1, loopOf100(perStop), 1)], 50, 2)]);

    expect(rows[0]!.usage, '收合列夾在 100%').toBe('1000%');
    expect(rows[0]!.routeRows[0]!.usage, '展開列跟收合列對不起來').toBe('1000%');
  });

  it('should judge the system row on the same thresholds as its routes', () => {
    // 收合列以前用另外寫死的 0.5 / 0.8，跟模擬的 0.8 / 0.9 / 1.5 不是同一組 ——
    // 於是一條真的在拒載的路線，收合起來看只是「有點滿」。
    const perStop = 50 * (SERVICE_TICKS / 50) * 10 / 2;
    const rows = buildTransitRows(
      [busSystem([route(1, loopOf100(perStop), 1)], 50, 2)]);

    expect(rows[0]!.status, '收合列沒有照模擬的門檻判斷').toBe('hopeless');
    expect(rows[0]!.status).toBe(rows[0]!.routeRows[0]!.status);
  });

  it('should print a dash for a system with no capacity of its own', () => {
    // 0% 會讓玩家以為它很空。
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
    // 面板只讀 `smoothedDailyRiders`，模擬讀 `max(昨天的實數, 跨日平滑)` —— 同一個
    // 數字兩個地方各記一份，就是 BUG-342 本身那個錯。
    const s = stop(0, 0, 0);
    s.smoothedDailyRiders = 10;
    s.lastDayRiders = 400;        // 昨天特別多人，平滑值還沒跟上
    const r = route(1, [s, stop(50, 0, 0)], 1);

    const rows = buildTransitRows([busSystem([r], 50, 2)]);

    expect(rows[0]!.routeRows[0]!.riders, '面板沒有讀模擬用的那個搭乘量').toBe(400);
    expect(rows[0]!.totalRiders, '收合列也要讀同一個').toBe(400);
  });

  it('should keep a suspended route visible and still count it', () => {
    // 停駛的路線還在收玩家的錢，面板不能把它藏起來。
    const suspended = { ...route(1, loopOf100(0), 1), suspended: true };
    const rows = buildTransitRows([busSystem([suspended], 50, 2)]);

    expect(rows[0]!.routeRows).toHaveLength(1);
    expect(rows[0]!.routeRows[0]!.suspended).toBe(true);
  });
});
