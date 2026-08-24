import { describe, it, expect } from 'vitest';
import { AgentRoutes, type ModeAdapter, type RouteHost } from '../AgentRoutes';
import { TransportType, type TransportRoute, type TransportStop } from '../../core/transport/types';

/**
 * Route management.
 *
 * The four transit modes create routes differently: a bus needs a road path, a ferry a water
 * path, and metro and rail only need the stops to exist. Those differences stay in each mode's
 * `ModeAdapter`, and this layer handles the **common validation**: the stops exist, there are at
 * least two, their order is preserved, and the route id is real.
 *
 * So what is tested is the validation, not whether the route is built correctly — that belongs
 * to `BaseTransportSystem`'s tests.
 */

function stop(id: number, x: number, y: number): TransportStop {
  return {
    id, x, y, type: TransportType.BUS,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  } as TransportStop;
}

type FakeAdapter = ModeAdapter & { calls: string[] };

/** A recording stub mode: it remembers which methods were called and with what. */
function fakeAdapter(over: Partial<ModeAdapter> = {}): FakeAdapter {
  const allStops = [stop(1, 5, 5), stop(2, 9, 9), stop(3, 12, 12)];
  const routes: TransportRoute[] = [];
  const calls: string[] = [];
  let nextId = 100;

  return {
    calls,
    stops: () => allStops,
    listRoutes: () => routes,
    createRoute(chosen, vehicleCount) {
      calls.push(`create ${chosen.map(s => s.id).join('-')} x${vehicleCount}`);
      const r = {
        id: nextId++, type: TransportType.BUS, stops: [...chosen],
        vehicles: vehicleCount, operatingCost: 0,
      } as TransportRoute;
      routes.push(r);
      return r;
    },
    deleteRoute(id) {
      calls.push(`delete ${id}`);
      const i = routes.findIndex(r => r.id === id);
      if (i >= 0) routes.splice(i, 1);
    },
    addVehicle(id) {
      calls.push(`add ${id}`);
      const r = routes.find(x => x.id === id);
      if (r) r.vehicles++;
    },
    removeVehicle(id) {
      calls.push(`remove ${id}`);
      // Mirrors BaseTransportSystem: at one vehicle it does nothing.
      const r = routes.find(x => x.id === id);
      if (r && r.vehicles > 1) r.vehicles--;
    },
    ...over,
  };
}

function fakeHost() {
  const bus = fakeAdapter();
  const metro = fakeAdapter();
  const host: RouteHost = { bus, metro, rail: fakeAdapter(), ferry: fakeAdapter() };
  return { routes: new AgentRoutes(host), bus, metro };
}

describe('有哪些運具', () => {
  it('should list every mode it can drive', () => {
    expect(fakeHost().routes.modes()).toEqual(['bus', 'metro', 'rail', 'ferry']);
  });

  it('should list the stops of one mode', () => {
    expect(fakeHost().routes.stops('bus')).toEqual([
      { id: 1, x: 5, y: 5 },
      { id: 2, x: 9, y: 9 },
      { id: 3, x: 12, y: 12 },
    ]);
  });

  it('should say so instead of throwing on a mode that does not exist', () => {
    const { routes } = fakeHost();
    expect(routes.stops('helicopter')).toEqual([]);
    expect(routes.create('helicopter', [1, 2])).toMatchObject({ ok: false });
  });
});

