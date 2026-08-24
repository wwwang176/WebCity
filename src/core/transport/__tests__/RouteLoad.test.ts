import { describe, it, expect } from 'vitest';
import {
  TRANSIT_SERVICE_TICKS_PER_DAY,
  CROWDING,
  computeCycleTime,
  computeHeadway,
  computeDailyCapacity,
  computeLoadFactor,
  extraHeadwaysWaited,
  expectedWait,
} from '../RouteLoad';
import { TransportType, type TransportStop } from '../types';

/**
 * How good a route is to ride depends on headway and crowding.
 *
 * Neither exists if headway is hardwired to `stops * 2` and crowding does not affect
 * waiting: extra vehicles then only raise the capacity ceiling, and the sole effect of
 * crowding is a cliff where a full route vanishes from everyone's options. The player's
 * main lever would do one thing only — push the cliff further out.
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
    // 4 stops, 5 tiles per leg, speed 2: a 20-tile loop / 2 = 10 ticks.
    expect(computeCycleTime(stops(4, 5), [5, 5, 5, 5], 2)).toBeCloseTo(10);
  });

  it('should fall back to the distance between stops with no segment data', () => {
    // The last stop connects back to the first, otherwise a long route loses one leg.
    expect(computeCycleTime(stops(3, 4), null, 1)).toBeCloseTo(16);
  });

  it('should ignore segment data that does not line up with the stops', () => {
    // Stop count changed but the cache has not been rebuilt; trusting it reports another
    // leg's distance (same as BUG-064).
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
    // "Per day" uses capacity's own scale (TRANSIT_SERVICE_TICKS_PER_DAY), not the calendar
    // day: vehicle speed was chosen to look right on screen and is a different clock.
    const loops = TRANSIT_SERVICE_TICKS_PER_DAY / 6;
    expect(computeDailyCapacity(2, 50, 6)).toBeCloseTo(2 * 50 * loops);
  });

  it('should not measure a service day by the calendar day', () => {
    // Mixing the two clocks is BUG-344: a bus route in a player save takes 141 ticks per
    // loop against a 24-tick calendar day, i.e. 0.17 loops per day, leaving a 50-seat
    // vehicle with 8.5 riders/day, so any route above about 9 riders saturates.
    expect(TRANSIT_SERVICE_TICKS_PER_DAY, '運能又跟日曆綁在一起了')
      .toBeGreaterThan(100);
  });

  it('should scale with vehicles', () => {
    const one = computeDailyCapacity(1, 50, 6);
    expect(computeDailyCapacity(3, 50, 6)).toBeCloseTo(one * 3);
  });

  it('should be zero when the route cannot run', () => {
    expect(computeDailyCapacity(2, 50, 0)).toBe(0);
    expect(computeDailyCapacity(0, 50, 6)).toBe(0);
  });

  it('should be far larger than the seat count of the fleet', () => {
    // Comparing a day's riders against `vehicles * seats` mixes a cumulative quantity with
    // an instantaneous one: two buses would be "full" at the 100th rider of the day, an
    // order of magnitude too low.
    const seats = 2 * 50;
    expect(computeDailyCapacity(2, 50, 6)).toBeGreaterThan(seats * 3);
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
  // The shape of the curve is pinned by GeometricCrowdingWait.test.ts. These only pin the
  // interface boundary: no penalty while seats remain, a penalty once they run out.
  it('should not punish a route that still has room', () => {
    expect(extraHeadwaysWaited(0)).toBe(0);
    expect(extraHeadwaysWaited(1)).toBe(0);
  });

  it('should rise the moment somebody is left behind', () => {
    expect(extraHeadwaysWaited(1.1)).toBeGreaterThan(0);
    expect(extraHeadwaysWaited(1.3)).toBeGreaterThan(extraHeadwaysWaited(1.1));
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

describe('沒有拒載門檻', () => {
  it('should punish an impossible route with time, not with disappearance', () => {
    // Removing a route from the options at load 1.5 produces a limit cycle, observed on a
    // player save: add vehicles, load crosses 1.5, everyone is ejected, load falls, the
    // riders return.
    const wait = expectedWait(20, 0.5, 99);
    expect(Number.isFinite(wait), '等待不是一個有限的數字，無法跟開車比大小').toBe(true);
    expect(wait, '擠成這樣還是很好搭').toBeGreaterThan(expectedWait(20, 0.5, 1) * 50);
  });
});
