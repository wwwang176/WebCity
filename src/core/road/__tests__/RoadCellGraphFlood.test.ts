import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../types';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { buildRoadCellGraph, floodRoadCellGraph, type RoadCellGraph } from '../RoadCellGraph';

const EW = RoadDirection.EAST | RoadDirection.WEST;
const NS = RoadDirection.NORTH | RoadDirection.SOUTH;

/** 見 RoadCellGraph.test.ts 的說明。拓撲細節不寫進斷言。 */
function testCity() {
  const w = 12, h = 6;
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < w; x++) cells.set(`${x},1`, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  for (let x = 2; x <= 8; x++) cells.set(`${x},3`, { roadType: RoadType.RURAL, roadFlags: EW });
  cells.set('2,2', { roadType: RoadType.RURAL, roadFlags: NS });

  const grid = {
    width: w, height: h,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(this.getCell(x, y)!, x, y);
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

/**
 * 獨立的參考實作：Bellman-Ford。
 *
 * 期望值不手算 —— 用一個**演算法完全不同**的最短路徑實作對照。Bellman-Ford
 * 不用堆、不靠 settle 順序、不做提早結束，所以 Dijkstra 那邊任何關於順序、
 * stale 判斷、relax 條件的錯誤，它都不會一起犯。
 */
function bellmanFord(g: RoadCellGraph, seeds: readonly number[], maxBudget: number): Int32Array {
  const n = g.nodeKeys.length;
  const dist = new Int32Array(n).fill(-1);
  for (const s of seeds) if (s >= 0 && s < n) dist[s] = 0;

  for (let round = 0; round < n; round++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (dist[i]! < 0) continue;
      for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
        const j = g.targets[k]!;
        const nc = dist[i]! + g.weights[k]!;
        if (nc > maxBudget) continue;
        if (dist[j]! < 0 || nc < dist[j]!) { dist[j] = nc; changed = true; }
      }
    }
    if (!changed) break;
  }
  return dist;
}

const BIG = 1_000_000;

/**
 * 手工 CSR 圖，**入邊權重不同**。
 *
 * 為什麼需要它：路網圖的成本加在**目的地**那一格，所以進入節點 j 的每一條邊
 * 權重都相同，於是 `dist[j] = w_j + min(已 settle 的前驅)`。Dijkstra 依成本
 * 遞增 settle，第一個 settle 的前驅就是最小的那個 —— **第一次 relax 就已經
 * 最佳**。結果是「重新 relax 成更便宜的值」與「過期堆項」這兩條分支在路網圖
 * 上永遠走不到，用 testCity 去驗它們是空轉的。
 *
 * 這張圖讓那兩條分支真的被執行：
 *
 *   S ──1──▶ A ──100──▶ T
 *   └──10──▶ B ───1───▶ T
 *
 * settle S(0) → relax A=1, B=10；settle A(1) → relax T=101；
 * settle B(10) → **T 改寫成 11**，而堆裡那個 101 變成過期項。
 *
 * `floodRoadCellGraph` 是通用的加權圖 Dijkstra，契約本來就該對任何圖成立 ——
 * 而且哪天成本模型加上轉彎懲罰，入邊權重就不再一致了。
 */
function skewedGraph(): RoadCellGraph {
  const nodeKeys = ['S', 'A', 'B', 'T'];
  const indexOf = new Map(nodeKeys.map((k, i) => [k, i]));
  return {
    nodeKeys, indexOf,
    //        S:0..2   A:2..3   B:3..4   T:4..4
    offsets: Uint32Array.from([0, 2, 3, 4, 4]),
    targets: Uint32Array.from([1, 2, 3, 3]),   // S→A, S→B, A→T, B→T
    weights: Uint16Array.from([1, 10, 100, 1]),
    nodeX: Uint16Array.from([0, 1, 2, 3]),
    nodeY: new Uint16Array(4),
    nodeLevel: new Uint8Array(4),
  };
}

