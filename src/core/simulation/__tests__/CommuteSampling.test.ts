import { describe, it, expect } from 'vitest';
import { commuteSampleSize, COMMUTE_SAMPLE_SPAN, COMMUTE_SAMPLE_CEILING } from '../CommuteSampling';

/**
 * The commute-spawn loop asking `working-age employed citizens / 8` per tick is proportional
 * to population. Measured on the same save scaled to 100,000 citizens: 13,149 asked per tick
 * at 191ms, against 250ms available per tick at speed 1 (BUG-328).
 *
 * That loop is also estimating ridership, and an estimate's accuracy depends on **how many
 * were asked**, not on the population it is drawn from — a thousand-person poll has the same
 * margin in a country of 20 million as in one of 300 million. So the number asked has no
 * reason to grow linearly with population.
 */

describe('每個 tick 問幾位市民', () => {
  it('should not touch a city small enough to ask everyone', () => {
    // A small city must be unchanged: the early game should not pay for a late-game problem.
    for (const n of [1, 5, 42, COMMUTE_SAMPLE_SPAN - 1, COMMUTE_SAMPLE_SPAN]) {
      expect(commuteSampleSize(n), `想問 ${n} 位卻打了折`).toBe(n);
    }
  });

  it('should never ask more people than it wanted to', () => {
    // A result above `attempts` makes the scale-up factor less than 1, counting each citizen
    // as less than one person.
    for (const n of [1, 100, 151, 1077, 13149, 200000]) {
      expect(commuteSampleSize(n), `想問 ${n} 位卻問了更多`).toBeLessThanOrEqual(n);
    }
  });

  it('should grow like a square root in the middle band', () => {
    // Linear growth stalls a large city; no growth at all makes the scale-up factor so large
    // that a small route's numbers jump in steps. A square root in the middle band covers
    // both.
    const a = commuteSampleSize(1_000);
    const b = commuteSampleSize(4_000);   // four times the volume
    expect(b / a, '量翻四倍，問的人數該翻兩倍').toBeCloseTo(2, 1);
    expect(b, '中段就先撞到天花板了，平方根那段等於不存在')
      .toBeLessThan(COMMUTE_SAMPLE_CEILING);
  });

  it('should stop growing at the ceiling', () => {
    // The square root is still unbounded: a million citizens would ask 4,415, about 66ms/tick.
    for (const n of [50_000, 200_000, 1_000_000]) {
      expect(commuteSampleSize(n), `${n} 沒有被天花板擋住`).toBe(COMMUTE_SAMPLE_CEILING);
    }
  });

  it('should keep the reference city where it was measured', () => {
    // The 12,501-citizen reference save intends to ask 1,077 per tick. Measured at about 400,
    // the ridership shown on the panel (after cross-day smoothing) moved by 0.6%. A different
    // number here invalidates that measurement.
    expect(commuteSampleSize(1077), '參考城市的取樣量變了').toBe(402);
  });

  it('should hold a hundred-thousand city to a fraction of the work', () => {
    // Measured on the save scaled to 100,000 citizens: 13,149 intended asks per tick at 191ms.
    const s = commuteSampleSize(13149);
    expect(s).toBe(COMMUTE_SAMPLE_CEILING);
    expect(s / 13149, '大城市省下的比例不如預期').toBeLessThan(0.08);
  });

  it('should never go down as the city grows', () => {
    // Non-monotonic behaviour would make the estimate worse as the city grows, which nobody
    // would expect.
    let prev = 0;
    for (let n = 1; n < 50_000; n = Math.ceil(n * 1.3)) {
      const s = commuteSampleSize(n);
      expect(s, `${n} 的取樣量比更小的城市還少`).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('should say zero for a city with nobody to ask', () => {
    // Callers use it as a divisor. Anything other than 0 here makes the scale-up factor
    // Infinity or NaN.
    expect(commuteSampleSize(0)).toBe(0);
    expect(commuteSampleSize(-5)).toBe(0);
    expect(commuteSampleSize(NaN)).toBe(0);
  });
});
