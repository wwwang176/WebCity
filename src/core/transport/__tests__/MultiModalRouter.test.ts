import { describe, it, expect } from 'vitest';
import { StopProximityIndex } from '../StopProximityIndex';
import {
  buildTransferGraph,
  buildStopRouteCache,
  findMultiModalRoutes,
  flattenSystems,
  type FlatRoute,
} from '../MultiModalRouter';
import { openFieldReach } from './openFieldReach';
import { CROWDING, TRANSIT_SERVICE_TICKS_PER_DAY } from '../RouteLoad';
import { TransportType, type TransportStop } from '../types';

function makeStop(x: number, y: number, id: number, type = TransportType.BUS): TransportStop {
  return { id, x, y, type, passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0 };
}

function makeRoute(
  routeId: number,
  type: TransportType,
  speed: number,
  stops: TransportStop[],
  opts?: { segDists?: number[]; headway?: number; loadFactor?: number;
           vehicles?: number; seatsPerVehicle?: number },
): FlatRoute {
  return {
    routeId, type, speed, stops,
    segDists: opts?.segDists ?? null,
    headway: opts?.headway ?? 10,
    loadFactor: opts?.loadFactor ?? 0,
    source: { stops, vehicles: opts?.vehicles ?? 1 },
    seatsPerVehicle: opts?.seatsPerVehicle ?? 0,
  };
}

/** 擠到幾乎沒指望的載重 —— 平均要多等 19 班。 */
const PACKED = 20;

// ── buildTransferGraph ──────────────────────────────────────────

describe('buildTransferGraph', () => {
  it('returns empty graph for no routes', () => {
    const graph = buildTransferGraph([], 3, openFieldReach);
    expect(graph.byStop.size).toBe(0);
  });

  it('creates edges between nearby stops of different routes', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2, [makeStop(0, 0, 1), makeStop(10, 0, 2)]),
      makeRoute(2, TransportType.METRO, 3, [makeStop(10, 1, 3), makeStop(20, 0, 4)]),
    ];
    // (10,0) ↔ (10,1) distance 1 ≤ 3
    const graph = buildTransferGraph(routes, 3, openFieldReach);
    expect(graph.byStop.size).toBe(2);
  });

  it('does NOT create edges between stops on the same route', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2, [makeStop(0, 0, 1), makeStop(2, 0, 2)]),
    ];
    const graph = buildTransferGraph(routes, 3, openFieldReach);
    expect(graph.byStop.size).toBe(0);
  });

  it('does NOT create edges beyond transfer range', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2, [makeStop(0, 0, 1)]),
      makeRoute(2, TransportType.METRO, 3, [makeStop(10, 0, 2)]),
    ];
    const graph = buildTransferGraph(routes, 3, openFieldReach);
    expect(graph.byStop.size).toBe(0);
  });

  it('creates edges for same-system different routes', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2, [makeStop(10, 0, 1)]),
      makeRoute(2, TransportType.BUS, 2, [makeStop(10, 1, 2)]),
    ];
    const graph = buildTransferGraph(routes, 3, openFieldReach);
    expect(graph.byStop.size).toBe(2);
  });

  it('handles zero-distance transfer at same coordinates', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2, [makeStop(5, 5, 1)]),
      makeRoute(2, TransportType.METRO, 3, [makeStop(5, 5, 2)]),
    ];
    const graph = buildTransferGraph(routes, 3, openFieldReach);
    expect(graph.byStop.size).toBe(2);
  });
});

// ── findMultiModalRoutes ────────────────────────────────────────

/** Build transfer graph AND pre-compute stop route cache in one step. */
function buildGraphWithCache(routes: FlatRoute[], transferRange: number, walkSpeed = 1, waitFactor = 0.5, maxLegs = 7) {
  const graph = buildTransferGraph(routes, transferRange, openFieldReach);
  buildStopRouteCache(routes, graph, walkSpeed, waitFactor, maxLegs);
  return graph;
}

