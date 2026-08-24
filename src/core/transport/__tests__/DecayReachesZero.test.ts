import { describe, it, expect } from 'vitest';
import { BusSystem } from '../BusSystem';

/**
 * Once nobody rides, the smoothed value must reach exactly 0.
 *
 * Day rollover applies exponential smoothing:
 *
 * ```
 * smoothed = 0.7 * smoothed + 0.3 * today's riders
 * ```
 *
 * After a route is deleted nobody rides, today's riders is always 0, and the formula
 * degenerates to multiplying by 0.7 each day. **Multiplication never reaches zero** — it
 * only approaches it in mathematics, and floats are worse:
 *
 * ```
 * 0.7 * 5e-324  ===  5e-324
 * ```
 *
 * `5e-324` is the smallest positive number JavaScript can represent; multiplying by 0.7
 * rounds back to itself, so the value **sticks**. Measured from 1000 over a hundred
 * thousand iterations, it stays at `5e-324`.
 *
 * Player saves have grown exactly this: after deleting a rail line, four stations held
 * `7.7e-44`, `1.16e-42`, `5e-324` and `1.25e-42`.
 *
 * It is not only untidy. Load factor at zero capacity keys off whether anyone wants to
 * ride: `dailyRiders > 0 ? Infinity : 0`. Since `5e-324 > 0` holds, load factor is infinite
 * and the vehicle stays permanently flagged red as hopeless (BUG-349).
 */

function busWithRiders(riders: number): BusSystem {
  const bus = new BusSystem();
  const stop = bus.addStop(1, 1);
  stop.smoothedDailyRiders = riders;
  return bus;
}

describe('浮點數為什麼救不了自己', () => {
  it('should not shrink the smallest positive number any further', () => {
    // This does not exercise production code; it pins why the snap to zero is needed.
    // Without it the snap reads as redundant defensiveness.
    expect(0.7 * Number.MIN_VALUE).toBe(Number.MIN_VALUE);
  });
});

describe('沒有人搭之後', () => {
  it('should reach exactly zero, not merely approach it', () => {
    const bus = busWithRiders(1000);
    // Three months with no riders.
    for (let day = 0; day < 90; day++) bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders, '只是趨近零而不是等於零').toBe(0);
  });

  it('should still be zero after a very long time', () => {
    const bus = busWithRiders(1000);
    for (let day = 0; day < 5000; day++) bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders).toBe(0);
  });

  it('should clear a value that is already denormal in a loaded save', () => {
    // Saves already contain such values; the first rollover after loading must clear them.
    const bus = busWithRiders(5e-324);
    bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders).toBe(0);
  });
});

describe('不能誤傷真的有人搭的路線', () => {
  it('should keep a busy stop busy', () => {
    const bus = busWithRiders(1000);
    bus.getStops()[0]!.dailyRiders = 1000;
    bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders).toBeCloseTo(1000, 6);
  });

  it('should not wipe a stop that merely had a quiet day', () => {
    // Smoothing exists so that one quiet day does not mean the stop is empty. The snap
    // threshold must not be high enough to swallow that.
    const bus = busWithRiders(50);
    bus.getStops()[0]!.dailyRiders = 0;
    bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders, '一天沒人就把整站清空了').toBeCloseTo(35, 6);
  });

  it('should still roll yesterday into lastDayRiders and reset today', () => {
    const bus = busWithRiders(0);
    bus.getStops()[0]!.dailyRiders = 42;
    bus.rolloverDailyRiders();

    const s = bus.getStops()[0]!;
    expect(s.lastDayRiders).toBe(42);
    expect(s.dailyRiders).toBe(0);
  });
});
