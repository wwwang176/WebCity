import { describe, it, expect } from 'vitest';
import { CommuteCache, CachedRoute } from '../CommuteCache';
import type { LaneEdge, ConnectionPoint } from '../LaneGraph';

/** Test helper: store a single-variant route (wraps setRouteVariants for legibility). */
function setSingleRoute(cache: CommuteCache, routeKey: string, path: LaneEdge[]): void {
  cache.setRouteVariants(routeKey, [path]);
}

/** Helper: create a minimal LaneEdge passing through given cells */
function makeEdge(fromCell: string, toCell: string): LaneEdge {
  const [fx, fy] = fromCell.split(',').map(Number);
  const [tx, ty] = toCell.split(',').map(Number);
  const from: ConnectionPoint = {
    id: `${fromCell}:east:0:exit`,
    position: { x: fx!, y: fy! },
    tangent: { tx: 1, ty: 0 },
    cellKey: fromCell,
    lane: 0,
    direction: 'east',
    type: 'exit',
  };
  const to: ConnectionPoint = {
    id: `${toCell}:west:0:entry`,
    position: { x: tx!, y: ty! },
    tangent: { tx: -1, ty: 0 },
    cellKey: toCell,
    lane: 0,
    direction: 'west',
    type: 'entry',
  };
  return {
    id: `${fromCell}>${toCell}`,
    from,
    to,
    length: 1.0,
    type: 'straight',
  };
}

