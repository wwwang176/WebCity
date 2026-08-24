import { describe, it, expect } from 'vitest';
import { CoverageBits } from '../CoverageBits';

/** A flag array sized to the map. */
function bits(w: number, h: number): CoverageBits {
  const b = new CoverageBits();
  b.reset(w, h);
  return b;
}

describe('逐格的覆蓋旗標', () => {
  it('should answer false before anything was ever calculated', () => {
    // A service is queried before its first pass, and until then it must be as quiet as an
    // empty Set.
    const b = new CoverageBits();

    expect(b.has(3, 4)).toBe(false);
    expect(b.size).toBe(0);
  });

  it('should remember what was added', () => {
    const b = bits(8, 6);
    b.add(3, 4);

    expect(b.has(3, 4)).toBe(true);
    expect(b.has(4, 3), 'x 跟 y 反過來也算命中').toBe(false);
    expect(b.size).toBe(1);
  });

  it('should count each cell once', () => {
    const b = bits(8, 6);

    expect(b.add(3, 4)).toBe(true);
    expect(b.add(3, 4), '同一格加第二次還說是新的').toBe(false);
    expect(b.size).toBe(1);
  });

  it('should not fold out-of-bounds coordinates onto real cells', () => {
    // `x = -1, y = 2` indexes exactly onto `(W - 1, 1)`. Unchecked, going off the left edge
    // returns the previous row's rightmost cell, so the fixture deliberately puts data there.
    const W = 8;
    const b = bits(W, 6);
    b.add(W - 1, 1);

    expect(b.has(W - 1, 1), 'fixture 沒把資料放在會被撞到的格子上').toBe(true);
    expect(b.has(-1, 2), '左邊出界折回上一列了').toBe(false);
    expect(b.has(1, 6)).toBe(false);
    expect(b.has(1, -1)).toBe(false);
    expect(b.add(-1, 2), '界外也被寫進去了').toBe(false);
    expect(b.size).toBe(1);
  });

  it('should be empty again after a reset', () => {
    const b = bits(8, 6);
    b.add(3, 4);
    b.add(1, 1);

    b.reset(8, 6);

    expect(b.has(3, 4), '上一輪的覆蓋還留著').toBe(false);
    expect(b.size).toBe(0);
  });

  it('should drop everything when the map size changes', () => {
    const b = bits(8, 6);
    b.add(7, 5);

    b.reset(4, 4);

    expect(b.size).toBe(0);
    expect(b.has(3, 3)).toBe(false);
    expect(b.width).toBe(4);
    expect(b.height).toBe(4);
  });

  it('should keep answering for the whole map after growing', () => {
    // The bottom-right corner must be queryable after growing the map; without the backing array
    // growing with it, that corner reads undefined.
    const b = bits(4, 4);
    b.reset(16, 12);
    b.add(15, 11);

    expect(b.has(15, 11)).toBe(true);
    expect(b.size).toBe(1);
  });

  it('should list the cells it holds', () => {
    const b = bits(4, 3);
    b.add(1, 0);
    b.add(3, 2);

    expect([...b.cells()]).toEqual([{ x: 1, y: 0 }, { x: 3, y: 2 }]);
  });
});
