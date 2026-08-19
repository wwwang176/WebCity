import { describe, it, expect } from 'vitest';
import { CongestionFlowSweep } from '../CongestionFlowSweep';
import { computeCongestionFlow } from '../CongestionFlowPredictor';
import { CommuteCache } from '../CommuteCache';
import { PathCellCache } from '../PathCellCache';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';

/**
 * 壅塞流量圖每 60 tick 重算一次。快取「路徑經過哪些格子」之後仍然要 60ms，全部落在
 * 單一個 tick 上 —— 速度 1 的一個 tick 只有 250ms，而算繪跟它搶同一個執行緒
 * （BUG-327）。
 *
 * 這件事沒有理由一次做完:結果本來就每 60 tick 才換一次。分次掃的重點是**不能讓
 * 別人讀到做到一半的表** —— 半張表代表「這些路上有人，其他路都是空的」，那比舊資料
 * 還糟。所以做在另一張紙上，掃完才整張換掉。
 */

/** 一條沿 +x、經過 `cells` 的路線，被 `riders` 個人走。 */
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

/** 一次掃完，當作對照組。 */
function atomic(cache: CommuteCache): Map<string, number> {
  return computeCongestionFlow(cache, new PathCellCache(), lanes).flowMap;
}

/** 每次只掃 `perTick` 條，直到掃完為止。回傳 (結果, 用掉幾個 tick)。 */
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
    // 半張表說的是「只有這幾條路上有人，其他都空的」—— 拿去做運具選擇，
    // 比用上一輪的舊資料還糟。
    const cache = populated();
    const sweep = new CongestionFlowSweep();
    const cells = new PathCellCache();
    sweep.begin(cache);
    expect(sweep.step(cache, cells, 1, lanes), '第一個 tick 就交出半張表').toBeNull();
    expect(sweep.step(cache, cells, 1, lanes), '第二個 tick 就交出半張表').toBeNull();
  });

  it('should take one tick per batch, not one per route', () => {
    // 分次的意義就在這裡。一次掃一條卻在同一個 tick 裡跑完的話，等於沒分。
    const cache = populated();
    expect(spread(cache, 1).ticks, '一次掃一條應該要用掉四個 tick').toBe(4);
    expect(spread(cache, 2).ticks).toBe(2);
    expect(spread(cache, 100).ticks, '一批掃得完就該一個 tick 交件').toBe(1);
  });

  it('should skip a route that disappeared while it was sweeping', () => {
    // 名單是開掃時拍下來的。市民換工作、路被拆掉，路線都會在掃到一半時消失。
    const cache = populated();
    const sweep = new CongestionFlowSweep();
    const cells = new PathCellCache();
    sweep.begin(cache);
    sweep.step(cache, cells, 1, lanes);
    cache.invalidateCell('2,0');   // 掃到一半，經過 2,0 的路線全部作廢

    let out = null;
    for (let t = 0; t < 50 && !out; t++) out = sweep.step(cache, cells, 1, lanes);
    expect(out, '路線消失之後掃不完了').not.toBeNull();
    expect(out!.flowMap.has('9,9'), '掃出了不存在的格子').toBe(false);
  });

  it('should throw the sweep away when the road network changed under it', () => {
    // 路網一改，routeIndex 整個被清掉。半舊半新拼出來的表是假的 ——
    // 寧可讓上一輪的舊表多留 60 個 tick。
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
    // 兩條路線共用 `2,0`，一次只掃一條 —— 所以那一格會在兩個不同的批次各拿到一份。
    // 每批各除一次的話，第一批那一份會被除兩次。單一條路線的案例看不出這件事。
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
    // 名單是開掃時拍下來的。每批重新拍一次的話，游標會對到不同的名單上 ——
    // 有的路線被跳過、有的被算兩次，而且靜態的城市完全看不出來。
    const cache = populated();
    const sweep = new CongestionFlowSweep();
    const cells = new PathCellCache();
    sweep.begin(cache);
    sweep.step(cache, cells, 1, lanes);

    addRoute(cache, ['8,8', '9,8'], 7, 900);   // 開掃之後才出現
    let out = null;
    for (let t = 0; t < 50 && !out; t++) out = sweep.step(cache, cells, 1, lanes);

    expect(out, '掃不完了').not.toBeNull();
    expect(out!.flowMap.has('8,8'), '把開掃之後才出現的路線也算了進去').toBe(false);
    expect(out!.flowMap.has('9,8')).toBe(false);
  });
});
