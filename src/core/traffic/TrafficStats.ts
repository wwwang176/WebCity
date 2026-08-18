/**
 * Pure-function traffic statistics aggregation (SRP).
 * Extracted from Game.ts — Game should not be responsible for aggregating traffic data.
 */

/** Pre-computed traffic data needed for stats (DIP). */
export interface TrafficStatsContext {
  /**
   * 有多少居民正在開車通勤 —— 不是路上的車輛總數。
   *
   * 路上還有過境車流、貨運與服務車輛，那三種跟居民的運具選擇無關。面板拿這張卡
   * 判斷政策有沒有把人趕上大眾運輸，混進去的話居民真的改搭公車了也看不出來。
   */
  commuteVehicleCount: number;
  topCongested: { segment: string; density: number }[];
  /** 居民開車通勤的平均路程。與 `commuteVehicleCount` 同一個母體。 */
  commuteAvgPathLength: number;
  roadTileCount: number;
}

export interface TrafficStatsResult {
  commuteVehicleCount: number;
  topCongested: { segment: string; density: number }[];
  commuteAvgPathLength: number;
  totalRoads: number;
}

/** Compute traffic statistics from pre-aggregated context. Pure function. */
export function getTrafficStats(ctx: TrafficStatsContext): TrafficStatsResult {
  return {
    commuteVehicleCount: ctx.commuteVehicleCount,
    topCongested: ctx.topCongested,
    commuteAvgPathLength: Math.round(ctx.commuteAvgPathLength * 10) / 10,
    totalRoads: ctx.roadTileCount,
  };
}
