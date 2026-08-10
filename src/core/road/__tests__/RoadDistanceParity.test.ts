import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../types';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { buildRoadCellGraph } from '../RoadCellGraph';
import {
  roadDistanceToTargets, roadDistanceToTargetsOnGrid,
} from '../../service/RoadCoverageFlood';

const EW = RoadDirection.EAST | RoadDirection.WEST;
const NS = RoadDirection.NORTH | RoadDirection.SOUTH;
const W = 12, H = 6;

/** 見 RoadCellGraph.test.ts 的說明。`withViaduct=false` 時不掛任何高架段。 */
function testCity(withViaduct = true) {
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
  if (withViaduct) {
    for (let x = 4; x <= 9; x++) {
      em.set(x, 1, 1, {
        roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0,
        isRamp: x === 4 || x === 9,
        rampAscendDirection: x === 4 ? RoadDirection.EAST : RoadDirection.WEST,
      });
    }
  }
  return { grid, lookup: new UnifiedRoadLookup(grid, em) };
}

/** 所有非道路格 —— 潛在的家與工作。 */
function buildingCells(grid: { width: number; height: number; getCell(x: number, y: number): { roadType: number } | null }) {
  const out: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.getCell(x, y)!.roadType === RoadType.NONE) out.push(`${x},${y}`);
    }
  }
  return out;
}

/**
 * 重構的證明，而且是永久的。
 *
 * 新實作走圖，舊實作直接掃格子。**在沒有高架的世界裡**，同一組查詢兩者必須
 * 逐格精確相等 —— 用 toBe。成本是整數，所以「精確相等」是可達成的契約
 * （浮點下不是：加法沒有結合律）。
 *
 * 有高架的世界裡兩者本來就該不同 —— 那正是 BUG-109。那一半由
 * `WorkerGraphParity` 與 `ElevatedAwareReachability` 守。
 */
describe('roadDistanceToTargets parity with the ground-only implementation', () => {
  it('should match the ground-only result for every home, exactly', () => {
    const { grid, lookup } = testCity(false);
    const cells = buildingCells(grid);
    const targets = new Set(cells);
    const graph = buildRoadCellGraph(lookup);

    for (const homeKey of cells) {
      const [hx, hy] = homeKey.split(',').map(Number);
      const home = { x: hx!, y: hy! };
      const a = roadDistanceToTargets(grid, home, targets, 1080, lookup, graph);
      const b = roadDistanceToTargetsOnGrid(grid, home, targets, 1080);

      expect([...a.keys()].sort(), `家 ${homeKey}：到得了的目標集合不同`)
        .toEqual([...b.keys()].sort());
      for (const [k, v] of b) {
        expect(a.get(k), `家 ${homeKey} → ${k}：成本不同`).toBe(v);
      }
    }
  });

  it('should agree at every budget', () => {
    const { grid, lookup } = testCity(false);
    const targets = new Set(buildingCells(grid));
    const graph = buildRoadCellGraph(lookup);
    const home = { x: 0, y: 0 };
    for (const budget of [0, 9, 36, 60, 360, 1080]) {
      const a = roadDistanceToTargets(grid, home, targets, budget, lookup, graph);
      const b = roadDistanceToTargetsOnGrid(grid, home, targets, budget);
      expect([...a.keys()].sort(), `預算 ${budget}`).toEqual([...b.keys()].sort());
      for (const [k, v] of b) expect(a.get(k), `預算 ${budget} → ${k}`).toBe(v);
    }
  });

  it('should build its own graph when none is passed', () => {
    // 不傳圖也必須算得一樣 —— 只是慢。
    const { grid, lookup } = testCity(false);
    const targets = new Set(buildingCells(grid));
    const home = { x: 0, y: 0 };
    expect(roadDistanceToTargets(grid, home, targets, 1080, lookup))
      .toEqual(roadDistanceToTargets(grid, home, targets, 1080, lookup,
        buildRoadCellGraph(lookup)));
  });

  it('should fall back to the ground-only path when there is no lookup', () => {
    const { grid } = testCity(false);
    const targets = new Set(buildingCells(grid));
    const home = { x: 0, y: 0 };
    expect(roadDistanceToTargets(grid, home, targets, 1080, null))
      .toEqual(roadDistanceToTargetsOnGrid(grid, home, targets, 1080));
  });

  it('should differ from the ground-only path once a viaduct exists', () => {
    // 這一條證明走圖不是白工。有高架時，地面版本看不到它。
    const { grid, lookup } = testCity(true);
    const targets = new Set(buildingCells(grid));
    const home = { x: 0, y: 0 };
    const withGraph = roadDistanceToTargets(grid, home, targets, 1080, lookup,
      buildRoadCellGraph(lookup));
    const groundOnly = roadDistanceToTargetsOnGrid(grid, home, targets, 1080);
    expect(withGraph, '有高架卻與地面版本完全相同 —— 高架沒有被走到')
      .not.toEqual(groundOnly);
  });
});
