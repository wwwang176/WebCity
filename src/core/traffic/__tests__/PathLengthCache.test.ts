import { describe, it, expect } from 'vitest';
import { PathLengthCache } from '../PathLengthCache';
import type { LaneEdge } from '../LaneGraph';


/**
 * 「這台車總共走了多遠」每幀每台車都要算一次（車輛要由前往後處理，那是排序的鍵）。
 * 原本每次都從路徑開頭重加一次前面所有邊的長度 —— 12 288 人的存檔實測，每幀為了
 * 排序掃過 14 438 條邊。
 *
 * 前綴和只跟路徑有關，跟車無關。而通勤路線是共用的:`CommuteCache` 的路線池把
 * 同一個陣列交給每個走這條路的人，所以走同一條路的幾百台車共用同一份。
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

/** 原本的算法。快取要跟它給一樣的答案。 */
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
    // 車開到路徑盡頭時 `edgeIndex` 會停在 length，抵達的判斷還會再讀一次。
    const cache = new PathLengthCache();
    const p = path([1.0, 2.0]);
    expect(cache.totalProgress(p, 99, 0), '超出範圍的 edgeIndex 算爆了')
      .toBeCloseTo(3.0, 10);
    // 進度不是 0 的時候照樣加上去 —— 註解說「當成走完整條」容易讀成「無視進度」。
    expect(cache.totalProgress(p, 99, 0.5), '超出範圍時把進度吃掉了')
      .toBeCloseTo(naive(p, 99, 0.5), 10);
  });

  it('should read each edge length only once per path', () => {
    // 「第二次答案一樣」即使每次都重加一遍也會過。真正要守的是**不再重算** ——
    // 那是這個類別存在的唯一理由。用 getter 數 `length` 被讀了幾次。
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

    // 同一條路徑再問幾次 —— 換不同的車、不同的位置，都不該再讀。
    cache.totalProgress(counted, 1, 0.2);
    cache.totalProgress(counted, 2, 0.9);
    cache.totalProgress(counted, 3, 0);
    expect(reads, '同一條路徑又被重新累加了一遍').toBe(afterFirst);
  });

  it('should give the same answer on the second call', () => {
    // 第一次算、之後查表。查到的必須跟算出來的一樣 —— 不然車會照著錯的順序處理。
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
