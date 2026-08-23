import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../types';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ZONE_ROAD_REACH } from '../../grid/constants';
import {
  buildRoadCellGraph, floodRoadCellGraph, seedNodesFor, attachAtSettledNode, levelOfKey,
} from '../RoadCellGraph';

const EW = RoadDirection.EAST | RoadDirection.WEST;
const NS = RoadDirection.NORTH | RoadDirection.SOUTH;
const W = 12, H = 6;

/** 見 RoadCellGraph.test.ts 的說明。拓撲細節不寫進斷言。 */
function testCity() {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < W; x++) cells.set(`${x},1`, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  for (let x = 2; x <= 8; x++) cells.set(`${x},3`, { roadType: RoadType.RURAL, roadFlags: EW });
  cells.set('2,2', { roadType: RoadType.RURAL, roadFlags: NS });

  const grid = {
    width: W, height: H,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fn(this.getCell(x, y)!, x, y);
    },
  };

  const em = new ElevationManager();
  for (let x = 4; x <= 9; x++) {
    em.set(x, 1, 1, {
      roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0,
      isRamp: x === 4 || x === 9,
      rampAscendDirection: x === 4 ? RoadDirection.EAST : RoadDirection.WEST,
    });
  }
  return { grid, lookup: new UnifiedRoadLookup(grid, em) };
}

const BIG = 1_000_000;

describe('seedNodesFor', () => {
  it('should return exactly the road nodes within Chebyshev reach, at every level', () => {
    // 期望值暴力算：掃全部節點，看誰在範圍內。不手算座標。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    for (const [cx, cy] of [[6, 0], [2, 4], [0, 5], [11, 5]] as const) {
      const expected = new Set<string>();
      for (let i = 0; i < g.nodeKeys.length; i++) {
        if (Math.max(Math.abs(g.nodeX[i]! - cx), Math.abs(g.nodeY[i]! - cy)) <= ZONE_ROAD_REACH) {
          expected.add(g.nodeKeys[i]!);
        }
      }
      const actual = new Set(seedNodesFor(g, cx, cy, ZONE_ROAD_REACH).map(i => g.nodeKeys[i]!));
      expect(actual, `(${cx},${cy}) 的種子集合不對`).toEqual(expected);
    }
  });

  it('fixture sanity: at least one probe really picks up an elevated cell', () => {
    // 否則「涵蓋所有樓層」是空轉的 —— 完全不處理高架的實作也會通過。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const keys = seedNodesFor(g, 6, 0, ZONE_ROAD_REACH).map(i => g.nodeKeys[i]!);
    expect(keys.some(k => levelOfKey(k) > 0), '探點旁邊沒有高架，高架等於沒測').toBe(true);
  });
});

