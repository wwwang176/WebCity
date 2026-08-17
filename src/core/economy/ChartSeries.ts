/**
 * 圖表的時間序列。
 *
 * 採樣跟著**遊戲的時間**走，不是跟著畫面。原本是每次 UI 更新記一筆 —— 那是每一幀，
 * 六十個點一秒就跑完，玩家看到的是資料往左邊衝，而那個速度只反映了 FPS。
 *
 * 底層一律以「日」為單位保存，範圍（週／月／年）是在畫的時候併出來的。三個範圍各存
 * 一份的話，切過去才開始累積，玩家會看到一張空圖 —— 而那段歷史明明已經發生過了。
 */

/** 一天的一筆樣本。五條序列共用一個時間軸。 */
export interface ChartSample {
  pop: number;
  happiness: number;
  funds: number;
  income: number;
  expenses: number;
}

export type ChartSeriesKey = keyof ChartSample;

export const CHART_SERIES_KEYS: readonly ChartSeriesKey[] =
  ['pop', 'happiness', 'funds', 'income', 'expenses'];

/** 逐日的歷史。`days` 是時間軸，其餘每條序列跟它等長。 */
export type ChartHistory = { days: number[] } & Record<ChartSeriesKey, number[]>;

export type ChartRange = 'week' | 'month' | 'year';

/**
 * 每個範圍看多少天、幾天併成一根長條。
 *
 * 長條數壓在 60 以內:一年 360 天一格一根的話，在 613px 寬的圖上每根不到兩像素，
 * 那不是圖表是雜訊。
 */
export const CHART_RANGES: Record<ChartRange, { days: number; bucketDays: number; label: string }> = {
  week: { days: 7, bucketDays: 1, label: 'Week' },
  month: { days: 30, bucketDays: 1, label: 'Month' },
  year: { days: 360, bucketDays: 10, label: 'Year' },
};

/** 要留多少天。最長的範圍看多少就留多少。 */
export const CHART_HISTORY_DAYS = CHART_RANGES.year.days;

export function emptyChartHistory(): ChartHistory {
  return { days: [], pop: [], happiness: [], funds: [], income: [], expenses: [] };
}

/**
 * 記下這一天。
 *
 * 同一天再來就覆蓋 —— 一天之內 UI 會更新幾百次，每次都追加的話一天就長出幾百個點，
 * 又回到原本那個問題。
 *
 * 時間軸存的是實際的日數，不補中間跳過的天。讀存檔或關著面板跑很久之後天數會一次跳
 * 很多，補零會在圖上畫出一段不曾發生過的谷底。
 */
export function appendChartDay(
  history: ChartHistory,
  day: number,
  sample: ChartSample,
  maxDays: number = CHART_HISTORY_DAYS,
): ChartHistory {
  const last = history.days.length - 1;
  const sameDay = last >= 0 && history.days[last] === day;

  const next: ChartHistory = {
    days: sameDay ? history.days.slice(0, last) : history.days.slice(),
    pop: [], happiness: [], funds: [], income: [], expenses: [],
  };
  for (const key of CHART_SERIES_KEYS) {
    next[key] = sameDay ? history[key].slice(0, last) : history[key].slice();
  }

  next.days.push(day);
  for (const key of CHART_SERIES_KEYS) next[key].push(sample[key]);

  const excess = next.days.length - maxDays;
  if (excess > 0) {
    next.days.splice(0, excess);
    for (const key of CHART_SERIES_KEYS) next[key].splice(0, excess);
  }
  return next;
}

/**
 * 併成這個範圍要畫的點。最新的在右邊 —— 玩家讀圖是從左讀到右。
 *
 * 桶內取**平均**不是加總。加總會讓「年」的長條比「月」高十倍，而那十倍只是格子變寬，
 * 城市的收支根本沒變 —— 切換範圍時縱軸的意思必須一樣。
 */
export function bucketChartSeries(
  history: ChartHistory,
  range: ChartRange,
): Record<ChartSeriesKey, number[]> {
  const spec = CHART_RANGES[range];
  const out = {
    pop: [] as number[], happiness: [] as number[], funds: [] as number[],
    income: [] as number[], expenses: [] as number[],
  };
  const n = history.days.length;
  if (n === 0) return out;

  // 只用真的有的資料。開局第三天切到「年」，畫的就是一根，不是 36 根裡有 35 根
  // 是憑空捏的。
  const usable = Math.min(n, spec.days);
  const buckets = Math.floor(usable / spec.bucketDays);
  if (buckets === 0) return out;

  // 從尾巴往回切，讓最新的那一天一定落在最後一根裡。從頭切的話餘數會留在右邊，
  // 最後一根永遠是舊資料。
  const from = n - buckets * spec.bucketDays;

  for (let b = 0; b < buckets; b++) {
    const lo = from + b * spec.bucketDays;
    const hi = lo + spec.bucketDays;
    for (const key of CHART_SERIES_KEYS) {
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += history[key][i]!;
      out[key].push(sum / spec.bucketDays);
    }
  }
  return out;
}
