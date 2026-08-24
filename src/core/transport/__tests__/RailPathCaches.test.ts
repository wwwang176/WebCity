import { describe, it, expect } from 'vitest';
import { RailSystem } from '../RailSystem';

/**
 * A route's path points are parsed once.
 *
 * Without a cache, `getRoutePathPoints()` reruns `parsePosKeyUnsafe` over every node
 * string of the path on each call, and `TrainAnimator` calls it **per frame per train** —
 * once of those only to read `segments.length` and check whether the route changed.
 *
 * Measured on a 12,400-citizen save at speed 10: `parsePosKeyUnsafe` took **9.3%** of
 * main-thread CPU, the largest single JS function, with **74% of its calls from
 * RailSystem**.
 *
 * ### Invalidation is by identity, not by remembering to clear
 *
 * The cache records which array it was built from. A replaced `routePaths` is a different
 * array, misses, and is rebuilt. This repo has been bitten nine times by caches that had
 * to be cleared by hand (the BUG-331 family), so no invalidation here depends on anyone
 * remembering.
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
    // Reparsing every frame is the whole problem. The same object back means no reparse.
    const sys = systemWithPath(1, [['0,0', '1,0']]);

    const first = sys.getRoutePathPoints(1);
    const second = sys.getRoutePathPoints(1);

    expect(second, '每次呼叫都重新解析了一遍').toBe(first);
  });

  it('should notice when the route path is replaced', () => {
    // Demolishing a station or editing a route replaces `routePaths` with a new array.
    // Missing that leaves trains running along track that no longer exists.
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

  it('should key on the source array, not on the route id', () => {
    // The cache keys on **the array**, not on the route id. This pins two things:
    //
    // 1. Swapping away and back to the same source returns the original result, which is
    //    only possible if the key is the array rather than the id.
    // 2. That behaviour requires a `WeakMap`, and the real reason for `WeakMap` is that
    //    **nothing has to be cleaned up**: once a route is deleted its array becomes
    //    unreachable and the cached value is collected with it.
    //
    // A "clearing the cache when a route is deleted" test cannot be written honestly here:
    // it would have to call the getter again after removing the source to create the
    // cleanup opportunity, and production never does that — after deletion nobody asks
    // about that id again.
    const sys = new RailSystem();
    const inner = sys as unknown as Internals;
    const first = [['0,0', '1,0']];
    const second = [['5,5', '6,5']];

    inner.routePaths.set(1, first);
    const fromFirst = sys.getRoutePathPoints(1);
    const distFirst = sys.getSegmentDistances(1);

    inner.routePaths.set(1, second);
    expect(sys.getRoutePathPoints(1), '換了來源卻沿用舊結果').not.toBe(fromFirst);

    inner.routePaths.set(1, first);
    expect(sys.getRoutePathPoints(1), '換回同一份來源卻重算了 —— 鍵是 id 不是陣列')
      .toBe(fromFirst);
    expect(sys.getSegmentDistances(1), '段落長度同上').toBe(distFirst);
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

  it('should not let the two caches feed each other', () => {
    // Both caches key on **the same source array**. Passing the same WeakMap to both would
    // let whichever is computed first be picked up by the other as its own result, turning
    // segment distances into coordinate objects or the reverse.
    //
    // Every test above uses its own RailSystem and never interleaves the two calls, so
    // none of them can catch this. Both orders are exercised: neither may contaminate the
    // other.
    for (const pointsFirst of [true, false]) {
      const sys = systemWithPath(1, [['0,0', '3,0', '3,4']]);
      if (pointsFirst) { sys.getRoutePathPoints(1); } else { sys.getSegmentDistances(1); }

      expect(sys.getRoutePathPoints(1), `points 先算=${pointsFirst}:路徑點被污染`)
        .toEqual([[{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]]);
      expect(sys.getSegmentDistances(1), `points 先算=${pointsFirst}:段落長度被污染`)
        .toEqual([7]);
    }
  });

  it('should return null for a route it has never seen', () => {
    expect(new RailSystem().getRoutePathPoints(42)).toBeNull();
  });
});

describe('每一段路多長只算一次（鐵路）', () => {
  /**
   * `RailSystem` overrides `BusSystem.getSegmentDistances()`, which is cached (BUG-328,
   * measured at 4.77ms/tick saved), so the override needs its own cache.
   *
   * `findAvailableTransit` calls it once per citizen per route: 200,000 calls in 12 seconds
   * when measured, each reparsing every node of the path twice.
   */
  it('should give the same numbers as walking the path', () => {
    const sys = systemWithPath(1, [['0,0', '3,0', '3,4'], ['3,4', '0,0']]);

    // First leg 3 + 4 = 7; second leg is the straight line from (3,4) to (0,0) = 5.
    expect(sys.getSegmentDistances(1)).toEqual([7, 5]);
  });

  it('should hand back the very same array on a second ask', () => {
    // This is the entire point of the cache. A fresh array with identical contents on each
    // call is no cache at all, and every content-comparing assertion still passes.
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
