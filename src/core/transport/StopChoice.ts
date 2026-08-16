import { walkDistanceToStop, type StopReach } from '../traffic/StopWalkReach';
import { walkRangeFor, WALK_RANGE_BY_TYPE } from './WalkRange';
import type { TransportType } from './types';

/** 挑站牌只需要座標，其餘欄位由呼叫端決定。 */
export interface StopLike {
  x: number;
  y: number;
  type?: TransportType;
}

/**
 * 從 `pos` 走得到、而且最近的那一站。一站都走不到就回 `null`。
 *
 * 這支決定行人第一哩／最後一哩要走去哪裡 —— 它挑的那一站，就是玩家會看到行人
 * 走過去的那一站。所以「近」必須跟其他挑站的地方用同一把尺：沿人行道量。用直線
 * 距離的話，對街的站牌只有兩格、永遠贏過同側往前三格的那一站，於是行人被派去
 * 對面，再繞到路口、繞回來。
 *
 * 回 `null` 是有意義的答案，不是失敗：一站都走不到的人就是搭不到車，該開車。
 */
export function findNearestReachableStop<T extends StopLike>(
  stops: readonly T[],
  pos: { x: number; y: number },
  reach: StopReach,
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const s of stops) {
    const dist = walkDistanceToStop(reach, s.x, s.y, pos.x, pos.y, WALK_RANGE_BY_TYPE.WIDEST);
    if (dist > (s.type ? walkRangeFor(s.type) : WALK_RANGE_BY_TYPE.FALLBACK)) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}