describe('CommuteCache', () => {
  it('should store and retrieve a CachedRoute', () => {
    const cache = new CommuteCache();
    const route: CachedRoute = {
      citizenId: 1,
      homeId: '5,5',
      workplaceId: '10,10',
      morningPath: null,
      eveningPath: null,
      status: 'pending',
      generation: 0,
    };
    cache.set(1, route);
    expect(cache.get(1)).toEqual(route);
    expect(cache.size).toBe(1);
  });

  it('should return undefined for missing citizenId', () => {
    const cache = new CommuteCache();
    expect(cache.get(999)).toBeUndefined();
  });

  it('should markDirty and track dirty count', () => {
    const cache = new CommuteCache();
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '1,1',
      morningPath: null, eveningPath: null, status: 'pending', generation: 0,
    });
    cache.markDirty(1);
    expect(cache.dirtyCount).toBe(1);
  });

  it('should getDirtyBatch returns N dirty citizenIds', () => {
    const cache = new CommuteCache();
    for (let i = 1; i <= 5; i++) {
      cache.set(i, {
        citizenId: i, homeId: `${i},0`, workplaceId: `${i},1`,
        morningPath: null, eveningPath: null, status: 'pending', generation: 0,
      });
      cache.markDirty(i);
    }
    const batch = cache.getDirtyBatch(3);
    expect(batch.length).toBe(3);
    // After getting batch, those IDs should be removed from dirty set
    expect(cache.dirtyCount).toBe(2);
  });

  it('should invalidateCell marks all citizens whose paths pass through that cell as dirty', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '2,0',
      morningPath, eveningPath: null, status: 'ready', generation: 0,
    });
    cache.set(2, {
      citizenId: 2, homeId: '3,3', workplaceId: '4,4',
      morningPath: [makeEdge('3,3', '4,4')], eveningPath: null, status: 'ready', generation: 0,
    });

    // Invalidate cell "1,0" which is on citizen 1's path
    cache.invalidateCell('1,0');
    expect(cache.dirtyCount).toBe(1);

    const batch = cache.getDirtyBatch(10);
    expect(batch).toContain(1);
    expect(batch).not.toContain(2);
  });

  it('should remove a citizen and clean up cellIndex', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '2,0',
      morningPath, eveningPath: null, status: 'ready', generation: 0,
    });
    expect(cache.size).toBe(1);

    cache.remove(1);
    expect(cache.size).toBe(0);
    expect(cache.get(1)).toBeUndefined();

    // After removal, invalidating cells that citizen 1 used should have no effect
    cache.invalidateCell('1,0');
    expect(cache.dirtyCount).toBe(0);
  });

  it('should store and retrieve shared route via routeIndex', () => {
    const cache = new CommuteCache();
    const path = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    const routeKey = '0,0->2,0';
    setSingleRoute(cache,routeKey, path);
    expect(cache.getByRoute(routeKey)).toEqual(path);
  });

  it('should return undefined for unknown routeKey', () => {
    const cache = new CommuteCache();
    expect(cache.getByRoute('unknown')).toBeUndefined();
  });

  it('should invalidateCell also removes affected routes from routeIndex', () => {
    const cache = new CommuteCache();
    const path = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    const routeKey = '0,0->2,0';
    setSingleRoute(cache,routeKey, path);

    // Invalidate cell "1,0" which is on the route
    cache.invalidateCell('1,0');
    expect(cache.getByRoute(routeKey)).toBeUndefined();
  });

  it('should not remove routes for unrelated cell invalidation', () => {
    const cache = new CommuteCache();
    const path = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    const routeKey = '0,0->2,0';
    setSingleRoute(cache,routeKey, path);

    // Invalidate a cell NOT on the route
    cache.invalidateCell('5,5');
    expect(cache.getByRoute(routeKey)).toEqual(path);
  });

  it('should clean up routeCellIndex on invalidateCell', () => {
    const cache = new CommuteCache();
    const path1 = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    const path2 = [makeEdge('1,0', '3,0')];
    setSingleRoute(cache,'route1', path1);
    setSingleRoute(cache,'route2', path2);

    // Both routes pass through "1,0"
    cache.invalidateCell('1,0');
    expect(cache.getByRoute('route1')).toBeUndefined();
    expect(cache.getByRoute('route2')).toBeUndefined();

    // Set a new route through "1,0" — should work fine after cleanup
    const path3 = [makeEdge('1,0', '2,0')];
    setSingleRoute(cache,'route3', path3);
    expect(cache.getByRoute('route3')).toEqual(path3);
  });

  it('should register cells in cellIndex when setting ready routes with paths', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    const eveningPath = [makeEdge('2,0', '1,0'), makeEdge('1,0', '0,0')];

    cache.set(10, {
      citizenId: 10, homeId: '0,0', workplaceId: '2,0',
      morningPath, eveningPath, status: 'ready', generation: 0,
    });

    // Invalidating any cell on the path should dirty citizen 10
    cache.invalidateCell('2,0');
    expect(cache.dirtyCount).toBe(1);
    const batch = cache.getDirtyBatch(10);
    expect(batch).toContain(10);
  });

  it('should not register cells for pending routes', () => {
    const cache = new CommuteCache();
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'pending', generation: 0,
    });
    cache.invalidateCell('0,0');
    expect(cache.dirtyCount).toBe(0);
  });

  it('isDirty should return true for dirty citizens and false otherwise', () => {
    const cache = new CommuteCache();
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'pending', generation: 0,
    });
    expect(cache.isDirty(1)).toBe(false);
    cache.markDirty(1);
    expect(cache.isDirty(1)).toBe(true);
  });

  it('set() should auto-clear dirty flag for the citizen', () => {
    const cache = new CommuteCache();
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '2,0',
      morningPath: [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')],
      eveningPath: null, status: 'ready', generation: 0,
    });
    cache.markDirty(1);
    expect(cache.isDirty(1)).toBe(true);

    // Re-set with new route → dirty should be cleared
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '3,0',
      morningPath: [makeEdge('0,0', '3,0')],
      eveningPath: null, status: 'ready', generation: 0,
    });
    expect(cache.isDirty(1)).toBe(false);
  });

  // ── roadGeneration + isExpired ──

  it('isExpired returns false when generation matches roadGeneration', () => {
    const cache = new CommuteCache();
    const route: CachedRoute = {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'ready', generation: 0,
    };
    cache.set(1, route);
    expect(cache.isExpired(route, 100)).toBe(false);
  });

  it('isExpired assigns random recalcAtTick on first staleness detection and returns false', () => {
    const cache = new CommuteCache();
    cache.roadGeneration = 2;
    const route: CachedRoute = {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'ready', generation: 0,
    };
    cache.set(1, route);

    // First call: assigns recalcAtTick, returns false
    expect(cache.isExpired(route, 10)).toBe(false);
    expect(route.recalcAtTick).toBeDefined();
    expect(route.recalcAtTick!).toBeGreaterThanOrEqual(10);
  });

  it('isExpired returns true when currentTick reaches recalcAtTick', () => {
    const cache = new CommuteCache();
    cache.roadGeneration = 1;
    const route: CachedRoute = {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'ready', generation: 0,
      recalcAtTick: 15,
    };
    cache.set(1, route);

    expect(cache.isExpired(route, 14)).toBe(false);
    expect(cache.isExpired(route, 15)).toBe(true);
    expect(cache.isExpired(route, 20)).toBe(true);
  });

  it('bumpGeneration increments roadGeneration and clears routeIndex', () => {
    const cache = new CommuteCache();
    const path = [makeEdge('0,0', '1,0')];
    setSingleRoute(cache,'0,0->1,0', path);
    expect(cache.getByRoute('0,0->1,0')).toEqual(path);
    expect(cache.roadGeneration).toBe(0);

    cache.bumpGeneration();

    expect(cache.roadGeneration).toBe(1);
    // Shared route pool should be cleared
    expect(cache.getByRoute('0,0->1,0')).toBeUndefined();
  });

  it('isExpired does not reset recalcAtTick on subsequent road changes', () => {
    const cache = new CommuteCache();
    cache.roadGeneration = 1;
    const route: CachedRoute = {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'ready', generation: 0,
    };
    cache.set(1, route);

    // First detection — assigns recalcAtTick
    cache.isExpired(route, 10);
    const firstRecalcAt = route.recalcAtTick;
    expect(firstRecalcAt).toBeDefined();

    // Another road change
    cache.roadGeneration = 2;

    // recalcAtTick should NOT be reassigned (it's already set)
    cache.isExpired(route, 11);
    expect(route.recalcAtTick).toBe(firstRecalcAt);
  });

  // ── routeRefCount ──

  it('should increment routeRefCount when setting a ready route', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    setSingleRoute(cache,'0,0->2,0', morningPath);

    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '2,0',
      morningPath, eveningPath: null, status: 'ready', generation: 0,
    });

    const refs: number[] = [];
    cache.forEachRouteWithRefCount((_path, refCount) => { refs.push(refCount); });
    expect(refs).toEqual([1]);
  });

  it('should accumulate refCount for multiple citizens sharing the same route', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    setSingleRoute(cache,'0,0->2,0', morningPath);

    for (let i = 1; i <= 5; i++) {
      cache.set(i, {
        citizenId: i, homeId: '0,0', workplaceId: '2,0',
        morningPath, eveningPath: null, status: 'ready', generation: 0,
      });
    }

    let totalRef = 0;
    cache.forEachRouteWithRefCount((_path, refCount) => { totalRef += refCount; });
    expect(totalRef).toBe(5);
  });

  it('should decrement routeRefCount when removing a citizen', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0')];
    setSingleRoute(cache,'0,0->1,0', morningPath);

    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath, eveningPath: null, status: 'ready', generation: 0,
    });
    cache.set(2, {
      citizenId: 2, homeId: '0,0', workplaceId: '1,0',
      morningPath, eveningPath: null, status: 'ready', generation: 0,
    });

    cache.remove(1);

    let totalRef = 0;
    cache.forEachRouteWithRefCount((_path, refCount) => { totalRef += refCount; });
    expect(totalRef).toBe(1);
  });

  it('should delete routeRefCount entry when last citizen is removed', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0')];
    setSingleRoute(cache,'0,0->1,0', morningPath);

    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath, eveningPath: null, status: 'ready', generation: 0,
    });

    cache.remove(1);

    let routeCount = 0;
    cache.forEachRouteWithRefCount(() => { routeCount++; });
    expect(routeCount).toBe(0);
  });

  // Renamed from 'should clear routeRefCount on bumpGeneration', which encoded
  // the BUG-061 behaviour as intended AND passed vacuously: forEachRouteWithRefCount
  // iterates routeIndex, which bumpGeneration also clears, so the assertion held
  // whether or not routeRefCount was touched.
  it('should report no routes after bumpGeneration retires the shared pool', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0')];
    setSingleRoute(cache,'0,0->1,0', morningPath);

    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath, eveningPath: null, status: 'ready', generation: 0,
    });

    cache.bumpGeneration();

    let routeCount = 0;
    cache.forEachRouteWithRefCount(() => { routeCount++; });
    expect(routeCount).toBe(0);
  });

  it('should adjust refCounts when a citizen route is replaced', () => {
    const cache = new CommuteCache();
    const path1 = [makeEdge('0,0', '1,0')];
    const path2 = [makeEdge('0,0', '3,0')];
    setSingleRoute(cache,'0,0->1,0', path1);
    setSingleRoute(cache,'0,0->3,0', path2);

    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: path1, eveningPath: null, status: 'ready', generation: 0,
    });

    // Replace with different route
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '3,0',
      morningPath: path2, eveningPath: null, status: 'ready', generation: 0,
    });

    const refCounts: number[] = [];
    cache.forEachRouteWithRefCount((_path, refCount) => { refCounts.push(refCount); });
    // Old route refCount 0 excluded, new route refCount 1
    expect(refCounts).toEqual([1]);
  });

  it('should not increment refCount for pending or failed routes', () => {
    const cache = new CommuteCache();
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'pending', generation: 0,
    });
    cache.set(2, {
      citizenId: 2, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'failed', generation: 0,
    });

    let routeCount = 0;
    cache.forEachRouteWithRefCount(() => { routeCount++; });
    expect(routeCount).toBe(0);
  });

  it('should count both morning and evening route refCounts separately', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0')];
    const eveningPath = [makeEdge('1,0', '0,0')];
    setSingleRoute(cache,'0,0->1,0', morningPath);
    setSingleRoute(cache,'1,0->0,0', eveningPath);

    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath, eveningPath, status: 'ready', generation: 0,
    });

    const refs: number[] = [];
    cache.forEachRouteWithRefCount((_path, refCount) => { refs.push(refCount); });
    expect(refs.sort()).toEqual([1, 1]);
  });

  it('recalcAtTick is cleared after route is re-set with current generation', () => {
    const cache = new CommuteCache();
    cache.roadGeneration = 1;
    const route: CachedRoute = {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'ready', generation: 0,
      recalcAtTick: 5,
    };
    cache.set(1, route);

    // Simulate recalculation: set new route with current generation
    const newRoute: CachedRoute = {
      citizenId: 1, homeId: '0,0', workplaceId: '1,0',
      morningPath: null, eveningPath: null, status: 'ready', generation: 1,
    };
    cache.set(1, newRoute);

    expect(cache.isExpired(newRoute, 100)).toBe(false);
    expect(newRoute.recalcAtTick).toBeUndefined();
  });
});

