import { describe, it, expect } from 'vitest';
import { CommuteCache } from '../CommuteCache';
import type { LaneEdge } from '../LaneGraph';

/**
 * "This commute has no route" is an answer too, and a different one from "not computed yet".
 *
 * With nowhere to record it, `onResult` returns immediately on a worker's empty array, the
 * retry counter climbs, and past its quota every round recomputes the same impossible route
 * synchronously on the main thread. Measured on a 41k save: 3,362 such routes and 9,838 wasted
 * synchronous A* runs, none of them successful (BUG-369).
 *
 * It shares `routeIndex`'s lifetime: a road change invalidates both.
 */

/** A stub lane edge, only required to be walkable by `collectEdgeCells`. */
function edge(cellKey: string): LaneEdge {
  const pt = (id: string) => ({
    id, position: { x: 0, y: 0 }, tangent: { tx: 1, ty: 0 },
    cellKey, lane: 0, direction: 'east' as const, type: 'exit' as const,
  });
  return { id: `e-${cellKey}`, from: pt(`${cellKey}:x`), to: pt(`${cellKey}:y`), length: 1, type: 'straight' };
}

describe('走不通的通勤路線', () => {
  it('should not claim a route is unroutable before anyone said so', () => {
    expect(new CommuteCache().isUnroutable('1,1->9,9')).toBe(false);
  });

  it('should remember that a route has no path', () => {
    const cc = new CommuteCache();
    cc.markUnroutable('1,1->9,9');

    expect(cc.isUnroutable('1,1->9,9')).toBe(true);
    expect(cc.isUnroutable('9,9->1,1'), '兩個方向被當成同一條').toBe(false);
  });

  it('should forget it when the road network changes', () => {
    // A new road may connect them. Without forgetting, that commute is never computed again.
    const cc = new CommuteCache();
    cc.markUnroutable('1,1->9,9');

    cc.bumpGeneration();

    expect(cc.isUnroutable('1,1->9,9'), '路網變了還記著舊答案').toBe(false);
  });

  it('should forget it when the route turns out to have a path after all', () => {
    // Two records contradicting each other is the hardest kind of breakage to trace. Storing a
    // route means that route exists.
    const cc = new CommuteCache();
    cc.markUnroutable('1,1->9,9');

    cc.setRouteVariants('1,1->9,9', [[edge('5,5')]]);

    expect(cc.isUnroutable('1,1->9,9'), '路線池裡有路，卻同時說它走不通').toBe(false);
    expect(cc.getRouteVariants('1,1->9,9')).toHaveLength(1);
  });

  it('should keep the mark when an empty variant list is stored', () => {
    // An empty variant list is not "has a route"; it is the same statement in other words.
    const cc = new CommuteCache();
    cc.markUnroutable('1,1->9,9');

    cc.setRouteVariants('1,1->9,9', []);

    expect(cc.isUnroutable('1,1->9,9')).toBe(true);
  });
});
