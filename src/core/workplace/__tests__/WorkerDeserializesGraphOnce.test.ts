import { describe, it, expect, vi } from 'vitest';

/**
 * 反序列化**不是**零成本的視圖:它要為每個路網節點配一個字串鍵、再塞進一個
 * `Map`（`RoadCellGraphBuffer.ts`）。放在逐工作地的迴圈裡就是
 * O(工作地數 × 路格數) 次字串配置，疊在真正的 flood 之上（BUG-334）。
 *
 * 這一條盯的是「圖只建一次」。用間諜數呼叫次數，不用時間 —— 計時的測試會抖。
 */
vi.mock('../../road/RoadCellGraphBuffer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../road/RoadCellGraphBuffer')>();
  return { ...actual, deserializeRoadCellGraph: vi.fn(actual.deserializeRoadCellGraph) };
});

import { deserializeRoadCellGraph, serializeRoadCellGraph } from '../../road/RoadCellGraphBuffer';
import { computeWorkplaceDistances, reverseFloodFromGraph } from '../../../workers/workplace-distance.worker';
import { RoadType } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../../road/RoadCellGraph';
import type { WorkplacePosition } from '../WorkplaceDistanceTypes';

const BUDGET = 1080;
const W = 12;
const H = 5;

/** 一條橫貫的路在 y=2，工作地排在 y=1 貼著它。 */
function fixture() {
  const roads = new Map<string, RoadType>();
  for (let x = 0; x < W; x++) roads.set(`${x},2`, RoadType.TWO_LANE);

  const grid = {
    width: W, height: H,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      return { roadType: roads.get(`${x},${y}`) ?? RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fn(this.getCell(x, y)!, x, y);
    },
  };

  const graphBuffer = serializeRoadCellGraph(
    transposeRoadCellGraph(buildRoadCellGraph(UnifiedRoadLookup.fromGrid(grid))),
  );
  const isBuilding = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && !roads.has(`${x},${y}`);

  const workplaces: WorkplacePosition[] = [];
  for (let x = 0; x < 6; x++) workplaces.push({ pos: `${x},1`, x, y: 1 });

  return { graphBuffer, isBuilding, workplaces };
}

describe('computeWorkplaceDistances', () => {
  it('should deserialize the road graph once, not once per workplace', () => {
    const { graphBuffer, isBuilding, workplaces } = fixture();
    const spy = vi.mocked(deserializeRoadCellGraph);

    spy.mockClear();
    computeWorkplaceDistances(graphBuffer, workplaces, BUDGET, isBuilding);

    expect(spy.mock.calls.length,
      `${workplaces.length} 個工作地卻建了 ${spy.mock.calls.length} 次圖`).toBe(1);
  });

  it('should give the same answers as flooding each workplace separately', () => {
    const { graphBuffer, isBuilding, workplaces } = fixture();

    const batch = computeWorkplaceDistances(graphBuffer, workplaces, BUDGET, isBuilding);

    const graph = deserializeRoadCellGraph(graphBuffer);
    const expected = workplaces.map(wp => ({
      workplacePos: wp.pos,
      distances: reverseFloodFromGraph(graph, wp, BUDGET, isBuilding),
    }));

    expect(Object.keys(expected[0]!.distances).length,
      'fixture 沒淹到任何建築 —— 這個測試什麼都沒比').toBeGreaterThan(0);
    expect(batch).toEqual(expected);
  });

  it('should keep each workplace on its own entry', () => {
    // 圖共用之後，每次 flood 都拿同一個 graph 物件。若 flood 寫回圖上的暫存
    // 狀態而沒清乾淨，後面的工作地會讀到前面的殘留。
    const { graphBuffer, isBuilding, workplaces } = fixture();

    const together = computeWorkplaceDistances(graphBuffer, workplaces, BUDGET, isBuilding);
    const alone = workplaces.map(wp =>
      computeWorkplaceDistances(graphBuffer, [wp], BUDGET, isBuilding)[0]!);

    expect(together).toEqual(alone);
  });
});
