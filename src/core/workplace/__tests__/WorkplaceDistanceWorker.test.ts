import { describe, it, expect } from 'vitest';
import { computeWorkplaceDistances, reverseFloodFromGraph } from '../../../workers/workplace-distance.worker';
import { RoadType } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../../road/RoadCellGraph';
import { deserializeRoadCellGraph, serializeRoadCellGraph } from '../../road/RoadCellGraphBuffer';
import type { WorkplacePosition } from '../WorkplaceDistanceTypes';
import { WorkplaceDistanceTable } from '../WorkplaceDistanceTable';

const BYTES_PER_CELL = 12;

/**
 * This file tested `reverseFloodFromWorkplace`, the worker's own flat Dijkstra that could not see
 * elevated roads. It has been replaced by `reverseFloodFromGraph` (the underlying fix for
 * BUG-109).
 *
 * Two things changed with the migration, both deliberately:
 *
 * 1. **Results no longer include road cells.** Attachment's `accept` asks whether a cell is a
 *    building, and the distance table's only use is `getDistance(homePos, workplacePos)`, where
 *    the home is always a building. Road cells are dead weight in the table and are
 *    structured-cloned with it. The synchronous query also returns only cells in the target set,
 *    so this makes the two paths more consistent.
 * 2. **The budget is x18.** Costs became integers (see `core/road/roadCost.ts`), so the old 60 is
 *    now 1080. The range is unchanged.
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
 * Wraps a `roads` map into a grid `UnifiedRoadLookup` accepts.
 *
 * These fixtures never had a real `Grid`, only a map and a hand-built buffer. `fromGrid()` needs
 * width, height, getCell and forEachCell, which this supplies.
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

/** Prepares both things the worker needs: the transposed graph's buffer and the is-a-building
 *  predicate. */
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

/**
 * Runs one flood and spreads it into `{ "x,y": cost }`.
 *
 * `reverseFloodFromGraph` collects into a dense array (see its documentation); spreading it back
 * into an object here only lets the assertions below talk about coordinates rather than index
 * arithmetic.
 */
function flood(
  width: number, height: number, roads: Map<string, RoadType>,
  wp: WorkplacePosition, maxBudget: number,
): Record<string, number> {
  const { graphBuffer, isBuilding } = workerInputs(width, height, roads);
  const dense = new Int32Array(width * height).fill(-1);
  reverseFloodFromGraph(
    deserializeRoadCellGraph(graphBuffer), wp, maxBudget, width, height, isBuilding, dense);
  const out: Record<string, number> = {};
  for (let i = 0; i < dense.length; i++) {
    if (dense[i]! >= 0) out[`${i % width},${Math.floor(i / width)}`] = dense[i]!;
  }
  return out;
}

const BUDGET = 1080;   // 60 on the old scale, x18

describe('reverseFloodFromGraph', () => {
  it('returns the workplace building itself at cost 0', () => {
    // 5x5, with a road at (2,2) and the workplace at (2,1) beside it.
    const roads = new Map([['2,2', RoadType.TWO_LANE]]);
    const result = flood(5, 5, roads, { pos: '2,1', x: 2, y: 1 }, BUDGET);

    expect(result['2,1']).toBe(0);
    // Road cells are **not** in the result; see the file header.
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

    // Every building beside the road is present.
    expect(result['1,1']).toBeDefined();
    expect(result['3,1']).toBeDefined();
    expect(result['4,1']).toBeDefined();
    // The road itself is not.
    expect(result['3,2']).toBeUndefined();
  });

  it('respects the budget limit', () => {
    // A long road and a small budget. The y=1 row is buildings, showing how far coverage gets.
    const roads = new Map<string, RoadType>();
    for (let x = 0; x < 20; x++) roads.set(`${x},0`, RoadType.TWO_LANE);
    const result = flood(20, 2, roads, { pos: '0,0', x: 0, y: 0 }, 90);   // 5 on the old scale, x18

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
    // The road is at y=5 across x 0..9, with the workplace at (3,3), two cells back in the inner
    // ring.
    const roads = new Map<string, RoadType>();
    for (let x = 0; x < 10; x++) roads.set(`${x},5`, RoadType.TWO_LANE);
    const result = flood(10, 10, roads, { pos: '3,3', x: 3, y: 3 }, 18000);

    expect(result['3,3'], '工作地點自己沒被收 —— 內圈沒有種到 flood').toBeDefined();
    // Once seeded, the flood runs the length of the road and buildings at the far end are
    // attached too.
    expect(result['9,4']).toBeDefined();
  });

  it('picks up non-road buildings across the whole inner ring', () => {
    // One road cell at (5,5). Buildings within Chebyshev 2 are present and those beyond 3 are
    // not.
    const roads = new Map<string, RoadType>([['5,5', RoadType.TWO_LANE]]);
    const result = flood(10, 10, roads, { pos: '5,5', x: 5, y: 5 }, BUDGET);

    // The four neighbours.
    expect(result['4,5']).toBeDefined();
    expect(result['5,4']).toBeDefined();
    // Diagonally, Chebyshev 1.
    expect(result['4,4']).toBeDefined();
    // The inner ring, Chebyshev 2.
    expect(result['3,3']).toBeDefined();
    expect(result['7,7']).toBeDefined();
    // Past the reach, Chebyshev 3.
    expect(result['2,2']).toBeUndefined();
    expect(result['8,8']).toBeUndefined();
  });
});

describe('one flood per workplace', () => {
  it('produces an independent table for each workplace', () => {
    // Replaces the former computeAllDistances, a wrapper that was only workplaces.map(); the
    // message handler now does it directly.
    const roads = new Map<string, RoadType>([
      ['1,0', RoadType.TWO_LANE],
      ['2,0', RoadType.TWO_LANE],
      ['3,0', RoadType.TWO_LANE],
    ]);
    const { graphBuffer, isBuilding } = workerInputs(5, 3, roads);

    const table = new WorkplaceDistanceTable(computeWorkplaceDistances(graphBuffer, [
      { pos: '1,1', x: 1, y: 1 },
      { pos: '3,1', x: 3, y: 1 },
    ], BUDGET, 5, 3, isBuilding));

    expect(table.workplaceCount).toBe(2);
    // Two workplaces reach each other along the same road.
    expect(table.costAt(3, 1, '1,1')).toBeDefined();
    expect(table.costAt(1, 1, '3,1')).toBeDefined();
  });
});