describe('floodRoadCellGraph on a graph with uneven incoming weights', () => {
  it('should improve a node when a cheaper route settles later', () => {
    const g = skewedGraph();
    const cost = floodRoadCellGraph(g, [0], BIG);
    expect([...cost], 'S/A/B/T 的最短成本').toEqual([0, 1, 10, 11]);
    expect([...cost]).toEqual([...bellmanFord(g, [0], BIG)]);
  });

  it('should settle each node exactly once despite the stale heap entry', () => {
    // T 先以 101 入堆、再以 11 入堆。少了過期過濾，T 會被 settle 兩次。
    const g = skewedGraph();
    const settled: number[] = [];
    floodRoadCellGraph(g, [0], BIG, (n) => { settled.push(n); return false; });
    expect(new Set(settled).size, '有節點被 settle 了兩次').toBe(settled.length);
    expect(settled.length).toBe(4);
  });

  it('fixture sanity: this graph really has uneven incoming weights', () => {
    // 若入邊權重一致，上面兩條就退化成空轉 —— 那正是 testCity 的情況。
    const g = skewedGraph();
    const intoT = new Set<number>();
    for (let i = 0; i < g.nodeKeys.length; i++) {
      for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
        if (g.targets[k] === 3) intoT.add(g.weights[k]!);
      }
    }
    expect(intoT.size, 'T 的入邊權重全部相同，測不出重新 relax').toBeGreaterThan(1);
  });
});

describe('floodRoadCellGraph', () => {
  it('should match an independent shortest-path implementation, node for node', () => {
    // 這是整個 flood 核心的主測試。全圖、每一個種子、精確相等。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    for (let seed = 0; seed < g.nodeKeys.length; seed++) {
      const mine = floodRoadCellGraph(g, [seed], BIG);
      const ref = bellmanFord(g, [seed], BIG);
      expect([...mine], `種子 ${g.nodeKeys[seed]} 的結果與參考實作不符`)
        .toEqual([...ref]);
    }
  });

  it('should match the reference at every budget, including tight ones', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const seed = g.indexOf.get('0,1')!;
    for (const budget of [0, 9, 36, 60, 100, 1080]) {
      expect([...floodRoadCellGraph(g, [seed], budget)], `預算 ${budget}`)
        .toEqual([...bellmanFord(g, [seed], budget)]);
    }
  });

  it('should take the cheapest of several seeds', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const a = g.indexOf.get('0,1')!, b = g.indexOf.get('8,3')!;
    expect([...floodRoadCellGraph(g, [a, b], BIG)]).toEqual([...bellmanFord(g, [a, b], BIG)]);
  });

  it('should return integers only, with -1 for unreached nodes', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const cost = floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 36);
    expect(cost).toBeInstanceOf(Int32Array);
    let unreached = 0;
    for (const c of cost) {
      expect(Number.isInteger(c)).toBe(true);
      if (c === -1) unreached++;
    }
    expect(unreached, '這個預算下應該有到不了的節點，否則預算截斷沒被測到')
      .toBeGreaterThan(0);
  });

  it('should settle in non-decreasing cost order', () => {
    // BUG-102 的守門：附掛依賴「第一次 settle 就是最便宜的那條路」。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const seen: number[] = [];
    floodRoadCellGraph(g, [g.indexOf.get('2,1')!], BIG, (_n, c) => { seen.push(c); return false; });
    expect(seen.length, '只 settle 了種子，這條測試等於沒測').toBeGreaterThan(5);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!, `第 ${i} 次 settle 的成本比前一次低`).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it('should settle each node exactly once', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const settled: number[] = [];
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], BIG, (n) => { settled.push(n); return false; });
    expect(new Set(settled).size, '有節點被 settle 了兩次').toBe(settled.length);
  });

  it('should stop early when onSettle asks it to', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    let count = 0;
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], BIG, () => { count++; return count >= 3; });
    expect(count).toBe(3);
  });
});
