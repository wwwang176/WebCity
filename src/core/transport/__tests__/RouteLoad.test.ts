import { describe, it, expect } from 'vitest';
import {
  CROWDING,
  computeCycleTime,
  computeHeadway,
  computeDailyCapacity,
  computeLoadFactor,
  crowdingWaitMultiplier,
  isOverCapacity,
  expectedWait,
} from '../RouteLoad';
import { TransportType, type TransportStop } from '../types';

/**
 * 一條路線有多好搭，取決於班距與有多擠。
 *
 * 舊的模型兩件事都沒有：班距寫死成 `站數 × 2`，加車只加了容量上限、不會讓班次
 * 變密；而擠不擠完全不影響等車時間，只有一個「滿了就整條路線從所有人的選項裡
 * 消失」的懸崖。玩家手上最主要的槓桿（加車）因此只做一件事：把懸崖往後推。
 */

function stops(n: number, gap: number): TransportStop[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, x: i * gap, y: 0, type: TransportType.BUS,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  }));
}

const TICKS_PER_DAY = 24;

describe('整圈時間', () => {
  it('should sum every segment around the loop', () => {
    // 4 站、每段 5 格、速度 2 → 整圈 20 格 / 2 = 10 tick
    expect(computeCycleTime(stops(4, 5), [5, 5, 5, 5], 2)).toBeCloseTo(10);
  });

  it('should fall back to the distance between stops with no segment data', () => {
    // 頭尾也要接回去，否則長路線的整圈會被少算一段。
    expect(computeCycleTime(stops(3, 4), null, 1)).toBeCloseTo(16);
  });

  it('should ignore segment data that does not line up with the stops', () => {
    // 站數變了但快取還沒重算 —— 拿它當真會回報別段的距離（同 BUG-064）。
    expect(computeCycleTime(stops(3, 4), [5, 5], 1)).toBeCloseTo(16);
  });

  it('should be zero for a route that cannot run', () => {
    expect(computeCycleTime(stops(1, 4), null, 2)).toBe(0);
    expect(computeCycleTime(stops(4, 5), [5, 5, 5, 5], 0)).toBe(0);
  });
});

describe('班距', () => {
  it('should halve when the vehicle count doubles', () => {
    expect(computeHeadway(24, 2)).toBeCloseTo(12);
    expect(computeHeadway(24, 4)).toBeCloseTo(6);
  });

  it('should treat a route with no vehicles as never coming', () => {
    expect(computeHeadway(24, 0)).toBe(Infinity);
  });
});

describe('每日載運能力', () => {
  it('should count how many loops each vehicle completes in a day', () => {
    // 整圈 6 tick → 一天跑 4 圈；2 台車 × 50 座 × 4 圈 = 400 人次
    expect(computeDailyCapacity(2, 50, 6, TICKS_PER_DAY)).toBeCloseTo(400);
  });

  it('should scale with vehicles', () => {
    const one = computeDailyCapacity(1, 50, 6, TICKS_PER_DAY);
    expect(computeDailyCapacity(3, 50, 6, TICKS_PER_DAY)).toBeCloseTo(one * 3);
  });

  it('should be zero when the route cannot run', () => {
    expect(computeDailyCapacity(2, 50, 0, TICKS_PER_DAY)).toBe(0);
    expect(computeDailyCapacity(0, 50, 6, TICKS_PER_DAY)).toBe(0);
  });

  it('should be far larger than the seat count of the fleet', () => {
    // 舊模型拿「一整天的人次」去比「車輛數 × 座位數」—— 一個是累計量、一個是
    // 瞬間量。兩台公車一天載到第 100 人次就「滿了」，天花板低了一個數量級。
    const seats = 2 * 50;
    expect(computeDailyCapacity(2, 50, 6, TICKS_PER_DAY)).toBeGreaterThan(seats * 3);
  });
});

describe('載重率', () => {
  it('should be the ratio of riders to capacity', () => {
    expect(computeLoadFactor(200, 400)).toBeCloseTo(0.5);
  });

  it('should treat riders with no capacity as hopelessly over', () => {
    expect(computeLoadFactor(1, 0)).toBe(Infinity);
    expect(computeLoadFactor(0, 0)).toBe(0);
  });
});

describe('擁擠對等車時間的影響', () => {
  it('should not punish a route that is not crowded yet', () => {
    expect(crowdingWaitMultiplier(0)).toBe(1);
    expect(crowdingWaitMultiplier(CROWDING.COMFORT_LOAD)).toBe(1);
  });

  it('should rise smoothly once it gets crowded', () => {
    const a = crowdingWaitMultiplier(0.9);
    const b = crowdingWaitMultiplier(1.1);
    const c = crowdingWaitMultiplier(1.3);
    expect(a).toBeGreaterThan(1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('should cap so the number stays meaningful', () => {
    expect(crowdingWaitMultiplier(CROWDING.REFUSE_LOAD)).toBeCloseTo(CROWDING.MAX_WAIT_MULTIPLIER);
    expect(crowdingWaitMultiplier(99)).toBeCloseTo(CROWDING.MAX_WAIT_MULTIPLIER);
  });

  it('should give the player warning before the route becomes unusable', () => {
    // 這是重點：不再是「99% 跟空車一樣好、100% 整條線蒸發」。玩家會先看到
    // 通勤時間變長，才輪到有人擠不上去。
    expect(isOverCapacity(0.9)).toBe(false);
    expect(crowdingWaitMultiplier(0.9)).toBeGreaterThan(1);
  });
});

describe('預期等車時間', () => {
  it('should be half the headway on an empty route', () => {
    expect(expectedWait(20, 0.5, 0)).toBeCloseTo(10);
  });

  it('should shorten when vehicles are added', () => {
    const cycle = 24;
    const two = expectedWait(computeHeadway(cycle, 2), 0.5, 0.3);
    const four = expectedWait(computeHeadway(cycle, 4), 0.5, 0.3);
    expect(four, '加車沒有讓等車變短').toBeLessThan(two);
  });

  it('should lengthen when the route gets crowded', () => {
    const quiet = expectedWait(20, 0.5, 0.2);
    const packed = expectedWait(20, 0.5, 1.2);
    expect(packed, '擠成這樣還是等一樣久').toBeGreaterThan(quiet);
  });
});

describe('擠不上去', () => {
  it('should let people on below the refusal load', () => {
    expect(isOverCapacity(CROWDING.REFUSE_LOAD - 0.01)).toBe(false);
  });

  it('should refuse beyond it', () => {
    expect(isOverCapacity(CROWDING.REFUSE_LOAD)).toBe(true);
    expect(isOverCapacity(Infinity)).toBe(true);
  });
});
