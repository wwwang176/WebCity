import { describe, it, expect } from 'vitest';
import { WorkplaceDistanceCache } from '../WorkplaceDistanceCache';
import { WorkplaceDistanceClient } from '../WorkplaceDistanceClient';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { buildRoadCellGraph } from '../../road/RoadCellGraph';
import {
  serializeRoadCellGraph, graphBufferNodeCount,
} from '../../road/RoadCellGraphBuffer';

/** 不回覆的 worker stub —— 這個檔案測的是狀態機，不是 worker 的計算。 */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}

/** 一條直路就夠 —— 這個檔案測的是 cache 的狀態機，不是路網。 */
function roadGraphBuffer(): ArrayBuffer {
  const grid = new Grid(10, 10);
  for (let x = 0; x < 10; x++) grid.setCell(x, 5, { roadType: RoadType.TWO_LANE });
  return serializeRoadCellGraph(buildRoadCellGraph(UnifiedRoadLookup.fromGrid(grid)));
}

describe('WorkplaceDistanceCache', () => {
  function makeCache() {
    const cache = new WorkplaceDistanceCache();
    cache.populateSync([
      {
        workplacePos: '5,5',
        distances: { '3,3': 10, '4,4': 5, '6,6': 8 },
      },
      {
        workplacePos: '10,10',
        distances: { '3,3': 20, '8,8': 3 },
      },
    ]);
    return cache;
  }

  it('starts empty', () => {
    const cache = new WorkplaceDistanceCache();
    expect(cache.isReady).toBe(false);
    expect(cache.isStale).toBe(true);
    expect(cache.getStatus()).toBe('empty');
  });

  it('populateSync sets status to ready', () => {
    const cache = makeCache();
    expect(cache.isReady).toBe(true);
    expect(cache.isStale).toBe(false);
  });

  it('getDistance returns correct cost', () => {
    const cache = makeCache();
    expect(cache.getDistance('3,3', '5,5')).toBe(10);
    expect(cache.getDistance('4,4', '5,5')).toBe(5);
    expect(cache.getDistance('8,8', '10,10')).toBe(3);
  });

  it('getDistance returns undefined for unreachable', () => {
    const cache = makeCache();
    expect(cache.getDistance('99,99', '5,5')).toBeUndefined();
    expect(cache.getDistance('3,3', '99,99')).toBeUndefined();
  });

  it('getReachableWorkplaces returns correct set', () => {
    const cache = makeCache();
    const reachable = cache.getReachableWorkplaces('3,3');
    expect(reachable.has('5,5')).toBe(true);
    expect(reachable.has('10,10')).toBe(true);

    const r2 = cache.getReachableWorkplaces('8,8');
    expect(r2.has('10,10')).toBe(true);
    expect(r2.has('5,5')).toBe(false);

    const r3 = cache.getReachableWorkplaces('99,99');
    expect(r3.size).toBe(0);
  });

  it('getDistancesFromHome builds map correctly', () => {
    const cache = makeCache();
    const dists = cache.getDistancesFromHome('3,3', ['5,5', '10,10', '99,99']);
    expect(dists.get('5,5')).toBe(10);
    expect(dists.get('10,10')).toBe(20);
    expect(dists.has('99,99')).toBe(false);
  });

  it('invalidate sets status to empty when ready', () => {
    const cache = makeCache();
    cache.invalidate();
    expect(cache.isReady).toBe(false);
    expect(cache.isStale).toBe(true);
  });

  it('reset clears everything', () => {
    const cache = makeCache();
    cache.reset();
    expect(cache.isReady).toBe(false);
    expect(cache.getDistance('3,3', '5,5')).toBeUndefined();
  });

  it('requestUpdate returns false without client', () => {
    // 圖必須是**非空**的 —— 否則這條可能只是因為空圖提前返回而綠燈，
    // 根本沒驗到「沒有 client」這條路徑。
    const cache = new WorkplaceDistanceCache();
    const graph = roadGraphBuffer();
    expect(graphBufferNodeCount(graph), 'fixture 的圖是空的，這條測不出東西')
      .toBeGreaterThan(0);
    const result = cache.requestUpdate(10, 10, new ArrayBuffer(10), graph, [], 1080);
    expect(result).toBe(false);
  });

  it('requestUpdate refuses an empty graph', () => {
    // 空圖代表城市還沒有路。送出去只會拿回一張空表，而空表會被標成 READY ——
    // 全城變成互相到不了。寧可維持 EMPTY 走同步 fallback。
    //
    // 判斷要看 header 的 nodeCount，不是 byteLength：空圖的 buffer 有 header。
    const cache = new WorkplaceDistanceCache(new WorkplaceDistanceClient(
      new FakeWorker() as unknown as Worker,
    ));
    const empty = serializeRoadCellGraph({
      nodeKeys: [], indexOf: new Map(), offsets: new Uint32Array(1),
      targets: new Uint32Array(0), weights: new Uint16Array(0),
      nodeX: new Uint16Array(0), nodeY: new Uint16Array(0), nodeLevel: new Uint8Array(0),
    });
    expect(empty.byteLength, '空圖的 buffer 應該有 header，不是 0 bytes')
      .toBeGreaterThan(0);
    expect(cache.requestUpdate(10, 10, new ArrayBuffer(10), empty, [], 1080)).toBe(false);
  });
});
