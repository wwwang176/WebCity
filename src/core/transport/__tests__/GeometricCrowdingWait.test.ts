import { describe, it, expect } from 'vitest';
import { extraHeadwaysWaited, expectedWait, routeLoadStatus, CROWDING } from '../RouteLoad';

/**
 * Crowding waits are derived from a geometric series, not chosen.
 *
 * A model of three hand-picked numbers plus a cliff — load 0.8 to 1.5 ramping linearly to
 * 4x, then outright refusal at 1.5 — behaves like this as vehicles are added (measured on a
 * 12,600-citizen save, one bus line):
 *
 * | buses | headway | load | riders/day |
 * |---|---|---|---|
 * | 1 | 141.1 | 0.05 | 8 |
 * | 2 | 82.3 | **1.86** | 544 |
 * | 4 | 41.2 | **1.02** | 723 |
 * | 8 | 21.8 | **1.88** | 2,070 |
 *
 * Load bounces between 1.0 and 1.9: crossing 1.5 ejects everyone, load falls, the riders
 * return. **The cliff produces a limit cycle.**
 *
 * The geometric form answers one question: with probability q of not boarding a given
 * vehicle, how many extra vehicles does a passenger wait for? `q / (1 - q)`. Substituting
 * `q = 1 - 1/load` gives exactly **load - 1 headways**. No cap, no cliff, no magic numbers,
 * and since waiting forever is equivalent to not being able to board, no separate refusal
 * line is needed.
 */

describe('擠不上車要多等幾班', () => {
  it('should make you wait for nobody when there is room', () => {
    expect(extraHeadwaysWaited(0.5)).toBe(0);
    expect(extraHeadwaysWaited(1)).toBe(0);
  });

  it('should charge one extra vehicle when half the queue cannot board', () => {
    // Load 2 means twice as many would-be riders as seats, so half are left behind and wait
    // one extra vehicle on average.
    expect(extraHeadwaysWaited(2)).toBeCloseTo(1, 10);
  });

  it('should keep rising with no ceiling', () => {
    // A cap at 4x would assert that crowding stops getting worse past some point, which is
    // not true.
    expect(extraHeadwaysWaited(4)).toBeCloseTo(3, 10);
    expect(extraHeadwaysWaited(11)).toBeCloseTo(10, 10);
    expect(extraHeadwaysWaited(101)).toBeCloseTo(100, 10);
  });

  it('should send a route with no capacity at all to infinity', () => {
    // No capacity but riders wanting to board: `computeLoadFactor` returns Infinity, and so
    // must the wait.
    expect(extraHeadwaysWaited(Infinity)).toBe(Infinity);
  });

  it('should have no cliff anywhere', () => {
    // A step at 1.5 from "still rideable" to "this line does not exist" turns on a single
    // passenger. Sweeping the range, no two adjacent points may jump.
    let prev = extraHeadwaysWaited(0.5);
    for (let load = 0.51; load <= 5; load += 0.01) {
      const now = extraHeadwaysWaited(load);
      expect(now - prev, `載重 ${load.toFixed(2)} 附近有跳躍`).toBeLessThan(0.02);
      expect(now, '等待變短了').toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });
});

describe('站在站牌前預期要等多久', () => {
  it('should be half a headway when the route is not crowded', () => {
    // Passengers arrive at random times, so the average wait is half a headway. The 0.5 is
    // derived, not chosen.
    expect(expectedWait(100, 0.5, 0.5)).toBeCloseTo(50, 10);
  });

  it('should add whole headways once people are left behind', () => {
    // Half a headway of base wait, plus whole headways for each vehicle missed.
    expect(expectedWait(100, 0.5, 2), '多等的那一班沒有算進去')
      .toBeCloseTo(100 * 0.5 + 100 * 1, 10);
    expect(expectedWait(100, 0.5, 3)).toBeCloseTo(100 * 0.5 + 100 * 2, 10);
  });

  it('should never come at all when there is no vehicle', () => {
    expect(expectedWait(Infinity, 0.5, 0)).toBe(Infinity);
  });
});

describe('面板的載重分段', () => {
  it('should stay green while nobody is left behind', () => {
    expect(routeLoadStatus(0.99), '還沒有人擠不上去就開始警告').toBe('comfortable');
  });

  it('should turn as soon as someone is left behind', () => {
    // The boundary sits where **something actually changes in the model**, not on a round
    // number. At load exactly 1 the seats are exactly enough and nobody is left behind, so
    // the boundary is "above 1".
    expect(routeLoadStatus(1), '剛好夠卻說擠').toBe('comfortable');
    expect(routeLoadStatus(1.01), '有人被留下了卻還是綠的').toBe('crowded');
    expect(routeLoadStatus(1.4)).toBe('crowded');
  });

  it('should go red when the extra wait passes half a headway', () => {
    expect(routeLoadStatus(CROWDING.OVERLOADED_LOAD)).toBe('overloaded');
  });

  it('should call it hopeless when two full vehicles go past', () => {
    // A **display label**, not a cliff in the simulation, which only makes the route very
    // slow.
    expect(routeLoadStatus(CROWDING.HOPELESS_LOAD)).toBe('hopeless');
    expect(routeLoadStatus(Infinity)).toBe('hopeless');
  });
});
