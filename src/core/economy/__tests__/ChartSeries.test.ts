import { describe, it, expect } from 'vitest';
import {
  emptyChartHistory, appendChartDay, bucketChartSeries, CHART_RANGES, CHART_HISTORY_DAYS,
  type ChartRange, type ChartHistory,
} from '../ChartSeries';

/**
 * Chart sampling. The time axis advances with in-game days, not with render frames: one
 * sample per frame would fill a sixty-point chart in a single second.
 */

/**
 * The five series deliberately carry different values. Were they all the same number, a
 * wiring bug that writes population into all five would leave every length, average and
 * expectation identical, and the tests would still pass.
 */
const sample = (n: number) => ({
  pop: n, happiness: n + 1000, funds: n + 2000, income: n + 3000, expenses: n + 4000,
});

/** Records `days` consecutive days starting at day 0; the value on day d is d. */
function fill(days: number, keep = 400): ChartHistory {
  let h = emptyChartHistory();
  for (let d = 0; d < days; d++) h = appendChartDay(h, d, sample(d), keep);
  return h;
}

describe('依日採樣', () => {
  it('should record one point per day', () => {
    expect(fill(5).days.length).toBe(5);
  });

  it('should overwrite the day already in progress', () => {
    // The UI refreshes many times within one day; appending on every refresh would grow
    // hundreds of points per day.
    let h = emptyChartHistory();
    h = appendChartDay(h, 3, sample(10), 400);
    h = appendChartDay(h, 3, sample(20), 400);
    expect(h.days.length, '同一天記了兩筆').toBe(1);
    expect(h.pop[0], '沒有更新成最新的值').toBe(20);
    expect(h.funds[0], 'funds 讀到的不是 funds').toBe(2020);
  });

  it('should drop the oldest once it is full', () => {
    const h = fill(10, 4);
    expect(h.days).toEqual([6, 7, 8, 9]);
    expect(h.pop).toEqual([6, 7, 8, 9]);
  });

  it('should cap at a year by default, without being told', () => {
    // The default `keep` is what the production path uses. Without a case that leaves it
    // implicit, removing it would let history grow without bound and every test would pass.
    let h = emptyChartHistory();
    for (let d = 0; d < CHART_HISTORY_DAYS + 25; d++) h = appendChartDay(h, d, sample(d));
    expect(h.days.length, '沒有裁到預設上限').toBe(CHART_HISTORY_DAYS);
    expect(h.days[h.days.length - 1], '裁掉的是新的那一頭').toBe(CHART_HISTORY_DAYS + 24);
  });

  it('should keep every series the same length', () => {
    // The five series share one time axis. Mismatched lengths would place different days at
    // the same index.
    const h = fill(10, 4);
    for (const key of ['pop', 'happiness', 'funds', 'income', 'expenses'] as const) {
      expect(h[key].length, `${key} 的長度跟時間軸對不上`).toBe(h.days.length);
    }
  });

  it('should not lose a day when the clock jumps', () => {
    // Loading a save, or running long with the panel closed, jumps the day counter. Only the
    // samples actually received are recorded; zero-filling would draw a trough that never
    // happened.
    let h = emptyChartHistory();
    h = appendChartDay(h, 0, sample(5), 400);
    h = appendChartDay(h, 50, sample(9), 400);
    expect(h.days).toEqual([0, 50]);
    expect(h.pop).toEqual([5, 9]);
  });
});

describe('三個範圍', () => {
  it('should offer week, month and year', () => {
    expect(Object.keys(CHART_RANGES).sort()).toEqual(['month', 'week', 'year']);
  });

  it('should show more history the longer the range', () => {
    const days = (r: ChartRange) => CHART_RANGES[r].days;
    expect(days('week')).toBeLessThan(days('month'));
    expect(days('month')).toBeLessThan(days('year'));
  });

  it('should keep every range down to a readable number of bars', () => {
    // A 360-day year at one bar per day is over three hundred bars, each under two pixels
    // wide on a 613px chart.
    for (const r of Object.keys(CHART_RANGES) as ChartRange[]) {
      const spec = CHART_RANGES[r];
      const bars = spec.days / spec.bucketDays;
      expect(bars, `${r} 有 ${bars} 根長條`).toBeLessThanOrEqual(60);
      expect(bars, `${r} 只有 ${bars} 根長條`).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('併成要畫的點', () => {
  it('should show one point per day on the week range', () => {
    const out = bucketChartSeries(fill(30), 'week');
    expect(out.pop.length).toBe(7);
    expect(out.pop, '週的範圍不該做平均').toEqual([23, 24, 25, 26, 27, 28, 29]);
    // Each series reads its own column. Were they all pointed at pop, these would be equal.
    expect(out.income, 'income 讀到的不是 income').toEqual([3023, 3024, 3025, 3026, 3027, 3028, 3029]);
  });

  it('should average within a bucket, not sum', () => {
    // Average, not sum: summing would make a year bar ten times taller than a month bar
    // purely because the bucket is wider. The vertical axis must mean the same thing in
    // every range.
    const out = bucketChartSeries(fill(360), 'year');
    const spec = CHART_RANGES.year;
    const last = out.income[out.income.length - 1]!;
    const firstDayOfLastBucket = 360 - spec.bucketDays;
    const expected = (firstDayOfLastBucket + 359) / 2 + 3000;
    expect(last).toBeCloseTo(expected, 6);
  });

  it('should only use the days it actually has', () => {
    // Switching to 'year' on day three must not draw 36 bars, 35 of them invented.
    const out = bucketChartSeries(fill(3), 'year');
    expect(out.pop.length).toBeLessThanOrEqual(1);
    expect(out.pop.every(v => Number.isFinite(v)), '出現了 NaN').toBe(true);
  });

  it('should say which day each bucket ends on', () => {
    // Hovering a bar has to say when it was. Without a time axis the tooltip can only say
    // 'bar 3', while the player cares about the day number.
    const week = bucketChartSeries(fill(30), 'week');
    expect(week.days).toEqual([23, 24, 25, 26, 27, 28, 29]);

    const year = bucketChartSeries(fill(360), 'year');
    expect(year.days.length, '時間軸跟資料的長度對不上').toBe(year.pop.length);
    expect(year.days[year.days.length - 1], '最後一根的日期不是最新的那天').toBe(359);
  });

  it('should return nothing when nothing has been recorded', () => {
    const out = bucketChartSeries(emptyChartHistory(), 'month');
    expect(out.pop).toEqual([]);
    expect(out.funds).toEqual([]);
  });

  it('should keep the newest data at the right edge', () => {
    // Time runs left to right, so the newest sample sits at the right edge.
    const out = bucketChartSeries(fill(30), 'month');
    expect(out.pop[out.pop.length - 1]).toBe(29);
    expect(out.pop[0]).toBeLessThan(out.pop[out.pop.length - 1]!);
  });

  it('should put the newest day in the last bucket even when it does not divide evenly', () => {
    // 25 days at ten days per bucket is two bars with five left over. The remainder is dropped
    // from the left (oldest first); kept on the right, the last bar would cover days 10-19 and
    // the rightmost bar would be five days stale. The 30-day case above divides evenly, so both
    // placements agree there.
    const out = bucketChartSeries(fill(25), 'year');
    expect(out.pop.length).toBe(2);
    const newest = (15 + 24) / 2;
    expect(out.pop[out.pop.length - 1], '最後一根不是最新的十天').toBeCloseTo(newest, 6);
  });
});
