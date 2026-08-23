/**
 * Multi-modal transit router — finds routes that transfer between
 * different transit lines (up to MAX_TRIP_LEGS legs, walk counts as a leg).
 *
 * Uses pre-computed segment distances from each transit system,
 * so per-citizen search is just table-lookup + addition.
 */

import { TransportType, type TransportStop } from './types';
import { walkDistanceToStop, type StopReach } from '../traffic/StopWalkReach';
import type { StopProximityIndex } from './StopProximityIndex';
import { computeRideDistance, getRouteRiders, type TransitSystemInfo } from './TransitAvailability';
import { expectedWait, routeService } from './RouteLoad';

// ── Types ───────────────────────────────────────────────────────

export interface TransitLeg {
  type: 'walk' | 'ride';
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Walk legs: walk time. Ride legs: wait time + ride time. */
  estimatedTime: number;
  /** Ride legs only */
  transitType?: TransportType;
  /** Index into the FlatRoute[] array passed to findMultiModalRoutes */
  routeIdx?: number;
  /** Boarding stop index within route.stops[] */
  boardStopIdx?: number;
  /** Alighting stop index within route.stops[] */
  alightStopIdx?: number;
}

export interface MultiLegRoute {
  legs: TransitLeg[];
  /** Sum of all legs' estimatedTime */
  totalTime: number;
  /** 其中有多少是走路 —— 比較時要多收一份不情願，回報時不收。 */
  walkTime: number;
}

export interface TransferEdge {
  /** Target route array index */
  toRI: number;
  /** Target stop array index */
  toSI: number;
  walkDistance: number;
}

export interface TransferGraph {
  /** Key: stopKey(routeArrayIdx, stopArrayIdx) → transfer edges */
  byStop: Map<string, TransferEdge[]>;
  /** Pre-computed best route between every (entry, exit) stop pair.
   *  Key: "entryRI:entrySI>exitRI:exitSI" → middle legs + ride time. */
  stopRouteCache: Map<string, StopToStopRoute>;
}

/** Cached route between two stops (excludes first/last mile walks). */
export interface StopToStopRoute {
  /** ride + transfer_walk legs only */
  legs: TransitLeg[];
  /** Total time of ride(s) + wait(s) + transfer walk(s) */
  totalTime: number;
}

export interface FlatRoute {
  routeId: number;
  type: TransportType;
  speed: number;
  stops: readonly TransportStop[];
  segDists: number[] | null;
  /** 班距（tick）：整圈時間 ÷ 車輛數。加車會讓它變短。 */
  headway: number;
  /** 載重率。等車時間隨它上升，沒有上限也沒有拒載門檻。 */
  loadFactor: number;
  /**
   * 來源路線本身，不是它的車輛數。
   *
   * 複製一份 `vehicles` 進來就是 `TransportRoute` 自己警告過的那個錯:玩家加車之後
   * 有兩個地方記著車輛數，而其中一個會忘記更新。這裡存參照，`refreshRouteService()`
   * 每次現讀。
   */
  source: { readonly stops: readonly TransportStop[]; readonly vehicles: number };
  seatsPerVehicle: number;
  /**
   * 現在的車速。壅塞會讓它變 —— `refreshRouteService()` 每個 tick 重讀。
   *
   * `speed` 只是它最後一次的值。不重讀的話就是 BUG-343 換一個欄位再犯一次:
   * 幹道塞住了，而估計時間還用著路網剛蓋好時的車速。
   *
   * 選填，理由同 `TransitSystemInfo.speedOn` —— 不模擬壅塞的 fixture 不必造一份。
   */
  speedOn?: () => number;
}

// ── Helpers ─────────────────────────────────────────────────────

function sk(ri: number, si: number): string {
  return `${ri}:${si}`;
}

// ── flattenSystems ──────────────────────────────────────────────

