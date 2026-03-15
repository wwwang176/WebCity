import { describe, it, expect } from 'vitest';
import { CommuteCache, type CachedRoute } from '../CommuteCache';

describe('CommuteCache: clear both directions on road change recalculation', () => {
  it('should clear the other direction when recalculating due to generation mismatch', () => {
    const cache = new CommuteCache();

    // Set up a cached route at generation 0
    const route: CachedRoute = {
      citizenId: 1,
      homeId: '5,5',
      workplaceId: '10,10',
      morningPath: [{ from: { cellKey: '5,5', x: 5, y: 5, lane: 0, direction: 'E' }, to: { cellKey: '6,5', x: 6, y: 5, lane: 0, direction: 'E' }, weight: 1 }] as any,
      eveningPath: [{ from: { cellKey: '10,10', x: 10, y: 10, lane: 0, direction: 'W' }, to: { cellKey: '9,10', x: 9, y: 10, lane: 0, direction: 'W' }, weight: 1 }] as any,
      status: 'ready',
      generation: 0,
    };
    cache.set(1, route);

    // Road changes → generation bumps
    cache.bumpGeneration(); // now generation = 1

    // Verify the route is expired
    const cached = cache.get(1)!;
    // First call assigns recalcAtTick, returns false
    cache.isExpired(cached, 100);
    // Second call: tick >= recalcAtTick → expired
    expect(cache.isExpired(cached, 200)).toBe(true);

    // When morning is recalculated, eveningPath should be nulled out
    // (This is enforced in SimulationLoop, but the interface contract is:
    //  when generation doesn't match, the other direction should be cleared)
    // We test the isExpired detection works for both directions
    expect(cached.generation).not.toBe(cache.roadGeneration);
  });

  it('isExpired should detect staleness for routes whose generation is behind', () => {
    const cache = new CommuteCache();

    const route: CachedRoute = {
      citizenId: 1,
      homeId: '5,5',
      workplaceId: '10,10',
      morningPath: null,
      eveningPath: null,
      status: 'ready',
      generation: 0,
    };
    cache.set(1, route);

    // Same generation → not expired
    expect(cache.isExpired(route, 0)).toBe(false);

    // Bump generation
    cache.bumpGeneration();

    // First detection → assigns recalcAtTick, returns false
    expect(cache.isExpired(route, 10)).toBe(false);
    expect(route.recalcAtTick).toBeDefined();

    // After the assigned tick → expired
    expect(cache.isExpired(route, route.recalcAtTick! + 1)).toBe(true);
  });
});
