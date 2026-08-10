import { describe, it, expect } from 'vitest';
import { reverseFloodFromGraph } from '../../../workers/workplace-distance.worker';
import { RoadType } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../../road/RoadCellGraph';
import { serializeRoadCellGraph } from '../../road/RoadCellGraphBuffer';
import type { WorkplacePosition } from '../WorkplaceDistanceTypes';

const BYTES_PER_CELL = 12;

/**
 * 這個檔案原本測的是 `reverseFloodFromWorkplace` —— worker 自己那份看不到
 * 高架的平面 Dijkstra。它已經被 `reverseFloodFromGraph` 取代（BUG-109 治本）。
 *
 * 遷移時有兩件事變了，都是刻意的：
 *
 * 1. **結果不再包含道路格。** 附掛的 `accept` 是「這一格是不是建築」，而距離
 *    表的唯一用途是 `getDistance(homePos, workplacePos)` —— home 一定是建築。
 *    道路格在表裡是死重量，還要跟著 structured clone。同步查詢也只回傳目標
 *    集合裡的格子，所以這也讓兩條路更一致。
 * 2. **預算 ×18。** 成本整數化（見 `core/road/roadCost.ts`），舊制的 60 是
 *    現在的 1080。涵蓋範圍不變。
 */

/** Build a minimal grid buffer with only roadType set. */
function makeGridBuffer(width: number, height: number, roads: Map<string, RoadType>): ArrayBuffer {
  const buf = new ArrayBuffer(width * height * BYTES_PER_CELL);
  const view = new DataView(buf);
  for (const [key, rt] of roads) {
    const [x, y] = key.split(',').map(Number);
    const offset = (y! * width + x!) * BYTES_PER_CELL;
    view.setUint8(offset + 5, rt);
  }
  return buf;
}

/**
 * 把 `roads` map 包成 `UnifiedRoadLookup` 收得下的 grid。
 *
 * 這些 fixture 從來沒有真的 `Grid` —— 只有一個 map 與手捏的 buffer。
 * `fromGrid()` 需要 width/height/getCell/forEachCell，所以在這裡補齊。
 */
function gridFromRoads(width: number, height: number, roads: Map<string, RoadType>) {
  return {
    width, height,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: roads.get(`${x},${y}`) ?? RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) fn(this.getCell(x, y)!, x, y);
    },
  };
}

/** 一次備好 worker 需要的兩樣東西：轉置圖的 buffer，與「是不是建築」的判斷。 */
function workerInputs(width: number, height: number, roads: Map<string, RoadType>) {
  const lookup = UnifiedRoadLookup.fromGrid(gridFromRoads(width, height, roads));
  const graphBuffer = serializeRoadCellGraph(
    transposeRoadCellGraph(buildRoadCellGraph(lookup)),
  );
  const view = new DataView(makeGridBuffer(width, height, roads));
  const isBuilding = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return view.getUint8((y * width + x) * BYTES_PER_CELL + 5) === 0;
  };
  return { graphBuffer, isBuilding };
}

function flood(
  width: number, height: number, roads: Map<string, RoadType>,
  wp: WorkplacePosition, maxBudget: number,
): Record<string, number> {
  const { graphBuffer, isBuilding } = workerInputs(width, height, roads);
  return reverseFloodFromGraph(graphBuffer, wp, maxBudget, isBuilding);
}

const BUDGET = 1080;   // 舊制 60 × 18

