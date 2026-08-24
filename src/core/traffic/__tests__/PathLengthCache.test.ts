import { describe, it, expect } from 'vitest';
import { PathLengthCache } from '../PathLengthCache';
import type { LaneEdge } from '../LaneGraph';


/**
 * "How far has this vehicle travelled" is computed once per vehicle per frame — it is the sort
 * key for processing vehicles front to back. Re-summing the preceding edge lengths from the
 * start of the path each time walked 14,438 edges per frame just to sort, measured on a
 * 12,288-population save.
 *
 * The prefix sums depend only on the path, not the vehicle, and commute routes are shared:
 * `CommuteCache`'s route pool hands the same array to every citizen on that trip, so hundreds
 * of vehicles on one route share a single copy.
 */

function path(lengths: number[]): LaneEdge[] {
  return lengths.map((length, i) => ({
    id: `e${i}`,
    from: {
      id: `p${i}`, cellKey: `${i},0`, position: { x: i, y: 0 },
      lane: 0, direction: 'east' as const, type: 'exit' as const, tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: `p${i + 1}`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
      lane: 0, direction: 'east' as const, type: 'entry' as const, tangent: { tx: 1, ty: 0 },
    },
    length, type: 'straight' as const,
  }));
}

/** The direct summation. The cache must give the same answer. */
function naive(p: readonly LaneEdge[], edgeIndex: number, edgeProgress: number): number {
  let total = 0;
  for (let i = 0; i < edgeIndex && i < p.length; i++) total += p[i]!.length;
  return total + edgeProgress;
}

describe('走了多遠', () => {
  it('should agree with summing the edges every time', () => {
    const cache = new PathLengthCache();
    const p = path([1.0, 0.7, 1.3, 0.5]);
    for (let ei = 0; ei <= p.length; ei++) {
      for (const prog of [0, 0.25, 0.5]) {
        expect(cache.totalProgress(p, ei, prog), `edgeIndex=${ei} progress=${prog} 算錯`)
          .toBeCloseTo(naive(p, ei, prog), 10);
      }
    }
  });

  it('should survive an edgeIndex past the end of the path', () => {
    // A vehicle reaching the end of its path leaves `edgeIndex` at the path length, and the
    // arrival check reads it once more.
    const cache = new PathLengthCache();
    const p = path([1.0, 2.0]);
    expect(cache.totalProgress(p, 99, 0), '超出範圍的 edgeIndex 算爆了')
      .toBeCloseTo(3.0, 10);
    // A non-zero progress is still added on top.
    expect(cache.totalProgress(p, 99, 0.5), '超出範圍時把進度吃掉了')
      .toBeCloseTo(naive(p, 99, 0.5), 10);
  });

  it('should read each edge length only once per path', () => {
    // "The second call agrees" passes even when everything is re-summed each time. What has to
    // hold is that **nothing is recomputed**, the sole reason this class exists. A getter counts
    // how often `length` is read.
    const cache = new PathLengthCache();
    const raw = path([1.0, 0.7, 1.3]);
    let reads = 0;
    const counted = raw.map(e => {
      const { length, ...rest } = e;
      return Object.defineProperty({ ...rest } as LaneEdge, 'length', {
        get() { reads++; return length; }, enumerable: true,
      });
    });

    cache.totalProgress(counted, 3, 0);
    const afterFirst = reads;
    expect(afterFirst, '第一次就該把整條路徑掃過一遍').toBe(counted.length);

    // The same path asked again for other vehicles at other positions must read nothing more.
    cache.totalProgress(counted, 1, 0.2);
    cache.totalProgress(counted, 2, 0.9);
    cache.totalProgress(counted, 3, 0);
    expect(reads, '同一條路徑又被重新累加了一遍').toBe(afterFirst);
  });

  it('should give the same answer on the second call', () => {
    // Computed once, looked up thereafter. A lookup differing from the computation would
    // process vehicles in the wrong order.
    const cache = new PathLengthCache();
    const p = path([1.0, 0.7, 1.3]);
    const first = cache.totalProgress(p, 2, 0.4);
    expect(cache.totalProgress(p, 2, 0.4), '第二次查表的答案跟第一次不一樣')
      .toBe(first);
  });

  it('should not mix up two different paths', () => {
    const cache = new PathLengthCache();
    const a = path([1.0, 1.0]);
    const b = path([5.0, 5.0]);
    expect(cache.totalProgress(a, 2, 0)).toBeCloseTo(2.0, 10);
    expect(cache.totalProgress(b, 2, 0), '兩條路徑共用了同一份前綴和').toBeCloseTo(10.0, 10);
    expect(cache.totalProgress(a, 2, 0), '第二條路徑把第一條的蓋掉了').toBeCloseTo(2.0, 10);
  });

  it('should handle an empty path', () => {
    expect(new PathLengthCache().totalProgress([], 0, 0)).toBe(0);
  });
});
