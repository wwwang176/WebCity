import { describe, it, expect } from 'vitest';
import { CommuteCache } from '../CommuteCache';
import type { LaneEdge, ConnectionPoint } from '../LaneGraph';

function fakeEdge(fromCell: string, toCell: string, lane = 0): LaneEdge {
  return {
    id: `${fromCell}:east:${lane}:exit->${toCell}:west:${lane}:entry`,
    from: { id: `${fromCell}:east:${lane}:exit`, cellKey: fromCell, x: 0, y: 0, lane, direction: 'east', type: 'exit', position: { x: 0, y: 0 }, tangent: { tx: 1, ty: 0 } } as ConnectionPoint,
    to: { id: `${toCell}:west:${lane}:entry`, cellKey: toCell, x: 1, y: 0, lane, direction: 'west', type: 'entry', position: { x: 1, y: 0 }, tangent: { tx: -1, ty: 0 } } as ConnectionPoint,
    length: 1,
    type: 'straight',
  };
}

describe('CommuteCache route variants', () => {
  it('should store and retrieve route variants', () => {
    const cache = new CommuteCache();
    const variant1 = [fakeEdge('0,0', '1,0', 0)];
    const variant2 = [fakeEdge('0,0', '1,0', 1)];
    const variants = [variant1, variant2];

    cache.setRouteVariants('A->B', variants);

    const retrieved = cache.getRouteVariants('A->B');
    expect(retrieved).toBeDefined();
    expect(retrieved!.length).toBe(2);
    expect(retrieved![0]).toBe(variant1);
    expect(retrieved![1]).toBe(variant2);
  });

  it('getRouteVariants should return undefined for unknown route', () => {
    const cache = new CommuteCache();
    expect(cache.getRouteVariants('X->Y')).toBeUndefined();
  });

  it('bumpGeneration should clear route variants', () => {
    const cache = new CommuteCache();
    cache.setRouteVariants('A->B', [[fakeEdge('0,0', '1,0')]]);

    cache.bumpGeneration();

    expect(cache.getRouteVariants('A->B')).toBeUndefined();
  });

  it('forEachRouteWithRefCount should distribute refCount across variants', () => {
    const cache = new CommuteCache();
    const v1 = [fakeEdge('0,0', '1,0', 0)];
    const v2 = [fakeEdge('0,0', '1,0', 1)];
    cache.setRouteVariants('A->B', [v1, v2]);

    // Simulate 10 citizens using this route
    for (let i = 0; i < 10; i++) {
      cache.set(i, {
        citizenId: i,
        homeId: 'A',
        workplaceId: 'B',
        morningPath: i % 2 === 0 ? v1 : v2,
        eveningPath: null,
        status: 'ready',
        generation: 0,
      });
    }

    const results: { path: LaneEdge[]; refCount: number }[] = [];
    cache.forEachRouteWithRefCount((path, refCount) => {
      results.push({ path, refCount });
    });

    // Should iterate 2 variants with refCount split
    expect(results.length).toBe(2);
    expect(results[0]!.refCount).toBe(5); // 10 / 2 variants
    expect(results[1]!.refCount).toBe(5);
  });

  // Backward compat: getByRoute should still work (returns first variant)
  it('getByRoute should return first variant for backward compat', () => {
    const cache = new CommuteCache();
    const v1 = [fakeEdge('0,0', '1,0', 0)];
    const v2 = [fakeEdge('0,0', '1,0', 1)];
    cache.setRouteVariants('A->B', [v1, v2]);

    const result = cache.getByRoute('A->B');
    expect(result).toBe(v1);
  });
});
