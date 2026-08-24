import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ZoneType } from '../../grid/types';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';

/**
 * "This commute has no path" must be remembered, and recorded once.
 *
 * `advanceCommuteFill` has two routes: ask the worker first, and compute locally once
 * `COMMUTE_FILL_MAX_ATTEMPTS` queued attempts have produced nothing. That counter guards
 * against a worker returning nothing — but a worker returning an empty array because there
 * genuinely is no path goes through the same counter, and dropping the empty result in
 * `onResult` makes "already known to have no path" and "not known yet" indistinguishable
 * here.
 *
 * The consequence is that every time the cursor comes round, that route is recomputed on the
 * main thread for the same answer. Measured on a 41k-citizen save: 3,362 such routes, 9,838
 * synchronous A* runs, **0 successes** after the quota was spent, and `advanceCommuteFill`
 * taking 9.9% of the main thread (BUG-369).
 *
 * The fixture is two **disconnected** corridors: both ends have connection points (so the
 * request can be sent) with no road between them (so A* is guaranteed to find nothing).
 */

const CORRIDOR_A_Y = 2;
const CORRIDOR_B_Y = 20;

/** The routable citizen's home, the stranded one's home, and both workplaces. */
const HOME_OK = '4,4';
const WORK_OK = '9,4';
const HOME_STRANDED = '6,4';
const WORK_STRANDED = '5,18';

const OK_ROUTE = `${HOME_OK}->${WORK_OK}`;
const MORNING = `${HOME_STRANDED}->${WORK_STRANDED}`;
const EVENING = `${WORK_STRANDED}->${HOME_STRANDED}`;

