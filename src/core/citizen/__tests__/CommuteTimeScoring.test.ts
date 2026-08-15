import { describe, it, expect } from 'vitest';
import { scoreCommute, HOUSING_SCORE } from '../HousingScore';

/**
 * 通勤好不好，看的是**要花多久**，不是隔多遠。
 *
 * 用直線距離的話，一間就在捷運站旁邊的房子，在系統眼中跟荒郊野外的房子一樣糟 ——
 * 只要它離公司遠。於是玩家蓋了捷運，市民的居住偏好完全不動，運輸建設對城市形狀
 * 沒有任何影響。
 *
 * 改看時間之後，距離仍然有代價（開車時間隨距離線性上升），但那個代價可以被交通
 * 建設抵銷 —— 這才有「住得遠但住在站旁邊」這種選擇。
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
    // 沒有工作的人不該因為「通勤未知」被加分或扣分。
    expect(scoreCommute(null)).toBe(0);
  });

  it('should rank a far house next to a station above a near house without one', () => {
    // 這是整件事的重點。遠但有捷運（時間 22）要贏過近但只能塞車開車（時間 45）。
    const farWithMetro = scoreCommute(22);
    const nearWithJam = scoreCommute(45);
    expect(farWithMetro, '住在站旁邊沒有比較吃香').toBeGreaterThan(nearWithJam);
  });
});
