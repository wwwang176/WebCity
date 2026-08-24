import { describe, it, expect } from 'vitest';
import { selectNth } from '../quickselect';

/** The reference implementation: sort, then index. */
function bySort(values: readonly number[], k: number): number {
  return [...values].sort((a, b) => a - b)[k]!;
}

describe('selectNth', () => {
  it('should return the k-th smallest, matching a full sort', () => {
    const values = [7, 1, 9, 3, 3, 8, 2];
    for (let k = 0; k < values.length; k++) {
      expect(selectNth(values, k), `k=${k}`).toBe(bySort(values, k));
    }
  });

  it('should handle the shapes that break naive partitioning', () => {
    const cases: [string, number[]][] = [
      ['單一元素', [42]],
      ['兩個元素、順序相反', [2, 1]],
      ['全部相同', [5, 5, 5, 5, 5, 5, 5]],
      ['已經排好', [1, 2, 3, 4, 5, 6, 7, 8]],
      ['完全逆序', [8, 7, 6, 5, 4, 3, 2, 1]],
      ['只有兩種值', [1, 9, 1, 9, 1, 9, 1, 9, 1]],
      ['有負數與零', [0, -3, 5, -3, 0, 2]],
      ['浮點數', [1.5, 1.25, 1.75, 1.5, 0.5]],
    ];
    for (const [name, values] of cases) {
      for (let k = 0; k < values.length; k++) {
        expect(selectNth(values, k), `${name} k=${k}`).toBe(bySort(values, k));
      }
    }
  });

  it('should agree with a full sort on a large pseudo-random array', () => {
    // A fixed seed, so a failure can be reproduced.
    let s = 12345;
    const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    const values = Array.from({ length: 5000 }, () => rnd() * 100);

    for (const k of [0, 1, 1249, 2500, 3751, 4998, 4999]) {
      expect(selectNth(values, k), `k=${k}`).toBe(bySort(values, k));
    }
  });

  it('should not modify the array it was given', () => {
    // The commute statistics do not reuse `times` afterwards, but this guards the day someone
    // computes something else from it.
    const values = [5, 3, 9, 1];
    const before = [...values];
    selectNth(values, 2);
    expect(values).toEqual(before);
  });

  it('should return undefined for an out-of-range k', () => {
    expect(selectNth([1, 2, 3], 3)).toBeUndefined();
    expect(selectNth([1, 2, 3], -1)).toBeUndefined();
    expect(selectNth([], 0)).toBeUndefined();
  });
});
