import { describe, it, expect } from 'vitest';
import { TransitAccessField } from '../TransitAccessField';
import { SidewalkStopReach } from '../../traffic/StopWalkReach';
import { cityWithMainRoad } from '../../traffic/__tests__/gridCityFixture';
import { TransportType, type TransportStop } from '../types';
import type { FlatRoute } from '../MultiModalRouter';

/**
 * 站牌的涵蓋範圍要照人行道量。
 *
 * 這張圖決定「誰算是搭得到公車」。用直線距離量的話，馬路對面只有兩格，於是住戶
 * 被算成走得到 —— 通勤時間因此被低估，行人被派去對面的站牌，到了現場才發現得繞
 * 到路口。畫面上那個繞大圈的人，是這張圖算錯的結果，不是行人走錯。
 */

function stop(id: number, x: number, y: number): TransportStop {
  return {
    id, x, y, type: TransportType.BUS,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  };
}

function busRoute(stops: TransportStop[]): FlatRoute {
  return {
    routeId: 1, type: TransportType.BUS, speed: 2, stops,
    segDists: null, frequency: 10, isFull: false,
  };
}

const RANGE = 5;
const SPEED = 1;

describe('涵蓋範圍不跨越馬路', () => {
  it('should cover a home on the same side of the road', () => {
    const { graph } = cityWithMainRoad(8);
    const route = busRoute([stop(1, 12, 11), stop(2, 4, 11)]);
    const field = TransitAccessField.build([route], RANGE, SPEED, new SidewalkStopReach(graph));

    expect(field.at(13, 11).length, '同一側的隔壁格算不到，這條測試等於沒測')
      .toBeGreaterThan(0);
  });

  it('should not cover a home across the road from the stop', () => {
    // 路口在 x=8 與 x=16，站牌在 x=12。過馬路要走 4 格到路口、過去、再走 4 格
    // 回來 —— 遠超過 5 格的步行上限，這個住戶其實搭不到這班公車。
    const { graph } = cityWithMainRoad(8);
    const route = busRoute([stop(1, 12, 11), stop(2, 4, 11)]);
    const field = TransitAccessField.build([route], RANGE, SPEED, new SidewalkStopReach(graph));

    expect(
      field.at(12, 9),
      '馬路對面被算成搭得到 —— 通勤時間被低估，行人會被派去繞路口',
    ).toHaveLength(0);
  });

  it('should cover both sides when the stop sits by an intersection', () => {
    // 同一條路，站牌改蓋在路口旁邊，對面就真的走得到了。
    // 「站牌蓋在哪」因此成為一個有後果的決定。
    const { graph } = cityWithMainRoad(8);
    const route = busRoute([stop(1, 9, 11), stop(2, 4, 11)]);
    const field = TransitAccessField.build([route], RANGE, SPEED, new SidewalkStopReach(graph));

    expect(field.at(9, 9).length, '緊鄰路口的站牌，對面仍然算不到').toBeGreaterThan(0);
  });

  it('should charge the real walking distance, not the straight line', () => {
    const { graph } = cityWithMainRoad(8);
    const route = busRoute([stop(1, 12, 11), stop(2, 4, 11)]);
    const field = TransitAccessField.build([route], 12, SPEED, new SidewalkStopReach(graph));

    const across = field.at(12, 9)[0];
    expect(across, '把上限放寬到 12 格之後，對面應該算得到').toBeDefined();
    expect(across!.walkTime, '走到對面的時間被當成直線的 2 格').toBeGreaterThan(6);
  });
});
