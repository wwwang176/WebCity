import { describe, it, expect } from 'vitest';
import { availableTransitFor } from './availableTransitFor';
import { type TransitSystemInfo } from '../TransitAvailability';
import { openFieldReach } from './openFieldReach';
import { TransportType, type TransportStop } from '../types';

/**
 * A single-mode estimate covers the walk to the stop and the wait, not just the ride.
 *
 * This result is compared directly against driving time. Counting only the ride puts a bus
 * on a 40-tick headway with a stop five tiles away on the same footing as one at the door
 * running to the second, so it beats driving almost always, and also beats transfer routes
 * that do include walking and waiting (`chooseModeMultiModal` starts from single-mode
 * options and only switches for something faster). The dispatching path would then charge
 * nothing for walking distance, leaving only the hard walk-range limit between a citizen
 * and a long walk to a bus.
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
const TICKS_PER_DAY = 24;

/** A two-stop bus route. Vehicle count sets the headway: cycle time / vehicles. */
function busLine(
  originStop: { x: number; y: number },
  destStop: { x: number; y: number },
  vehicles = 2,
): TransitSystemInfo {
  return {
    type: TransportType.BUS,
    speed: 2,
    routes: [{
      id: 1, type: TransportType.BUS,
      stops: [stop(originStop.x, originStop.y, 1), stop(destStop.x, destStop.y, 2)],
      vehicles, operatingCost: 0,
    }],
  };
}

function timeOf(sys: TransitSystemInfo, origin: { x: number; y: number }, dest: { x: number; y: number }): number {
  const result = availableTransitFor([sys], origin, dest, openFieldReach, WALK_SPEED, WAIT_FACTOR);
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
    // Headway comes from the vehicle count: the same route with fewer vehicles runs less
    // often.
    const frequent = timeOf(busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 8), home, work);
    const rare = timeOf(busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 1), home, work);

    expect(rare, '車從 8 台減到 1 台，估計時間卻沒有變 —— 等車沒有被算進去')
      .toBeGreaterThan(frequent);
  });

  it('should cost more when the stop is further from the workplace', () => {
    const near = timeOf(busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 4), home, work);
    const far = timeOf(busLine({ x: 1, y: 0 }, { x: 16, y: 0 }, 4), home, work);

    // Moving the alighting stop three tiles back shortens the ride but lengthens the walk by
    // three, so the total must grow.
    expect(far, '下車後那段路沒有被算進去').toBeGreaterThan(near);
  });

  it('should never be cheaper than the ride alone', () => {
    const t = timeOf(busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 4), home, work);
    const rideOnly = 18 / 2;
    expect(t).toBeGreaterThan(rideOnly);
  });

  it('should still report zero-ish when origin and destination share a stop', () => {
    // Boarding and alighting at the same stop is not a ride, but the walk to it still counts.
    const sys = busLine({ x: 1, y: 0 }, { x: 19, y: 0 }, 4);
    const result = availableTransitFor([sys], { x: 0, y: 0 }, { x: 2, y: 0 }, openFieldReach, WALK_SPEED, WAIT_FACTOR);
    expect(result).toHaveLength(1);
    expect(result[0]!.estimatedTime, '同站上下車卻回報 0，走到站的路憑空消失').toBeGreaterThan(0);
  });
});