describe('findMultiModalRoutes', () => {
  const WALK_SPEED = 1;
  const WAIT_FACTOR = 0.5;
  const WALK_RANGE = 5;
  const TRANSFER_RANGE = 3;
  const MAX_LEGS = 7;

  it('returns empty array when no routes exist', () => {
    const graph = buildGraphWithCache([], TRANSFER_RANGE);
    const result = findMultiModalRoutes(
      [], { x: 0, y: 0 }, { x: 10, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS,
      StopProximityIndex.build([], openFieldReach),
    );
    expect(result).toEqual([]);
  });

  it('finds single-ride route (3 legs: walk-ride-walk)', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2, [makeStop(1, 0, 1), makeStop(9, 0, 2)], { segDists: [10, 10] }),
    ];
    const graph = buildGraphWithCache(routes, TRANSFER_RANGE);
    const result = findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 10, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS,
      StopProximityIndex.build(routes, openFieldReach),
    );

    expect(result.length).toBeGreaterThanOrEqual(1);
    const best = result[0]!;
    expect(best.legs).toHaveLength(3);
    expect(best.legs[0]!.type).toBe('walk');
    expect(best.legs[1]!.type).toBe('ride');
    expect(best.legs[2]!.type).toBe('walk');
  });

  it('finds two-ride route with transfer (5 legs)', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2,
        [makeStop(1, 0, 1), makeStop(10, 0, 2)], { segDists: [10, 10] }),
      makeRoute(2, TransportType.METRO, 3,
        [makeStop(10, 1, 3), makeStop(19, 0, 4)], { segDists: [10, 10] }),
    ];
    const graph = buildGraphWithCache(routes, TRANSFER_RANGE);
    const result = findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 20, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS,
      StopProximityIndex.build(routes, openFieldReach),
    );

    const fiveLegs = result.find(r => r.legs.length === 5);
    expect(fiveLegs).toBeDefined();
    expect(fiveLegs!.legs[0]!.type).toBe('walk');
    expect(fiveLegs!.legs[1]!.type).toBe('ride');
    expect(fiveLegs!.legs[1]!.transitType).toBe(TransportType.BUS);
    expect(fiveLegs!.legs[2]!.type).toBe('walk'); // transfer walk
    expect(fiveLegs!.legs[3]!.type).toBe('ride');
    expect(fiveLegs!.legs[3]!.transitType).toBe(TransportType.METRO);
    expect(fiveLegs!.legs[4]!.type).toBe('walk');
  });

  it('finds three-ride route (7 legs)', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2,
        [makeStop(1, 0, 1), makeStop(10, 0, 2)], { segDists: [10, 10] }),
      makeRoute(2, TransportType.METRO, 3,
        [makeStop(10, 1, 3), makeStop(20, 0, 4)], { segDists: [10, 10] }),
      makeRoute(3, TransportType.RAIL, 4,
        [makeStop(20, 1, 5), makeStop(29, 0, 6)], { segDists: [10, 10] }),
    ];
    const graph = buildGraphWithCache(routes, TRANSFER_RANGE);
    const result = findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 30, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS,
      StopProximityIndex.build(routes, openFieldReach),
    );

    const sevenLegs = result.find(r => r.legs.length === 7);
    expect(sevenLegs).toBeDefined();
    expect(sevenLegs!.legs.map(l => l.type)).toEqual(
      ['walk', 'ride', 'walk', 'ride', 'walk', 'ride', 'walk'],
    );
  });

  it('respects maxLegs limit', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2,
        [makeStop(1, 0, 1), makeStop(10, 0, 2)], { segDists: [10, 10] }),
      makeRoute(2, TransportType.METRO, 3,
        [makeStop(10, 1, 3), makeStop(19, 0, 4)], { segDists: [10, 10] }),
    ];
    const graph = buildGraphWithCache(routes, TRANSFER_RANGE, WALK_SPEED, WAIT_FACTOR, 3);
    // maxLegs=3 → only single-ride routes
    const result = findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 20, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, 3,
      StopProximityIndex.build(routes, openFieldReach),
    );
    for (const route of result) {
      expect(route.legs.length).toBeLessThanOrEqual(3);
    }
  });

  it('supports same-system transfer (bus route A → bus route B)', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2,
        [makeStop(1, 0, 1), makeStop(10, 0, 2)], { segDists: [10, 10] }),
      makeRoute(2, TransportType.BUS, 2,
        [makeStop(10, 1, 3), makeStop(19, 0, 4)], { segDists: [10, 10] }),
    ];
    const graph = buildGraphWithCache(routes, TRANSFER_RANGE);
    const result = findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 20, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS,
      StopProximityIndex.build(routes, openFieldReach),
    );

    const transfer = result.find(r => r.legs.length === 5);
    expect(transfer).toBeDefined();
    expect(transfer!.legs[1]!.transitType).toBe(TransportType.BUS);
    expect(transfer!.legs[3]!.transitType).toBe(TransportType.BUS);
    // Different routes (different routeIdx)
    expect(transfer!.legs[1]!.routeIdx).not.toBe(transfer!.legs[3]!.routeIdx);
  });

  it('does not reuse same route in one trip', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2,
        [makeStop(0, 0, 1), makeStop(5, 0, 2), makeStop(10, 0, 3)]),
    ];
    const graph = buildGraphWithCache(routes, TRANSFER_RANGE);
    const result = findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 10, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS,
      StopProximityIndex.build(routes, openFieldReach),
    );
    // Only single-ride routes possible (no transfer edges)
    for (const route of result) {
      expect(route.legs.length).toBe(3);
    }
  });

  it('punishes a packed route with time instead of hiding it', () => {
    // 沒有拒載門檻了。擠爆的路線照樣列得出來，但等車時間長到它自己輸掉 ——
    // 而懸崖會自己造出極限環（玩家 12 600 人的存檔實測過）。
    const packed: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2,
        [makeStop(1, 0, 1), makeStop(9, 0, 2)], { loadFactor: PACKED }),
    ];
    const empty: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2, [makeStop(1, 0, 1), makeStop(9, 0, 2)]),
    ];
    const search = (routes: FlatRoute[]) => findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 10, y: 0 },
      WALK_SPEED, WAIT_FACTOR, buildGraphWithCache(routes, TRANSFER_RANGE), MAX_LEGS,
      StopProximityIndex.build(routes, openFieldReach),
    );

    const jammed = search(packed)[0];
    const free = search(empty)[0];
    expect(jammed, '擠爆的路線被整條藏起來了').toBeDefined();
    expect(jammed!.totalTime, '擠成這樣跟空車一樣快')
      .toBeGreaterThan(free!.totalTime * 5);
  });

  it('includes walk and wait time in total time estimate', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2,
        [makeStop(2, 0, 1), makeStop(8, 0, 2)], { segDists: [10, 10], headway: 10 }),
    ];
    const graph = buildGraphWithCache(routes, TRANSFER_RANGE);
    const result = findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 10, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS,
      StopProximityIndex.build(routes, openFieldReach),
    );

    expect(result.length).toBeGreaterThan(0);
    const route = result[0]!;
    // Walk to stop: manhattan(0,0 → 2,0) = 2, time = 2/1 = 2
    // Wait: 10 * 0.5 = 5
    // Ride: min(seg[0]=10, seg[1]=10) = 10, time = 10/2 = 5
    // Walk from stop: manhattan(8,0 → 10,0) = 2, time = 2/1 = 2
    // Total: 2 + 5 + 5 + 2 = 14
    expect(route.totalTime).toBeCloseTo(14);
    // Sum of legs should equal totalTime
    const legSum = route.legs.reduce((s, l) => s + l.estimatedTime, 0);
    expect(legSum).toBeCloseTo(route.totalTime);
  });

  it('returns routes sorted by total time (best first)', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 1,
        [makeStop(1, 0, 1), makeStop(9, 0, 2)], { segDists: [10, 10] }),
      makeRoute(2, TransportType.METRO, 5,
        [makeStop(1, 1, 3), makeStop(9, 1, 4)], { segDists: [10, 10] }),
    ];
    const graph = buildGraphWithCache(routes, TRANSFER_RANGE);
    const result = findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 10, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS,
      StopProximityIndex.build(routes, openFieldReach),
    );

    expect(result.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.totalTime).toBeGreaterThanOrEqual(result[i - 1]!.totalTime);
    }
  });

  it('skips full route in transfer chain', () => {
    const routes: FlatRoute[] = [
      makeRoute(1, TransportType.BUS, 2,
        [makeStop(1, 0, 1), makeStop(10, 0, 2)], { segDists: [10, 10] }),
      makeRoute(2, TransportType.METRO, 3,
        [makeStop(10, 1, 3), makeStop(19, 0, 4)], { segDists: [10, 10], loadFactor: PACKED }),
    ];
    const graph = buildGraphWithCache(routes, TRANSFER_RANGE);
    const result = findMultiModalRoutes(
      routes, { x: 0, y: 0 }, { x: 20, y: 0 },
      WALK_SPEED, WAIT_FACTOR, graph, MAX_LEGS,
      StopProximityIndex.build(routes, openFieldReach),
    );
    // 轉乘那一段的捷運擠爆了 —— 路線還在，但慢到不值得。
    const fiveLegs = result.find(r => r.legs.length === 5);
    const direct = result.find(r => r.legs.length < 5);
    expect(fiveLegs, '擠爆的轉乘鏈被整條藏起來了').toBeDefined();
    if (direct) {
      expect(fiveLegs!.totalTime, '繞去搭擠爆的捷運反而比較快')
        .toBeGreaterThan(direct.totalTime);
    }
  });
});

