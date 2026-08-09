import { describe, it, expect } from 'vitest';
import { variantIndexOf } from '../BuildingAppearance';
import { VARIANT_COUNT } from '../geometry/buildings/massing/dimensions';

/** N×N 的街廓上，相鄰兩格用同一個變體的比例。 */
function adjacencyRate(n: number, seedByte: number, count: number): number {
  const v: number[][] = [];
  for (let x = 0; x < n; x++) {
    v[x] = [];
    for (let y = 0; y < n; y++) v[x]![y] = variantIndexOf(x, y, seedByte, count);
  }
  let pairs = 0;
  let same = 0;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        if (x + dx >= n || y + dy >= n) continue;
        pairs++;
        if (v[x]![y] === v[x + dx]![y + dy]) same++;
      }
    }
  }
  return same / pairs;
}

describe('variant selection avoids the neighbours', () => {
  it('should keep neighbouring cells from sharing a variant', () => {
    // 本階段的主要驗收條件。純逐格雜湊是 1/V = 12.5%，而一條街上每八棟就有
    // 一棟跟隔壁一樣是看得出來的。
    for (const seed of [0, 7, 128, 255]) {
      const rate = adjacencyRate(64, seed, VARIANT_COUNT);
      expect(rate, `seed ${seed} 相鄰重複 ${(rate * 100).toFixed(1)}%`).toBeLessThan(0.05);
    }
  });

  it('should still use every variant roughly evenly', () => {
    // 迴避不能把分布壓歪 —— 某幾個變體從此不出現的話，等於變體數變少。
    const counts = new Array<number>(VARIANT_COUNT).fill(0);
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) counts[variantIndexOf(x, y, 0, VARIANT_COUNT)]!++;
    }
    const expected = (64 * 64) / VARIANT_COUNT;
    for (let i = 0; i < VARIANT_COUNT; i++) {
      expect(counts[i]!, `變體 ${i} 出現 ${counts[i]} 次`).toBeGreaterThan(expected * 0.7);
      expect(counts[i]!, `變體 ${i} 出現 ${counts[i]} 次`).toBeLessThan(expected * 1.3);
    }
  });

  it('should stay deterministic', () => {
    for (let i = 0; i < 50; i++) {
      expect(variantIndexOf(i, i * 3, 0, VARIANT_COUNT))
        .toBe(variantIndexOf(i, i * 3, 0, VARIANT_COUNT));
    }
  });

  it('should always land inside the variant list', () => {
    for (const count of [1, 2, 8]) {
      for (let x = -20; x < 20; x++) {
        for (let y = -20; y < 20; y++) {
          const v = variantIndexOf(x, y, 0, count);
          expect(v, `count ${count}`).toBeGreaterThanOrEqual(0);
          expect(v, `count ${count}`).toBeLessThan(count);
        }
      }
    }
  });

  it('should return 0 rather than NaN when there are no variants', () => {
    expect(variantIndexOf(3, 4, 0, 0)).toBe(0);
  });
});
