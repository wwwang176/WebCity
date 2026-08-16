import { TransportType, type TransportRoute, type TransportStop } from './types';
import { walkDistanceToStop, type StopReach } from '../traffic/StopWalkReach';
import { routeService, expectedWait, isOverCapacity } from './RouteLoad';
import { walkRangeFor, WALK_RANGE_BY_TYPE } from './WalkRange';
import type { AvailableTransport } from './ModeChoice';

export interface TransitSystemInfo {
  type: TransportType;
  speed: number;
  /** Single-vehicle passenger capacity (e.g. 50 for bus). 0 or omitted = unlimited. */
  vehicleCapacity?: number;
  routes: readonly TransportRoute[];
  /** Return precomputed segment distances for a route (one per stop pair). */
  getSegmentDistances?: (routeId: number) => number[] | null;
}

/** Sum dailyRiders across all stops of a route (zero-alloc). */
export function getRouteDailyRiders(route: TransportRoute): number {
  let total = 0;
  for (let i = 0; i < route.stops.length; i++) {
    total += route.stops[i]!.dailyRiders;
  }
  return total;
}

/**
 * 這條路線的常態載客量，用來判斷有多擠。
 *
 * `dailyRiders` 是**今天到現在為止**的累計，每天歸零 —— 直接拿它當載重的話，每天
 * 早上每條路線看起來都是空的，擁擠代價要到傍晚才出現，然後隔天再歸零。取它與
 * 跨日平滑值的較大者：既有的路線用平滑值，新開或正在爆量的路線用今天的實數。
 */
export function getRouteRiders(route: TransportRoute): number {
  let daily = 0;
  let smoothed = 0;
  for (let i = 0; i < route.stops.length; i++) {
    const s = route.stops[i]!;
    daily += s.dailyRiders;
    smoothed += s.smoothedDailyRiders;
  }
  return Math.max(daily, smoothed);
}

/**
 * Find available transit options between origin and destination.
 * A transit route is "available" if it has stops within walkRange
 * of both origin and destination, AND has remaining capacity.
 *
 * 「走得到」由 `reach` 定義，也就是沿人行道量。這裡曾經用曼哈頓距離，而曼哈頓
 * 距離看不見馬路：對街的站牌只有兩格，於是住戶被算成搭得到，行人被派過去，到了
 * 現場才發現行人只在路口過馬路，得繞一大圈。
 *
 * 估計時間是**整趟**：走到站 + 等車 + 乘車 + 走到目的地。
 *
 * 這裡曾經只回報乘車那一段，而這個數字會直接跟開車時間比大小 —— 一條班距 40
 * tick、站牌在五格外的公車，看起來會跟「門口就有、班班準點」一樣好。它因此幾乎
 * 永遠贏過開車，也永遠贏過含走路與等車的轉乘路線（`chooseModeMultiModal` 是先看
 * 單一運具、更快才換過去）。結果是實際派車的那條路徑對步行距離完全不收費，唯一
 * 擋住「走很遠去搭公車」的只剩下 `walkRange` 那個硬門檻。
 */
export function findAvailableTransit(
  systems: readonly TransitSystemInfo[],
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  reach: StopReach,
  walkSpeed: number,
  waitFactor: number,
  ticksPerDay: number,
): AvailableTransport[] {
  const result: AvailableTransport[] = [];

  for (const sys of systems) {
    // 願意為這種運具走多遠。涵蓋範圍一律用最寬的半徑算一次（快取的鍵含半徑），
    // 再由這裡截斷 —— 各運具各算一份的話，同一個站牌會被重算好幾次。
    const walkRange = walkRangeFor(sys.type);
    for (const route of sys.routes) {
      const segDists = sys.getSegmentDistances?.(route.id) ?? null;
      const { headway, loadFactor } = routeService(
        route, getRouteRiders(route), sys.vehicleCapacity ?? 0, sys.speed, segDists, ticksPerDay,
      );
      // 擠不上去的路線對這個人不存在。這條線之前的形式是「一整天的人次 ≥
      // 車輛數 × 座位數」—— 累計量比瞬間量，天花板低了一個數量級。
      if (isOverCapacity(loadFactor)) continue;

      // Find nearest origin and destination stops within walk range
      let bestOriginIdx = -1, bestOriginDist = Infinity;
      let bestDestIdx = -1, bestDestDist = Infinity;

      for (let i = 0; i < route.stops.length; i++) {
        const stop = route.stops[i]!;
        const scan = WALK_RANGE_BY_TYPE.WIDEST;
        const dOrigin = walkDistanceToStop(reach, stop.x, stop.y, origin.x, origin.y, scan);
        const dDest = walkDistanceToStop(reach, stop.x, stop.y, destination.x, destination.y, scan);
        if (dOrigin <= walkRange && dOrigin < bestOriginDist) {
          bestOriginIdx = i;
          bestOriginDist = dOrigin;
        }
        if (dDest <= walkRange && dDest < bestDestDist) {
          bestDestIdx = i;
          bestDestDist = dDest;
        }
      }

      if (bestOriginIdx < 0 || bestDestIdx < 0) continue;

      const walkTime = (bestOriginDist + bestDestDist) / walkSpeed;
      const boardStop = route.stops[bestOriginIdx]!;
      const alightStop = route.stops[bestDestIdx]!;

      // 同一站上下車 = 沒有真的搭到，但走到站牌的那段路仍然花掉了。
      if (bestOriginIdx === bestDestIdx) {
        result.push({ type: sys.type, estimatedTime: walkTime, walkTime, boardStop, alightStop });
        continue;
      }

      const rideDistance = computeRideDistance(
        route.stops, bestOriginIdx, bestDestIdx, segDists,
      );
      // 帶著這兩站一起回去。派車時重挑一次「最近的站」會挑到別條路線上，而時間
      // 是照這兩站估的 —— 人會被記到他沒搭的那條路線頭上（BUG-283）。
      result.push({
        type: sys.type,
        estimatedTime: walkTime
          + expectedWait(headway, waitFactor, loadFactor)
          + rideDistance / sys.speed,
        walkTime,
        boardStop,
        alightStop,
      });
    }
  }

  return result;
}

/**
 * Compute ride distance along the route between two stop indices.
 * Picks the shorter direction around the circular route.
 */
export function computeRideDistance(
  stops: readonly TransportStop[],
  fromIdx: number,
  toIdx: number,
  segDists: number[] | null,
): number {
  const n = stops.length;
  // A cached segment list must line up 1:1 with the stops, otherwise it is stale
  // and indexing it by the CURRENT stop index silently returns another leg's
  // distance. Degrade to the euclidean fallback instead of lying (BUG-064).
  const safeDists = segDists && segDists.length === n ? segDists : null;
  const forward = sumDirection(stops, fromIdx, toIdx, n, safeDists);
  const backward = sumDirection(stops, toIdx, fromIdx, n, safeDists);
  return Math.min(forward, backward);
}

/** Sum distances going forward from fromIdx to toIdx around the circular route. */
function sumDirection(
  stops: readonly TransportStop[],
  fromIdx: number,
  toIdx: number,
  n: number,
  segDists: number[] | null,
): number {
  let total = 0;
  let i = fromIdx;
  while (i !== toIdx) {
    const next = (i + 1) % n;
    if (segDists && i < segDists.length) {
      total += segDists[i]!;
    } else {
      // Fallback: euclidean distance between consecutive stops
      const a = stops[i]!;
      const b = stops[next]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    i = next;
  }
  return total;
}
