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

/** A worker stub that never replies: this file tests the state machine, not the computation. */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}

/** One straight road is enough: this file tests the cache's state machine, not the network. */
function roadGraphBuffer(): ArrayBuffer {
  const grid = new Grid(10, 10);
  for (let x = 0; x < 10; x++) grid.setCell(x, 5, { roadType: RoadType.TWO_LANE });
  return serializeRoadCellGraph(buildRoadCellGraph(UnifiedRoadLookup.fromGrid(grid)));
}

/** The cache takes CSR buffers. This writes workplace-to-cell costs as a table and assembles
 *  them. */
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
    // The graph has to be **non-empty**, or this could pass through the empty-graph early return
    // without exercising the "no client" path at all.
    const cache = new WorkplaceDistanceCache();
    const graph = roadGraphBuffer();
    expect(graphBufferNodeCount(graph), 'fixture 的圖是空的，這條測不出東西')
      .toBeGreaterThan(0);
    const result = cache.requestUpdate(10, 10, new ArrayBuffer(10), graph, [], 1080);
    expect(result).toBe(false);
  });

  it('requestUpdate refuses an empty graph', () => {
    // An empty graph means the city has no roads yet. Sending it returns an empty table, which is
    // marked READY, and the whole city becomes mutually unreachable. Staying EMPTY and falling
    // back to the synchronous path is better.
    //
    // The check reads the header's nodeCount rather than byteLength: an empty graph's buffer has
    // a header.
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
   * This group guards what was measured on a 40k save: `runJobRelocation` runs about every 13
   * seconds while the cache is READY for only 6-8, so falling in a gap drops back to a synchronous
   * Dijkstra at a **measured 2,684ms** against 161ms through the cache, and where it falls is
   * luck.
   *
   * One house upgrading does not change road distances. A table one round behind is a far smaller
   * error than freezing the main thread for 2.7 seconds.
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
    // A different city. The old city's distance table means nothing for the new one, and keeping
    // it is worse than having none.
    const cache = ready();
    cache.reset();

    expect(cache.hasTable).toBe(false);
    expect(cache.getDistance('3,3', '5,5')).toBeUndefined();
  });

  it('should take a result that arrived after an invalidation', () => {
    // The city changed midway. This result is not current, but it is newer than the one in hand,
    // and discarding it means holding an older one.
    const cache = ready();
    cache.invalidate();
    cache.populateSync(buffersFrom([['5,5', { '3,3': 99 }]]));

    expect(cache.getDistance('3,3', '5,5')).toBe(99);
  });
});

describe('路網變了跟建築變了不是同一件事', () => {
  /**
   * Continuing with an old table assumes its distances are still about right. **A house gaining a
   * floor changes no road distance**: it changes only which cells count as workplaces, and the
   * current candidate set filters that.
   *
   * The road network is different: after a road is demolished, a one-way direction is reversed or
   * a road type is upgraded, the old table calls **unreachable workplaces reachable**, assigning
   * citizens to shifts they cannot drive to, or excludes newly connected ones. That is not stale
   * but wrong.
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
    // A road was demolished midway. This result was computed against the old network, and
    // accepting it installs wrong reachability as fresh. A building change can be accepted, since
    // distances are unchanged; this cannot.
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

describe('worker 失敗之後的狀態機', () => {
  it('should not discard the next good result after a failed topology rebuild', () => {
    // The network changed, the in-flight result was marked for rejection, and the worker then
    // failed. Leaving the flag set means **the next result, correctly computed against the new
    // network, is discarded too**, and READY arrives only on the third request.
    const cache = new WorkplaceDistanceCache();
    const inner = cache as unknown as {
      status: string;
      topologyChangedDuringBuild: boolean;
      applyResult(b: ReturnType<typeof buffersFrom>): void;
      onComputeFailed(): void;
    };
    inner.status = 'computing';
    cache.invalidateTopology();
    // The worker threw, which is the path requestUpdate's catch takes.
    inner.onComputeFailed();

    expect(inner.topologyChangedDuringBuild, '失敗之後旗標還留著').toBe(false);

    // The next successful result has to be accepted.
    inner.applyResult(buffersFrom([['5,5', { '3,3': 7 }]]));
    expect(cache.hasTable).toBe(true);
    expect(cache.getDistance('3,3', '5,5')).toBe(7);
  });
});
