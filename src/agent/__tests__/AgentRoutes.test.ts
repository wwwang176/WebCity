import { describe, it, expect } from 'vitest';
import { AgentRoutes, type ModeAdapter, type RouteHost } from '../AgentRoutes';
import { TransportType, type TransportRoute, type TransportStop } from '../../core/transport/types';

/**
 * 路線管理。
 *
 * 四種運具建路線的方式各不相同 —— 公車要沿著馬路找得到路，渡輪要走得到水路，
 * 地鐵跟鐵路只要站牌在。那些差異留在各自的 `ModeAdapter` 裡，這一層管的是
 * **共通的把關**:站牌存不存在、夠不夠兩站、順序有沒有保住、路線 ID 是真的嗎。
 *
 * 所以測的是把關，不是「路線建得對不對」（那是 `BaseTransportSystem` 的測試在管）。
 */

function stop(id: number, x: number, y: number): TransportStop {
  return {
    id, x, y, type: TransportType.BUS,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  } as TransportStop;
}

type FakeAdapter = ModeAdapter & { calls: string[] };

/** 一個記帳的假運具:記得誰被呼叫過、拿到什麼。 */
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
      // 照著 BaseTransportSystem:剩一台就不再理。
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
    // 路線是有順序的 —— 3→1→2 跟 1→2→3 是不同的路線。
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
    // 公車找不到馬路、渡輪找不到水路的時候，遊戲回 null。
    const bus = fakeAdapter({ createRoute: () => null });
    const routes = new AgentRoutes({ bus } as unknown as RouteHost);

    const r = routes.create('bus', [1, 2]);
    expect(r.ok).toBe(false);
    expect(r.reason, '遊戲拒絕了卻沒說').toBeTruthy();
  });

  it('should report what the route actually became, not what was asked for', () => {
    // 遊戲不一定照單全收 —— 鐵路會把接不上的車站丟掉，車輛數也可能被夾。
    // 回報「我要求的」而不是「實際建成的」會讓呼叫端以為要求都生效了。
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
    // 遊戲的 removeVehicleFromRoute 判的是 `vehicles <= 1` 就直接 return ——
    // 下限是一台不是零。不擋的話會回一個 ok:true 但什麼都沒發生的結果。
    //
    // 這一條是在瀏覽器上測出來的:單元測試的假運具照著我寫的下限（零）動，
    // 兩邊一起錯就看不出來。
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
    // 每一種運具的路線 ID 各自從小開始編，撞號是常態。拿公車的 ID 去動地鐵
    // 不能「剛好也有一條」就動下去。
    const { routes, bus, metro } = fakeHost();
    const id = routes.create('metro', [1, 2]).routeId!;
    metro.calls.length = 0;

    expect(routes.delete('bus', id).ok, '動到隔壁運具的路線').toBe(false);
    expect(bus.calls).toEqual([]);
    expect(metro.calls).toEqual([]);
  });
});
