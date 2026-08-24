import { describe, it, expect } from 'vitest';
import { availableTransitFor } from './availableTransitFor';
import { BusSystem } from '../BusSystem';
import { MetroSystem } from '../MetroSystem';
import { flattenSystems } from '../MultiModalRouter';
import { computeRideDistance } from '../TransitAvailability';
import { expectedWait } from '../RouteLoad';
import { openFieldReach } from './openFieldReach';
import type { TransitSystemInfo } from '../TransitAvailability';
import { TransportType } from '../types';

/**
 * A bus's **estimated ride time** includes congestion.
 *
 * Mode choice compares driving time against transit time, and the driving side charges
 * congestion in full (`driveTime = manhattan * (1 + congestion)`). Passing the raw
 * `config.speed` on the bus side makes buses look implausibly good in a congested city:
 * every car slows down while the bus keeps its timetable.
 *
 * Per-route congestion already exists (`congestionOn` / `getSpeedMultiplier`, BUG-339);
 * this wires it into the time estimate, where it affects two things:
 *
 * 1. **Ride time** rises (`rideDistance / speed`).
 * 2. **Headway** rises with it (cycle time / vehicle count), and headway feeds capacity, so
 *    a congested route completes fewer loops per day.
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
    // A slower vehicle takes longer per loop, which lengthens the headway, which sets loops
    // per day and therefore capacity.
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
    // Precisely what the player builds a metro for.
    const metro = new MetroSystem();
    const line = metro.createLine([metro.addStation(0, 0), metro.addStation(20, 0)], 2);
    metro.congestionLevel = 1;
    metro.setRouteCongestion(line.id, 1);

    const flat = flattenSystems(infosOf(metro, TransportType.METRO))[0]!;
    expect(flat.speed, '捷運的估計時間被地面壅塞拖慢了').toBe(metro.getSpeed());
  });

  it('should reach the single-mode path as well', () => {
    // `findAvailableTransit` is the other time-estimating path (single mode). If the two
    // read different speeds, the same commute gets different answers depending on which
    // code path served it.
    const { bus, routeId } = busWithRoute();
    const at = (o: { x: number; y: number }, d: { x: number; y: number }) =>
      availableTransitFor(infosOf(bus, TransportType.BUS), o, d, openFieldReach,
        WALK_SPEED, WAIT_FACTOR)[0];

    const clear = at({ x: 0, y: 1 }, { x: 20, y: 1 });
    expect(clear, 'fixture 裡搭不到公車 —— 這個測試沒驗到東西').toBeDefined();

    bus.setRouteCongestion(routeId, 1);
    const jammed = at({ x: 0, y: 1 }, { x: 20, y: 1 });

    expect(jammed!.estimatedTime, '單一運具那條路徑的估計時間沒有含壅塞')
      .toBeGreaterThan(clear!.estimatedTime);
  });

  it('should slow the ride itself down, not only the wait', () => {
    // The test above only asserts that the estimate grew, and congestion already grows
    // `expectedWait` through the headway, so it cannot tell whether the ride term followed.
    // This subtracts the waiting and walking legs and checks which speed the remaining ride
    // time was computed at.
    const { bus, routeId } = busWithRoute();
    bus.setRouteCongestion(routeId, 1);

    const infos = infosOf(bus, TransportType.BUS);
    const flat = flattenSystems(infos)[0]!;
    const option = availableTransitFor(
      infos, { x: 0, y: 1 }, { x: 20, y: 1 }, openFieldReach, WALK_SPEED, WAIT_FACTOR,
    )[0];
    expect(option, 'fixture 裡搭不到公車 —— 這個測試沒驗到東西').toBeDefined();

    const wait = expectedWait(flat.headway, WAIT_FACTOR, flat.loadFactor);
    const ride = option!.estimatedTime - option!.walkTime - wait;
    const rideDistance = computeRideDistance(flat.stops, 0, 1, flat.segDists);

    expect(ride, '乘車時間用的是設定車速，不是塞住之後的車速')
      .toBeCloseTo(rideDistance / flat.speed, 6);
  });
});
