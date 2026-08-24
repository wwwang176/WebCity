import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../types';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { buildRoadCellGraph, floodRoadCellGraph, type RoadCellGraph } from '../RoadCellGraph';

const EW = RoadDirection.EAST | RoadDirection.WEST;
const NS = RoadDirection.NORTH | RoadDirection.SOUTH;

/** See RoadCellGraph.test.ts. The topology is never written into an assertion. */
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
 * An independent reference implementation: Bellman-Ford.
 *
 * Expectations are not worked out by hand but compared against a shortest-path implementation
 * with an **entirely different algorithm**. Bellman-Ford uses no heap, depends on no settle order
 * and exits early nowhere, so it cannot repeat any of Dijkstra's mistakes about ordering, stale
 * entries or the relax condition.
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
 * A hand-built CSR graph with **differing in-edge weights**.
 *
 * Why it is needed: the road graph charges cost at the **destination** cell, so every edge into
 * node j carries the same weight and `dist[j] = w_j + min(settled predecessors)`. Dijkstra settles
 * in increasing cost order, so the first settled predecessor is the smallest and **the first relax
 * is already optimal**. As a result the "relax to a cheaper value" and "stale heap entry" branches
 * are unreachable on a road graph, and exercising them with testCity is vacuous.
 *
 * This graph really executes both branches:
 *
 *   S --1--> A --100--> T
 *   +--10--> B ---1---> T
 *
 * Settling S(0) relaxes A=1 and B=10; settling A(1) relaxes T=101; settling B(10) **rewrites T to
 * 11**, leaving the 101 in the heap as a stale entry.
 *
 * `floodRoadCellGraph` is a general weighted-graph Dijkstra whose contract should hold for any
 * graph — and the day the cost model gains a turn penalty, in-edge weights stop being uniform.
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
    // T enters the heap at 101 and then at 11. Without the stale filter, T settles twice.
    const g = skewedGraph();
    const settled: number[] = [];
    floodRoadCellGraph(g, [0], BIG, (n) => { settled.push(n); return false; });
    expect(new Set(settled).size, '有節點被 settle 了兩次').toBe(settled.length);
    expect(settled.length).toBe(4);
  });

  it('fixture sanity: this graph really has uneven incoming weights', () => {
    // With uniform in-edge weights the two tests above are vacuous, which is exactly testCity's
    // situation.
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
    // The flood core's main test: the whole graph, every seed, exact equality.
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
    // Guards BUG-102: attachment depends on the first settle being the cheapest route.
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
