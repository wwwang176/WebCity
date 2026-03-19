import { describe, it, expect } from 'vitest';
import { WorkplaceDistanceCache } from '../WorkplaceDistanceCache';

describe('WorkplaceDistanceCache', () => {
  function makeCache() {
    const cache = new WorkplaceDistanceCache();
    cache.populateSync([
      {
        workplacePos: '5,5',
        distances: { '3,3': 10, '4,4': 5, '6,6': 8 },
      },
      {
        workplacePos: '10,10',
        distances: { '3,3': 20, '8,8': 3 },
      },
    ]);
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
    const cache = new WorkplaceDistanceCache();
    const result = cache.requestUpdate(10, 10, new ArrayBuffer(10), [], 60);
    expect(result).toBe(false);
  });
});
