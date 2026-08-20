import { describe, it, expect } from 'vitest';
import { BusSystem } from '../BusSystem';
import { MetroSystem } from '../MetroSystem';
import { flattenSystems } from '../MultiModalRouter';
import { findAvailableTransit } from '../TransitAvailability';
import { openFieldReach } from './openFieldReach';
import type { TransitSystemInfo } from '../TransitAvailability';
import { TransportType } from '../types';

/**
 * 公車的**乘車時間估計**要含壅塞。
 *
 * 運具選擇是把「開車要多久」跟「搭車要多久」擺在一起比大小，而開車那一側滿滿地
 * 計入壅塞（`driveTime = 曼哈頓距離 × (1 + 壅塞)`）。公車那一側傳的卻是
 * `config.speed` 的**原始值** —— 塞車的城市裡，公車看起來不合理地好:路上的車全部
 * 慢下來，只有公車照跑。
 *
 * 逐路線的壅塞在 BUG-339 就有了（`congestionOn` / `getSpeedMultiplier`），這裡只是
 * 把它接到估計時間上。接上之後壅塞同時吃兩件事:
 *
 * 1. **乘車時間**變長（`rideDistance / speed`）
 * 2. **班距**跟著變長（整圈時間 ÷ 車輛數）—— 而班距又餵給運能，塞住的路線一天
 *    跑得完的圈數變少。兩件都是真的。
 */

const WALK_SPEED = 0.3;
const WAIT_FACTOR = 0.5;

function infosOf(system: BusSystem | MetroSystem, type: TransportType): TransitSystemInfo[] {
  return [{
    type,
    speed: system.getSpeed(),
    speedOn: (routeId: number) => system.getSpeedOn(routeId),
    vehicleCapacity: system.getCapacity(),
    routes: system.getRoutes(),
    getSegmentDistances: (routeId: number) => system.getSegmentDistances(routeId),
  }];
}

function busWithRoute(): { bus: BusSystem; routeId: number } {
  const bus = new BusSystem();
  const route = bus.createRoute([bus.addStop(0, 0), bus.addStop(20, 0)], 2);
  return { bus, routeId: route.id };
}

describe('公車的乘車時間含壅塞', () => {
  it('should slow the ride down when the corridor is jammed', () => {
    const { bus, routeId } = busWithRoute();
    const clear = flattenSystems(infosOf(bus, TransportType.BUS))[0]!;

    bus.setRouteCongestion(routeId, 1);
    const jammed = flattenSystems(infosOf(bus, TransportType.BUS))[0]!;

    expect(jammed.speed, '路線塞死了，估計時間用的還是原始車速')
      .toBeLessThan(clear.speed);
  });

  it('should stretch the headway too, not just the ride', () => {
    // 車開得慢，整圈就跑得久，班距跟著拉長 —— 而班距又決定一天跑幾圈，也就是運能。
    const { bus, routeId } = busWithRoute();
    const clear = flattenSystems(infosOf(bus, TransportType.BUS))[0]!;

    bus.setRouteCongestion(routeId, 1);
    const jammed = flattenSystems(infosOf(bus, TransportType.BUS))[0]!;

    expect(jammed.headway, '塞住的路線班距沒有變長').toBeGreaterThan(clear.headway);
  });

  it('should charge each route its own congestion', () => {
    const bus = new BusSystem();
    const jam = bus.createRoute([bus.addStop(0, 0), bus.addStop(20, 0)], 1);
    const free = bus.createRoute([bus.addStop(0, 40), bus.addStop(20, 40)], 1);
    bus.setRouteCongestion(jam.id, 1);

    const flat = flattenSystems(infosOf(bus, TransportType.BUS));
    const jammed = flat.find(r => r.routeId === jam.id)!;
    const clear = flat.find(r => r.routeId === free.id)!;

    expect(jammed.speed, '兩條路線拿到同一個車速').toBeLessThan(clear.speed);
  });

  it('should leave the metro alone — it does not share the road', () => {
    // 這正是玩家蓋捷運的理由。
    const metro = new MetroSystem();
    const line = metro.createLine([metro.addStation(0, 0), metro.addStation(20, 0)], 2);
    metro.congestionLevel = 1;
    metro.setRouteCongestion(line.id, 1);

    const flat = flattenSystems(infosOf(metro, TransportType.METRO))[0]!;
    expect(flat.speed, '捷運的估計時間被地面壅塞拖慢了').toBe(metro.getSpeed());
  });

  it('should reach the single-mode path as well', () => {
    // `findAvailableTransit` 是另一條估時間的路徑（單一運具）。兩條各讀各的話，
    // 同一趟通勤會因為走哪條程式碼而得到不同的答案。
    const { bus, routeId } = busWithRoute();
    const at = (o: { x: number; y: number }, d: { x: number; y: number }) =>
      findAvailableTransit(infosOf(bus, TransportType.BUS), o, d, openFieldReach,
        WALK_SPEED, WAIT_FACTOR)[0];

    const clear = at({ x: 0, y: 1 }, { x: 20, y: 1 });
    expect(clear, 'fixture 裡搭不到公車 —— 這個測試沒驗到東西').toBeDefined();

    bus.setRouteCongestion(routeId, 1);
    const jammed = at({ x: 0, y: 1 }, { x: 20, y: 1 });

    expect(jammed!.estimatedTime, '單一運具那條路徑的估計時間沒有含壅塞')
      .toBeGreaterThan(clear!.estimatedTime);
  });
});
