import { describe, it, expect } from 'vitest';
import { BusSystem } from '../BusSystem';
import type { LaneEdge } from '../../traffic/LaneGraph';

/**
 * Leg lengths are pure geometry, independent of today's ridership.
 *
 * `findAvailableTransit` calls this once per "which transit options does this citizen
 * have" question, and the commute-spawn loop asks close to a thousand times per tick,
 * allocating a fresh array and re-summing every edge each time. Measured on a
 * 12,696-citizen save with three back-to-back A/B rounds: `findAvailableTransit` went from
 * 17.53 to 12.76ms/tick, **4.77ms/tick saved** (BUG-328).
 *
 * A route's segments array is a new instance on every recompute (`computeRouteSegments`
 * returns and stores a new array, `updateRunningBusSegments` only repoints the reference
 * rather than mutating in place), so the array itself is enough of a key: new segments mean
 * a new key, and a stale answer is structurally unreachable. Same pattern as
 * `PathLengthCache` and `PathCellCache`.
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
 * A two-stop bus route. Each `findEdgePath` call hands back a segment of the next length
 * in `lengths`, so a recompute swaps in a different set of lengths and a stale cache
 * becomes visible.
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
    // This is the whole 4.77ms/tick. A fresh array with identical contents on each call is
    // no cache at all, and every content-comparing assertion still passes.
    const { bus, route } = busWithRoute([3, 4]);
    expect(bus.getSegmentDistances(route.id), '第二次又重算了一遍')
      .toBe(bus.getSegmentDistances(route.id));
  });

  it('should follow the route when its segments are recomputed', () => {
    // Demolishing a road reroutes the line and recomputes its segments. Returning the old
    // lengths would compute headway and waiting time against a road that no longer exists,
    // with no visible symptom.
    // Four lengths: the first pass takes 3 and 4, the second takes 4 and 3.
    const { bus, route, find } = busWithRoute([3, 4, 4, 3]);
    expect(bus.getSegmentDistances(route.id), '前置條件').toEqual([3, 4]);

    bus.computeRouteSegments(route, find);   // this pass yields segments of length 4 and 3
    expect(bus.getSegmentDistances(route.id), '段落重算了，長度還是舊的')
      .toEqual([4, 3]);
  });

  it('should keep two routes apart', () => {
    // One cache shared by all routes would give the second route the first one's lengths.
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