describe('建路線', () => {
  it('should create a route through the chosen stops', () => {
    const { routes, bus } = fakeHost();
    const r = routes.create('bus', [1, 3], 2);

    expect(r).toMatchObject({ ok: true, mode: 'bus', stopIds: [1, 3], vehicleCount: 2 });
    expect(r.routeId).toBe(100);
    expect(bus.calls).toEqual(['create 1-3 x2']);
  });

  it('should keep the stop order it was given', () => {
    // A route is ordered: 3-1-2 is a different route from 1-2-3.
    const { routes, bus } = fakeHost();
    routes.create('bus', [3, 1, 2]);

    expect(bus.calls, '順序被排序或去重了').toEqual(['create 3-1-2 x1']);
  });

  it('should refuse a route with fewer than two stops', () => {
    const { routes, bus } = fakeHost();
    const r = routes.create('bus', [1]);

    expect(r.ok).toBe(false);
    expect(r.reason).toContain('2');
    expect(bus.calls, '明明不合法還是送出去了').toEqual([]);
  });

  it('should name the stop id it could not find', () => {
    const { routes, bus } = fakeHost();
    const r = routes.create('bus', [1, 99]);

    expect(r.ok).toBe(false);
    expect(r.reason, '沒說是哪一個站牌不存在').toContain('99');
    expect(bus.calls).toEqual([]);
  });

  it('should report the reason when the game itself refuses', () => {
    // The game returns null when a bus finds no road or a ferry no water route.
    const bus = fakeAdapter({ createRoute: () => null });
    const routes = new AgentRoutes({ bus } as unknown as RouteHost);

    const r = routes.create('bus', [1, 2]);
    expect(r.ok).toBe(false);
    expect(r.reason, '遊戲拒絕了卻沒說').toBeTruthy();
  });

  it('should report what the route actually became, not what was asked for', () => {
    // The game does not necessarily take everything: rail drops unreachable stations and the
    // vehicle count can be clamped. Reporting what was asked for rather than what was built
    // would let the caller believe every part of the request took effect.
    const bus = fakeAdapter({
      createRoute: (chosen) => ({
        id: 7, type: TransportType.BUS,
        stops: [...chosen].slice(0, 2), vehicles: 1, operatingCost: 0,
      } as TransportRoute),
    });
    const routes = new AgentRoutes({ bus } as unknown as RouteHost);

    const r = routes.create('bus', [1, 2, 3], 5);
    expect(r.stopIds, '回報的是要求的站牌，不是實際跑的').toEqual([1, 2]);
    expect(r.vehicleCount, '回報的是要求的車輛數，不是實際的').toBe(1);
  });

  it('should refuse a vehicle count that is not a whole number of vehicles', () => {
    const { routes, bus } = fakeHost();

    expect(routes.create('bus', [1, 2], -1).ok, '負數台車').toBe(false);
    expect(routes.create('bus', [1, 2], 1.5).ok, '半台車').toBe(false);
    expect(bus.calls).toEqual([]);
  });
});

describe('動已經在跑的路線', () => {
  it('should list routes with the stop ids that made them', () => {
    const { routes } = fakeHost();
    const id = routes.create('bus', [1, 2]).routeId!;

    expect(routes.list('bus')).toEqual([
      { routeId: id, stopIds: [1, 2], vehicleCount: 1, suspended: false },
    ]);
  });

  it('should add and remove vehicles', () => {
    const { routes } = fakeHost();
    const id = routes.create('bus', [1, 2]).routeId!;

    expect(routes.addVehicle('bus', id)).toMatchObject({ ok: true, vehicleCount: 2 });
    expect(routes.removeVehicle('bus', id)).toMatchObject({ ok: true, vehicleCount: 1 });
  });

  it('should refuse to take away the last vehicle on a route', () => {
    // The game's removeVehicleFromRoute returns immediately at `vehicles <= 1`, so the floor is
    // one vehicle, not zero. Without the check the result is `ok: true` for an action that did
    // nothing.
    //
    // Found in the browser: a stub mode written to a floor of zero agrees with an
    // implementation written to the same wrong floor, and neither side shows it.
    const { routes, bus } = fakeHost();
    const id = routes.create('bus', [1, 2], 1).routeId!;
    bus.calls.length = 0;

    const r = routes.removeVehicle('bus', id);
    expect(r.ok, '把最後一台車減掉了').toBe(false);
    expect(r.vehicleCount, '回報的車數不是實際的').toBe(1);
    expect(bus.calls, '遊戲那邊根本不會理，還是送出去了').toEqual([]);
  });

  it('should still remove a vehicle while more than one is running', () => {
    const { routes } = fakeHost();
    const id = routes.create('bus', [1, 2], 2).routeId!;

    expect(routes.removeVehicle('bus', id), '下限擋過頭了').toMatchObject({ ok: true, vehicleCount: 1 });
  });

  it('should delete a route', () => {
    const { routes } = fakeHost();
    const id = routes.create('bus', [1, 2]).routeId!;

    expect(routes.delete('bus', id)).toMatchObject({ ok: true });
    expect(routes.list('bus')).toEqual([]);
  });

  it('should refuse every operation on a route id that does not exist', () => {
    const { routes, bus } = fakeHost();
    routes.create('bus', [1, 2]);
    bus.calls.length = 0;

    for (const r of [
      routes.delete('bus', 999),
      routes.addVehicle('bus', 999),
      routes.removeVehicle('bus', 999),
    ]) {
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('999');
    }
    expect(bus.calls, '不存在的路線也照樣送出去了').toEqual([]);
  });

  it('should not reach into another mode when asked for one', () => {
    // Each mode numbers its routes from the bottom independently, so collisions are normal. A
    // bus id must not act on the metro just because a metro route happens to share it.
    const { routes, bus, metro } = fakeHost();
    const id = routes.create('metro', [1, 2]).routeId!;
    metro.calls.length = 0;

    expect(routes.delete('bus', id).ok, '動到隔壁運具的路線').toBe(false);
    expect(bus.calls).toEqual([]);
    expect(metro.calls).toEqual([]);
  });
});