export function flattenSystems(
  systems: readonly TransitSystemInfo[],
): FlatRoute[] {
  const result: FlatRoute[] = [];
  for (const sys of systems) {
    for (const route of sys.routes) {
      if (route.suspended) continue;
      const segDists = sys.getSegmentDistances?.(route.id) ?? null;
      // 含壅塞的車速。乘車時間與班距都吃它 —— 車開得慢，整圈就跑得久，班距跟著
      // 拉長，而班距又決定一天跑幾圈也就是運能。三件都是真的。
      const speedOn = sys.speedOn ? () => sys.speedOn!(route.id) : undefined;
      const speed = speedOn?.() ?? sys.speed;
      result.push({
        routeId: route.id,
        type: sys.type,
        speed,
        stops: route.stops,
        segDists,
        source: route,
        seatsPerVehicle: sys.vehicleCapacity ?? 0,
        speedOn,
        ...routeService(
          route, getRouteRiders(route), sys.vehicleCapacity ?? 0, speed, segDists,
        ),
      });
    }
  }
  return result;
}

/**
 * 把每條扁平路線的班距與載重率更新成**當下**的數字。
 *
 * 這兩個值原本只在 `flattenSystems()` 算一次，而扁平路線只有玩家動到路網拓樸時
 * 才重建 —— 搭乘人數之後怎麼漲都回不到這裡。玩家 12 500 人的存檔實測:記著的
 * 載重率 0.0000192，照當下人數重算是 **308**。整套擁擠模型因此形同不存在:
 * `expectedWait()` 的擁擠加成
 * 永遠是 1。而同一份判斷在 `findAvailableTransit()` 裡是每次現算的 —— 兩條路徑
 * 對同一條路線的看法差了一千六百萬倍（BUG-343）。
 *
 * 就地改而不是重建陣列:`TransferGraph` 與 `TransitAccessField` 都以索引指回這裡，
 * 換掉陣列等於把那兩份快取一起作廢。而它們存的是幾何，本來就不需要跟著變。
 */
export function refreshRouteService(routes: FlatRoute[]): void {
  for (const r of routes) {
    // 車速先重讀 —— 底下兩個都從它算出來。
    if (r.speedOn) r.speed = r.speedOn();
    const { headway, loadFactor } = routeService(
      r.source, getRouteRiders(r.source), r.seatsPerVehicle, r.speed, r.segDists,
    );
    r.headway = headway;
    r.loadFactor = loadFactor;
  }
}

// ── Transfer Graph ──────────────────────────────────────────────

export function buildTransferGraph(
  routes: readonly FlatRoute[],
  transferRange: number,
  reach: StopReach,
): TransferGraph {
  const byStop = new Map<string, TransferEdge[]>();

  // Collect all (routeIdx, stopIdx, stop) triples
  const all: Array<{ ri: number; si: number; stop: TransportStop }> = [];
  for (let ri = 0; ri < routes.length; ri++) {
    const r = routes[ri]!;
    for (let si = 0; si < r.stops.length; si++) {
      all.push({ ri, si, stop: r.stops[si]! });
    }
  }

  // Pairwise check — different routes only
  for (let i = 0; i < all.length; i++) {
    const a = all[i]!;
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j]!;
      if (a.ri === b.ri) continue; // same route → skip

      // 轉乘也是用走的，一樣照人行道量 —— 只差一條馬路的兩個站牌，直線是三格，
      // 實際上得繞到路口。四個挑站的地方留一個用直線，就是留一個會不一致的縫。
      const dist = walkDistanceToStop(reach, a.stop.x, a.stop.y, b.stop.x, b.stop.y, transferRange);
      if (dist > transferRange) continue;

      // Bidirectional edges
      const keyA = sk(a.ri, a.si);
      let edgesA = byStop.get(keyA);
      if (!edgesA) { edgesA = []; byStop.set(keyA, edgesA); }
      edgesA.push({ toRI: b.ri, toSI: b.si, walkDistance: dist });

      const keyB = sk(b.ri, b.si);
      let edgesB = byStop.get(keyB);
      if (!edgesB) { edgesB = []; byStop.set(keyB, edgesB); }
      edgesB.push({ toRI: a.ri, toSI: a.si, walkDistance: dist });
    }
  }

  return { byStop, stopRouteCache: new Map() };
}

// ── Stop-to-Stop Route Cache ────────────────────────────────────

function cacheKey(entryRI: number, entrySI: number, exitRI: number, exitSI: number): string {
  return `${entryRI}:${entrySI}>${exitRI}:${exitSI}`;
}

