import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../../road/RoadCellGraph';
import { roadDistanceToTargets } from '../../service/RoadCoverageFlood';
import { reverseFloodFromGraph } from '../../../workers/workplace-distance.worker';

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

function buildingCells(grid: { getCell(x: number, y: number): { roadType: number } | null }) {
  const out: string[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid.getCell(x, y)!.roadType === RoadType.NONE) out.push(`${x},${y}`);
    }
  }
  return out;
}

const BUDGET = 1080;

/**
 * 本設計的硬約束：**worker 算的必須等於同步查詢算的。**
 *
 * 兩者共用同一個 flood 核心，所以這條理應永遠綠 —— 它守的是「有人哪天為了
 * 效能在 worker 裡另外寫一份」。城市有高架、匝道，而且**路型混合** ——
 * 全部同路型時正反向剛好相等，BUG-237 就是這樣漏掉的。
 *
 * 用 `.toBe`：成本是整數，加法可交換，所以正向與反向必然位元相同。
 * （浮點下這條在數學上就不可能通過。）
 */
describe('worker result equals the synchronous query', () => {
  it('should agree on every home → workplace cost, exactly', () => {
    const { grid, lookup } = testCity();
    const forward = buildRoadCellGraph(lookup);
    const transposed = transposeRoadCellGraph(forward);
    const cells = buildingCells(grid);
    const isBuilding = (x: number, y: number): boolean => {
      const c = grid.getCell(x, y);
      return c !== null && c.roadType === RoadType.NONE;
    };

    let compared = 0;
    for (const wpKey of cells) {
      const [wx, wy] = wpKey.split(',').map(Number);
      const fromWorker = reverseFloodFromGraph(
        transposed, { pos: wpKey, x: wx!, y: wy! }, BUDGET, isBuilding,
      );
      for (const homeKey of cells) {
        const [hx, hy] = homeKey.split(',').map(Number);
        const sync = roadDistanceToTargets(
          grid, { x: hx!, y: hy! }, new Set([wpKey]), BUDGET, lookup, forward,
        );
        const a = fromWorker[homeKey];
        const b = sync.get(wpKey);
        if (b === undefined) {
          expect(a, `${homeKey} → ${wpKey}：同步說到不了，worker 說到得了`).toBeUndefined();
        } else {
          expect(a, `${homeKey} → ${wpKey}：成本不同`).toBe(b);
        }
        compared++;
      }
    }
    expect(compared, '一組都沒比到').toBeGreaterThan(100);
  });

  it('should disagree if given the forward graph instead of the transpose', () => {
    // 這一條證明「用轉置圖」不是可有可無的裝飾。路型混合時，拿正向圖跑反向
    // flood 會得到不同的答案 —— 那正是 BUG-237。
    const { grid, lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const isBuilding = (x: number, y: number): boolean => {
      const c = grid.getCell(x, y);
      return c !== null && c.roadType === RoadType.NONE;
    };
    const wp = { pos: '0,0', x: 0, y: 0 };
    const withTranspose = reverseFloodFromGraph(
      transposeRoadCellGraph(g), wp, BUDGET, isBuilding);
    const withForward = reverseFloodFromGraph(g, wp, BUDGET, isBuilding);
    expect(withForward, '正向圖與轉置圖給出相同結果 —— fixture 的路型不夠混合')
      .not.toEqual(withTranspose);
  });
});
