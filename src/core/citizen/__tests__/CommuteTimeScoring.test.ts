import { describe, it, expect } from 'vitest';
import { scoreCommute, HOUSING_SCORE } from '../HousingScore';

/**
 * How good a commute is follows **how long it takes**, not how far it is.
 *
 * By straight-line distance, a house beside a metro station looks as bad to the system as one in
 * open country as long as it is far from work. The player builds a metro, housing preferences do
 * not move, and the transport built has no effect on the city's shape.
 *
 * With time, distance still costs — driving time rises linearly with it — but that cost can be
 * offset by transport, which is what makes living far away beside a station a choice.
 */

describe('住房評分的通勤項', () => {
  it('should give the best score to a short commute', () => {
    expect(scoreCommute(HOUSING_SCORE.COMMUTE_TIME_NEAR)).toBe(HOUSING_SCORE.COMMUTE_BEST);
    expect(scoreCommute(0)).toBe(HOUSING_SCORE.COMMUTE_BEST);
  });

  it('should give the worst score beyond the far threshold', () => {
    expect(scoreCommute(HOUSING_SCORE.COMMUTE_TIME_FAR + 1)).toBe(HOUSING_SCORE.COMMUTE_WORST);
    expect(scoreCommute(999)).toBe(HOUSING_SCORE.COMMUTE_WORST);
  });

  it('should slide between the two', () => {
    const mid = (HOUSING_SCORE.COMMUTE_TIME_NEAR + HOUSING_SCORE.COMMUTE_TIME_FAR) / 2;
    const s = scoreCommute(mid);
    expect(s).toBeLessThan(HOUSING_SCORE.COMMUTE_BEST);
    expect(s).toBeGreaterThan(HOUSING_SCORE.COMMUTE_WORST);
  });

  it('should never reward a longer commute', () => {
    let prev = Infinity;
    for (let t = 0; t <= 120; t += 5) {
      const s = scoreCommute(t);
      expect(s, `通勤 ${t} 的分數比更短的通勤還高`).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  it('should score an unknown commute as neutral', () => {
    // Someone with no job should be neither rewarded nor penalised for an unknown commute.
    expect(scoreCommute(null)).toBe(0);
  });

  it('should rank a far house next to a station above a near house without one', () => {
    // The point of all of it: far with a metro, at 22, beats near with only congested driving,
    // at 45.
    const farWithMetro = scoreCommute(22);
    const nearWithJam = scoreCommute(45);
    expect(farWithMetro, '住在站旁邊沒有比較吃香').toBeGreaterThan(nearWithJam);
  });
});
