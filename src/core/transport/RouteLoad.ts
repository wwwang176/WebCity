import type { TransportStop } from './types';

/**
 * 一條路線有多好搭：班距與擁擠程度。
 *
 * 兩者都是從「現在有幾台車、載了多少人」算出來的，不存成欄位。存成欄位的話，每個
 * 會動到路線的地方都得記得重算 —— 加車那條路就漏了，於是加車只提高了容量上限，
 * 班次一點也沒有變密。
 */

export const CROWDING = {
  /** 到這個載重為止，等車時間不受影響。 */
  COMFORT_LOAD: 0.8,
  /** 擠到極限時要等這麼多倍 —— 眼睜睜看幾班滿載的車開走。 */
  MAX_WAIT_MULTIPLIER: 4,
  /** 超過這個載重就真的上不去了。 */
  REFUSE_LOAD: 1.5,
} as const;

/**
 * 一台車跑完整圈要多久（tick）。
 *
 * 是整圈而不是單程：路線是環狀的，車子回到起點才輪到下一班。
 */
export function computeCycleTime(
  stops: readonly TransportStop[],
  segDists: number[] | null,
  speed: number,
): number {
  const n = stops.length;
  if (n < 2 || speed <= 0) return 0;

  // 快取的段距要與站數 1:1 才能用。站數變了而快取還沒重算時拿它當真，會回報
  // 別一段的距離（同 BUG-064 的理由）—— 寧可退回站與站之間的直線距離。
  const safe = segDists && segDists.length === n ? segDists : null;

  let total = 0;
  for (let i = 0; i < n; i++) {
    if (safe) { total += safe[i]!; continue; }
    const a = stops[i]!;
    const b = stops[(i + 1) % n]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total / speed;
}

/**
 * 班距：整圈時間 ÷ 車輛數。
 *
 * 這是加車真正買到的東西。原本班距寫死成站數的倍數，加車只把容量上限往上推，
 * 等車一秒都沒有變短 —— 玩家最主要的槓桿其實不改善服務品質。
 */
export function computeHeadway(cycleTime: number, vehicles: number): number {
  if (vehicles <= 0) return Infinity;
  return cycleTime / vehicles;
}

/**
 * 一天載得動多少人次。
 *
 * 座位數要乘上「一天跑幾圈」才是同一個單位。原本是拿一整天的累計人次去比
 * `車輛數 × 座位數` —— 一個是累計量、一個是瞬間量，兩台公車一天載到第 100 人次
 * 就算滿了，天花板低了一個數量級。
 */
export function computeDailyCapacity(
  vehicles: number,
  seatsPerVehicle: number,
  cycleTime: number,
  ticksPerDay: number,
): number {
  if (vehicles <= 0 || seatsPerVehicle <= 0 || cycleTime <= 0) return 0;
  const loopsPerDay = ticksPerDay / cycleTime;
  return vehicles * seatsPerVehicle * loopsPerDay;
}

/** 載重率。沒有運能卻有人要搭，就是無窮大。 */
export function computeLoadFactor(dailyRiders: number, dailyCapacity: number): number {
  if (dailyCapacity > 0) return dailyRiders / dailyCapacity;
  return dailyRiders > 0 ? Infinity : 0;
}

/**
 * 擠不擠得上去，反映在等車時間上。
 *
 * 車廂滿了就得等下一班、再下一班。原本沒有這一段，只有一個「滿了就整條路線從所有
 * 人的選項裡消失」的懸崖：載到 99% 時它跟空車一樣好，到 100% 的瞬間全城改開車。
 * 改成連續的之後，玩家會先看到通勤時間變長，才輪到有人擠不上去。
 */
export function crowdingWaitMultiplier(loadFactor: number): number {
  if (loadFactor <= CROWDING.COMFORT_LOAD) return 1;
  const span = CROWDING.REFUSE_LOAD - CROWDING.COMFORT_LOAD;
  const over = Math.min(1, (loadFactor - CROWDING.COMFORT_LOAD) / span);
  return 1 + over * (CROWDING.MAX_WAIT_MULTIPLIER - 1);
}

/**
 * 面板轉紅的載重。
 *
 * 這是一個**顯示用**的門檻，不是模擬常數 —— 模擬裡九成載重不會發生任何特別的事。
 * 它存在的理由是提前警告:等到一五○%（`REFUSE_LOAD`，路線真的開始拒載）才變紅
 * 的話，玩家看到紅燈時事情已經壞了。紅燈要說的是「現在該加車了」，不是
 * 「已經來不及了」。
 */
export const USAGE_WARN_LOAD = 0.9;

/**
 * 載重的四個階段。顏色與文案照這個分。
 *
 * 前兩段與最後一段對應模擬裡**真的會發生的事**，中間那道是顯示用的提前警告:
 * - `comfortable`（< 0.8）：等車時間不受影響。
 * - `crowded`（0.8 ~ 0.9）：等車時間開始拉長（`crowdingWaitMultiplier`）。
 * - `overloaded`（>= 0.9）：提前警告，該加車了。
 * - `refusing`（>= 1.5）：真的擠不上去，這條路線從那個人的選項裡消失
 *   （`isOverCapacity`）。顏色跟 `overloaded` 一樣紅，但文案不同 —— 玩家要看得出
 *   「快滿了」跟「已經沒有人搭得上去了」的差別。
 *
 * 抽出來是為了讓面板跟模擬讀同一組數字 —— 各寫一份的話，兩邊會靜靜地分家。
 */
export type RouteLoadStatus = 'comfortable' | 'crowded' | 'overloaded' | 'refusing';

export function routeLoadStatus(loadFactor: number): RouteLoadStatus {
  if (loadFactor >= CROWDING.REFUSE_LOAD) return 'refusing';
  if (loadFactor >= USAGE_WARN_LOAD) return 'overloaded';
  if (loadFactor >= CROWDING.COMFORT_LOAD) return 'crowded';
  return 'comfortable';
}

/**
 * 面板上那一欄的字。**不夾在 100%**。
 *
 * 夾住的話，一條 105% 的路線跟一條 400% 的路線長得一模一樣 —— 而前者加一台車就
 * 夠，後者要加三倍。那一欄是玩家決定「該加幾台車」的唯一依據，夾住等於把要做
 * 決定的那個資訊藏起來。
 *
 * 沒有運能的路線印 `—` 而不是 0%：0% 會讓玩家以為它很空。
 */
export function formatRouteUsage(riders: number, capacity: number): string {
  if (capacity <= 0) return '\u2014';
  return `${Math.round((riders / capacity) * 100)}%`;
}

/** 真的擠不上去了 —— 這條路線對這個人不存在。 */
export function isOverCapacity(loadFactor: number): boolean {
  return loadFactor >= CROWDING.REFUSE_LOAD;
}

/**
 * 站在站牌前預期要等多久。
 *
 * 單一運具、轉乘路線與可及性圖三處都要算這個數字，寫在同一個地方 —— 各寫一次的話，
 * 評分認為他搭得很順、實際派車卻讓他等到天荒地老，兩邊會靜靜地不一致。
 */
export function expectedWait(headway: number, waitFactor: number, loadFactor: number): number {
  return headway * waitFactor * crowdingWaitMultiplier(loadFactor);
}

/**
 * 一條路線現在有多好搭：班距與載重率。
 *
 * 兩個都從「現在有幾台車、載了多少人」算出來，不從欄位讀 —— 存成欄位的話，每個
 * 會動到路線的地方都得記得重算，而加車那條路就漏了。
 *
 * `seatsPerVehicle` 給 0 代表這個系統不受運能限制（機場走的是另一套模型），
 * 沿用舊行為。
 */
export function routeService(
  route: { stops: readonly TransportStop[]; vehicles: number },
  riders: number,
  seatsPerVehicle: number,
  speed: number,
  segDists: number[] | null,
  ticksPerDay: number,
): { headway: number; loadFactor: number } {
  const cycleTime = computeCycleTime(route.stops, segDists, speed);
  const loadFactor = seatsPerVehicle > 0
    ? computeLoadFactor(
        riders,
        computeDailyCapacity(route.vehicles, seatsPerVehicle, cycleTime, ticksPerDay),
      )
    : 0;
  return { headway: computeHeadway(cycleTime, route.vehicles), loadFactor };
}
