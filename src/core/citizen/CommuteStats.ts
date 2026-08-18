import type { Citizen } from './types';

/**
 * 全城通勤時間的統計。
 *
 * 地圖圖層與總覽面板讀的是同一份 —— 兩邊各算一次的話，地圖上紅通通、面板卻說
 * 平均通勤良好，玩家不知道該信哪一個。
 */

/** 分桶的邊界（tick）。最後一桶是「以上」，所以桶數比邊界數多一。 */
export const COMMUTE_BUCKET_EDGES = [15, 30, 45, 60] as const;

/**
 * 一位市民的通勤：花多久、怎麼去。算不出來時回傳 null。
 *
 * `chargedDriver` 是「這一趟付了壅塞費」—— 還在開車，而且起點或終點落在收費區裡。
 * 由呼叫端判斷，因為只有它查得到分區;統計這一層只負責數。
 */
export type CommuteOf = (citizen: Citizen)
  => { time: number; mode: string; chargedDriver?: boolean } | null;

export interface WorstHome {
  pos: string;
  /** 這一格住戶的平均通勤時間。 */
  time: number;
  residents: number;
}

export interface CommuteStats {
  /** 住宅格 → 住戶的平均通勤時間。圖層直接讀這一張。 */
  byHome: Map<string, number>;
  /** 算得出通勤時間的人數。 */
  sampled: number;
  average: number;
  median: number;
  /** 通勤時間**超過**門檻的人數（門檻上剛好那一位不算）。 */
  overThreshold: number;
  /** 依 `COMMUTE_BUCKET_EDGES` 分桶的人數。 */
  buckets: number[];
  /** 交通方式 → 人數。 */
  byMode: Record<string, number>;
  /**
   * 付了壅塞費的通勤人數。
   *
   * 壅塞費的收入照這個數字收 —— 它是**流量**，車越少收得越少。用收費區的格數
   * 之類的存量計價的話，在荒地上畫一個大區也照樣進帳，而且政策越成功收入也不會
   * 掉，那就不是壅塞費了。
   */
  chargedDrivers: number;
  /** 通勤最久的幾個住宅格，最久的排前面。 */
  worst: WorstHome[];
}

function emptyStats(): CommuteStats {
  return {
    byHome: new Map(), sampled: 0, average: 0, median: 0, overThreshold: 0,
    buckets: new Array(COMMUTE_BUCKET_EDGES.length + 1).fill(0),
    byMode: {}, worst: [], chargedDrivers: 0,
  };
}

function bucketOf(time: number): number {
  for (let i = 0; i < COMMUTE_BUCKET_EDGES.length; i++) {
    if (time < COMMUTE_BUCKET_EDGES[i]!) return i;
  }
  return COMMUTE_BUCKET_EDGES.length;
}

/**
 * 掃過全體市民，算出圖層與面板要的所有數字。
 *
 * 算不出通勤時間的人**整個跳過**，不是當成 0 —— 路網剛改過的那幾 tick 會有一批
 * 人暫時算不出來，當成 0 會讓平均值瞬間跳低，看起來像是城市突然變好了。
 */
export function computeCommuteStats(
  citizens: readonly Citizen[],
  commuteOf: CommuteOf,
  threshold: number,
  worstCount: number,
): CommuteStats {
  const stats = emptyStats();
  const times: number[] = [];
  /** 住宅格 → [總時間, 人數] */
  const homeTotals = new Map<string, [number, number]>();

  for (const c of citizens) {
    if (!c.homeId || !c.workplaceId) continue;
    const commute = commuteOf(c);
    if (!commute || !Number.isFinite(commute.time)) continue;

    times.push(commute.time);
    if (commute.time > threshold) stats.overThreshold++;
    stats.buckets[bucketOf(commute.time)]!++;
    stats.byMode[commute.mode] = (stats.byMode[commute.mode] ?? 0) + 1;
    // 算不出通勤的人在上面就被跳過了 —— 收入不該把他們算進去。
    if (commute.chargedDriver) stats.chargedDrivers++;

    const entry = homeTotals.get(c.homeId);
    if (entry) { entry[0] += commute.time; entry[1]++; }
    else homeTotals.set(c.homeId, [commute.time, 1]);
  }

  stats.sampled = times.length;
  if (times.length === 0) return stats;

  let sum = 0;
  for (const t of times) sum += t;
  stats.average = sum / times.length;
  times.sort((a, b) => a - b);
  stats.median = times[Math.floor(times.length / 2)]!;

  const worst: WorstHome[] = [];
  for (const [pos, [total, residents]] of homeTotals) {
    const avg = total / residents;
    stats.byHome.set(pos, avg);
    worst.push({ pos, time: avg, residents });
  }
  worst.sort((a, b) => b.time - a.time);
  stats.worst = worst.slice(0, worstCount);

  return stats;
}
