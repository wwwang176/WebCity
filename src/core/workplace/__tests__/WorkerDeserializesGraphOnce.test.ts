import { describe, it, expect, vi } from 'vitest';

/**
 * Deserialisation is **not** a zero-cost view: it allocates a string key per road node and puts
 * it into a `Map` (`RoadCellGraphBuffer.ts`). Inside a per-workplace loop that is
 * O(workplaces x road cells) string allocations on top of the flood itself (BUG-334).
 *
 * This checks the graph is built once, counting calls with a spy rather than measuring time,
 * because timing tests are flaky.
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
import { WorkplaceDistanceTable } from '../WorkplaceDistanceTable';

const BUDGET = 1080;
const W = 12;
const H = 5;

/** One road across y=2, with workplaces lined up against it at y=1. */
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
    computeWorkplaceDistances(graphBuffer, workplaces, BUDGET, W, H, isBuilding);

    expect(spy.mock.calls.length,
      `${workplaces.length} 個工作地卻建了 ${spy.mock.calls.length} 次圖`).toBe(1);
  });

  it('should give the same answers as flooding each workplace separately', () => {
    const { graphBuffer, isBuilding, workplaces } = fixture();

    const batch = new WorkplaceDistanceTable(
      computeWorkplaceDistances(graphBuffer, workplaces, BUDGET, W, H, isBuilding));

    const graph = deserializeRoadCellGraph(graphBuffer);
    let compared = 0;
    for (const wp of workplaces) {
      const dense = new Int32Array(W * H).fill(-1);
      reverseFloodFromGraph(graph, wp, BUDGET, W, H, isBuilding, dense);
      for (let i = 0; i < dense.length; i++) {
        const x = i % W, y = Math.floor(i / W);
        expect(batch.costAt(x, y, wp.pos),
          `${wp.pos} → (${x},${y}) 批次與單獨算的不一樣`).toBe(dense[i]! < 0 ? undefined : dense[i]!);
        if (dense[i]! >= 0) compared++;
      }
    }
    expect(compared, 'fixture 沒淹到任何建築 —— 這個測試什麼都沒比').toBeGreaterThan(0);
  });

  it('should keep each workplace on its own entry', () => {
    // With the graph shared, every flood takes the same graph object, and **the dense scratch
    // array is shared too**. Without refilling it with -1 before each workplace, later workplaces
    // read earlier ones' residue.
    const { graphBuffer, isBuilding, workplaces } = fixture();

    const together = new WorkplaceDistanceTable(
      computeWorkplaceDistances(graphBuffer, workplaces, BUDGET, W, H, isBuilding));

    for (const wp of workplaces) {
      const alone = new WorkplaceDistanceTable(
        computeWorkplaceDistances(graphBuffer, [wp], BUDGET, W, H, isBuilding));
      for (let i = 0; i < W * H; i++) {
        const x = i % W, y = Math.floor(i / W);
        expect(together.costAt(x, y, wp.pos),
          `${wp.pos} → (${x},${y}) 沾到了別的工作地的殘留`).toBe(alone.costAt(x, y, wp.pos));
      }
    }
  });
});