function twoIslands(): GameState {
  const state = createGameState(24, 24);
  for (const y of [CORRIDOR_A_Y, CORRIDOR_B_Y]) {
    for (let x = 2; x <= 10; x++) {
      let flags = RoadDirection.EAST | RoadDirection.WEST;
      if (x === 2) flags = RoadDirection.EAST;
      if (x === 10) flags = RoadDirection.WEST;
      state.grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  for (const key of [HOME_OK, HOME_STRANDED]) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    state.grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  for (const key of [WORK_OK, WORK_STRANDED]) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    state.grid.setCell(x, y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  }
  return state;
}

/**
 * `commuteFillAttempts` is incremented in exactly two places: queueing once with the worker,
 * and computing once on the main thread. It is therefore the total effort spent on a route,
 * which is what the wasted retries show up in.
 */
type Inner = {
  commuteFillAttempts: Map<string, number>;
  advanceCommuteFill(): void;
};

interface Fixture {
  loop: SimulationLoop;
  inner: Inner;
  stranded: number;
}

/**
 * @param worker whether to install a worker. Without one, `advanceCommuteFill` takes the
 *   synchronous route.
 *
 * One `tick()` first builds the lane graph and the worker's mapping, after which **only
 * `advanceCommuteFill` is called**: full ticks would let migration and `runJobRelocation`
 * move citizens' homes and jobs, which is exactly what is under observation.
 */
function makeCity(opts: { worker: boolean }): Fixture {
  const state = twoIslands();
  const pair = (home: string, work: string): number => {
    // Below working age, `advanceCommuteFill` skips the citizen outright.
    const c = state.citizens.createCitizen({ age: 100 });
    if (!c) throw new Error('測資沒建出市民 —— 住宅容量不夠');
    c.homeId = home;
    c.workplaceId = work;
    return c.id;
  };
  pair(HOME_OK, WORK_OK);
  const stranded = pair(HOME_STRANDED, WORK_STRANDED);

  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  if (opts.worker) loop.setPathfindingWorker(createSyncFakeWorker());
  loop.tick();

  // That tick may have moved the citizen or changed their job. Pin them back to the pair the
  // fixture is asking about.
  const c = state.citizens.getCitizens().find(x => x.id === stranded);
  if (!c) throw new Error('測資的市民在第一個 tick 就不見了');
  c.homeId = HOME_STRANDED;
  c.workplaceId = WORK_STRANDED;
  return { loop, inner: loop as unknown as Inner, stranded };
}

describe('走不通的通勤只算一次', () => {
  it('should route the commute that does have a road', () => {
    // A precondition: if this route cannot be computed, every test below passes for the wrong
    // reason.
    const { loop, inner } = makeCity({ worker: true });
    inner.advanceCommuteFill();

    expect(loop.commuteCache.getRouteVariants(OK_ROUTE), '同一條路廊上的通勤也算不出來 —— 測資壞了')
      .toBeTruthy();
    expect(loop.commuteCache.isUnroutable(OK_ROUTE)).toBe(false);
  });

  it('should remember the worker saying there is no path', () => {
    const { loop, inner } = makeCity({ worker: true });
    inner.advanceCommuteFill();

    expect(loop.commuteCache.isUnroutable(MORNING), 'worker 交回「沒有路」，沒有人記下來').toBe(true);
    expect(loop.commuteCache.isUnroutable(EVENING)).toBe(true);
  });

  it('should stop spending effort once it knows there is no path', () => {
    // The point of the whole thing. A counter that keeps rising means the cursor re-asks the
    // same question on every pass, and past the worker's quota that effort all goes into
    // synchronous A* on the main thread.
    const { inner } = makeCity({ worker: true });
    for (let t = 0; t < 40; t++) inner.advanceCommuteFill();

    expect(inner.commuteFillAttempts.get(MORNING) ?? 0, '知道沒有路之後還在重問').toBeLessThanOrEqual(1);
    expect(inner.commuteFillAttempts.get(EVENING) ?? 0, '知道沒有路之後還在重問').toBeLessThanOrEqual(1);
  });

  it('should mark the citizen failed so job relocation can pick them up', () => {
    // Only a `failed` mark counts as settled, so the cursor need not examine them again next
    // pass, and it is the signal `runJobRelocation` uses to find citizens who should change
    // jobs.
    const { loop, inner, stranded } = makeCity({ worker: true });
    inner.advanceCommuteFill();

    expect(loop.commuteCache.get(stranded)?.status, '兩個方向都確定沒有路，卻沒有結案')
      .toBe('failed');
  });

  it('should still work with no pathfinding worker at all', () => {
    // The worker is an accelerator, not a dependency. Without one, the local route must reach
    // the same conclusion, and reach it once.
    const { loop, inner, stranded } = makeCity({ worker: false });
    for (let t = 0; t < 40; t++) inner.advanceCommuteFill();

    expect(loop.commuteCache.getRouteVariants(OK_ROUTE), '沒有 worker 就連走得通的都算不出來')
      .toBeTruthy();
    expect(loop.commuteCache.isUnroutable(MORNING)).toBe(true);
    expect(loop.commuteCache.get(stranded)?.status).toBe('failed');
    expect(inner.commuteFillAttempts.get(MORNING) ?? 0, '沒有 worker 的時候自己算了不只一次')
      .toBeLessThanOrEqual(1);
  });

  it('should not call it failed just because the search budget ran out', () => {
    // "No answer yet" is not "no path". Marking failed closes the case: that citizen is never
    // computed again in this road generation, while nobody has actually searched their
    // evening route.
    //
    // Constructed by dropping the route pool (equivalent to a road edit just now), which lets
    // the citizen ahead consume both synchronous search slots for this pass. The stranded
    // citizen then has null in both directions, but only the morning route is **known** to
    // have no path.
    const { loop, inner, stranded } = makeCity({ worker: false });
    loop.commuteCache.bumpGeneration();
    loop.commuteCache.markUnroutable(MORNING);

    inner.advanceCommuteFill();

    expect(loop.commuteCache.isUnroutable(EVENING), '前置條件:晚上那條要還沒問過').toBe(false);
    expect(loop.commuteCache.get(stranded)?.status, '只有一個方向確定沒有路就結案了')
      .not.toBe('failed');
  });

  it('should ask again after the road network changes', () => {
    // A newly built road may connect them. Without forgetting, that citizen never commutes
    // again.
    const { loop, inner } = makeCity({ worker: true });
    inner.advanceCommuteFill();
    expect(loop.commuteCache.isUnroutable(MORNING), '前置條件:要先記起來').toBe(true);

    loop.markLaneGraphDirty([`5,${CORRIDOR_A_Y}`]);

    expect(loop.commuteCache.isUnroutable(MORNING), '路網變了還記著舊答案').toBe(false);
  });
});
