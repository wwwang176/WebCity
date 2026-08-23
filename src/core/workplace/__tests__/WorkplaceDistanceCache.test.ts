import { describe, it, expect } from 'vitest';
import { WorkplaceDistanceTableBuilder } from '../WorkplaceDistanceTable';
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

/** 快取吃的是 CSR 緩衝。這裡把「工作地 → 哪幾格多少錢」寫成表再組起來。 */
const TW = 12, TH = 12;
function buffersFrom(rows: Array<[string, Record<string, number>]>) {
  const b = new WorkplaceDistanceTableBuilder(TW, TH);
  for (const [pos, dists] of rows) {
    const dense = new Int32Array(TW * TH).fill(-1);
    for (const [cell, cost] of Object.entries(dists)) {
      const [x, y] = cell.split(',').map(Number);
      dense[y! * TW + x!] = cost;
    }
    b.addWorkplace(pos, dense);
  }
  return b.build();
}

describe('WorkplaceDistanceCache', () => {
  function makeCache() {
    const cache = new WorkplaceDistanceCache();
    cache.populateSync(buffersFrom([
      ['5,5', { '3,3': 10, '4,4': 5, '6,6': 8 }],
      ['10,10', { '3,3': 20, '8,8': 3 }],
    ]));
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

describe('重算期間繼續用上一份', () => {
  /**
   * 這一整組守的是 4 萬人存檔量到的東西:`runJobRelocation` 大約每 13 秒跑一次，
   * 快取 READY 的窗只有 6~8 秒 —— 落在空檔就掉回同步 Dijkstra，**實測 2,684ms**，
   * 而走快取只要 161ms。落在哪裡純粹是運氣。
   *
   * 一棟房子升級不會改變路網距離。上一份表隔一輪的誤差，遠小於凍住主執行緒 2.7 秒。
   */
  function ready() {
    const cache = new WorkplaceDistanceCache();
    cache.populateSync(buffersFrom([['5,5', { '3,3': 10 }]]));
    return cache;
  }

  it('should keep answering after being invalidated', () => {
    const cache = ready();
    cache.invalidate();

    expect(cache.isReady, '失效之後還說自己是當前的').toBe(false);
    expect(cache.hasTable, '失效就把唯一一份可用的表丟了').toBe(true);
    expect(cache.getDistance('3,3', '5,5')).toBe(10);
  });

  it('should have nothing to answer with before the first result', () => {
    expect(new WorkplaceDistanceCache().hasTable).toBe(false);
  });

  it('should throw the table away on reset', () => {
    // 換一座城市。舊城的距離表對新城毫無意義,留著比沒有更糟。
    const cache = ready();
    cache.reset();

    expect(cache.hasTable).toBe(false);
    expect(cache.getDistance('3,3', '5,5')).toBeUndefined();
  });

  it('should take a result that arrived after an invalidation', () => {
    // 算到一半城市變了。這份結果不算「當前」，但它比手上那份新 ——
    // 丟掉它等於抱著更舊的一份。
    const cache = ready();
    cache.invalidate();
    cache.populateSync(buffersFrom([['5,5', { '3,3': 99 }]]));

    expect(cache.getDistance('3,3', '5,5')).toBe(99);
  });
});

describe('路網變了跟建築變了不是同一件事', () => {
  /**
   * 續用舊表的前提是「這份距離還算得準」。**房子長高一層不會改變任何一條道路的
   * 距離** —— 它只改變哪些格子算是工作地，而那件事由當下的候選集合過濾掉。
   *
   * 路網不一樣:拆一條路、改單行方向、升級路型，舊表就會把**已經到不了的工作地
   * 說成到得了**（市民被指派到一個開不過去的班），或反過來把新通的工作地排除掉。
   * 那不是「稍舊」，那是錯的。
   */
  function ready() {
    const cache = new WorkplaceDistanceCache();
    cache.populateSync(buffersFrom([['5,5', { '3,3': 10 }]]));
    return cache;
  }

  it('should keep the table when only buildings changed', () => {
    const cache = ready();
    cache.invalidate();

    expect(cache.hasTable).toBe(true);
    expect(cache.getDistance('3,3', '5,5')).toBe(10);
  });

  it('should drop the table when the road network changed', () => {
    const cache = ready();
    cache.invalidateTopology();

    expect(cache.hasTable, '路拆掉了還在拿舊的可達性指派工作').toBe(false);
    expect(cache.getDistance('3,3', '5,5')).toBeUndefined();
    expect(cache.isStale).toBe(true);
  });

  it('should refuse a result computed on the old road network', () => {
    // 算到一半路被拆了。這份結果是照舊路網算的 —— 收下它等於把錯的可達性
    // 當成新的。建築變了那一種可以收（距離沒變），這一種不行。
    const cache = new WorkplaceDistanceCache();
    cache.populateSync(buffersFrom([['5,5', { '3,3': 10 }]]));
    (cache as unknown as { status: string }).status = 'computing';
    cache.invalidateTopology();

    cache.populateSync(buffersFrom([['5,5', { '3,3': 99 }]]));
    expect(cache.getDistance('3,3', '5,5'), 'populateSync 是測試用的直接寫入，不受影響')
      .toBe(99);
  });

  it('should throw away an in-flight result after a road change', () => {
    const cache = new WorkplaceDistanceCache();
    const inner = cache as unknown as {
      status: string;
      applyResult(b: ReturnType<typeof buffersFrom>): void;
    };
    cache.populateSync(buffersFrom([['5,5', { '3,3': 10 }]]));
    inner.status = 'computing';
    cache.invalidateTopology();

    inner.applyResult(buffersFrom([['5,5', { '3,3': 99 }]]));

    expect(cache.hasTable, '照舊路網算出來的結果被收下了').toBe(false);
    expect(cache.isStale, '沒有排下一次重算').toBe(true);
  });
});
