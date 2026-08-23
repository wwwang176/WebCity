import { describe, it, expect } from 'vitest';
import { StopProximityIndex } from '../StopProximityIndex';
import { openFieldReach } from './openFieldReach';
import { WALK_RANGE_BY_TYPE } from '../WalkRange';
import type { FlatRoute } from '../MultiModalRouter';
import type { StopReach } from '../../traffic/StopWalkReach';
import { TransportType, type TransportStop } from '../types';

function makeStop(x: number, y: number, id: number, type: TransportType): TransportStop {
  return { id, x, y, type, passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0 };
}

function makeRoute(routeId: number, type: TransportType, stops: TransportStop[]): FlatRoute {
  return {
    routeId, type, speed: 2, stops, segDists: null,
    headway: 10, loadFactor: 0,
    source: { stops, vehicles: 1 }, seatsPerVehicle: 0,
  };
}

/** 一格人行道都沒有的城市 —— 每個站牌都是孤島。 */
const noReach: StopReach = { cellsWithin: () => new Map() };

describe('StopProximityIndex', () => {
  it('returns an empty list for a cell no stop reaches', () => {
    const index = StopProximityIndex.build(
      [makeRoute(1, TransportType.BUS, [makeStop(0, 0, 1, TransportType.BUS)])],
      openFieldReach,
    );
    expect(index.at(80, 80)).toEqual([]);
  });

  it('records the walking distance from the cell to the stop', () => {
    const index = StopProximityIndex.build(
      [makeRoute(1, TransportType.BUS, [makeStop(10, 10, 1, TransportType.BUS)])],
      openFieldReach,
    );
    // 空地上的步行距離就是曼哈頓距離。
    expect(index.at(12, 11)).toEqual([{ routeIdx: 0, stopIdx: 0, walkDistance: 3 }]);
  });

  it('keeps EVERY stop of a route in range, not just the nearest', () => {
    // 這是它跟 `TransitAccessField` 的差別 —— 轉乘要在候選站牌之間挑，
    // 每條路線只留一站的話，比較好的那組轉乘會在建索引時就被丟掉。
    const route = makeRoute(1, TransportType.BUS, [
      makeStop(10, 10, 1, TransportType.BUS),
      makeStop(12, 10, 2, TransportType.BUS),
    ]);
    const index = StopProximityIndex.build([route], openFieldReach);

    const here = index.at(11, 10);
    expect(here.map(n => n.stopIdx).sort()).toEqual([0, 1]);
    expect(here.every(n => n.walkDistance === 1)).toBe(true);
  });

  it('stops at the walk range of that transit type', () => {
    // 公車 5 格，捷運 12 —— 人願意為捷運多走。
    const index = StopProximityIndex.build([
      makeRoute(1, TransportType.BUS, [makeStop(20, 20, 1, TransportType.BUS)]),
      makeRoute(2, TransportType.METRO, [makeStop(20, 20, 2, TransportType.METRO)]),
    ], openFieldReach);

    expect(index.at(25, 20).map(n => n.routeIdx), '公車剛好走得到 5 格').toEqual([0, 1]);
    expect(index.at(26, 20).map(n => n.routeIdx), '第 6 格還算得到公車').toEqual([1]);
    expect(index.at(32, 20).map(n => n.routeIdx), '捷運剛好走得到 12 格').toEqual([1]);
    expect(index.at(33, 20), '第 13 格連捷運也走不到').toEqual([]);
  });

  it('scans once at the widest range, whatever the type', () => {
    // 涵蓋範圍的快取以半徑為鍵。各運具各掃各的半徑，同一個站牌會被重算好幾份。
    const asked: number[] = [];
    const spy: StopReach = {
      cellsWithin(x, y, maxDist) { asked.push(maxDist); return openFieldReach.cellsWithin(x, y, maxDist); },
    };
    StopProximityIndex.build([
      makeRoute(1, TransportType.BUS, [makeStop(20, 20, 1, TransportType.BUS)]),
      makeRoute(2, TransportType.METRO, [makeStop(40, 40, 2, TransportType.METRO)]),
    ], spy);

    expect(asked).toEqual([WALK_RANGE_BY_TYPE.WIDEST, WALK_RANGE_BY_TYPE.WIDEST]);
  });

  it('keeps routes apart', () => {
    const index = StopProximityIndex.build([
      makeRoute(1, TransportType.BUS, [makeStop(10, 10, 1, TransportType.BUS)]),
      makeRoute(2, TransportType.BUS, [makeStop(11, 10, 2, TransportType.BUS)]),
    ], openFieldReach);

    expect(index.at(10, 10).map(n => ({ r: n.routeIdx, d: n.walkDistance })))
      .toEqual([{ r: 0, d: 0 }, { r: 1, d: 1 }]);
  });

  it('records nothing for a stop that touches no sidewalk', () => {
    // 站牌沒接上人行道 = 它服務不到任何人。刻意不退回直線距離 —— 那會讓
    // 「站牌沒進圖」這種錯誤靜靜地被蓋掉。
    const index = StopProximityIndex.build(
      [makeRoute(1, TransportType.BUS, [makeStop(10, 10, 1, TransportType.BUS)])],
      noReach,
    );
    expect(index.size).toBe(0);
    expect(index.at(10, 10)).toEqual([]);
  });

  it('is empty when there are no routes', () => {
    const index = StopProximityIndex.build([], openFieldReach);
    expect(index.size).toBe(0);
  });
});
