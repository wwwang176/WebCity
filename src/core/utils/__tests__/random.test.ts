import { describe, it, expect } from 'vitest';
import { randomInt, randomElement, pickWeighted } from '../random';

describe('randomInt', () => {
  it('should return 0 when max is 1', () => {
    for (let i = 0; i < 20; i++) {
      expect(randomInt(1)).toBe(0);
    }
  });

  it('should return values in range [0, max)', () => {
    for (let i = 0; i < 100; i++) {
      const val = randomInt(10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(10);
      expect(Number.isInteger(val)).toBe(true);
    }
  });
});

describe('randomElement', () => {
  it('should return the only element of a single-element array', () => {
    expect(randomElement([42])).toBe(42);
  });

  it('should return an element from the array', () => {
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(randomElement(arr));
    }
  });
});

describe('pickWeighted', () => {
  it('returns the only entry when pool has one item', () => {
    const pool = [{ val: 'A', weight: 1 }];
    const result = pickWeighted(pool, 1, e => e.weight);
    expect(result.val).toBe('A');
  });

  it('returns items from the pool', () => {
    const pool = [
      { val: 'A', weight: 3 },
      { val: 'B', weight: 7 },
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(pickWeighted(pool, 10, e => e.weight).val);
    }
    expect(seen.has('A')).toBe(true);
    expect(seen.has('B')).toBe(true);
  });

  it('always returns last entry as fallback', () => {
    // Edge case: totalWeight = 0 should fall through to last element
    const pool = [{ val: 'X', weight: 0 }];
    expect(pickWeighted(pool, 0, e => e.weight).val).toBe('X');
  });

  it('respects weight proportions', () => {
    // Item with weight 100 vs weight 0: should almost always pick the heavy one
    const pool = [
      { val: 'heavy', weight: 100 },
      { val: 'zero', weight: 0 },
    ];
    let heavyCount = 0;
    for (let i = 0; i < 100; i++) {
      if (pickWeighted(pool, 100, e => e.weight).val === 'heavy') heavyCount++;
    }
    expect(heavyCount).toBe(100);
  });
});
