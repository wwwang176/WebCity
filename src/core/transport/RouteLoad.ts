import type { TransportStop } from './types';

/**
 * 一條路線有多好搭：班距與擁擠程度。
 *
 * 兩者都是從「現在有幾台車、載了多少人」算出來的，不存成欄位。存成欄位的話，每個
 * 會動到路線的地方都得記得重算 —— 加車那條路就漏了，於是加車只提高了容量上限，
 * 班次一點也沒有變密。
 */

/**
 * 面板把載重分成幾段。**兩個都是顯示用的分界，不是模擬常數。**
 *
 * 模擬本身沒有任何門檻 —— 等待是連續的（`extraHeadwaysWaited`），越擠越久，
 * 沒有上限也沒有懸崖。這裡的兩個數字只決定那一格什麼時候變黃、什麼時候變紅。
 */
export const CROWDING = {
  /** 多等超過半個班距 —— 該加車了。 */
  OVERLOADED_LOAD: 1.5,
  /** 眼睜睜看兩班滿載的車開過去。 */
  HOPELESS_LOAD: 3,
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
 * 一台車一天算在班上多久（tick）。**運能專用，不是日曆上的一天。**
 *
 * 這個遊戲裡有兩個時鐘:
 *
 * | | |
 * |---|---|
 * | 日曆 | `ticksPerDay = 24` —— 老化、薪資、成長、統計都靠它 |
 * | 動畫 | 車子每 tick 前進幾格 —— 挑的是「看起來像不像公車」 |
 *
 * 車速從來不是從物理推出來的。所以拿 `ticksPerDay`（日曆）去除 `cycleTime`（動畫）
 * 是把兩個時鐘當成同一個 —— 玩家 12 500 人的存檔實測，一條 282 格的公車路線一圈
 * 要 141 tick，而一天只有 24 tick:一天跑 **0.17 圈**，50 座的車一天運能剩
 * **8.5 人次**。任何路線超過約 9 人次就爆表，玩家得買三百台車。
 *
 * 分開之後，運能用自己這把尺。**畫面上那台車一天還是只跑 0.17 圈** —— 兩個時鐘
 * 不同步，這是明知道的取捨。要同步就只能把車速調成每 tick 跨二十幾格，那是拿
 * 畫面去換公式好看。
 *
 * 480 的來由（玩家存檔的那條公車路線，2 623 人次/日）:
 *
 * | | 一天跑幾圈 | 單車運能/日 | 一條線要幾台車 |
 * |---|---|---|---|
 * | 24（日曆，錯的） | 0.17 | 8.5 | 309 |
 * | **480** | **3.4** | **170** | **15** |
 * | 960 | 6.8 | 340 | 8 |
 *
 * 選 480 而不是 960:960 之下捷運永遠吃不滿（四列車 12 400 人次/日，而全城一天
 * 約 17 600 趟通勤），擁擠模型在捷運上等於不存在。
 *
 * **這是平衡旋鈕**，不是物理常數。
 */
export const TRANSIT_SERVICE_TICKS_PER_DAY = 480;

/**
 * 一天載得動多少人次。
 *
 * 座位數要乘上「一天跑幾圈」才是同一個單位。原本是拿一整天的累計人次去比
 * `車輛數 × 座位數` —— 一個是累計量、一個是瞬間量，兩台公車一天載到第 100 人次
 * 就算滿了，天花板低了一個數量級。
 *
 * 「一天」用的是 `TRANSIT_SERVICE_TICKS_PER_DAY`，不是日曆上的一天，理由見上面。
 * 這裡**不收**時鐘參數 —— 收的話下一個呼叫端還是會把 `ticksPerDay` 傳進來。
 */
export function computeDailyCapacity(
  vehicles: number,
  seatsPerVehicle: number,
  cycleTime: number,
): number {
  if (vehicles <= 0 || seatsPerVehicle <= 0 || cycleTime <= 0) return 0;
  const loopsPerDay = TRANSIT_SERVICE_TICKS_PER_DAY / cycleTime;
  return vehicles * seatsPerVehicle * loopsPerDay;
}

/** 載重率。沒有運能卻有人要搭，就是無窮大。 */
export function computeLoadFactor(dailyRiders: number, dailyCapacity: number): number {
  if (dailyCapacity > 0) return dailyRiders / dailyCapacity;
  return dailyRiders > 0 ? Infinity : 0;
}

/**
 * 擠不上這班，平均還要多等幾班。
 *
 * 一句話推出來的:這班上不去的機率是 `q`，那要等 1、2、3⋯ 班的機率是等比級數，
 * 期望值 `q / (1 - q)`。以 `q = 1 - 1 / 載重` 代入（想搭的人是位子的 L 倍，
 * 就有 `1 - 1/L` 的人這班上不去），化簡剛好是 **載重 - 1**。
 *
 * 沒有上限:載重 11 就是多等 10 班。舊模型封在 4 倍，而「再擠也不會更糟」不是真的。
 *
 * 沒有懸崖:舊模型在載重 1.5 那一點從「還能搭」變成「這條線不存在」，中間差一個
 * 乘客。玩家 12 600 人的存檔實測，那道懸崖自己造出一個極限環 —— 加車讓載重衝過
 * 1.5，全部人被踢出去，載重掉回來，人又回來，再衝過去。
 *
 * 也不需要另外一條拒載線:等待自己會發散，而「等到天荒地老」本來就等價於
 * 「不能搭」—— 運具選擇是比大小的，一條要等十班的路線自己就輸了。
 */
export function extraHeadwaysWaited(loadFactor: number): number {
  return Math.max(0, loadFactor - 1);
}

/**
 * 載重的四個階段。顏色與文案照這個分。
 *
 * 分界點挑的是**模型裡真的會發生事情**的那幾點，不是好看的整數:
 * - `comfortable`（< 1）：位子夠，沒有人被留在站牌上。
 * - `crowded`（>= 1）：**開始有人上不去**，多等的班數從零往上走。
 * - `overloaded`（>= 1.5）：多等超過半個班距 —— 比基本等待還久，該加車了。
 * - `hopeless`（>= 3）：眼睜睜看兩班滿載的車開過去。
 *
 * 最後一段是**標籤，不是懸崖** —— 模擬不會把這條路線藏起來，只是讓它非常慢。
 * 舊模型那道 `refusing` 懸崖在載重 1.5 那一點把整條線從選項裡拿掉，而玩家實測
 * 發現它自己造出一個極限環。
 *
 * 抽出來是為了讓面板跟模擬讀同一組數字 —— 各寫一份的話，兩邊會靜靜地分家。
 */
export type RouteLoadStatus = 'comfortable' | 'crowded' | 'overloaded' | 'hopeless';

export function routeLoadStatus(loadFactor: number): RouteLoadStatus {
  if (loadFactor >= CROWDING.HOPELESS_LOAD) return 'hopeless';
  if (loadFactor >= CROWDING.OVERLOADED_LOAD) return 'overloaded';
  if (extraHeadwaysWaited(loadFactor) > 0) return 'crowded';
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

/**
 * 站在站牌前預期要等多久。
 *
 * 單一運具、轉乘路線與可及性圖三處都要算這個數字，寫在同一個地方 —— 各寫一次的話，
 * 評分認為他搭得很順、實際派車卻讓他等到天荒地老，兩邊會靜靜地不一致。
 */
export function expectedWait(headway: number, waitFactor: number, loadFactor: number): number {
  // 基本等待是**半個**班距（乘客隨機到站），多等的則是**整班** —— 兩者的單位不同，
  // 所以是相加不是相乘。舊寫法是整段乘上一個倍率，那讓「多等一班」的意思被
  // `waitFactor` 稀釋掉了。
  return headway * (waitFactor + extraHeadwaysWaited(loadFactor));
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
): { headway: number; loadFactor: number } {
  const cycleTime = computeCycleTime(route.stops, segDists, speed);
  const loadFactor = seatsPerVehicle > 0
    ? computeLoadFactor(
        riders,
        computeDailyCapacity(route.vehicles, seatsPerVehicle, cycleTime),
      )
    : 0;
  return { headway: computeHeadway(cycleTime, route.vehicles), loadFactor };
}
