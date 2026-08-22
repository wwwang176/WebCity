/**
 * 一格的服務有多糟 —— 距離與負載合成一個數字。
 *
 * ## 為什麼要合成
 *
 * 圓點與圖層一直以來只畫距離:「沿馬路從最近一座設施走過來的成本 ÷ 預算」。
 * 那答的是「有沒有人管得到我」，不是「我被管得好不好」。緊鄰一間爆到 200% 的醫院，
 * 距離比值是 0，圓點是最綠的 —— 而那間醫院對死亡率的抑制已經歸零（BUG-362）。
 *
 * ## 取比較糟的那一個，不是平均
 *
 * 平均會讓兩種都「有點糟」看起來比一種「非常糟」還嚴重。而玩家要處理的是那個
 * 最糟的:設施太遠就多蓋一座近的，設施太滿就多蓋一座分流 —— 動作不同，
 * 但都由最糟的那一項決定。
 *
 * ## 負載怎麼換算成 0–1
 *
 * 剛好滿（1.0）算 0，兩倍（2.0）算 1。這條線不是隨便挑的:遊戲自己就是這樣量
 * 「超載有多糟」的 —— `loadRatioToDeathMultiplier()` 在負載 1.0 時給死亡率 ×0.3
 * （設施全效），2.0 以上給 ×1.0（**等於完全沒有設施**），中間線性。
 */

/** 負載換算成嚴重度的兩個端點。 */
export const LOAD_SEVERITY = {
  /** 到這裡為止都算沒事。 */
  FULL: 1.0,
  /** 到這裡就等於完全沒有這個服務。 */
  USELESS: 2.0,
} as const;

/** 沒有覆蓋。跟「覆蓋得很差」是兩件事 —— 前者要蓋新的，後者要蓋近的。 */
export const NO_COVERAGE = -1;

/**
 * 負載比值 → 0–1 的嚴重度。
 *
 * 負數代表「不適用」（沒有覆蓋、或這個服務沒有負載的概念），回 0 而不是 -1 ——
 * 這支的回傳值是要拿去跟距離比大小的，混進一個 -1 會讓它永遠輸。
 */
export function loadSeverity(loadRatio: number): number {
  if (!(loadRatio > LOAD_SEVERITY.FULL)) return 0;
  if (loadRatio >= LOAD_SEVERITY.USELESS) return 1;
  return (loadRatio - LOAD_SEVERITY.FULL) / (LOAD_SEVERITY.USELESS - LOAD_SEVERITY.FULL);
}

/**
 * 這一格的服務有多糟。0 = 最好，1 = 最差，`-1` = 沒有覆蓋。
 *
 * `costRatio` 是 `getCostRatio()` 的回傳值（-1 代表沒覆蓋）。
 * `loadRatio` 是服務這一格的那座設施的負載 ÷ 容量（-1 代表問不到）。
 */
export function serviceSeverity(costRatio: number, loadRatio: number): number {
  if (costRatio < 0) return NO_COVERAGE;
  return Math.max(Math.min(1, costRatio), loadSeverity(loadRatio));
}
