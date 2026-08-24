import { describe, it, expect } from 'vitest';
import { CongestionFlowSweep } from '../CongestionFlowSweep';
import { computeCongestionFlow } from '../CongestionFlowPredictor';
import { CommuteCache } from '../CommuteCache';
import { PathCellCache } from '../PathCellCache';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';

/**
 * The congestion flow field is recomputed every 60 ticks. Even with "which cells a path passes
 * through" cached it takes 60ms, all in a single tick, against 250ms available per tick at
 * speed 1 with rendering competing for the same thread (BUG-327).
 *
 * There is no reason to do it in one go: the result is only replaced every 60 ticks anyway.
 * What matters about sweeping is that **nobody may read a half-built table** — a half-built
 * table claims those roads carry traffic and everything else is empty, which is worse than
 * stale data. So it accumulates on a separate sheet and is swapped in whole.
 */

/** A route along +x through `cells`, taken by `riders` citizens. */
function addRoute(cache: CommuteCache, cells: string[], riders: number, idBase: number): void {
  const path = cells.slice(0, -1).map((from, i) => makeCellEdge(from, cells[i + 1]!, 0, { length: 1 }));
  const key = `${cells[0]}->${cells[cells.length - 1]}`;
  cache.setRouteVariants(key, [path]);
  for (let i = 0; i < riders; i++) {
    cache.set(idBase + i, {
      citizenId: idBase + i, homeId: cells[0]!, workplaceId: cells[cells.length - 1]!,
      morningPath: path, eveningPath: null, status: 'ready', generation: 0,
    });
  }
}

function populated(): CommuteCache {
  const cache = new CommuteCache();
  addRoute(cache, ['0,0', '1,0', '2,0', '3,0'], 12, 100);
  addRoute(cache, ['0,1', '1,1', '2,1'], 5, 200);
  addRoute(cache, ['2,0', '2,1', '2,2'], 30, 300);
  addRoute(cache, ['4,4', '5,4'], 1, 400);
  return cache;
}

const lanes = () => 1;
const entries = (m: Map<string, number>) => [...m.entries()].sort();

/** Computed in one go, as the control. */
function atomic(cache: CommuteCache): Map<string, number> {
  return computeCongestionFlow(cache, new PathCellCache(), lanes).flowMap;
}

/** Sweeps `perTick` routes at a time until it completes, returning the result and the tick
 *  count. */
function spread(cache: CommuteCache, perTick: number, maxTicks = 500):
{ flowMap: Map<string, number>; ticks: number; partials: number } {
  const sweep = new CongestionFlowSweep();
  const cells = new PathCellCache();
  sweep.begin(cache);
  let partials = 0;
  for (let t = 1; t <= maxTicks; t++) {
    const done = sweep.step(cache, cells, perTick, lanes);
    if (done) return { flowMap: done.flowMap, ticks: t, partials };
    partials++;
  }
  throw new Error('掃不完');
}

