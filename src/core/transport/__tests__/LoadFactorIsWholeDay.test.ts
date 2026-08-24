import { describe, it, expect } from 'vitest';
import { getRouteRiders } from '../TransitAvailability';
import { TransportType, type TransportStop } from '../types';

/**
 * Load factor compares a **whole day** against a whole day.
 *
 * Capacity is riders per day. `dailyRiders` is the running total for today so far and
 * resets each game day, a different unit: the route looks empty each morning, fills as the
 * day runs out, then resets.
 *
 * Measured on a 12,600-citizen save (one bus line, one vehicle, 151 consecutive samples):
 *
 * | | |
 * |---|---|
 * | load factor range | **5.56 to 47.34** (mean 29.92) |
 * | today's running total | **0 to 6,519**, then zero |
 *
 * That saw-tooth is the reported "usage oscillates between 80% and 100%". It also
 * destabilises demand: the route looks empty every morning, everyone picks it, it overloads
 * by evening, and the cycle repeats.
 *
 * Reading a **complete day** — the larger of yesterday's actual count and the cross-day
 * smoothed value — makes load change once per day, in the same unit as capacity. The cost
 * is that a new route looks empty on its first day, since a day of data takes a day.
 */

function stop(id: number, daily: number, lastDay: number, smoothed: number): TransportStop {
  return {
    id, x: id, y: 0, type: TransportType.BUS, passengers: 0,
    dailyRiders: daily, lastDayRiders: lastDay, smoothedDailyRiders: smoothed,
  };
}

describe('載重讀的是整天', () => {
  it('should not swing while the day is only half over', () => {
    // Same route, same real ridership, differing only in how far into the day it is.
    const morning = { stops: [stop(1, 0, 900, 900)] };
    const evening = { stops: [stop(1, 900, 900, 900)] };

    expect(getRouteRiders(morning), '早上看起來是空的').toBe(900);
    expect(getRouteRiders(evening), '傍晚跟早上不一樣').toBe(900);
  });

  it('should follow a route whose ridership jumped yesterday', () => {
    // A route that spiked yesterday must show today; the smoothed value alone takes days to
    // catch up.
    const surged = { stops: [stop(1, 0, 5000, 900)] };
    expect(getRouteRiders(surged), '昨天暴增，今天還當它是老樣子').toBe(5000);
  });

  it('should keep the smoothed value when yesterday was a fluke dip', () => {
    // One quiet day does not mean the line suddenly emptied.
    const dip = { stops: [stop(1, 0, 100, 3000)] };
    expect(getRouteRiders(dip), '一天的低點就把整條線當成空的').toBe(3000);
  });

  it('should add up across the stops of the route', () => {
    const route = { stops: [stop(1, 0, 100, 50), stop(2, 0, 200, 50)] };
    expect(getRouteRiders(route)).toBe(300);
  });

  it('should read zero on a brand new route', () => {
    // No data on day one: a day of data takes a day. Not an error.
    expect(getRouteRiders({ stops: [stop(1, 0, 0, 0)] })).toBe(0);
  });
});
