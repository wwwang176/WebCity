import { describe, it, expect } from 'vitest';
import { commuteSampleSize, COMMUTE_SAMPLE_SPAN, COMMUTE_SAMPLE_CEILING } from '../CommuteSampling';

/**
 * 生成通勤車的迴圈每個 tick 問「適齡有工作的人 ÷ 8」位市民，也就是跟人口成正比。
 * 同一份存檔複製成 10 萬人實測:每 tick 問 13 149 位、191ms，而速度 1 的一個 tick
 * 只有 250ms（BUG-328）。
 *
 * 這個迴圈同時在估搭乘數，而估計的準確度只跟**問了幾個人**有關 —— 民調問一千人的
 * 誤差，兩千萬人的國家和三億人的國家一樣。所以問的人數沒有理由跟人口線性成長。
 */

describe('每個 tick 問幾位市民', () => {
  it('should not touch a city small enough to ask everyone', () => {
    // 小城市一個字都不該改。前期不該為了後期的問題付代價。
    for (const n of [1, 5, 42, COMMUTE_SAMPLE_SPAN - 1, COMMUTE_SAMPLE_SPAN]) {
      expect(commuteSampleSize(n), `想問 ${n} 位卻打了折`).toBe(n);
    }
  });

  it('should never ask more people than it wanted to', () => {
    // 回傳值大於 attempts 的話，放大倍率會小於 1 —— 每個人被算成不到一個人。
    for (const n of [1, 100, 151, 1077, 13149, 200000]) {
      expect(commuteSampleSize(n), `想問 ${n} 位卻問了更多`).toBeLessThanOrEqual(n);
    }
  });

  it('should grow like a square root in the middle band', () => {
    // 線性成長的話大城市會卡死;完全不成長的話放大倍率會大到讓小路線的數字
    // 一格一格跳。中段走平方根，兩邊都顧到。
    const a = commuteSampleSize(1_000);
    const b = commuteSampleSize(4_000);   // 四倍的量
    expect(b / a, '量翻四倍，問的人數該翻兩倍').toBeCloseTo(2, 1);
    expect(b, '中段就先撞到天花板了，平方根那段等於不存在')
      .toBeLessThan(COMMUTE_SAMPLE_CEILING);
  });

  it('should stop growing at the ceiling', () => {
    // 平方根仍然是無限成長的:100 萬人要問 4 415 位，約 66ms/tick。
    for (const n of [50_000, 200_000, 1_000_000]) {
      expect(commuteSampleSize(n), `${n} 沒有被天花板擋住`).toBe(COMMUTE_SAMPLE_CEILING);
    }
  });

  it('should keep the reference city where it was measured', () => {
    // 12 501 人的參考存檔每 tick 想問 1 077 位。實測降到約 400 位時，面板上顯示的
    // 搭乘數（跨日平滑後）波動 0.6%。這個數字換了，那個量測就不再適用。
    expect(commuteSampleSize(1077), '參考城市的取樣量變了').toBe(402);
  });

  it('should hold a hundred-thousand city to a fraction of the work', () => {
    // 複製成 10 萬人的實測:每 tick 想問 13 149 位、191ms。
    const s = commuteSampleSize(13149);
    expect(s).toBe(COMMUTE_SAMPLE_CEILING);
    expect(s / 13149, '大城市省下的比例不如預期').toBeLessThan(0.08);
  });

  it('should never go down as the city grows', () => {
    // 非單調的話，城市長大反而讓估計變差 —— 那是沒有人預期得到的行為。
    let prev = 0;
    for (let n = 1; n < 50_000; n = Math.ceil(n * 1.3)) {
      const s = commuteSampleSize(n);
      expect(s, `${n} 的取樣量比更小的城市還少`).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('should say zero for a city with nobody to ask', () => {
    // 呼叫端拿它當除數。回 0 以外的東西會讓放大倍率變成 Infinity 或 NaN。
    expect(commuteSampleSize(0)).toBe(0);
    expect(commuteSampleSize(-5)).toBe(0);
    expect(commuteSampleSize(NaN)).toBe(0);
  });
});
