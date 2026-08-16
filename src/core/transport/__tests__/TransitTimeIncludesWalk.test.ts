import { describe, it, expect } from 'vitest';
import { findAvailableTransit, type TransitSystemInfo } from '../TransitAvailability';
import { openFieldReach } from './openFieldReach';
import { TransportType, type TransportStop } from '../types';

/**
 * 單一運具的估計時間要含走到站與等車，不能只算乘車。
 *
 * 這支的結果會直接跟開車時間比大小。只算乘車的話，一條班距 40 tick、站牌在五格外
 * 的公車，看起來會跟「門口就有、班班準點」一樣好 —— 於是它幾乎永遠贏過開車，也
 * 永遠贏過含走路與等車的轉乘路線（`chooseModeMultiModal` 是先看單一運具、更快才
 * 換過去）。結果是實際派車走的那條路徑對步行距離完全不收費，唯一擋住「走很遠去
 * 搭公車」的東西只剩下步行上限那個硬門檻。
 */

function stop(x: number, y: number, id: number): TransportStop {
  return {
    id, x, y, type: TransportType.BUS,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  };
}

const WALK_RANGE = 5;
const WALK_SPEED = 1;
const WAIT_FACTOR = 0.5;

/** 兩站相距 8 格的公車路線。 */
function busLine(
  originStop: { x: number; y: number },
  destStop: { x: number; y: number },
  frequency: number,
): TransitSystemInfo {
  return {
    type: TransportType.BUS,
    speed: 2,
    routes: [{
      id: 1, type: TransportType.BUS,
      stops: [stop(originStop.x, originStop.y, 1), stop(destStop.x, destStop.y, 2)],
      vehicles: 2, frequency, operatingCost: 0,
    }],
  };
}

function timeOf(sys: TransitSystemInfo, origin: { x: number; y: number }, dest: { x: number; y: number }): number {
  const result = findAvailableTransit([sys], origin, dest, WALK_RANGE, openFieldReach, WALK_SPEED, WAIT_FACTOR);
  expect(result, '這條路線搭不到，測試等於沒測').toHaveLength(1);
  return result[0]!.estimatedTime;
}

describe('單一運具的估計時間', () => {
  const home = { x: 0, y: 0 };
  const work = { x: 20, y: 0 };

  it('should cost more when the stop is further from home', () => {
    const near = timeOf(busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 4), home, work);
    const far = timeOf(busLine({ x: 4, y: 0 }, { x: 19, y: 0 }, 4), home, work);

    expect(far, '站牌遠了三格，估計時間卻沒有變 —— 走路沒有被算進去')
      .toBeGreaterThan(near);
  });

  it('should cost more when the service is infrequent', () => {
    const frequent = timeOf(busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 2), home, work);
    const rare = timeOf(busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 40), home, work);

    expect(rare, '班距從 2 拉到 40，估計時間卻沒有變 —— 等車沒有被算進去')
      .toBeGreaterThan(frequent);
  });

  it('should cost more when the stop is further from the workplace', () => {
    const near = timeOf(busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 4), home, work);
    const far = timeOf(busLine({ x: 1, y: 0 }, { x: 16, y: 0 }, 4), home, work);

    // 下車站往回退三格：乘車段短了，但走路段長了三格 —— 淨值要變大。
    expect(far, '下車後那段路沒有被算進去').toBeGreaterThan(near);
  });

  it('should never be cheaper than the ride alone', () => {
    const t = timeOf(busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 4), home, work);
    const rideOnly = 18 / 2;
    expect(t).toBeGreaterThan(rideOnly);
  });

  it('should still report zero-ish when origin and destination share a stop', () => {
    // 同一站上下車等於沒搭到 —— 但走到站牌的那段路仍然要算。
    const sys = busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 4);
    const result = findAvailableTransit([sys], { x: 0, y: 0 }, { x: 2, y: 0 }, WALK_RANGE, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime, '同站上下車卻回報 0，走到站的路憑空消失').toBeGreaterThan(0);
  });
});