describe('attachAtSettledNode', () => {
  /**
   * 跑一次 flood，並在 settle 當下附掛。
   *
   * `attachAtSettledNode` 收在密集陣列裡（見它的說明），這裡攤回 `Map` 只是為了
   * 讓下面的斷言講「(x,y) 收到多少」而不是講索引算術。**回傳的 `added` 總數獨立
   * 於攤平**，所以「有沒有真的收到」不是靠這層轉換推出來的。
   */
  function floodAndAttach(startKey: string, accept: (x: number, y: number) => boolean) {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const dense = new Int32Array(W * H).fill(-1);
    let added = 0;
    const cost = floodRoadCellGraph(g, [g.indexOf.get(startKey)!], BIG, (node, c) => {
      added += attachAtSettledNode(g, node, c, ZONE_ROAD_REACH, W, H, accept, dense);
      return false;
    });
    const out = new Map<string, number>();
    for (let i = 0; i < dense.length; i++) {
      if (dense[i]! >= 0) out.set(`${i % W},${Math.floor(i / W)}`, dense[i]!);
    }
    return { g, out, cost, added };
  }

  it('should report how many cells it newly collected', () => {
    // 呼叫端拿這個數字做「找齊目標就早退」的計數。恆回 0 的話同步查詢會永遠
    // 跑滿預算，而且沒有別的斷言看得出來。
    const { out, added } = floodAndAttach('0,1', () => true);

    expect(added).toBe(out.size);
    expect(added).toBeGreaterThan(0);
  });

  it('should not count a cell twice when a cheaper road settles later', () => {
    // 只記第一次 —— 重複計數會讓早退提前觸發，查詢在找齊之前就停。
    const { g, added } = floodAndAttach('0,1', () => true);
    let distinct = 0;
    const seen = new Set<string>();
    for (let x = -ZONE_ROAD_REACH; x < W + ZONE_ROAD_REACH; x++) {
      for (let y = -ZONE_ROAD_REACH; y < H + ZONE_ROAD_REACH; y++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        for (let i = 0; i < g.nodeKeys.length; i++) {
          if (Math.max(Math.abs(g.nodeX[i]! - x), Math.abs(g.nodeY[i]! - y)) <= ZONE_ROAD_REACH
            && !seen.has(`${x},${y}`)) { seen.add(`${x},${y}`); distinct++; }
        }
      }
    }
    expect(added, '同一格被算了不只一次').toBe(distinct);
  });

  it('should stay inside the grid', () => {
    // 密集陣列要求上界也要擋。舊版只擋負數，靠 `accept` 拒絕界外 —— 寫進陣列
    // 就不能這樣賭了，越界會安靜地寫壞別人的格子。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const dense = new Int32Array(W * H).fill(-1);
    const corner = g.indexOf.get(`${W - 1},1`)!;

    expect(() => attachAtSettledNode(g, corner, 0, ZONE_ROAD_REACH, W, H, () => true, dense))
      .not.toThrow();
    for (let i = 0; i < dense.length; i++) {
      const x = i % W, y = Math.floor(i / W);
      if (dense[i]! < 0) continue;
      expect(Math.max(Math.abs(x - (W - 1)), Math.abs(y - 1)),
        `(${x},${y}) 不在 reach 內卻被寫到了`).toBeLessThanOrEqual(ZONE_ROAD_REACH);
    }
  });

  /**
   * 獨立參考：一個格子應該拿到的成本 = reach 內所有**到得了的**路格中最便宜的。
   * 暴力掃全圖，不依賴 settle 順序，也不依賴 attachAtSettledNode 的邏輯。
   */
  function cheapestNearby(
    g: ReturnType<typeof buildRoadCellGraph>, cost: Int32Array, x: number, y: number,
  ): number | undefined {
    let best: number | undefined;
    for (let i = 0; i < g.nodeKeys.length; i++) {
      if (cost[i]! < 0) continue;
      if (Math.max(Math.abs(g.nodeX[i]! - x), Math.abs(g.nodeY[i]! - y)) > ZONE_ROAD_REACH) continue;
      if (best === undefined || cost[i]! < best) best = cost[i]!;
    }
    return best;
  }

  it('should give every accepted cell its cheapest reachable road cost', () => {
    // 全域比對。「(5,5) 應該掛在 (5,3) 上」這種手算的期望值連錯兩次，
    // 所以這裡對**每一個**格子比對暴力算出來的最小值。
    const { g, out, cost } = floodAndAttach('0,1', () => true);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const expected = cheapestNearby(g, cost, x, y);
        expect(out.get(`${x},${y}`), `(${x},${y}) 的附掛成本不是最便宜的`).toBe(expected);
      }
    }
  });

  it('fixture sanity: some cell is genuinely contested by roads of different cost', () => {
    // 若每個格子在 reach 內都只有一個路格，「取最便宜」就是空轉的。
    const { g, cost } = floodAndAttach('0,1', () => true);
    let contested = 0;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const costs = new Set<number>();
        for (let i = 0; i < g.nodeKeys.length; i++) {
          if (cost[i]! < 0) continue;
          if (Math.max(Math.abs(g.nodeX[i]! - x), Math.abs(g.nodeY[i]! - y)) <= ZONE_ROAD_REACH) {
            costs.add(cost[i]!);
          }
        }
        if (costs.size > 1) contested++;
      }
    }
    expect(contested, '沒有任何格子被多個不同成本的路格競爭，最小值邏輯沒被測到')
      .toBeGreaterThan(0);
  });

  it('should cover road cells too, not just buildings', () => {
    // 舊實作有一段「道路格本身也可能是目標」。dx/dy 包含 (0,0) 就涵蓋了，
    // 但那是實作細節 —— 這一條把「路格也會被收」釘成契約。
    //
    // **只斷言有被收，不斷言收到自己的成本。** 附掛取的是 reach 內最便宜的
    // 路格，而一個路格的鄰居可能更便宜。實際成本由上面那條全域比對負責。
    const { g, out, cost } = floodAndAttach('0,1', () => true);
    let checked = 0;
    for (let i = 0; i < g.nodeKeys.length; i++) {
      if (cost[i]! < 0 || levelOfKey(g.nodeKeys[i]!) !== 0) continue;
      const key = `${g.nodeX[i]},${g.nodeY[i]}`;
      expect(out.has(key), `道路格 ${key} 沒有被收`).toBe(true);
      checked++;
    }
    expect(checked, '一個地面路格都沒檢查到').toBeGreaterThan(5);
  });

  it('fixture sanity: some road cell is cheaper via a neighbour than on its own', () => {
    // 這一條把上面那段註解釘成可驗證的事實。第 3 版曾經斷言「路格會收到自己
    // 的成本」，那會讓正確實作紅燈 —— 這裡的計數就是反證。
    const { g, out, cost } = floodAndAttach('0,1', () => true);
    let cheaperViaNeighbour = 0;
    for (let i = 0; i < g.nodeKeys.length; i++) {
      if (cost[i]! < 0 || levelOfKey(g.nodeKeys[i]!) !== 0) continue;
      const key = `${g.nodeX[i]},${g.nodeY[i]}`;
      if (out.get(key)! < cost[i]!) cheaperViaNeighbour++;
    }
    expect(cheaperViaNeighbour, '沒有任何路格靠鄰居拿到更便宜的成本')
      .toBeGreaterThan(0);
  });

  it('should ignore cells the accept predicate rejects', () => {
    expect(floodAndAttach('0,1', () => false).out.size).toBe(0);
  });
});
