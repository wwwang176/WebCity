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
 * 混合路型 + 高架 + 匝道的測試城市。
 *
 *   y=1   x 0..11  雙線道主幹（每格 36）
 *   y=3   x 2..8   鄉道支線（每格 60）
 *   x=2   y=2      鄉道，連接主幹與支線
 *   level 1, y=1, x 4..9  高速高架（每格 9），x=4 與 x=9 是匝道
 *
 * 路型混合是必要的 —— 全部同路型時正向與反向剛好相等，而那正好會讓反向
 * 對稱性的 bug 測不出來（BUG-237 就是這樣漏掉的）。
 *
 * 這個 fixture 的**拓撲細節不寫進斷言** —— 測試一律從 lookup 或獨立參考
 * 演算法推導期望值。手算過兩次，兩次都錯。
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

/** 節點 key 的所有出邊，回傳 [目標 key, 權重]。 */
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
    // 全域比對，不是抽樣。期望值直接向 lookup 問 —— 不需要我心算哪一格連
    // 哪一格（手算過兩次，兩次都錯）。這一條同時涵蓋樓層規則、匝道軸向、
    // 邊界裁切，因為那些全都在 getCompatibleNeighborKeys 裡。
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
    // 同樣是全域的。每一條邊的權重都必須等於「走進去那一格」的路型成本。
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
    // 整數是順序無關性的地基（見 roadCost.ts）。浮點權重會讓正反向 flood
    // 不可能位元相等。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(g.weights).toBeInstanceOf(Uint16Array);
    for (let k = 0; k < g.weights.length; k++) {
      expect(Number.isInteger(g.weights[k]!)).toBe(true);
      expect(g.weights[k]!).toBeGreaterThan(0);
    }
  });

  // ── fixture 健全性 ──────────────────────────────────────────────
  // 以下兩條不斷言座標，只斷言「這個 fixture 真的含有要測的東西」。
  // 算錯也只會讓測試更嚴格，不會讓正確實作紅燈。

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
    // 全部同路型時正反向剛好相等，BUG-237 就是這樣漏掉的。
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

    // 去重：上面「edges the lookup permits」用 Set 比對，重複的邊會被它藏起來。
    // 重複邊不影響最短路徑結果，但會讓 flood 白做工，而且是建圖邏輯出錯的訊號。
    for (let i = 0; i < g.nodeKeys.length; i++) {
      const seen = new Set<number>();
      for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
        expect(seen.has(g.targets[k]!), `${g.nodeKeys[i]} 有重複的出邊`).toBe(false);
        seen.add(g.targets[k]!);
      }
    }
  });
});
