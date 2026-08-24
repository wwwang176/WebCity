import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../types';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { parsePosKeyUnsafe, FOUR_NEIGHBORS } from '../../grid/GridHelpers';
import { buildRoadCellGraph, levelOfKey } from '../RoadCellGraph';
import { roadTileCost } from '../roadCost';

const EW = RoadDirection.EAST | RoadDirection.WEST;
const NS = RoadDirection.NORTH | RoadDirection.SOUTH;

/**
 * A test city mixing road types with an elevated section and ramps.
 *
 *   y=1   x 0..11  two-lane arterial, 36 per cell
 *   y=3   x 2..8   rural branch, 60 per cell
 *   x=2   y=2      rural, joining the arterial to the branch
 *   level 1, y=1, x 4..9  elevated highway, 9 per cell, with ramps at x=4 and x=9
 *
 * The mix of road types is necessary: with one road type throughout, forward and reverse happen
 * to be equal, which is exactly what hides a reverse-symmetry defect (how BUG-237 was missed).
 *
 * **This fixture's topology is never written into an assertion**: expectations are always derived
 * from the lookup or from an independent reference algorithm. Worked out by hand twice, wrong
 * both times.
 */
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

/** A node key's out-edges, as [target key, weight]. */
function outEdges(g: ReturnType<typeof buildRoadCellGraph>, key: string): [string, number][] {
  const i = g.indexOf.get(key);
  if (i === undefined) return [];
  const out: [string, number][] = [];
  for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
    out.push([g.nodeKeys[g.targets[k]!]!, g.weights[k]!]);
  }
  return out;
}

describe('buildRoadCellGraph', () => {
  it('should contain exactly the cells the lookup reports', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect([...g.nodeKeys].sort()).toEqual(lookup.getAllCellKeys().sort());
  });

  it('should contain exactly the edges the lookup permits, for every node', () => {
    // Compared exhaustively rather than sampled, with the expectation asked of the lookup so
    // nothing has to be worked out by hand (done twice, wrong both times). This covers the level
    // rules, ramp axis and boundary clipping at once, because all of them live in
    // getCompatibleNeighborKeys.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);

    for (const key of lookup.getAllCellKeys()) {
      const { x, y } = parsePosKeyUnsafe(key);
      const expected = new Set<string>();
      for (const [dx, dy] of FOUR_NEIGHBORS) {
        for (const nk of lookup.getCompatibleNeighborKeys(key, x + dx!, y + dy!)) {
          expected.add(nk);
        }
      }
      const actual = new Set(outEdges(g, key).map(([k]) => k));
      expect(actual, `${key} 的鄰接與 lookup 不符`).toEqual(expected);
    }
  });

  it('should charge the cost of the destination cell, for every edge', () => {
    // Exhaustive too. Every edge's weight has to equal the road type cost of the cell it enters.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    let checked = 0;
    for (const key of g.nodeKeys) {
      for (const [dstKey, w] of outEdges(g, key)) {
        const dst = lookup.getCellByKey(dstKey)!;
        expect(w, `${key} → ${dstKey} 付錯了價`).toBe(roadTileCost(dst.roadType));
        checked++;
      }
    }
    expect(checked, '一條邊都沒檢查到 —— 這條測試等於沒測').toBeGreaterThan(20);
  });

  it('should store integral weights that fit the Uint16 range', () => {
    // Integers are the foundation of order independence (see roadCost.ts). Floating-point weights
    // make bit-identical forward and reverse floods impossible.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(g.weights).toBeInstanceOf(Uint16Array);
    for (let k = 0; k < g.weights.length; k++) {
      expect(Number.isInteger(g.weights[k]!)).toBe(true);
      expect(g.weights[k]!).toBeGreaterThan(0);
    }
  });

  // ── Fixture sanity ──────────────────────────────────────────────
  // The two below assert no coordinates, only that the fixture really contains what is being
  // tested. Getting them wrong makes the tests stricter rather than failing a correct
  // implementation.

  it('fixture sanity: the ground reaches the viaduct, and only at ramps', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const groundToAir: [string, string][] = [];
    for (const key of g.nodeKeys) {
      if (levelOfKey(key) !== 0) continue;
      for (const [dstKey] of outEdges(g, key)) {
        if (levelOfKey(dstKey) > 0) groundToAir.push([key, dstKey]);
      }
    }
    expect(groundToAir.length, 'fixture 裡沒有任何地面→高架的邊，高架等於沒測')
      .toBeGreaterThan(0);
    for (const [from, to] of groundToAir) {
      expect(lookup.isRamp(to), `${from} → ${to}：高架端不是匝道`).toBe(true);
    }
  });

  it('fixture sanity: it really mixes road tiers', () => {
    // With one road type throughout, forward and reverse happen to be equal, which is how
    // BUG-237 was missed.
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(new Set(g.weights).size, 'fixture 只有一種路型，測不出方向性')
      .toBeGreaterThanOrEqual(3);
  });

  it('should keep CSR structurally consistent, with no duplicate edges', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(g.indexOf.size).toBe(g.nodeKeys.length);
    for (let i = 0; i < g.nodeKeys.length; i++) {
      expect(g.indexOf.get(g.nodeKeys[i]!)).toBe(i);
    }
    expect(g.offsets.length).toBe(g.nodeKeys.length + 1);
    expect(g.offsets[g.nodeKeys.length]).toBe(g.targets.length);
    expect(g.weights.length).toBe(g.targets.length);

    // Duplicates: "edges the lookup permits" above compares Sets, which hide a repeated edge.
    // Duplicates do not change the shortest path but make the flood do wasted work, and they are
    // a sign the graph construction is wrong.
    for (let i = 0; i < g.nodeKeys.length; i++) {
      const seen = new Set<number>();
      for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
        expect(seen.has(g.targets[k]!), `${g.nodeKeys[i]} 有重複的出邊`).toBe(false);
        seen.add(g.targets[k]!);
      }
    }
  });
});
