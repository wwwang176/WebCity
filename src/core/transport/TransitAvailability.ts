import { TransportType, type TransportRoute, type TransportStop } from './types';
import { expectedWait } from './RouteLoad';
import type { FlatRoute } from './MultiModalRouter';
import type { NearbyStop, StopProximityIndex } from './StopProximityIndex';
import type { AvailableTransport } from './ModeChoice';

export interface TransitSystemInfo {
  type: TransportType;
  /** 設定值。沒有 `speedOn` 的系統（測試用的簡易 fixture）拿它當退路。 */
  speed: number;
  /**
   * 這條路線現在實際開多快 —— 含壅塞。
   *
   * 選填是為了讓不在乎壅塞的呼叫端（多數測試）不必造一份。省略時退回 `speed`，
   * 那是「這個系統不受壅塞影響」，不是「現在不塞」。
   */
  speedOn?: (routeId: number) => number;
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
 * 讀的是**完整的一天** —— 昨天的實數與跨日平滑值取大者。運能的單位是「一天載得動
 * 幾人次」，所以搭乘量也必須是一整天的。
 *
 * 這裡曾經讀 `dailyRiders`，那是**今天到現在為止**的累計，每個遊戲日歸零。兩者單位
 * 不同，於是載重每天鋸齒一次:早上路線看起來是空的，隨這一天走完慢慢變擠，然後歸零
 * 重來。玩家 12 600 人的存檔實測（一台公車、連續取樣 151 次）:載重在 **5.56 到
 * 47.34** 之間跳，而今日累計人次在 **0 到 6 519** 之間跑。玩家回報的
 * 「usage 在 80~100% 震盪」就是它。
 *
 * 而且它同時讓需求失控:每天早上看起來是空的，所有人都選它，載重到傍晚才爆掉。
 *
 * 取兩者的較大者是為了兩件事都顧到 —— 昨天暴增的路線今天就反映得出來（讀
 * `lastDayRiders`），而昨天剛好沒人搭的一次低點不會把整條線當成空的（讀平滑值）。
 * 代價是新路線第一天看起來是空的:一天的資料要滿一天才有。
 */
export function getRouteRiders(route: { stops: readonly TransportStop[] }): number {
  let lastDay = 0;
  let smoothed = 0;
  for (let i = 0; i < route.stops.length; i++) {
    const s = route.stops[i]!;
    lastDay += s.lastDayRiders;
    smoothed += s.smoothedDailyRiders;
  }
  return Math.max(lastDay, smoothed);
}

/**
 * Find available transit options between origin and destination.
 * A transit route is "available" if it has stops within walkRange
 * of both origin and destination, AND has remaining capacity.
 *
 * 「走得到」由 `StopProximityIndex` 回答，而索引是沿人行道量出來的。這裡曾經自己
 * 逐站量曼哈頓距離，而曼哈頓距離看不見馬路：對街的站牌只有兩格，於是住戶被算成
 * 搭得到，行人被派過去，到了現場才發現行人只在路口過馬路，得繞一大圈。
 *
 * 逐站掃描的年代是「每問一位市民 × 全城每一個站牌 × 兩端」—— 3 條路線 19 個站牌
 * 的城市實測 5.74µs/位，查兩次索引是 0.25µs。
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
  routes: readonly FlatRoute[],
  index: StopProximityIndex,
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  walkSpeed: number,
  waitFactor: number,
): AvailableTransport[] {
  const fromNear = index.at(origin.x, origin.y);
  if (fromNear.length === 0) return [];
  const toNear = index.at(destination.x, destination.y);
  if (toNear.length === 0) return [];

  // 逐路線最近的那一站。平手時留先看到的 —— 索引是照路線、站牌的順序建的，
  // 所以「先看到」就是站牌陣列裡比較前面的那一個，跟逐站掃描的年代一樣。
  const nearestFrom = nearestPerRoute(fromNear);
  const nearestTo = nearestPerRoute(toNear);

  const result: AvailableTransport[] = [];
  for (const [routeIdx, a] of nearestFrom) {
    const b = nearestTo.get(routeIdx);
    if (b === undefined) continue;
    const route = routes[routeIdx];
    if (route === undefined) continue;

    const walkTime = (a.walkDistance + b.walkDistance) / walkSpeed;
    const boardStop = route.stops[a.stopIdx]!;
    const alightStop = route.stops[b.stopIdx]!;

    // 同一站上下車 = 沒有真的搭到，但走到站牌的那段路仍然花掉了。
    if (a.stopIdx === b.stopIdx) {
      result.push({ type: route.type, estimatedTime: walkTime, walkTime, boardStop, alightStop });
      continue;
    }

    // 班距與載重率讀扁平路線的欄位，不在這裡重算 —— `refreshRouteService()` 已經在
    // 同一個 tick 的前幾行用一模一樣的輸入算過了（`tick()` 裡就在 `spawnVehicles()`
    // 之前）。各算各的正是 BUG-343 的形狀:兩條路徑對同一條路線的看法會分岔，
    // 而分岔的那一刻沒有任何測試會紅。
    //
    // 沒有拒載門檻。擠爆的路線照樣列出來，只是等車時間長到自己輸掉 ——
    // 「等到天荒地老」本來就等價於「不能搭」，而懸崖會自己造出極限環。
    const rideDistance = computeRideDistance(route.stops, a.stopIdx, b.stopIdx, route.segDists);
    // 帶著這兩站一起回去。派車時重挑一次「最近的站」會挑到別條路線上，而時間
    // 是照這兩站估的 —— 人會被記到他沒搭的那條路線頭上（BUG-283）。
    result.push({
      type: route.type,
      estimatedTime: walkTime
        + expectedWait(route.headway, waitFactor, route.loadFactor)
        + rideDistance / route.speed,
      walkTime,
      boardStop,
      alightStop,
    });
  }

  return result;
}

/**
 * 每條路線留最近的那一站。
 *
 * 路線數是個位數，所以用 `Map` 而不是照 `routes.length` 開一條共用的暫存陣列 ——
 * 共用暫存要嘛每次清空（等於還是掃一遍），要嘛用世代戳記，兩者換來的都不值這裡的
 * 幾個項目。
 */
function nearestPerRoute(near: readonly NearbyStop[]): Map<number, NearbyStop> {
  const best = new Map<number, NearbyStop>();
  for (const n of near) {
    const seen = best.get(n.routeIdx);
    if (seen === undefined || n.walkDistance < seen.walkDistance) best.set(n.routeIdx, n);
  }
  return best;
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
