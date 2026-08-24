import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { collectJobRelocationTriggers } from '../../citizen/JobRelocation';
import { CommuteCache } from '../../traffic/CommuteCache';
import { ZoneType } from '../../grid/types';
import type { LaneEdge } from '../../traffic/LaneGraph';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import { useSeededRandom } from '../../__tests__/helpers/seededRandom';

/**
 * After a load, the simulation must see a city the same size as the one saved.
 *
 * `warmup` has two jobs: putting a fraction of citizens on the road immediately, and
 * **building route cache entries for the whole commuting population**. Losing the second
 * while optimising the first was measured on a 2,146-citizen save as 1,377 of 1,752 employed
 * citizens with no cache entry at all, predicted traffic falling from 3,504 to 353, average
 * road noise density from 4.70 to 2.74, and all 49 cells in the top band dropping to zero.
 *
 * It cannot recover on its own: once the vehicle cap is reached `spawnCommuteVehicles`
 * breaks immediately and writes no further cache entries — measured over 40 ticks with the
 * pathfinding worker running normally, it stalled at 643 of 1,750.
 *
 * These pin three things: nobody is unknown to the cache after warmup, the background fill
 * completes the routes, and citizens not yet computed are not treated downstream as
 * "computed, and this is the answer".
 */

/**
 * A small liveable city: a grid road network, housing in the north half and commerce in the
 * south.
 *
 * The housing is necessary. With no residential capacity, `updateResidentialCapacity(0)`
 * evicts citizens as the ticks run (measured: 120 down to 62 over 60 ticks), and the
 * coverage measured would be a population curve rather than coverage.
 */
