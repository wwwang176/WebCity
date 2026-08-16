import { describe, it, expect } from 'vitest';
import { findAvailableTransit, type TransitSystemInfo } from '../TransitAvailability';
import { buildTransferGraph, buildStopRouteCache, findMultiModalRoutes, type FlatRoute } from '../MultiModalRouter';
import { SidewalkStopReach } from '../../traffic/StopWalkReach';
import { findNearestReachableStop } from '../StopChoice';
import { cityWithMainRoad } from '../../traffic/__tests__/gridCityFixture';
import { TransportType, type TransportStop, type TransportRoute } from '../types';

/**
 * 挑上下車的站牌，也要照人行道量。
 *
 * `TransitAccessField` 管的是評分與換工作判斷；真正生出行人的是這兩支 ——
 * `findAvailableTransit`（單一運具）與 `findMultiModalRoutes`（含轉乘）。它們各自
 * 拿曼哈頓距離挑站，於是把住戶配給對街的站牌，行人到了現場才發現得繞到路口。
 * 玩家看到的那個繞大圈的人，是從這裡派出去的。
 */

function stop(id: number, x: number, y: number): TransportStop {
  return {
    id, x, y, type: TransportType.BUS,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  };
}

const WALK_RANGE = 5;
const WALK_SPEED = 1;
const WAIT_FACTOR = 0.5;
const TICKS_PER_DAY = 24;

/** 站牌都在路南；(12,9) 與 (4,9) 在路北，正對面。 */
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
    segDists: null, headway: 10, loadFactor: 0,
  };
}

describe('挑站牌不跨越馬路', () => {
  it('should offer transit between two homes on the stop side', () => {
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);

    const result = findAvailableTransit(
      [busSystem()], { x: 13, y: 11 }, { x: 5, y: 11 }, reach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY,
    );
    expect(result.length, '同一側兩端都在站旁邊卻搭不到，這條測試等於沒測')
      .toBeGreaterThan(0);
  });

  it('should not offer transit to someone across the road from every stop', () => {
    // 路口在 x=8 與 x=16，站牌在 x=12 的路南。住在 (12,9) 的人要過馬路得走到
    // 路口再繞回來，遠超過 5 格 —— 他其實搭不到這班公車。
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);

    const result = findAvailableTransit(
      [busSystem()], { x: 12, y: 9 }, { x: 4, y: 9 }, reach, WALK_SPEED, WAIT_FACTOR, TICKS_PER_DAY,
    );
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
      WALK_SPEED, WAIT_FACTOR, transferGraph, 7, reach,
    );

    expect(result, '轉乘路線把住戶從馬路對面走到站牌').toEqual([]);
  });

  it('should pick a reachable stop over a nearer one across the road', () => {
    // 住在 (12,9)：對街的 (12,11) 直線只有 2 格，同側的 (9,9) 要 3 格。
    // 用直線量的話對街永遠贏，行人於是被派去繞路口。
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const stops = [stop(1, 12, 11), stop(2, 9, 9)];

    const picked = findNearestReachableStop(stops, { x: 12, y: 9 }, reach);

    expect(picked, '一站都沒挑到').not.toBeNull();
    expect(picked!.id, '挑了對街那一站 —— 行人得繞到路口再繞回來').toBe(2);
  });

  it('should pick nothing when every stop is across the road', () => {
    // 走不到任何一站是有意義的答案：這個人搭不到車，該開車。
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);

    expect(
      findNearestReachableStop(SOUTH_STOPS, { x: 12, y: 9 }, reach),
      '硬挑了一站走不到的給他',
    ).toBeNull();
  });

  it('should still build walk legs on the stop side', () => {
    const { graph } = cityWithMainRoad(8);
    const reach = new SidewalkStopReach(graph);
    const routes = [busFlatRoute()];
    const transferGraph = buildTransferGraph(routes, 3, reach);
    buildStopRouteCache(routes, transferGraph, WALK_SPEED, WAIT_FACTOR, 7);

    const result = findMultiModalRoutes(
      routes, { x: 13, y: 11 }, { x: 5, y: 11 },
      WALK_SPEED, WAIT_FACTOR, transferGraph, 7, reach,
    );

    expect(result.length, '同一側也走不到，這條測試等於沒測').toBeGreaterThan(0);
  });
});
