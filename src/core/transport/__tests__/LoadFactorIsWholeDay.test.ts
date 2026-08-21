import { describe, it, expect } from 'vitest';
import { getRouteRiders } from '../TransitAvailability';
import { TransportType, type TransportStop } from '../types';

/**
 * 載重要拿**整天**比整天。
 *
 * 運能是「一天載得動幾人次」。而搭乘量原本讀的是 `dailyRiders` —— **今天到現在為止**
 * 的累計，每個遊戲日歸零。兩者單位不同:每天一開始路線看起來都是空的，隨著這一天
 * 走完慢慢變擠，然後歸零重來。
 *
 * 玩家 12 600 人的存檔實測（一條公車線、一台車，連續取樣 151 次）:
 *
 * | | |
 * |---|---|
 * | 載重範圍 | **5.56 ~ 47.34**（平均 29.92） |
 * | 今日累計人次 | **0 → 6 519** 然後歸零 |
 *
 * 玩家回報的「usage 在 80~100% 之間震盪」就是這個鋸齒。而且它同時讓需求失控:
 * 每天早上路線看起來是空的，於是所有人都選它，載重到傍晚才爆掉，隔天再來一次。
 *
 * 改成讀**完整的一天**（昨天的實數與跨日平滑值取大者）之後，載重一天只變一次 ——
 * 跟運能同一個單位。代價是新路線第一天看起來是空的，第二天才反映真實 —— 那是
 * 「一天的資料要滿一天才有」，不是延遲。
 */

function stop(id: number, daily: number, lastDay: number, smoothed: number): TransportStop {
  return {
    id, x: id, y: 0, type: TransportType.BUS, passengers: 0,
    dailyRiders: daily, lastDayRiders: lastDay, smoothedDailyRiders: smoothed,
  };
}

describe('載重讀的是整天', () => {
  it('should not swing while the day is only half over', () => {
    // 同一條路線、同一個真實載客量，只差在「今天走到哪裡」。
    const morning = { stops: [stop(1, 0, 900, 900)] };
    const evening = { stops: [stop(1, 900, 900, 900)] };

    expect(getRouteRiders(morning), '早上看起來是空的').toBe(900);
    expect(getRouteRiders(evening), '傍晚跟早上不一樣').toBe(900);
  });

  it('should follow a route whose ridership jumped yesterday', () => {
    // 昨天暴增的路線，今天就要反映出來 —— 只讀平滑值的話要好幾天才追得上。
    const surged = { stops: [stop(1, 0, 5000, 900)] };
    expect(getRouteRiders(surged), '昨天暴增，今天還當它是老樣子').toBe(5000);
  });

  it('should keep the smoothed value when yesterday was a fluke dip', () => {
    // 昨天剛好很少人搭，不代表這條線突然變空。
    const dip = { stops: [stop(1, 0, 100, 3000)] };
    expect(getRouteRiders(dip), '一天的低點就把整條線當成空的').toBe(3000);
  });

  it('should add up across the stops of the route', () => {
    const route = { stops: [stop(1, 0, 100, 50), stop(2, 0, 200, 50)] };
    expect(getRouteRiders(route)).toBe(300);
  });

  it('should read zero on a brand new route', () => {
    // 第一天沒有資料 —— 那是「一天的資料要滿一天才有」，不是錯誤。
    expect(getRouteRiders({ stops: [stop(1, 0, 0, 0)] })).toBe(0);
  });
});
