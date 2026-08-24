import { describe, it, expect } from 'vitest';
import { StopProximityIndex } from '../StopProximityIndex';
import { availableTransitFor } from './availableTransitFor';
import { type TransitSystemInfo } from '../TransitAvailability';
import { buildTransferGraph, buildStopRouteCache, findMultiModalRoutes, type FlatRoute } from '../MultiModalRouter';
import { SidewalkStopReach } from '../../traffic/StopWalkReach';
import { cityWithMainRoad } from '../../traffic/__tests__/gridCityFixture';
import { TransportType, type TransportStop, type TransportRoute } from '../types';

/**
 * Boarding and alighting stops are also picked along the sidewalk graph.
 *
 * `TransitAccessField` handles scoring and job-change decisions; the functions that actually
 * produce pedestrians are `findAvailableTransit` (single mode) and `findMultiModalRoutes`
 * (with transfers). Picking stops by Manhattan distance assigns households to stops across
 * the street, and the pedestrian then has to detour to a junction. The visible long way
 * round is dispatched from here.
 */

function stop(id: number, x: number, y: number): TransportStop {
  return {
    id, x, y, type: TransportType.BUS,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  };
}

const WALK_SPEED = 1;
const WAIT_FACTOR = 0.5;
const TICKS_PER_DAY = 24;

/** Both stops sit south of the road; (12,9) and (4,9) are directly opposite, to the north. */
const SOUTH_STOPS = [stop(1, 12, 11), stop(2, 4, 11)];

function busSystem(): TransitSystemInfo {
  const route: TransportRoute = {
    id: 1, stops: SOUTH_STOPS, vehicles: 4,
    operatingCost: 0, suspended: false,
  } as TransportRoute;
  return { type: TransportType.BUS, speed: 2, routes: [route] };
}

function busFlatRoute(): FlatRoute {
  return {
    routeId: 1, type: TransportType.BUS, speed: 2, stops: SOUTH_STOPS,
    segDists: null, headway: 10, loadFactor: 0, source: { stops: SOUTH_STOPS, vehicles: 1 }, seatsPerVehicle: 0,
  };
}

describe('挑站牌不跨越馬路', () => {
  it('should offer transit between two homes on the stop side', () => {
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);

    const result = availableTransitFor(
      [busSystem()], { x: 13, y: 11 }, { x: 5, y: 11 }, reach, WALK_SPEED, WAIT_FACTOR);
    expect(result.length, '同一側兩端都在站旁邊卻搭不到，這條測試等於沒測')
      .toBeGreaterThan(0);
  });

  it('should not offer transit to someone across the road from every stop', () => {
    // Junctions sit at x=8 and x=16, the stop at x=12 south of the road. Someone at (12,9)
    // must walk to a junction and back to cross, well beyond 5 tiles, so they cannot
    // actually reach this bus.
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);

    const result = availableTransitFor(
      [busSystem()], { x: 12, y: 9 }, { x: 4, y: 9 }, reach, WALK_SPEED, WAIT_FACTOR);
    expect(
      result,
      '馬路對面的人被算成搭得到 —— 行人會被派去繞路口',
    ).toEqual([]);
  });

  it('should not build a walk leg across the road', () => {
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const routes = [busFlatRoute()];
    const transferGraph = buildTransferGraph(routes, 3, reach);
    buildStopRouteCache(routes, transferGraph, WALK_SPEED, WAIT_FACTOR, 7);

    const result = findMultiModalRoutes(
      routes, { x: 12, y: 9 }, { x: 4, y: 9 },
      WALK_SPEED, WAIT_FACTOR, transferGraph, 7, StopProximityIndex.build(routes, reach),
    );

    expect(result, '轉乘路線把住戶從馬路對面走到站牌').toEqual([]);
  });

  it('should board at the same-side stop, not the nearer one across the road', () => {
    // From (12,9): the stop across the street at (12,11) is 2 tiles away in a straight line,
    // the same-side stop at (9,9) is 3. Straight-line distance always picks the far side and
    // sends the pedestrian round the junction. The reported boarding stop is the one the
    // pedestrian walks to.
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const acrossRoad = stop(1, 12, 11);
    const sameSide = stop(2, 9, 9);
    const nearWork = stop(3, 4, 9);
    const route = {
      id: 1, stops: [acrossRoad, sameSide, nearWork], vehicles: 4, operatingCost: 0,
    } as TransportRoute;

    const [option] = availableTransitFor(
      [{ type: TransportType.BUS, speed: 2, routes: [route] }],
      { x: 12, y: 9 }, { x: 5, y: 9 }, reach, WALK_SPEED, WAIT_FACTOR);

    expect(option, '同一側走得到卻沒有回報任何路線').toBeDefined();
    expect(option!.boardStop?.id, '挑了對街那一站 —— 行人得繞到路口再繞回來')
      .toBe(sameSide.id);
  });

  it('should still build walk legs on the stop side', () => {
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const routes = [busFlatRoute()];
    const transferGraph = buildTransferGraph(routes, 3, reach);
    buildStopRouteCache(routes, transferGraph, WALK_SPEED, WAIT_FACTOR, 7);

    const result = findMultiModalRoutes(
      routes, { x: 13, y: 11 }, { x: 5, y: 11 },
      WALK_SPEED, WAIT_FACTOR, transferGraph, 7, StopProximityIndex.build(routes, reach),
    );

    expect(result.length, '同一側也走不到，這條測試等於沒測').toBeGreaterThan(0);
  });
});