describe('分次掃出壅塞流量圖', () => {
  it('should end up with exactly what computing it in one go gives', () => {
    const cache = populated();
    for (const perTick of [1, 2, 3, 100]) {
      expect(entries(spread(cache, perTick).flowMap), `一次掃 ${perTick} 條的結果不一樣`)
        .toEqual(entries(atomic(cache)));
    }
  });

  it('should hand back nothing at all until the last route is in', () => {
    // A half-built table claims only those roads carry anyone. Fed to mode choice, that is
    // worse than the previous sweep's data.
    const cache = populated();
    const sweep = new CongestionFlowSweep();
    const cells = new PathCellCache();
    sweep.begin(cache);
    expect(sweep.step(cache, cells, 1, lanes), '第一個 tick 就交出半張表').toBeNull();
    expect(sweep.step(cache, cells, 1, lanes), '第二個 tick 就交出半張表').toBeNull();
  });

  it('should take one tick per batch, not one per route', () => {
    // The whole point of sweeping. Processing one route at a time but finishing within one
    // tick is no sweep at all.
    const cache = populated();
    expect(spread(cache, 1).ticks, '一次掃一條應該要用掉四個 tick').toBe(4);
    expect(spread(cache, 2).ticks).toBe(2);
    expect(spread(cache, 100).ticks, '一批掃得完就該一個 tick 交件').toBe(1);
  });

  it('should skip a route that disappeared while it was sweeping', () => {
    // The key list is taken when the sweep starts. Job changes and demolished roads both make
    // routes vanish mid-sweep.
    const cache = populated();
    const sweep = new CongestionFlowSweep();
    const cells = new PathCellCache();
    sweep.begin(cache);
    sweep.step(cache, cells, 1, lanes);
    cache.invalidateCell('2,0');   // mid-sweep, every route through 2,0 is invalidated

    let out = null;
    for (let t = 0; t < 50 && !out; t++) out = sweep.step(cache, cells, 1, lanes);
    expect(out, '路線消失之後掃不完了').not.toBeNull();
    expect(out!.flowMap.has('9,9'), '掃出了不存在的格子').toBe(false);
  });

  it('should throw the sweep away when the road network changed under it', () => {
    // A road change clears routeIndex entirely. A table stitched from old and new data is
    // false, and keeping the previous sweep's table another 60 ticks is preferable.
    const cache = populated();
    const sweep = new CongestionFlowSweep();
    const cells = new PathCellCache();
    sweep.begin(cache);
    sweep.step(cache, cells, 1, lanes);
    cache.bumpGeneration();

    for (let t = 0; t < 50; t++) {
      expect(sweep.step(cache, cells, 1, lanes), '路網變了還把這一輪交出去').toBeNull();
    }
    expect(sweep.inProgress, '路網變了卻還在掃').toBe(false);
  });

  it('should say it is idle before anyone starts it', () => {
    const sweep = new CongestionFlowSweep();
    expect(sweep.inProgress).toBe(false);
    expect(sweep.step(populated(), new PathCellCache(), 10, lanes), '沒開始就交件').toBeNull();
  });

  it('should divide flow by the lane count once, at the end', () => {
    // Two routes share `2,0` and one route is swept per batch, so that cell receives a
    // contribution in two different batches. Dividing per batch would divide the first
    // contribution twice. A single-route case cannot show this.
    const cache = new CommuteCache();
    addRoute(cache, ['1,0', '2,0'], 8, 100);
    addRoute(cache, ['2,0', '3,0'], 8, 200);

    const oneLane = spread(cache, 1);
    expect(oneLane.ticks, '前置條件:兩條路線要落在不同批次').toBe(2);

    const sweep = new CongestionFlowSweep();
    const cells = new PathCellCache();
    sweep.begin(cache);
    let out = null;
    for (let t = 0; t < 50 && !out; t++) out = sweep.step(cache, cells, 1, () => 4);
    expect(out!.flowMap.get('2,0')!, '共用的那一格被除了不只一次車道數')
      .toBeCloseTo(oneLane.flowMap.get('2,0')! / 4, 10);
  });

  it('should ignore a route that appeared after it started', () => {
    // The key list is taken when the sweep starts. Retaking it per batch would point the
    // cursor at a different list each time, skipping some routes and counting others twice,
    // and a static city would show nothing.
    const cache = populated();
    const sweep = new CongestionFlowSweep();
    const cells = new PathCellCache();
    sweep.begin(cache);
    sweep.step(cache, cells, 1, lanes);

    addRoute(cache, ['8,8', '9,8'], 7, 900);   // appears after the sweep started
    let out = null;
    for (let t = 0; t < 50 && !out; t++) out = sweep.step(cache, cells, 1, lanes);

    expect(out, '掃不完了').not.toBeNull();
    expect(out!.flowMap.has('8,8'), '把開掃之後才出現的路線也算了進去').toBe(false);
    expect(out!.flowMap.has('9,8')).toBe(false);
  });
});