/**
 * Pre-compute the best multi-modal route between every reachable
 * (entry stop, exit stop) pair. Called once when the transfer graph
 * is rebuilt; per-citizen search then becomes pure lookup.
 */
export function buildStopRouteCache(
  routes: readonly FlatRoute[],
  transferGraph: TransferGraph,
  walkSpeed: number,
  waitFactor: number,
  maxLegs: number,
): void {
  const cache = transferGraph.stopRouteCache;
  cache.clear();

  const maxRides = Math.floor((maxLegs - 1) / 2);
  if (maxRides < 1) return;

  const hasTransferEdges = new Set<string>(transferGraph.byStop.keys());

  function tryCache(
    entryRI: number, entrySI: number,
    exitRI: number, exitSI: number,
    legs: TransitLeg[], totalTime: number,
  ): void {
    const key = cacheKey(entryRI, entrySI, exitRI, exitSI);
    const existing = cache.get(key);
    if (!existing || totalTime < existing.totalTime) {
      cache.set(key, { legs: legs.slice(), totalTime });
    }
  }

  /** DFS: from an alight stop, try transfer + ride to reach more exits. */
  function exploreTransfers(
    entryRI: number, entrySI: number,
    alightRI: number, alightSI: number,
    timeSoFar: number, legsSoFar: TransitLeg[],
    usedRoutes: Set<number>, rideNum: number,
  ): void {
    if (rideNum >= maxRides) return;
    const key = sk(alightRI, alightSI);
    if (!hasTransferEdges.has(key)) return;

    const edges = transferGraph.byStop.get(key)!;
    const alightStop = routes[alightRI]!.stops[alightSI]!;

    for (const edge of edges) {
      if (usedRoutes.has(edge.toRI)) continue;
      const targetRoute = routes[edge.toRI]!;
      // 擠爆的路線不再被藏起來 —— `expectedWait()` 會讓它慢到自己輸掉。

      const targetStop = targetRoute.stops[edge.toSI]!;
      const transferWalkTime = edge.walkDistance / walkSpeed;
      const transferWalkLeg: TransitLeg = {
        type: 'walk',
        fromX: alightStop.x, fromY: alightStop.y,
        toX: targetStop.x, toY: targetStop.y,
        estimatedTime: transferWalkTime,
      };

      const waitTime = expectedWait(targetRoute.headway, waitFactor, targetRoute.loadFactor);

      for (let ai = 0; ai < targetRoute.stops.length; ai++) {
        if (ai === edge.toSI) continue;
        const nextStop = targetRoute.stops[ai]!;
        const rideTime = computeRideDistance(
          targetRoute.stops, edge.toSI, ai, targetRoute.segDists,
        ) / targetRoute.speed;

        const rideLeg: TransitLeg = {
          type: 'ride',
          fromX: targetStop.x, fromY: targetStop.y,
          toX: nextStop.x, toY: nextStop.y,
          estimatedTime: waitTime + rideTime,
          transitType: targetRoute.type,
          routeIdx: edge.toRI,
          boardStopIdx: edge.toSI,
          alightStopIdx: ai,
        };

        const newTime = timeSoFar + transferWalkTime + waitTime + rideTime;
        const newLegs = [...legsSoFar, transferWalkLeg, rideLeg];

        // Cache this exit
        tryCache(entryRI, entrySI, edge.toRI, ai, newLegs, newTime);

        // Recurse for more transfers
        if (rideNum + 1 < maxRides && hasTransferEdges.has(sk(edge.toRI, ai))) {
          const newUsed = new Set(usedRoutes);
          newUsed.add(edge.toRI);
          exploreTransfers(
            entryRI, entrySI, edge.toRI, ai,
            newTime, newLegs, newUsed, rideNum + 1,
          );
        }
      }
    }
  }

  // For each entry stop, explore all reachable exits
  for (let ri = 0; ri < routes.length; ri++) {
    const route = routes[ri]!;
    // 同上:沒有拒載門檻，慢就是它的懲罰。

    for (let si = 0; si < route.stops.length; si++) {
      const entryStop = route.stops[si]!;
      const waitTime = expectedWait(route.headway, waitFactor, route.loadFactor);

      // Single ride: board at (ri,si), alight at (ri,ai)
      for (let ai = 0; ai < route.stops.length; ai++) {
        if (ai === si) continue;
        const alightStop = route.stops[ai]!;
        const rideTime = computeRideDistance(route.stops, si, ai, route.segDists) / route.speed;
        const rideLeg: TransitLeg = {
          type: 'ride',
          fromX: entryStop.x, fromY: entryStop.y,
          toX: alightStop.x, toY: alightStop.y,
          estimatedTime: waitTime + rideTime,
          transitType: route.type,
          routeIdx: ri,
          boardStopIdx: si,
          alightStopIdx: ai,
        };

        tryCache(ri, si, ri, ai, [rideLeg], waitTime + rideTime);

        // Explore transfers from this alight stop
        if (maxRides >= 2 && hasTransferEdges.has(sk(ri, ai))) {
          exploreTransfers(
            ri, si, ri, ai,
            waitTime + rideTime, [rideLeg],
            new Set([ri]), 1,
          );
        }
      }
    }
  }
}

