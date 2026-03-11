import { describe, it, expect } from 'vitest';
import { randomInt, randomElement } from '../random';

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