// BUG-061: bumpGeneration wiped routeRefCount while status:'ready' routes still
// logically held references. When each citizen was later recomputed, set() ran
// adjustRefCounts(old, -1) against the zeroed map, driving the counter to -1;
// applyRefDelta deletes on <= 0, and the following +1 restored it to exactly 1.
// N citizens sharing a route therefore ended at 1 instead of N, permanently.
describe('CommuteCache — refCount survives bumpGeneration', () => {
  function totalRefCount(cache: CommuteCache): number {
    let total = 0;
    cache.forEachRouteWithRefCount((_path, refCount) => { total += refCount; });
    return total;
  }

  function setCitizen(cache: CommuteCache, id: number, path: LaneEdge[], generation: number): void {
    cache.set(id, {
      citizenId: id, homeId: '0,0', workplaceId: '1,0',
      morningPath: path, eveningPath: null, status: 'ready', generation,
    });
  }

  it('should keep the full count when shared routes are recomputed after a bump', () => {
    const cache = new CommuteCache();
    const path = [makeEdge('0,0', '1,0')];
    setSingleRoute(cache, '0,0->1,0', path);
    for (const id of [1, 2, 3]) setCitizen(cache, id, path, 0);
    expect(totalRefCount(cache)).toBe(3);

    cache.bumpGeneration();
    // Every citizen re-computes and lands on the same route, as isExpired()
    // guarantees within RECALC_SPREAD_TICKS.
    setSingleRoute(cache, '0,0->1,0', path);
    for (const id of [1, 2, 3]) setCitizen(cache, id, path, cache.roadGeneration);

    expect(totalRefCount(cache)).toBe(3);
  });

  it('should still drop to zero when the citizens are removed after a bump', () => {
    const cache = new CommuteCache();
    const path = [makeEdge('0,0', '1,0')];
    setSingleRoute(cache, '0,0->1,0', path);
    for (const id of [1, 2]) setCitizen(cache, id, path, 0);

    cache.bumpGeneration();
    setSingleRoute(cache, '0,0->1,0', path);
    for (const id of [1, 2]) setCitizen(cache, id, path, cache.roadGeneration);
    for (const id of [1, 2]) cache.remove(id);

    expect(totalRefCount(cache)).toBe(0);
  });

  it('should move the count when a citizen switches to a different route', () => {
    const cache = new CommuteCache();
    const pathA = [makeEdge('0,0', '1,0')];
    const pathB = [makeEdge('0,0', '0,1')];
    setSingleRoute(cache, '0,0->1,0', pathA);
    setSingleRoute(cache, '0,0->0,1', pathB);
    setCitizen(cache, 1, pathA, 0);

    cache.bumpGeneration();
    setSingleRoute(cache, '0,0->0,1', pathB);
    cache.set(1, {
      citizenId: 1, homeId: '0,0', workplaceId: '0,1',
      morningPath: pathB, eveningPath: null, status: 'ready', generation: cache.roadGeneration,
    });

    expect(totalRefCount(cache)).toBe(1);
  });
});
