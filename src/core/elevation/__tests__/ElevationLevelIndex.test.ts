import { describe, it, expect } from 'vitest';
import { ElevationManager } from '../ElevationManager';
import { RoadType } from '../../road/types';

/**
 * The "which levels does this cell occupy" index.
 *
 * The justification is measured. `UnifiedRoadLookup.getCompatibleNeighborKeys` asks all three
 * levels for every neighbour it probes, building an `x,y,level` string and a Map lookup each
 * time. On a 40,000-population save `ElevationManager.get` took **5.8%** of the main thread in
 * a city holding **7 elevated segments** in total.
 *
 * The index is **derived data**; `layers` remains the single source of truth. So what is under
 * test is whether it diverges: one case each for insert, delete, overwrite, clear and load.
 */
function seg(roadType = RoadType.TWO_LANE) {
  return { roadType, roadFlags: 0, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 };
}

describe('這一格有哪幾層', () => {
  it('should be empty where nothing was built', () => {
    expect(new ElevationManager().levelsAt(3, 4)).toBe(0);
  });

  it('should have one bit per occupied level', () => {
    const em = new ElevationManager();
    em.set(3, 4, 1, seg());
    em.set(3, 4, 3, seg());

    expect(em.levelsAt(3, 4)).toBe((1 << 1) | (1 << 3));
  });

  it('should not leak between positions', () => {
    // A wrong position key — x and y folded together, say — gives a neighbouring cell
    // someone else's levels.
    const em = new ElevationManager();
    em.set(3, 4, 1, seg());

    expect(em.levelsAt(4, 3), '(3,4) 與 (4,3) 被摺成同一個鍵').toBe(0);
    expect(em.levelsAt(3, 5)).toBe(0);
  });

  it('should drop the bit when the segment goes', () => {
    const em = new ElevationManager();
    em.set(3, 4, 1, seg());
    em.set(3, 4, 2, seg());
    em.delete(3, 4, 1);

    expect(em.levelsAt(3, 4)).toBe(1 << 2);
  });

  it('should be empty again once the last level goes', () => {
    const em = new ElevationManager();
    em.set(3, 4, 1, seg());
    em.delete(3, 4, 1);

    expect(em.levelsAt(3, 4)).toBe(0);
  });

  it('should not double-count an overwrite', () => {
    const em = new ElevationManager();
    em.set(3, 4, 1, seg());
    em.set(3, 4, 1, seg(RoadType.HIGHWAY));
    em.delete(3, 4, 1);

    expect(em.levelsAt(3, 4), '覆寫被算成兩段，刪一次清不掉').toBe(0);
  });

  it('should survive clear()', () => {
    const em = new ElevationManager();
    em.set(3, 4, 1, seg());
    em.clear();

    expect(em.levelsAt(3, 4)).toBe(0);
    expect(em.hasAnySegment()).toBe(false);
  });

  it('should be rebuilt by fromJSON', () => {
    const src = new ElevationManager();
    src.set(3, 4, 1, seg());
    src.set(9, 9, 2, seg());

    const dst = new ElevationManager();
    dst.set(1, 1, 3, seg());       // pre-load content, has to be replaced wholesale
    dst.fromJSON(src.toJSON());

    expect(dst.levelsAt(3, 4)).toBe(1 << 1);
    expect(dst.levelsAt(9, 9)).toBe(1 << 2);
    expect(dst.levelsAt(1, 1), '讀檔沒有清掉舊索引').toBe(0);
  });

  it('should agree with the layer map itself', () => {
    // The index is derived; once it diverges it is worthless. Checked cell by cell.
    const em = new ElevationManager();
    em.set(2, 2, 1, seg());
    em.set(2, 2, 2, seg());
    em.set(5, 7, 3, seg());
    em.delete(2, 2, 2);

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        let expected = 0;
        for (let lv = 1; lv <= 3; lv++) if (em.get(x, y, lv)) expected |= 1 << lv;
        expect(em.levelsAt(x, y), `(${x},${y}) 的索引與 layers 不一致`).toBe(expected);
      }
    }
  });

  it('should answer the level scans from the index', () => {
    const em = new ElevationManager();
    em.set(6, 6, 1, seg());
    em.set(6, 6, 3, seg());

    expect(em.hasElevatedSegment(6, 6)).toBe(true);
    expect(em.hasElevatedSegment(6, 7)).toBe(false);
    expect(em.getHighestLevel(6, 6)).toBe(3);
    expect(em.getHighestLevel(6, 7)).toBe(0);
    expect(em.getAllLevels(6, 6).map(l => l.level)).toEqual([1, 3]);
  });
});

describe('索引不會被無效的座標或層級弄壞', () => {
  it('should refuse a level outside 1-3 on delete, like set does', () => {
    // `1 << 33` is `1 << 1` in JS (shifts are taken mod 32). Unvalidated, `delete(x, y, 33)`
    // clears the bit for the **actual level 1** while that segment stays in `layers`: index
    // and truth diverge, and that elevated segment stops existing for every query.
    const em = new ElevationManager();
    em.set(1, 0, 1, seg());

    expect(() => em.delete(1, 0, 33)).toThrow(RangeError);
    expect(em.levelsAt(1, 0), '真正的 level 1 被位移取模清掉了').toBe(1 << 1);
    expect(em.get(1, 0, 1)).not.toBeNull();
  });

  it('should refuse a position the key cannot represent, like set does', () => {
    // The position key is `x * 8192 + y`, so `(0, 8192)` and `(1, 0)` fold to the same number.
    // `set` already refuses; without the same guard, `delete` would clear a neighbour's mask.
    const em = new ElevationManager();
    em.set(1, 0, 1, seg());

    expect(() => em.delete(0, 8192, 1)).toThrow(RangeError);
    expect(em.levelsAt(1, 0), '被一個摺到同一個鍵的座標清掉了').toBe(1 << 1);
  });

  it('should still accept the levels it is supposed to', () => {
    // The converse, or "throws on everything" would pass both cases above.
    const em = new ElevationManager();
    em.set(2, 2, 1, seg());
    em.set(2, 2, 3, seg());

    expect(() => em.delete(2, 2, 1)).not.toThrow();
    expect(em.levelsAt(2, 2)).toBe(1 << 3);
  });
});
