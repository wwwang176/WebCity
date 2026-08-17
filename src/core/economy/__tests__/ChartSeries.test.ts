import { describe, it, expect } from 'vitest';
import {
  emptyChartHistory, appendChartDay, bucketChartSeries, CHART_RANGES, CHART_HISTORY_DAYS,
  type ChartRange, type ChartHistory,
} from '../ChartSeries';

/**
 * 圖表的採樣。
 *
 * 原本是每次 UI 更新就記一筆 —— 那是每一幀，六十個點一秒就跑完，玩家看到的是資料
 * 往左邊衝。時間軸要跟著遊戲的時間走，不是跟著畫面。
 */

/**
 * 五條序列**刻意給不同的值**。全部設成同一個數字的話，把 population 寫進全部五條
 * 序列這種接錯法，長度、平均與所有預期值都會完全一樣，測試看不出來。
 */
const sample = (n: number) => ({
  pop: n, happiness: n + 1000, funds: n + 2000, income: n + 3000, expenses: n + 4000,
});

/** 從第 0 天開始連續記 `days` 天，第 d 天的值都是 d。 */
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
    // 同一天之內 UI 會更新很多次。每次都追加的話，一天就長出幾百個點。
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
    // 上面那條每次都明講 `keep`，所以**正式路徑用的預設值完全沒被測到** ——
    // 把它拿掉，遊戲跑久了歷史會無限成長，而測試照樣全綠。
    let h = emptyChartHistory();
    for (let d = 0; d < CHART_HISTORY_DAYS + 25; d++) h = appendChartDay(h, d, sample(d));
    expect(h.days.length, '沒有裁到預設上限').toBe(CHART_HISTORY_DAYS);
    expect(h.days[h.days.length - 1], '裁掉的是新的那一頭').toBe(CHART_HISTORY_DAYS + 24);
  });

  it('should keep every series the same length', () => {
    // 五條序列共用一個時間軸。長度對不齊的話，圖表上第 i 個點會是不同時間的資料。
    const h = fill(10, 4);
    for (const key of ['pop', 'happiness', 'funds', 'income', 'expenses'] as const) {
      expect(h[key].length, `${key} 的長度跟時間軸對不上`).toBe(h.days.length);
    }
  });

  it('should not lose a day when the clock jumps', () => {
    // 讀存檔、或關著面板跑很久之後，天數會一次跳很多。這裡只記有拿到的樣本 ——
    // 補零會在圖上畫出一段不曾發生過的谷底。
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
    // 一年 360 天一格一根的話是三百多根長條，在 613px 寬的圖上每根不到兩像素。
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
    // 每條序列讀的是自己那一欄。全部指向 pop 的話這裡會全部相等。
    expect(out.income, 'income 讀到的不是 income').toEqual([3023, 3024, 3025, 3026, 3027, 3028, 3029]);
  });

  it('should average within a bucket, not sum', () => {
    // 平均而不是加總:加總會讓「年」的長條比「月」高十倍，而那十倍只是格子變寬，
    // 城市的收支根本沒變。切換範圍時縱軸的意思必須一樣。
    const out = bucketChartSeries(fill(360), 'year');
    const spec = CHART_RANGES.year;
    const last = out.income[out.income.length - 1]!;
    const firstDayOfLastBucket = 360 - spec.bucketDays;
    const expected = (firstDayOfLastBucket + 359) / 2 + 3000;
    expect(last).toBeCloseTo(expected, 6);
  });

  it('should only use the days it actually has', () => {
    // 開局第三天切到「年」，不該畫出 36 根長條，其中 35 根是憑空捏的。
    const out = bucketChartSeries(fill(3), 'year');
    expect(out.pop.length).toBeLessThanOrEqual(1);
    expect(out.pop.every(v => Number.isFinite(v)), '出現了 NaN').toBe(true);
  });

  it('should say which day each bucket ends on', () => {
    // 滑到某一根長條上要說得出「這是什麼時候」。沒有時間軸的話那個提示只能寫
    // 「第 3 根」，而玩家關心的是第幾天。
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
    // 時間往右長。反過來的話最新的一筆會在最左邊，而玩家讀圖是從左讀到右。
    const out = bucketChartSeries(fill(30), 'month');
    expect(out.pop[out.pop.length - 1]).toBe(29);
    expect(out.pop[0]).toBeLessThan(out.pop[out.pop.length - 1]!);
  });

  it('should put the newest day in the last bucket even when it does not divide evenly', () => {
    // 25 天、十天一根 —— 兩根，餘五天。餘數要留在**左邊**（丟掉最舊的），不然
    // 最後一根畫的是第 10–19 天，而玩家看到的「現在」其實是五天前。
    //
    // 上面那條驗不到這件事:30 天一天一根剛好整除，兩種切法算出來一樣。
    const out = bucketChartSeries(fill(25), 'year');
    expect(out.pop.length).toBe(2);
    const newest = (15 + 24) / 2;
    expect(out.pop[out.pop.length - 1], '最後一根不是最新的十天').toBeCloseTo(newest, 6);
  });
});
