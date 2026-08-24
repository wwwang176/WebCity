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

/** See RoadCellGraph.test.ts. The topology is never written into an assertion. */
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
    // The expectation is brute-forced by scanning every node for those in range, rather than
    // working coordinates out by hand.
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
    // Otherwise "covers every level" is vacuous and an implementation ignoring elevated roads
    // entirely would pass.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const keys = seedNodesFor(g, 6, 0, ZONE_ROAD_REACH).map(i => g.nodeKeys[i]!);
    expect(keys.some(k => levelOfKey(k) > 0), '探點旁邊沒有高架，高架等於沒測').toBe(true);
  });
});

describe('attachAtSettledNode', () => {
  /**
   * Runs a flood, attaching at each settle.
   *
   * `attachAtSettledNode` collects into a dense array (see its documentation); spreading it back
   * into a `Map` here only lets the assertions below talk about what (x,y) received rather than
   * about index arithmetic. **The returned `added` total is independent of that spreading**, so
   * whether anything was really attached is not inferred from this conversion.
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
    // The caller counts towards its early exit with this number. Always returning 0 makes the
    // synchronous query run the full budget forever, and no other assertion would show it.
    const { out, added } = floodAndAttach('0,1', () => true);

    expect(added).toBe(out.size);
    expect(added).toBeGreaterThan(0);
  });

  it('should not count a cell twice when a cheaper road settles later', () => {
    // Only the first attachment counts: double counting fires the early exit too soon and the
    // query stops before finding everything.
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
    // The dense array requires the upper bound to be checked too. Checking only for negatives
    // and relying on `accept` to reject out-of-bounds cells is not a bet that can be taken when
    // writing into an array: an overrun silently corrupts another cell.
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
   * An independent reference: a cell's cost is the cheapest of every **reachable** road cell
   * within reach. Brute-forced over the whole graph, depending on neither settle order nor
   * attachAtSettledNode's logic.
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
    // Compared exhaustively. Hand-worked expectations such as "(5,5) should attach to (5,3)" were
    // wrong twice, so **every** cell is compared against the brute-forced minimum.
    const { g, out, cost } = floodAndAttach('0,1', () => true);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const expected = cheapestNearby(g, cost, x, y);
        expect(out.get(`${x},${y}`), `(${x},${y}) 的附掛成本不是最便宜的`).toBe(expected);
      }
    }
  });

  it('fixture sanity: some cell is genuinely contested by roads of different cost', () => {
    // With one road cell within reach of every cell, "takes the cheapest" is vacuous.
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
    // A road cell can itself be a target. `dx`/`dy` including (0,0) covers that, but that is an
    // implementation detail; this pins "road cells are attached too" as a contract.
    //
    // **Only that it was attached, not that it received its own cost.** Attachment takes the
    // cheapest road cell within reach, and a road cell's neighbour can be cheaper. The actual
    // costs are the exhaustive comparison above.
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
    // Makes the note above a checkable fact. Asserting that a road cell receives its own cost
    // fails a correct implementation, and this count is the counter-example.
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
