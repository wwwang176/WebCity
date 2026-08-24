/**
 * The charts' time series.
 *
 * Sampled against **game time** rather than the display. Recording on every UI update means once
 * per frame, sixty points a second, and the player watches the data race leftwards at a speed
 * that reflects nothing but the frame rate.
 *
 * Everything is stored by day, and the ranges — week, month, year — are bucketed at draw time.
 * Storing each range separately means it starts accumulating when it is first opened and the
 * player sees an empty chart for history that has already happened.
 */

/** One day's sample. The five series share one time axis. */
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

/** The per-day history. `days` is the time axis and every other series matches its length. */
export type ChartHistory = { days: number[] } & Record<ChartSeriesKey, number[]>;

export type ChartRange = 'week' | 'month' | 'year';

/**
 * How many days each range covers and how many days go into one bar.
 *
 * The bar count is held under 60: a year of 360 days at one bar each is under two pixels per bar
 * on a 613px chart, which is noise rather than a chart.
 */
export const CHART_RANGES: Record<ChartRange, { days: number; bucketDays: number; label: string }> = {
  week: { days: 7, bucketDays: 1, label: 'Week' },
  month: { days: 30, bucketDays: 1, label: 'Month' },
  year: { days: 360, bucketDays: 10, label: 'Year' },
};

/** How many days are kept: as many as the longest range covers. */
export const CHART_HISTORY_DAYS = CHART_RANGES.year.days;

export function emptyChartHistory(): ChartHistory {
  return { days: [], pop: [], happiness: [], funds: [], income: [], expenses: [] };
}

/**
 * Records this day.
 *
 * The same day again overwrites: the UI updates hundreds of times within one day, and appending
 * each time grows hundreds of points a day, which is the original problem again.
 *
 * The axis stores actual day numbers and does not fill skipped days. Loading a save, or running
 * with the panel closed for a long time, jumps the day count sharply, and filling with zeros
 * draws a trough on the chart that never happened.
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

/** The bucketed data. `days` is the day each bar ends on and matches the other series' length. */
export type BucketedSeries = { days: number[] } & Record<ChartSeriesKey, number[]>;

/**
 * Buckets into the points this range draws, newest on the right, because a chart is read left to
 * right.
 *
 * A bucket takes the **average** rather than the sum. Summing makes the year's bars ten times the
 * month's when nothing about the city's finances changed except the bucket width: the vertical
 * axis has to mean the same thing across ranges.
 */
export function bucketChartSeries(
  history: ChartHistory,
  range: ChartRange,
): BucketedSeries {
  const spec = CHART_RANGES[range];
  const out: BucketedSeries = {
    days: [],
    pop: [], happiness: [], funds: [],
    income: [], expenses: [],
  };
  const n = history.days.length;
  if (n === 0) return out;

  // Only data that exists. Switching to the year view on day three draws one bar rather than 36
  // of which 35 are invented.
  const usable = Math.min(n, spec.days);
  const buckets = Math.floor(usable / spec.bucketDays);
  if (buckets === 0) return out;

  // Bucketed backwards from the end, so the newest day always lands in the last bar. Bucketing
  // forwards leaves the remainder on the right and the last bar is always old data.
  const from = n - buckets * spec.bucketDays;

  for (let b = 0; b < buckets; b++) {
    const lo = from + b * spec.bucketDays;
    const hi = lo + spec.bucketDays;
    // Which day this bar ends on, so the hover tooltip can say when it was.
    out.days.push(history.days[hi - 1]!);
    for (const key of CHART_SERIES_KEYS) {
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += history[key][i]!;
      out[key].push(sum / spec.bucketDays);
    }
  }
  return out;
}