function makeCity(citizenCount: number): GameState {
  const state = createGameState(24, 24);
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      const onRoad = i % 3 === 0 || j % 3 === 0;
      if (!onRoad) continue;
      let flags = 0;
      if (j > 0 && (i % 3 === 0)) flags |= RoadDirection.NORTH;
      if (j < 23 && (i % 3 === 0)) flags |= RoadDirection.SOUTH;
      if (i > 0 && (j % 3 === 0)) flags |= RoadDirection.WEST;
      if (i < 23 && (j % 3 === 0)) flags |= RoadDirection.EAST;
      state.grid.setCell(i, j, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  // Buildings fill the gaps in the road network: small homes in the north (4 residents each)
  // and small shops in the south (4 jobs each).
  const homes: string[] = [];
  const works: string[] = [];
  for (let i = 1; i < 24; i += 3) {
    for (let j = 1; j < 24; j += 3) {
      if (j <= 10) {
        state.grid.setCell(i, j, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
        homes.push(`${i},${j}`);
      } else {
        state.grid.setCell(i, j, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
        works.push(`${i},${j}`);
      }
    }
  }
  // Only 8 origin-destination pairs city-wide. A real city has 842 for 2,146 citizens and
  // takes minutes to fill; what is under test here is that the fill completes, and this city
  // has no public services to survive that long (measured: nobody is still employed after 75
  // ticks), so the pair count is kept low enough for the fill to finish before the decline.
  const PAIRS = 8;
  for (let n = 0; n < citizenCount; n++) {
    const c = state.citizens.createCitizen({ age: 100 });
    if (!c) break;
    c.homeId = homes[n % PAIRS]!;
    c.workplaceId = works[n % PAIRS]!;
  }
  return state;
}

/** A pathfinding worker that is alive and responsive but returns nothing for every pair. */
function createEmptyAnswerWorker(): Worker {
  const listeners: ((e: MessageEvent) => void)[] = [];
  const fake = {
    addEventListener(type: string, h: (e: MessageEvent) => void) {
      if (type === 'message') listeners.push(h);
    },
    removeEventListener() {},
    terminate() {},
    postMessage(msg: { type: string; batchId?: number; requests?: { id: number }[] }) {
      const reply = msg.type === 'INIT_GRAPH'
        ? { type: 'READY' }
        : {
            type: 'BATCH_RESULT', batchId: msg.batchId,
            results: (msg.requests ?? []).map(r => ({ id: r.id, variants: [] as number[][] })),
          };
      for (const l of listeners) l({ data: reply } as MessageEvent);
    },
  };
  return fake as unknown as Worker;
}

function makeLoop(state: GameState): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return loop;
}

function jobHolders(state: GameState) {
  return state.citizens.getCitizens().filter(c => c.homeId && c.workplaceId);
}

/** How many employed citizens have no cache entry at all. */
function unknownCitizens(state: GameState, loop: SimulationLoop): number {
  return jobHolders(state).filter(c => !loop.commuteCache.get(c.id)).length;
}

/** How many employed citizens have a real path in the cache. */
function readyCitizens(state: GameState, loop: SimulationLoop): number {
  return jobHolders(state).filter(c => loop.commuteCache.get(c.id)?.status === 'ready').length;
}

function totalRefCount(loop: SimulationLoop): number {
  let total = 0;
  loop.commuteCache.forEachRouteWithRefCount((_p, ref) => { total += ref; });
  return total;
}

describe('warmup 之後的快取覆蓋率', () => {
  // Coverage is measured against a fixed tick budget, and that budget is pushed around by
  // the dice behind building growth, layoffs and vehicle jitter: across 24 seeds, 2 leave one
  // road-connected citizen short. The tight budget is where these tests get their signal and
  // cannot be relaxed; the sampling noise can be removed instead.
  useSeededRandom();

  it('should leave no commuting citizen unknown to the cache', async () => {
    const state = makeCity(120);
    const loop = makeLoop(state);
    await loop.warmup(0.2);

    expect(jobHolders(state).length, '城市裡沒有通勤人口，這條測試會是空的')
      .toBeGreaterThan(50);
    expect(unknownCitizens(state, loop), '有市民在快取裡查無此人')
      .toBe(0);
  });

  it('should not let a not-computed-yet citizen inflate predicted flow', async () => {
    // "Not known yet" must not count towards traffic, which would overstate it instead.
    const state = makeCity(120);
    const loop = makeLoop(state);
    await loop.warmup(0);

    expect(unknownCitizens(state, loop), '沒有人被標記，這條測試會是空的').toBe(0);
    expect(totalRefCount(loop), '沒算過路徑的人被算進預測車流').toBe(0);
  });

  /**
   * Ticks until the whole commuting population has a path, reporting whether it got there.
   *
   * Both numbers come from **the same moment**: job changes and deaths keep the commuting
   * population moving, so comparing the coverage count against the population at warmup time
   * would measure population change rather than coverage.
   */
  function tickUntilCovered(state: GameState, loop: SimulationLoop, maxTicks: number) {
    let covered = false;
    let lastHolders = jobHolders(state).length;
    for (let t = 0; t < maxTicks && !covered; t++) {
      loop.tick();
      lastHolders = jobHolders(state).length;
      if (readyCitizens(state, loop) >= lastHolders) covered = true;
    }
    return { covered, holders: lastHolders, ready: readyCitizens(state, loop) };
  }

  it('should finish computing every commuter route in the background', async () => {
    // `spawnCommuteVehicles` breaks at the vehicle cap, so spawning cannot finish the fill:
    // measured on a 2,146-citizen save it stalled at 643 of 1,750. The fill needs its own
    // driver.
    const state = makeCity(120);
    const loop = makeLoop(state);
    loop.setPathfindingWorker(createSyncFakeWorker());
    await loop.warmup(0.2);

    expect(readyCitizens(state, loop), '載入時就把所有人都算完了，這條測試會是空的')
      .toBeLessThan(jobHolders(state).length);

    const r = tickUntilCovered(state, loop, 40);
    expect(r.holders, '通勤人口跑光了，覆蓋率就沒有意義').toBeGreaterThan(50);
    expect(r.covered, `背景沒有把剩下的路線補完（${r.ready}／${r.holders}）`).toBe(true);
  });

  it('should not let unroutable citizens starve everyone else', async () => {
    // Citizens with no road connection (a house too far from any road) are retried every
    // tick. If those retries count against the budget, everyone behind them never gets a
    // turn: measured on a 2,146-citizen save, the fill rate fell from 32 routes per tick to
    // 2.
    const state = createGameState(24, 24);
    for (let x = 0; x < 24; x++) {
      let flags = RoadDirection.EAST | RoadDirection.WEST;
      if (x === 0) flags = RoadDirection.EAST;
      if (x === 23) flags = RoadDirection.WEST;
      state.grid.setCell(x, 12, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
    const homes: string[] = [];
    const works: string[] = [];
    for (let x = 1; x <= 8; x++) {
      state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      state.grid.setCell(x, 13, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      homes.push(`${x},11`);
      works.push(`${x},13`);
      // An isolated home 11 tiles from the road, with no access point on the network at all.
      state.grid.setCell(x, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    }

    // The unreachable citizens come first and the ordinary ones after. There have to be
    // enough of them: the per-tick quota is 32, and with fewer the round-robin simply steps
    // past them, hiding the cost of charging failed retries to the quota.
    for (let n = 0; n < 400; n++) {
      const c = state.citizens.createCitizen({ age: 100 })!;
      c.homeId = `${1 + (n % 8)},0`;
      c.workplaceId = works[n % works.length]!;
    }
    const normal: number[] = [];
    for (let n = 0; n < 24; n++) {
      const c = state.citizens.createCitizen({ age: 100 })!;
      c.homeId = homes[n % homes.length]!;
      c.workplaceId = works[n % works.length]!;
      normal.push(c.id);
    }

    const loop = makeLoop(state);
    loop.setPathfindingWorker(createSyncFakeWorker());
    await loop.warmup(0);   // no vehicles spawned, so coverage can only come from the fill
    // 4 ticks: 8 pairs and 16 routes, which a healthy fill queues in two (measured at 2 for
    // every seed). That leaves one tick of slack, while charging failed retries to the quota
    // drops the rate to two per tick and needs eight — the gap this test is looking for.
    //
    // Measuring at tick 12 is too late: this service-less city starts laying citizens off
    // around tick 5, and a laid-off citizen loses their cache entry, so the measurement
    // becomes layoffs rather than coverage and 2 of 24 seeds come up one citizen short.
    for (let t = 0; t < 4; t++) loop.tick();

    const covered = normal.filter(id => loop.commuteCache.get(id)?.status === 'ready').length;
    expect(covered, `接得上路網的人被前面接不上的人卡住（${covered}／${normal.length}）`)
      .toBe(normal.length);
  });

  it('should fill routes when the worker answers but never finds a path', async () => {
    // A worker is not simply present or absent. It can be alive and responding while
    // returning nothing for every pair, and treating it as a dependency leaves the fill
    // queued forever.
    const state = makeCity(120);
    const loop = makeLoop(state);
    loop.setPathfindingWorker(createEmptyAnswerWorker());
    await loop.warmup(0);   // no routes precomputed, so the fill is the only source

    const r = tickUntilCovered(state, loop, 40);
    expect(r.holders, '通勤人口跑光了，覆蓋率就沒有意義').toBeGreaterThan(50);
    expect(r.covered, `worker 交白卷就補不完（${r.ready}／${r.holders}）`).toBe(true);
  });

  it('should fill routes without a pathfinding worker', async () => {
    // Production without COOP/COEP has no SharedArrayBuffer and therefore no worker
    // (`Game.ts` swallows the construction failure silently). This loop never has one
    // installed, and the fill must still complete.
    const state = makeCity(120);
    const loop = makeLoop(state);
    await loop.warmup(0.2);

    const r = tickUntilCovered(state, loop, 40);
    expect(r.holders, '通勤人口跑光了，覆蓋率就沒有意義').toBeGreaterThan(50);
    expect(r.covered, `沒有 worker 就補不完（${r.ready}／${r.holders}）`).toBe(true);
  });
});

describe('下游怎麼看待「還沒算」的市民', () => {
  const CONFIG = { manhattanFallback: 15, happinessThreshold: 35 };

  function relocationPool(route: { status: 'pending' | 'ready'; morningPath: LaneEdge[] | null } | null) {
    const state = createGameState(24, 24);
    const c = state.citizens.createCitizen({ age: 100 })!;
    c.homeId = '1,1';
    c.workplaceId = '20,20';   // Manhattan distance 38, well past the threshold of 15
    c.happiness = 80;          // unhappiness is not the trigger under test here

    const cache = new CommuteCache();
    if (route) {
      cache.set(c.id, {
        citizenId: c.id, homeId: c.homeId, workplaceId: c.workplaceId,
        morningPath: route.morningPath, eveningPath: null,
        status: route.status, generation: cache.roadGeneration,
      });
    }
    const candidates = [
      { pos: '20,20', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },
      { pos: '2,2', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },
    ];
    const { urgent, nonUrgent } = collectJobRelocationTriggers(
      [c], candidates, cache, CONFIG);
    return urgent.length + nonUrgent.length;
  }

  it('should judge a citizen the same way whether or not the route is computed', () => {
    // Job changes depend on how long the commute takes, not on whether the system has
    // computed that route yet.
    //
    // Routing the two through different rules — Manhattan distance with no cache entry,
    // path length with one — means that filling the cache at load time switches everyone to
    // the other rule, whose threshold never holds, and the whole mechanism stops silently
    // (see JobRelocationTrigger.test.ts).
    expect(relocationPool(null), '查無此人卻沒有進換工作名單').toBe(1);
    expect(relocationPool({ status: 'pending', morningPath: null }), '還沒算好就被放過')
      .toBe(1);
  });
});
