import { describe, it, expect } from 'vitest';
import { BusSystem } from '../BusSystem';
import type { LaneEdge } from '../../traffic/LaneGraph';

/**
 * 每一段路多長，是純幾何 —— 跟今天有幾個人搭車無關。
 *
 * 但 `findAvailableTransit` 每問一次「這個人有哪些大眾運輸可選」就呼叫它一次，而生成
 * 通勤車的迴圈每個 tick 要問將近一千次 —— 每次都重新配置一個陣列，把每一段的所有
 * 邊長重加一遍。玩家存檔實測（人口 12 696），同場交替 A/B 三輪:
 * `findAvailableTransit` 17.53 → 12.76ms/tick，**省下 4.77ms/tick**（BUG-328）。
 *
 * 路線的段落陣列每次重算都是新的實體（`computeRouteSegments` 回傳並存進新陣列，
 * `updateRunningBusSegments` 只是把參考指過去、不就地改），所以以陣列本身當 key
 * 就夠 —— 段落換了 key 就換了，結構上不可能拿到過期的答案。與 `PathLengthCache`、
 * `PathCellCache` 同一個模式。
 */

function makeEdge(id: string, from: string, to: string): LaneEdge {
  const [fx, fy] = from.split(',').map(Number);
  const [tx, ty] = to.split(',').map(Number);
  return {
    id,
    from: { id: `${id}_f`, cellKey: from, position: { x: fx!, y: fy! }, lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 } },
    to: { id: `${id}_t`, cellKey: to, position: { x: tx!, y: ty! }, lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 } },
    length: 1, type: 'straight',
  } as LaneEdge;
}

/**
 * 兩站的公車路線。`findEdgePath` 每被呼叫一次就交出 `lengths` 裡下一個長度的段落，
 * 所以重算一次就會換成另一組長度 —— 快取沒跟上就看得出來。
 */
function busWithRoute(lengths: number[]) {
  const bus = new BusSystem();
  const a = bus.addStop(0, 0);
  const b = bus.addStop(5, 0);
  const route = bus.createRoute([a, b]);
  let call = 0;
  const find = (): LaneEdge[] => {
    const n = lengths[call++ % lengths.length]!;
    return Array.from({ length: n }, (_, i) => makeEdge(`e${call}_${i}`, `${i},0`, `${i + 1},0`));
  };
  bus.computeRouteSegments(route, find);
  return { bus, route, find };
}

describe('每一段路多長只算一次', () => {
  it('should give the same numbers as summing the edges', () => {
    const { bus, route } = busWithRoute([3, 4]);
    expect(bus.getSegmentDistances(route.id), '段落長度算錯').toEqual([3, 4]);
  });

  it('should hand back the very same array on a second ask', () => {
    // 這是省下 4.77ms/tick 的唯一理由。內容相同但每次新建的陣列等於沒有快取，
    // 而所有比內容的斷言都還是會綠。
    const { bus, route } = busWithRoute([3, 4]);
    expect(bus.getSegmentDistances(route.id), '第二次又重算了一遍')
      .toBe(bus.getSegmentDistances(route.id));
  });

  it('should follow the route when its segments are recomputed', () => {
    // 路被拆掉、路線改道，段落會重算。還回舊長度的話，班距與等車時間會照著一條
    // 已經不存在的路算，而且沒有任何看得見的徵兆。
    // 四個長度:第一次重算拿 3、4，第二次拿 4、3。
    const { bus, route, find } = busWithRoute([3, 4, 4, 3]);
    expect(bus.getSegmentDistances(route.id), '前置條件').toEqual([3, 4]);

    bus.computeRouteSegments(route, find);   // 這一次拿到的是長度 4 與 3 的段落
    expect(bus.getSegmentDistances(route.id), '段落重算了，長度還是舊的')
      .toEqual([4, 3]);
  });

  it('should keep two routes apart', () => {
    // 一份快取共用給所有路線的話，第二條路線會拿到第一條的長度。
    const bus = new BusSystem();
    const mk = (ids: [number, number], n: number) => {
      const r = bus.createRoute([bus.addStop(ids[0], 0), bus.addStop(ids[1], 0)]);
      bus.computeRouteSegments(r, () =>
        Array.from({ length: n }, (_, i) => makeEdge(`r${r.id}_${i}`, `${i},0`, `${i + 1},0`)));
      return r;
    };
    const short = mk([0, 2], 2);
    const long = mk([10, 20], 7);
    expect(bus.getSegmentDistances(short.id)).toEqual([2, 2]);
    expect(bus.getSegmentDistances(long.id), '兩條路線共用了同一份長度').toEqual([7, 7]);
  });

  it('should say nothing about a route it has no segments for', () => {
    expect(new BusSystem().getSegmentDistances(999)).toBeNull();
  });
});
