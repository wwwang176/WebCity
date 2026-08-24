import { describe, it, expect } from 'vitest';
import { availableTransitFor } from './availableTransitFor';
import { type TransitSystemInfo } from '../TransitAvailability';
import { chooseModeMultiModal } from '../ModeChoice';
import { TransportType, TransportMode, type TransportStop, type TransportRoute } from '../types';
import { openFieldReach } from './openFieldReach';

/**
 * The estimate is computed for a specific pair of stops, so dispatch and rider counting
 * must use those stops.
 *
 * Re-picking "the nearest stop in the system" after the mode is chosen agrees with the
 * estimate only while there is one route. With several routes the two diverge: nearest
 * along the sidewalk and fastest overall are different criteria. Riders then get credited
 * to a route they did not take, distorting the crowding of both lines (BUG-283).
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

/** The route actually ridden: reachable from both ends. */
const RIDDEN_BOARD = stop(11, 0, 0);
const RIDDEN_ALIGHT = stop(12, 20, 0);

/**
 * A decoy: its origin-side stop is nearer than the route above (1 tile vs 2), but it heads
 * north and never reaches the workplace. "Nearest stop" picks it.
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
  return availableTransitFor(
    [SYSTEM], HOME, WORK, openFieldReach, WALK_SPEED, WAIT_FACTOR);
}

describe('搭乘記在他真正搭的那條路線上', () => {
  it('should report which stops the estimate was based on', () => {
    const [only] = options();
    expect(only, '兩端都碰得到的那條路線沒有被回報').toBeDefined();
    expect(only!.boardStop?.id, '沒有回報估計所依據的上車站').toBe(RIDDEN_BOARD.id);
    expect(only!.alightStop?.id, '沒有回報估計所依據的下車站').toBe(RIDDEN_ALIGHT.id);
  });

  it('should not report the nearer stop of a route that cannot reach the destination', () => {
    // The decoy stop is 1 tile from home, nearer than the one actually ridden, so
    // "pick the nearest" lands on it.
    const [only] = options();
    expect(only!.boardStop?.id, '記到了到不了目的地的那條路線頭上').not.toBe(DECOY_NEAR.id);
  });

  it('should carry the stops through to the chosen mode', () => {
    // Distance 19: driving is 19 and the threshold is 28.5, so this route at about 18 wins.
    const picked = chooseModeMultiModal(
      HOME, WORK, options(), [],
      { congestionLevel: 0, walkSpeed: WALK_SPEED, walkWeight: 1 , driveDeterrence: 1},
    );

    expect(picked.mode, '這組數字下應該選公車').toBe(TransportMode.BUS);
    expect(picked.boardStop?.id, '選中的走法沒有把上車站帶出來').toBe(RIDDEN_BOARD.id);
    expect(picked.alightStop?.id, '選中的走法沒有把下車站帶出來').toBe(RIDDEN_ALIGHT.id);
  });

  it('should carry no stops when driving', () => {
    // Someone who reaches no stop drives, and has no boarding or alighting stop. Keeping a
    // previous value would credit them to a stop they never visited.
    const picked = chooseModeMultiModal(
      HOME, { x: 200, y: 200 }, [], [],
      { congestionLevel: 0, walkSpeed: WALK_SPEED, walkWeight: 1 , driveDeterrence: 1},
    );

    expect(picked.mode).toBe(TransportMode.DRIVE);
    expect(picked.boardStop).toBeNull();
    expect(picked.alightStop).toBeNull();
  });
});
