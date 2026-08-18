import { describe, it, expect } from 'vitest';
import { findAvailableTransit, type TransitSystemInfo } from '../TransitAvailability';
import { chooseModeMultiModal } from '../ModeChoice';
import { TransportType, TransportMode, type TransportStop, type TransportRoute } from '../types';
import { openFieldReach } from './openFieldReach';

/**
 * 估計時間是照某兩站算的，派車與計數就得記在那兩站上。
 *
 * 這裡曾經是分開的兩件事：選完運具之後再用「整個系統裡最近的站」重挑一次。只有
 * 一條路線的時候兩者一致，路線一多就分岔 —— 挑站的條件（沿人行道最近）跟選路線
 * 的條件（整趟最快）本來就不是同一件事。結果是人被記到他沒搭的那條路線頭上，
 * 兩條線的擁擠程度同時被扭曲（BUG-283）。
 */

const WALK_SPEED = 1;
const WAIT_FACTOR = 0.5;
const TICKS_PER_DAY = 24;

function stop(id: number, x: number, y: number): TransportStop {
  return {
    id, x, y, type: TransportType.BUS,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  };
}

function route(id: number, stops: TransportStop[]): TransportRoute {
  return { id, type: TransportType.BUS, stops, vehicles: 2, operatingCost: 0 };
}

const HOME = { x: 2, y: 0 };
const WORK = { x: 20, y: 1 };

/** 他真正搭的那條：兩端都碰得到。 */
const RIDDEN_BOARD = stop(11, 0, 0);
const RIDDEN_ALIGHT = stop(12, 20, 0);

/**
 * 幌子：起點端的站比上面那條更近（1 格 vs 2 格），但它往北去，到不了公司。
 * 「最近的站」會挑中它。
 */
const DECOY_NEAR = stop(21, 1, 0);
const DECOY_FAR = stop(22, 1, 40);

const SYSTEM: TransitSystemInfo = {
  type: TransportType.BUS,
  speed: 2,
  vehicleCapacity: 50,
  routes: [
    route(1, [RIDDEN_BOARD, RIDDEN_ALIGHT]),
    route(2, [DECOY_NEAR, DECOY_FAR]),
  ],
};

function options() {
  return findAvailableTransit(
    [SYSTEM], HOME, WORK, openFieldReach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY,
  );
}

describe('搭乘記在他真正搭的那條路線上', () => {
  it('should report which stops the estimate was based on', () => {
    const [only] = options();
    expect(only, '兩端都碰得到的那條路線沒有被回報').toBeDefined();
    expect(only!.boardStop?.id, '沒有回報估計所依據的上車站').toBe(RIDDEN_BOARD.id);
    expect(only!.alightStop?.id, '沒有回報估計所依據的下車站').toBe(RIDDEN_ALIGHT.id);
  });

  it('should not report the nearer stop of a route that cannot reach the destination', () => {
    // 幌子站離家只有 1 格，比真正要搭的那站近 —— 「挑最近的」會挑中它。
    const [only] = options();
    expect(only!.boardStop?.id, '記到了到不了目的地的那條路線頭上').not.toBe(DECOY_NEAR.id);
  });

  it('should carry the stops through to the chosen mode', () => {
    // 距離 19，開車 19、門檻 28.5；這條路線約 18，會被選中。
    const picked = chooseModeMultiModal(
      HOME, WORK, options(), [],
      { congestionLevel: 0, walkSpeed: WALK_SPEED, walkWeight: 1 , driveDeterrence: 1},
    );

    expect(picked.mode, '這組數字下應該選公車').toBe(TransportMode.BUS);
    expect(picked.boardStop?.id, '選中的走法沒有把上車站帶出來').toBe(RIDDEN_BOARD.id);
    expect(picked.alightStop?.id, '選中的走法沒有把下車站帶出來').toBe(RIDDEN_ALIGHT.id);
  });

  it('should carry no stops when driving', () => {
    // 一站都碰不到的人開車，沒有上下車站可言 —— 留著上一次的值會把人記到
    // 一個他根本沒去的站。
    const picked = chooseModeMultiModal(
      HOME, { x: 200, y: 200 }, [], [],
      { congestionLevel: 0, walkSpeed: WALK_SPEED, walkWeight: 1 , driveDeterrence: 1},
    );

    expect(picked.mode).toBe(TransportMode.DRIVE);
    expect(picked.boardStop).toBeNull();
    expect(picked.alightStop).toBeNull();
  });
});
