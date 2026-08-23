import { describe, it, expect } from 'vitest';
import { ElevationManager } from '../ElevationManager';
import { RoadType } from '../../road/types';

/**
 * 「這一格有哪幾層」的索引。
 *
 * 存在的理由是量出來的:`UnifiedRoadLookup.getCompatibleNeighborKeys` 每探一個
 * 鄰居就無條件問三層，每問一次配一個 `x,y,level` 字串再查一次 Map。4 萬人的
 * 存檔實測 `ElevationManager.get` 佔主執行緒 **5.8%**，而那座城市總共只有
 * **7 段高架**。
 *
 * 索引是**衍生資料** —— `layers` 仍然是唯一的真相。所以測的重點是它會不會跟
 * 真相分家:新增、刪除、覆寫、清空、讀檔各一條。
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
    // 位置鍵算錯的話（例如 x 與 y 摺在一起）隔壁格會拿到別人的層。
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
    dst.set(1, 1, 3, seg());       // 讀檔前的舊內容必須整個被換掉
    dst.fromJSON(src.toJSON());

    expect(dst.levelsAt(3, 4)).toBe(1 << 1);
    expect(dst.levelsAt(9, 9)).toBe(1 << 2);
    expect(dst.levelsAt(1, 1), '讀檔沒有清掉舊索引').toBe(0);
  });

  it('should agree with the layer map itself', () => {
    // 索引是衍生的，分家就沒有意義了。逐格對一次。
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
    // `1 << 33` 在 JS 等於 `1 << 1`（位移取模 32）。不驗證的話，`delete(x, y, 33)`
    // 會清掉**真正 level 1** 的那個位元，而 `layers` 裡那一段還在 —— 索引與真相
    // 從此分家，那一段高架對所有查詢都變成不存在。
    const em = new ElevationManager();
    em.set(1, 0, 1, seg());

    expect(() => em.delete(1, 0, 33)).toThrow(RangeError);
    expect(em.levelsAt(1, 0), '真正的 level 1 被位移取模清掉了').toBe(1 << 1);
    expect(em.get(1, 0, 1)).not.toBeNull();
  });

  it('should refuse a position the key cannot represent, like set does', () => {
    // 位置鍵是 `x * 8192 + y`。`(0, 8192)` 與 `(1, 0)` 摺出同一個數字。
    // `set` 已經擋了，`delete` 不擋的話會清掉鄰居的遮罩。
    const em = new ElevationManager();
    em.set(1, 0, 1, seg());

    expect(() => em.delete(0, 8192, 1)).toThrow(RangeError);
    expect(em.levelsAt(1, 0), '被一個摺到同一個鍵的座標清掉了').toBe(1 << 1);
  });

  it('should still accept the levels it is supposed to', () => {
    // 反面 —— 不然「全部都丟例外」也會讓上面兩條通過。
    const em = new ElevationManager();
    em.set(2, 2, 1, seg());
    em.set(2, 2, 3, seg());

    expect(() => em.delete(2, 2, 1)).not.toThrow();
    expect(em.levelsAt(2, 2)).toBe(1 << 3);
  });
});
