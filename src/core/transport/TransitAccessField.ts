import { manhattanDistance, toPosKey } from '../grid/GridHelpers';
import { computeRideDistance } from './TransitAvailability';
import { chooseModeMultiModal, type AvailableTransport } from './ModeChoice';
import type { FlatRoute } from './MultiModalRouter';

/**
 * 大眾運輸可及性圖 —— 每一格走得到哪些路線、要走多久。
 *
 * 通勤時間取決於「起點 × 終點」這個**配對**：住房分配一輪要評好幾萬組，用多模式
 * 路由器逐一算會直接卡死。這張圖在路線變動時建一次，之後任兩點的通勤時間就是
 * 幾次查表加算術。
 *
 * 精度換速度是刻意的 —— 它只回答「兩端碰不碰得到同一條路線」，不處理轉乘。真正
 * 派車時仍然走完整的多模式路由器；這張圖只用於評分與觸發判斷，那些地方要的是
 * 「這個人的通勤大概多痛苦」，不是精確路線。
 */

/** 從某一格走得到的一個站。 */
export interface TransitAccess {
  /** `routes` 陣列的索引。 */
  routeIdx: number;
  /** 該路線 `stops` 陣列的索引。 */
  stopIdx: number;
  /** 走到那一站要幾 tick。 */
  walkTime: number;
}

const NONE: readonly TransitAccess[] = [];

export class TransitAccessField {
  private readonly byCell = new Map<string, TransitAccess[]>();

  private constructor() {}

  /**
   * 從站牌往外掃 `walkRange`，把每一格走得到的路線記下來。
   *
   * 同一條路線只留最近的那一站 —— 留全部的話這張圖會膨脹成站數 × 覆蓋面積，
   * 而遠一點的那些站永遠不會被選中。
   */
  static build(
    routes: readonly FlatRoute[], walkRange: number, walkSpeed: number,
  ): TransitAccessField {
    const field = new TransitAccessField();

    for (let ri = 0; ri < routes.length; ri++) {
      const stops = routes[ri]!.stops;
      for (let si = 0; si < stops.length; si++) {
        const s = stops[si]!;
        for (let dy = -walkRange; dy <= walkRange; dy++) {
          const rest = walkRange - Math.abs(dy);
          for (let dx = -rest; dx <= rest; dx++) {
            const x = s.x + dx, y = s.y + dy;
            if (x < 0 || y < 0) continue;
            const walkTime = manhattanDistance(s.x, s.y, x, y) / walkSpeed;
            field.record(toPosKey(x, y), ri, si, walkTime);
          }
        }
      }
    }
    return field;
  }

  private record(key: string, routeIdx: number, stopIdx: number, walkTime: number): void {
    const list = this.byCell.get(key);
    if (!list) {
      this.byCell.set(key, [{ routeIdx, stopIdx, walkTime }]);
      return;
    }
    const existing = list.find(a => a.routeIdx === routeIdx);
    if (!existing) {
      list.push({ routeIdx, stopIdx, walkTime });
      return;
    }
    if (walkTime < existing.walkTime) {
      existing.stopIdx = stopIdx;
      existing.walkTime = walkTime;
    }
  }

  /** 這一格走得到的路線。沒有就是空陣列。 */
  at(x: number, y: number): readonly TransitAccess[] {
    return this.byCell.get(toPosKey(x, y)) ?? NONE;
  }

  /** 記了幾格（測試與除錯用）。 */
  get size(): number {
    return this.byCell.size;
  }
}

/**
 * 兩端都碰得到的路線，各自要花多久。
 *
 * 時間含走到站、等車與乘車 —— 只算乘車的話，一條班距 40 tick 的公車看起來會
 * 跟捷運一樣好。
 */
function transitOptions(
  from: { x: number; y: number }, to: { x: number; y: number },
  field: TransitAccessField, routes: readonly FlatRoute[], waitFactor: number,
): AvailableTransport[] {
  const fromAccess = field.at(from.x, from.y);
  if (fromAccess.length === 0) return [];
  const toAccess = field.at(to.x, to.y);
  if (toAccess.length === 0) return [];

  const options: AvailableTransport[] = [];
  for (const a of fromAccess) {
    const b = toAccess.find(t => t.routeIdx === a.routeIdx);
    if (!b || b.stopIdx === a.stopIdx) continue;
    const route = routes[a.routeIdx];
    if (!route || route.isFull) continue;

    const rideDistance = computeRideDistance(route.stops, a.stopIdx, b.stopIdx, route.segDists);
    const wait = route.frequency * waitFactor;
    options.push({
      type: route.type,
      estimatedTime: a.walkTime + wait + rideDistance / route.speed + b.walkTime,
    });
  }
  return options;
}

/**
 * 這一趟通勤要花多久（tick）。
 *
 * 開車時間隨距離與壅塞上升，搭車時間由路網決定 —— 兩者是同一個尺度，所以
 * 「住得遠但住在站旁邊」與「住得近但天天塞車」比得出高下。
 *
 * 選哪一種交通方式沿用 `chooseModeMultiModal`，不另外寫一套判斷 —— 兩邊各寫
 * 一次的話，評分認為他搭捷運、實際派車卻讓他開車，兩者會靜靜地不一致。
 */
export function estimateCommuteTime(
  from: { x: number; y: number },
  to: { x: number; y: number },
  congestionLevel: number,
  field: TransitAccessField,
  routes: readonly FlatRoute[],
  waitFactor: number,
): number {
  return estimateCommute(from, to, congestionLevel, field, routes, waitFactor).time;
}

/** 同上，但連「怎麼去」一起回報 —— 總覽面板要看交通方式的分布。 */
export function estimateCommute(
  from: { x: number; y: number },
  to: { x: number; y: number },
  congestionLevel: number,
  field: TransitAccessField,
  routes: readonly FlatRoute[],
  waitFactor: number,
): { time: number; mode: string } {
  const options = transitOptions(from, to, field, routes, waitFactor);
  const choice = chooseModeMultiModal(from, to, options, [], congestionLevel);
  return { time: choice.time, mode: choice.mode };
}