describe('reverseFloodFromGraph', () => {
  it('returns the workplace building itself at cost 0', () => {
    // 5x5，道路在 (2,2)，工作地點 (2,1) 緊鄰它。
    const roads = new Map([['2,2', RoadType.TWO_LANE]]);
    const result = flood(5, 5, roads, { pos: '2,1', x: 2, y: 1 }, BUDGET);

    expect(result['2,1']).toBe(0);
    // 道路格**不在**結果裡 —— 見檔頭說明。
    expect(result['2,2'], '道路格不該出現在距離表裡').toBeUndefined();
  });

  it('follows a straight road and picks up the buildings beside it', () => {
    const roads = new Map<string, RoadType>([
      ['1,2', RoadType.TWO_LANE],
      ['2,2', RoadType.TWO_LANE],
      ['3,2', RoadType.TWO_LANE],
      ['4,2', RoadType.TWO_LANE],
    ]);
    const result = flood(6, 5, roads, { pos: '1,2', x: 1, y: 2 }, BUDGET);

    // 路邊的建築都要在
    expect(result['1,1']).toBeDefined();
    expect(result['3,1']).toBeDefined();
    expect(result['4,1']).toBeDefined();
    // 路本身不在
    expect(result['3,2']).toBeUndefined();
  });

  it('respects the budget limit', () => {
    // 長路 + 小預算。y=1 那一列是建築，用來觀察涵蓋到哪裡。
    const roads = new Map<string, RoadType>();
    for (let x = 0; x < 20; x++) roads.set(`${x},0`, RoadType.TWO_LANE);
    const result = flood(20, 2, roads, { pos: '0,0', x: 0, y: 0 }, 90);   // 舊制 5 × 18

    expect(result['0,1'], '近處的建築應該收得到').toBeDefined();
    expect(result['19,1'], '遠處的建築超出預算，不該收得到').toBeUndefined();
  });

  it('does not cross a gap in the road network', () => {
    const roads = new Map<string, RoadType>([
      ['1,0', RoadType.TWO_LANE],
      ['2,0', RoadType.TWO_LANE],
      // gap at 3,0 / 4,0
      ['5,0', RoadType.TWO_LANE],
      ['6,0', RoadType.TWO_LANE],
    ]);
    const result = flood(8, 2, roads, { pos: '1,0', x: 1, y: 0 }, BUDGET);

    expect(result['1,1'], '同一段路旁的建築應該收得到').toBeDefined();
    expect(result['6,1'], '斷開那一段旁的建築不該收得到').toBeUndefined();
  });

  it('seeds the flood even when the workplace sits 2 tiles from the road', () => {
    // 路在 y=5（x 0..9），工作地點 (3,3) —— 距離路兩格（內圈）。
    const roads = new Map<string, RoadType>();
    for (let x = 0; x < 10; x++) roads.set(`${x},5`, RoadType.TWO_LANE);
    const result = flood(10, 10, roads, { pos: '3,3', x: 3, y: 3 }, 18000);

    expect(result['3,3'], '工作地點自己沒被收 —— 內圈沒有種到 flood').toBeDefined();
    // 種好之後 flood 會沿路傳到底，遠端路邊的建築也要收得到
    expect(result['9,4']).toBeDefined();
  });

  it('picks up non-road buildings across the whole inner ring', () => {
    // 只有一格路 (5,5)。Chebyshev 2 以內的建築都要在，3 以外的不能在。
    const roads = new Map<string, RoadType>([['5,5', RoadType.TWO_LANE]]);
    const result = flood(10, 10, roads, { pos: '5,5', x: 5, y: 5 }, BUDGET);

    // 四鄰
    expect(result['4,5']).toBeDefined();
    expect(result['5,4']).toBeDefined();
    // 對角（Chebyshev 1）
    expect(result['4,4']).toBeDefined();
    // 內圈（Chebyshev 2）
    expect(result['3,3']).toBeDefined();
    expect(result['7,7']).toBeDefined();
    // 超出 reach（Chebyshev 3）
    expect(result['2,2']).toBeUndefined();
    expect(result['8,8']).toBeUndefined();
  });
});

describe('one flood per workplace', () => {
  it('produces an independent table for each workplace', () => {
    // 取代舊的 computeAllDistances —— 那個包裝只是 workplaces.map()，
    // 訊息處理端現在直接做這件事。
    const roads = new Map<string, RoadType>([
      ['1,0', RoadType.TWO_LANE],
      ['2,0', RoadType.TWO_LANE],
      ['3,0', RoadType.TWO_LANE],
    ]);
    const { graphBuffer, isBuilding } = workerInputs(5, 3, roads);

    const entries = [
      { pos: '1,1', x: 1, y: 1 },
      { pos: '3,1', x: 3, y: 1 },
    ].map(wp => ({
      workplacePos: wp.pos,
      distances: reverseFloodFromGraph(graphBuffer, wp, BUDGET, isBuilding),
    }));

    expect(entries.length).toBe(2);
    expect(entries[0]!.workplacePos).toBe('1,1');
    expect(entries[1]!.workplacePos).toBe('3,1');
    // 兩個工作地點沿同一條路互相到得了
    expect(entries[0]!.distances['3,1']).toBeDefined();
    expect(entries[1]!.distances['1,1']).toBeDefined();
  });
});
