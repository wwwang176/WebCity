import { describe, it, expect } from 'vitest';
import { CommuteCache, CachedRoute } from '../CommuteCache';
import type { LaneEdge, ConnectionPoint } from '../LaneGraph';

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
      morningPath: null, eveningPath: null, status: 'pending',
    });
    cache.markDirty(1);
    expect(cache.dirtyCount).toBe(1);
  });

  it('should getDirtyBatch returns N dirty citizenIds', () => {
    const cache = new CommuteCache();
    for (let i = 1; i <= 5; i++) {
      cache.set(i, {
        citizenId: i, homeId: `${i},0`, workplaceId: `${i},1`,
        morningPath: null, eveningPath: null, status: 'pending',
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
      morningPath, eveningPath: null, status: 'ready',
    });
    cache.set(2, {
      citizenId: 2, homeId: '3,3', workplaceId: '4,4',
      morningPath: [makeEdge('3,3', '4,4')], eveningPath: null, status: 'ready',
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
      morningPath, eveningPath: null, status: 'ready',
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
    cache.setRoute(routeKey, path);
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
    cache.setRoute(routeKey, path);

    // Invalidate cell "1,0" which is on the route
    cache.invalidateCell('1,0');
    expect(cache.getByRoute(routeKey)).toBeUndefined();
  });

  it('should not remove routes for unrelated cell invalidation', () => {
    const cache = new CommuteCache();
    const path = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    const routeKey = '0,0->2,0';
    cache.setRoute(routeKey, path);

    // Invalidate a cell NOT on the route
    cache.invalidateCell('5,5');
    expect(cache.getByRoute(routeKey)).toEqual(path);
  });

  it('should clean up routeCellIndex on invalidateCell', () => {
    const cache = new CommuteCache();
    const path1 = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    const path2 = [makeEdge('1,0', '3,0')];
    cache.setRoute('route1', path1);
    cache.setRoute('route2', path2);

    // Both routes pass through "1,0"
    cache.invalidateCell('1,0');
    expect(cache.getByRoute('route1')).toBeUndefined();
    expect(cache.getByRoute('route2')).toBeUndefined();

    // Set a new route through "1,0" — should work fine after cleanup
    const path3 = [makeEdge('1,0', '2,0')];
    cache.setRoute('route3', path3);
    expect(cache.getByRoute('route3')).toEqual(path3);
  });

  it('should register cells in cellIndex when setting ready routes with paths', () => {
    const cache = new CommuteCache();
    const morningPath = [makeEdge('0,0', '1,0'), makeEdge('1,0', '2,0')];
    const eveningPath = [makeEdge('2,0', '1,0'), makeEdge('1,0', '0,0')];

    cache.set(10, {
      citizenId: 10, homeId: '0,0', workplaceId: '2,0',
      morningPath, eveningPath, status: 'ready',
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
      morningPath: null, eveningPath: null, status: 'pending',
    });
    cache.invalidateCell('0,0');
    expect(cache.dirtyCount).toBe(0);
  });
});
