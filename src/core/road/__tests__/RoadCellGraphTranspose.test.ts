import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../types';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import {
  buildRoadCellGraph, transposeRoadCellGraph, floodRoadCellGraph, type RoadCellGraph,
} from '../RoadCellGraph';

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

const BIG = 1_000_000;

/** Every edge in the graph, normalised into a comparable set of strings. */
function edgeSet(g: RoadCellGraph): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < g.nodeKeys.length; i++) {
    for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
      out.add(`${g.nodeKeys[i]}|${g.nodeKeys[g.targets[k]!]}|${g.weights[k]}`);
    }
  }
  return out;
}

/**
 * Cost is charged at the **destination** cell, so a forward edge A->B is priced at cost(B).
 * Spreading backwards has to keep the weight on the edge: walking outward from B on the forward
 * graph charges cost(A) instead.
 *
 * That is what `reverseFloodFromWorkplace` did (BUG-237). The existing tests missed it because
 * they used a single road type, where forward and reverse happen to be equal.
 */
describe('transposeRoadCellGraph', () => {
  it('should be exactly the edge set with every arrow reversed', () => {
    // Compared exhaustively rather than sampled. The weight follows the edge.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const t = transposeRoadCellGraph(g);
    const flipped = new Set(
      [...edgeSet(g)].map(s => { const [a, b, w] = s.split('|'); return `${b}|${a}|${w}`; }),
    );
    expect(edgeSet(t)).toEqual(flipped);
  });

  it('should give the same cost as a forward flood, for every pair', () => {
    // The only reason the transpose exists: one outward run from a workplace on it equals a
    // forward flood from every home. Only a mix of road types can show it.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const t = transposeRoadCellGraph(g);

    for (const targetKey of ['8,3', '0,1', '6,1,1']) {
      const target = g.indexOf.get(targetKey)!;
      expect(target, `${targetKey} 不在圖裡`).toBeDefined();
      const reverse = floodRoadCellGraph(t, [target], BIG);
      for (let home = 0; home < g.nodeKeys.length; home++) {
        const forward = floodRoadCellGraph(g, [home], BIG)[target]!;
        expect(reverse[home]!, `${g.nodeKeys[home]} → ${targetKey} 的成本不一致`)
          .toBe(forward);
      }
    }
  });

  it('fixture sanity: the graph is genuinely asymmetric', () => {
    // If the forward graph is already symmetric, with each edge's reverse carrying the same
    // weight, the transpose does nothing and the test above is vacuous.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(edgeSet(g), '圖是對稱的 —— 轉置測不出東西，fixture 的路型不夠混合')
      .not.toEqual(edgeSet(transposeRoadCellGraph(g)));
  });

  it('should preserve node identity and CSR shape', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const t = transposeRoadCellGraph(g);
    expect(t.nodeKeys).toEqual(g.nodeKeys);
    expect(t.targets.length).toBe(g.targets.length);
    expect(t.offsets.length).toBe(g.offsets.length);
    expect(t.offsets[g.nodeKeys.length]).toBe(g.targets.length);
    expect([...t.nodeX]).toEqual([...g.nodeX]);
    expect([...t.nodeLevel]).toEqual([...g.nodeLevel]);
  });
});
