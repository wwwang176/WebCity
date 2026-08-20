import { describe, it, expect } from 'vitest';
import { RailSystem } from '../RailSystem';

/**
 * 路線的路徑點只解析一次。
 *
 * `getRoutePathPoints()` 原本每次呼叫都把整條路徑的節點字串重新 `parsePosKeyUnsafe`
 * 一遍 —— 而 `TrainAnimator` **每一幀、每一列車**呼叫它，其中一次還只是為了讀
 * `segments.length` 來判斷路線有沒有變。
 *
 * 實測(玩家 12 400 人的存檔，速度 10):`parsePosKeyUnsafe` 佔主執行緒 CPU 的
 * **9.3%**，是所有 JS 函式裡最大的一個，而 **74% 的呼叫來自 RailSystem**。
 *
 * ### 失效靠身分比對，不靠記得清快取
 *
 * 快取存著「我是從哪一個陣列建出來的」。`routePaths` 換過（新的陣列）就對不上，
 * 自動重建。這個 repo 在「記得清快取」上吃過九次虧（BUG-331 那一整類），所以這裡
 * 不留任何需要人記得的失效點。
 */

type Internals = { routePaths: Map<number, string[][]> };

function systemWithPath(routeId: number, paths: string[][]): RailSystem {
  const sys = new RailSystem();
  (sys as unknown as Internals).routePaths.set(routeId, paths);
  return sys;
}

describe('路線路徑點的快取', () => {
  it('should parse the node keys into points', () => {
    const sys = systemWithPath(1, [['0,0', '1,0', '2,3'], ['2,3', '0,0']]);

    expect(sys.getRoutePathPoints(1)).toEqual([
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 3 }],
      [{ x: 2, y: 3 }, { x: 0, y: 0 }],
    ]);
  });

  it('should hand back the same arrays instead of re-parsing', () => {
    // 每幀重解一次是整個問題的來源。同一個物件回來就代表沒有重解。
    const sys = systemWithPath(1, [['0,0', '1,0']]);

    const first = sys.getRoutePathPoints(1);
    const second = sys.getRoutePathPoints(1);

    expect(second, '每次呼叫都重新解析了一遍').toBe(first);
  });

  it('should notice when the route path is replaced', () => {
    // 車站被拆、路線被改 → `routePaths` 換成新的陣列。沒發現的話列車會沿著
    // 一條已經不存在的軌道跑。
    const sys = systemWithPath(1, [['0,0', '1,0']]);
    expect(sys.getRoutePathPoints(1)).toEqual([[{ x: 0, y: 0 }, { x: 1, y: 0 }]]);

    (sys as unknown as Internals).routePaths.set(1, [['5,5', '6,5', '7,5']]);

    expect(sys.getRoutePathPoints(1), '路線換了，回來的還是舊的點')
      .toEqual([[{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }]]);
  });

  it('should return null once the route is gone', () => {
    const sys = systemWithPath(1, [['0,0', '1,0']]);
    sys.getRoutePathPoints(1);

    (sys as unknown as Internals).routePaths.delete(1);

    expect(sys.getRoutePathPoints(1), '路線刪掉了還拿得到路徑').toBeNull();
  });

  it('should not keep entries for routes that no longer exist', () => {
    // 路線 id 是遞增的，刪掉的號碼不會被重用 —— 不清的話，一場玩很久、路線改很多次
    // 的遊戲會一直長。讀不到（前面的 null 就擋掉了），但會一直佔著。
    const sys = systemWithPath(1, [['0,0', '1,0']]);
    const inner = sys as unknown as Internals & {
      pathPointsCache: Map<number, unknown>;
      segmentDistCache: Map<number, unknown>;
    };
    sys.getRoutePathPoints(1);
    sys.getSegmentDistances(1);
    expect(inner.pathPointsCache.size).toBe(1);
    expect(inner.segmentDistCache.size).toBe(1);

    inner.routePaths.delete(1);
    sys.getRoutePathPoints(1);
    sys.getSegmentDistances(1);

    expect(inner.pathPointsCache.size, '路線刪了，路徑點的快取還留著').toBe(0);
    expect(inner.segmentDistCache.size, '路線刪了，段落長度的快取還留著').toBe(0);
  });

  it('should keep routes apart', () => {
    const sys = new RailSystem();
    const inner = sys as unknown as Internals;
    inner.routePaths.set(1, [['0,0', '1,0']]);
    inner.routePaths.set(2, [['9,9', '9,8']]);

    expect(sys.getRoutePathPoints(1)).toEqual([[{ x: 0, y: 0 }, { x: 1, y: 0 }]]);
    expect(sys.getRoutePathPoints(2), '兩條路線共用了同一份快取')
      .toEqual([[{ x: 9, y: 9 }, { x: 9, y: 8 }]]);
    expect(sys.getRoutePathPoints(1), '算了第二條之後第一條就壞了')
      .toEqual([[{ x: 0, y: 0 }, { x: 1, y: 0 }]]);
  });

  it('should return null for a route it has never seen', () => {
    expect(new RailSystem().getRoutePathPoints(42)).toBeNull();
  });
});

describe('每一段路多長只算一次（鐵路）', () => {
  /**
   * `BusSystem.getSegmentDistances()` 早就有快取（BUG-328，實測省 4.77ms/tick），
   * 但 `RailSystem` **覆寫了它而且沒有快取** —— 而鐵路這一支沒有任何測試守著，
   * 所以漏掉之後沒人發現。
   *
   * `findAvailableTransit` 每問一個人、每條路線就呼叫它一次:實測 12 秒 20 萬次，
   * 每次把整條路徑的每個節點解析兩遍。
   */
  it('should give the same numbers as walking the path', () => {
    const sys = systemWithPath(1, [['0,0', '3,0', '3,4'], ['3,4', '0,0']]);

    // 第一段 3 + 4 = 7；第二段是 (3,4) 到 (0,0) 的直線 = 5。
    expect(sys.getSegmentDistances(1)).toEqual([7, 5]);
  });

  it('should hand back the very same array on a second ask', () => {
    // 這是整個修法的唯一理由。內容相同但每次新建的陣列等於沒有快取，
    // 而所有比內容的斷言都還是會綠。
    const sys = systemWithPath(1, [['0,0', '1,0', '2,0']]);

    expect(sys.getSegmentDistances(1), '第二次又把整條路徑重解了一遍')
      .toBe(sys.getSegmentDistances(1));
  });

  it('should notice when the route path is replaced', () => {
    const sys = systemWithPath(1, [['0,0', '1,0']]);
    expect(sys.getSegmentDistances(1)).toEqual([1]);

    (sys as unknown as Internals).routePaths.set(1, [['0,0', '9,0']]);

    expect(sys.getSegmentDistances(1), '路線換了，段落長度還是舊的').toEqual([9]);
  });

  it('should return null once the route is gone', () => {
    const sys = systemWithPath(1, [['0,0', '1,0']]);
    sys.getSegmentDistances(1);

    (sys as unknown as Internals).routePaths.delete(1);

    expect(sys.getSegmentDistances(1)).toBeNull();
  });

  it('should keep routes apart', () => {
    const sys = new RailSystem();
    const inner = sys as unknown as Internals;
    inner.routePaths.set(1, [['0,0', '1,0']]);
    inner.routePaths.set(2, [['0,0', '4,0']]);

    expect(sys.getSegmentDistances(1)).toEqual([1]);
    expect(sys.getSegmentDistances(2), '兩條路線共用了同一份快取').toEqual([4]);
    expect(sys.getSegmentDistances(1), '算了第二條之後第一條就壞了').toEqual([1]);
  });
});