// ── flattenSystems ──────────────────────────────────────────────

describe('flattenSystems', () => {
  it('flattens systems into FlatRoute array', () => {
    const systems = [{
      type: TransportType.BUS,
      speed: 2,
      vehicleCapacity: 50,
      routes: [{
        id: 1, type: TransportType.BUS,
        stops: [makeStop(0, 0, 1), makeStop(10, 0, 2)],
        vehicles: 2, operatingCost: 100,
      }],
      getSegmentDistances: () => [10, 10],
    }];
    const flat = flattenSystems(systems);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.routeId).toBe(1);
    expect(flat[0]!.type).toBe(TransportType.BUS);
    expect(flat[0]!.speed).toBe(2);
    expect(flat[0]!.segDists).toEqual([10, 10]);
    expect(flat[0]!.loadFactor).toBe(0);
  });

  it('halves the headway when the fleet doubles', () => {
    // 加車真正買到的東西。班距原本寫死成站數的倍數，加車一秒也沒有變短。
    const stops = [makeStop(0, 0, 1), makeStop(10, 0, 2)];
    const sys = (vehicles: number) => [{
      type: TransportType.BUS, speed: 2, vehicleCapacity: 50,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles, operatingCost: 100 }],
      getSegmentDistances: () => [10, 10],
    }];
    const two = flattenSystems(sys(2))[0]!.headway;
    const four = flattenSystems(sys(4))[0]!.headway;
    expect(four).toBeCloseTo(two / 2);
  });

  it('measures load against what the fleet carries in a day', () => {
    const stops = [makeStop(0, 0, 1), makeStop(10, 0, 2)];
    stops[0]!.lastDayRiders = 100;
    const systems = [{
      type: TransportType.BUS,
      speed: 2,
      vehicleCapacity: 50,
      routes: [{
        id: 1, type: TransportType.BUS, stops,
        vehicles: 2, operatingCost: 100,
      }],
      getSegmentDistances: () => [10, 10],
    }];
    const flat = flattenSystems(systems);
    // 整圈 20 格 / 速度 2 = 10 tick。一天跑幾圈由 TRANSIT_SERVICE_TICKS_PER_DAY 決定
    // —— 期望值跟著它算，寫死的話調一次刻度就得回來改魔術數字。
    const loops = TRANSIT_SERVICE_TICKS_PER_DAY / 10;
    // 舊模型拿 100 人次去比「2 台 × 50 座 = 100」，這條線在這裡就滿了。
    expect(flat[0]!.loadFactor).toBeCloseTo(100 / (2 * 50 * loops));
    expect(flat[0]!.loadFactor, '一天才 100 人次就算滿了').toBeLessThan(1);
  });

  it('reports a load factor well past capacity', () => {
    const stops = [makeStop(0, 0, 1), makeStop(10, 0, 2)];
    // 「沒指望」那條線是 3，運能是 2 台 × 50 座 × 一天跑幾圈 —— 人次要壓過它。
    stops[0]!.lastDayRiders = 2 * 50 * (TRANSIT_SERVICE_TICKS_PER_DAY / 10) * 4;
    const systems = [{
      type: TransportType.BUS, speed: 2, vehicleCapacity: 50,
      routes: [{ id: 1, type: TransportType.BUS, stops, vehicles: 2, operatingCost: 100 }],
      getSegmentDistances: () => [10, 10],
    }];
    expect(flattenSystems(systems)[0]!.loadFactor).toBeGreaterThan(CROWDING.HOPELESS_LOAD);
  });

  it('skips suspended routes', () => {
    const systems = [{
      type: TransportType.BUS,
      speed: 2,
      routes: [{
        id: 1, type: TransportType.BUS,
        stops: [makeStop(0, 0, 1)],
        vehicles: 1, operatingCost: 100,
        suspended: true,
      }],
    }];
    const flat = flattenSystems(systems);
    expect(flat).toHaveLength(0);
  });
});
