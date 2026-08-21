/**
 * 大眾運輸面板那張表的數字。
 *
 * 抽出來是因為面板自己算過一次運能，而且算錯了單位:`車輛數 × 座位數` 是**瞬間**
 * 的座位數，卻拿去比 `smoothedDailyRiders`（一整天的累計人次）。
 * `computeDailyCapacity()` 的說明裡寫的就是這個錯 —— 模擬那邊修好了，面板沒跟上。
 *
 * 玩家 12 500 人的存檔回報:同一條公車路線、同一個時刻，面板上有三個數字 ——
 * 收合列 100%（`Math.min` 夾住的）、展開列 5 246%（單位錯的）、模擬自己的公式
 * 30 853%。
 *
 * 現在收合列與展開列走同一條路徑，用的是模擬那組函式。
 */

import {
  computeCycleTime, computeDailyCapacity, computeLoadFactor,
  formatRouteUsage, routeLoadStatus, type RouteLoadStatus,
} from '../../../core/transport/RouteLoad';
import { getRouteRiders } from '../../../core/transport/TransitAvailability';
import type { TransportRoute, TransportStop, TransportType } from '../../../core/transport/types';

/** 面板需要一個運輸系統提供的東西。只有這些，不是整個 `BaseTransportSystem`。 */
export interface TransitSystemSource {
  type: TransportType;
  routes: readonly TransportRoute[];
  stops: readonly TransportStop[];
  /** 每台車幾個座位。0 代表這個系統不受運能限制。 */
  seatsPerVehicle: number;
  speed: number;
  vehicleCount: number;
  operatingCost: number;
  segmentDistances(routeId: number): number[] | null;
}

export interface TransitRouteRow {
  id: number;
  stops: number;
  vehicles: number;
  /** 每日人次。 */
  riders: number;
  /** 每日人次的運能 —— 座位數 × 一天跑幾圈。 */
  capacity: number;
  loadFactor: number;
  usage: string;
  status: RouteLoadStatus;
  cost: number;
  suspended: boolean;
}

export interface TransitSystemRow {
  type: TransportType;
  routeCount: number;
  totalStops: number;
  totalVehicles: number;
  totalRiders: number;
  totalCapacity: number;
  loadFactor: number;
  usage: string;
  status: RouteLoadStatus;
  totalCost: number;
  routeRows: TransitRouteRow[];
}

/**
 * 搭乘量走模擬那支 —— 面板自己數的話，兩邊會靜靜地分家。
 *
 * 差別不是理論上的:`getRouteRiders()` 取「今日累計」與「跨日平滑」的**較大者**
 * （`dailyRiders` 每天歸零，直接拿它當載重的話每天早上每條路線看起來都是空的）。
 * 面板原本只讀平滑值，於是白天累計量超過平滑值的時候，顯示的 % 比模擬實際採用的低。
 */
function ridersOf(stops: readonly TransportStop[]): number {
  return getRouteRiders({ stops });
}

export function buildTransitRows(
  systems: readonly TransitSystemSource[],
): TransitSystemRow[] {
  return systems.map((sys) => {
    const routeRows: TransitRouteRow[] = sys.routes.map((route) => {
      const riders = ridersOf(route.stops);
      // 停駛的路線照樣列出來 —— 它還在收玩家的錢。
      const cycleTime = computeCycleTime(
        route.stops, sys.segmentDistances(route.id), sys.speed);
      const capacity = computeDailyCapacity(
        route.vehicles, sys.seatsPerVehicle, cycleTime);
      const loadFactor = computeLoadFactor(riders, capacity);
      return {
        id: route.id,
        stops: route.stops.length,
        vehicles: route.vehicles,
        riders,
        capacity,
        loadFactor,
        usage: formatRouteUsage(riders, capacity),
        status: routeLoadStatus(loadFactor),
        cost: route.operatingCost,
        suspended: !!route.suspended,
      };
    });

    const totalRiders = ridersOf(sys.stops);
    const totalCapacity = routeRows.reduce((s, r) => s + r.capacity, 0);
    const loadFactor = computeLoadFactor(totalRiders, totalCapacity);

    return {
      type: sys.type,
      routeCount: sys.routes.length,
      totalStops: routeRows.reduce((s, r) => s + r.stops, 0),
      totalVehicles: sys.vehicleCount,
      totalRiders,
      totalCapacity,
      loadFactor,
      usage: formatRouteUsage(totalRiders, totalCapacity),
      status: routeLoadStatus(loadFactor),
      totalCost: sys.operatingCost,
      routeRows,
    };
  });
}