// ── Multi-Modal Route Search (cache-backed) ─────────────────────

const MAX_RESULTS = 20;

/**
 * 用預先算好的站對站快取找轉乘路線。
 *
 * 每問一位市民的成本是「走得到的進站 × 走得到的出站」次查表 —— 逐站掃描的年代是
 * 「全城站牌數 + 走得到的進站數 × 全城站牌數」，因為出站那一側的步行距離被寫在
 * 進站迴圈**裡面**，而它跟進站選哪一站無關。192 個站牌、一位市民走得到 9.8 個的
 * 合成城市實測:每位市民 2 005 次步行距離查詢，其中 1 882 次是重算的。
 */
export function findMultiModalRoutes(
  routes: readonly FlatRoute[],
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  walkSpeed: number,
  _waitFactor: number,
  transferGraph: TransferGraph,
  _maxLegs: number,
  index: StopProximityIndex,
): MultiLegRoute[] {
  if (routes.length === 0) return [];

  // 索引已經照運具的步行上限截過了（人願意為捷運多走，為公車不肯），而且是沿
  // 人行道量的 —— 直線看不見馬路，會把住戶從對街「走」到站牌。
  const entries = index.at(origin.x, origin.y);
  if (entries.length === 0) return [];
  const exits = index.at(destination.x, destination.y);
  if (exits.length === 0) return [];

  const cache = transferGraph.stopRouteCache;
  const results: MultiLegRoute[] = [];

  for (const entry of entries) {
    const entryStop = routes[entry.routeIdx]?.stops[entry.stopIdx];
    if (entryStop === undefined) continue;

    const firstWalkTime = entry.walkDistance / walkSpeed;
    const firstWalkLeg: TransitLeg = {
      type: 'walk',
      fromX: origin.x, fromY: origin.y,
      toX: entryStop.x, toY: entryStop.y,
      estimatedTime: firstWalkTime,
    };

    for (const exit of exits) {
      const cached = cache.get(cacheKey(entry.routeIdx, entry.stopIdx, exit.routeIdx, exit.stopIdx));
      if (!cached) continue;
      const exitStop = routes[exit.routeIdx]?.stops[exit.stopIdx];
      if (exitStop === undefined) continue;

      const lastWalkTime = exit.walkDistance / walkSpeed;
      const lastWalkLeg: TransitLeg = {
        type: 'walk',
        fromX: exitStop.x, fromY: exitStop.y,
        toX: destination.x, toY: destination.y,
        estimatedTime: lastWalkTime,
      };

      const legs = [firstWalkLeg, ...cached.legs, lastWalkLeg];
      results.push({
        legs,
        totalTime: firstWalkTime + cached.totalTime + lastWalkTime,
        // 中間那幾段可能還有轉乘步行，所以是把 walk 腿全部加起來，
        // 不是只算頭尾兩段。
        walkTime: legs.reduce((s, l) => l.type === 'walk' ? s + l.estimatedTime : s, 0),
      });

      if (results.length >= MAX_RESULTS) break;
    }
    if (results.length >= MAX_RESULTS) break;
  }

  results.sort((a, b) => a.totalTime - b.totalTime);
  return results;
}
