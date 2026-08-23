import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { UtilityFloodScratch } from '../UtilityFloodScratch';

const W = 8, H = 6;

function scratchOn(infra?: Set<string>): { grid: Grid; scratch: UtilityFloodScratch } {
  const grid = new Grid(W, H);
  const scratch = new UtilityFloodScratch();
  scratch.beginPass(grid, infra);
  return { grid, scratch };
}

/**
 * flood 暫存跨呼叫重複使用，所以「上一輪的東西有沒有清乾淨」是它唯一會出的錯，
 * 而且失敗模式全部是**安靜的**:多付一次錢、少付一次錢、或者把界外的基礎設施
 * 記在真的格子上。
 */
describe('水電 flood 的暫存', () => {
  it('should forget which footprints were paid for when a new pass starts', () => {
    // 沒清的話，上一輪付過的多格建築這一輪就變免費 —— 電廠的預算會憑空多出來，
    // 而覆蓋圖看起來完全正常。
    const { grid, scratch } = scratchOn();
    scratch.markPaid(3);
    expect(scratch.isPaid(3), '前置條件:要先付過').toBe(true);

    scratch.beginPass(grid);

    expect(scratch.isPaid(3), '換一輪還記得上一輪付過的錢').toBe(false);
  });

  it('should forget which cells belong to which building when a new pass starts', () => {
    // 房子拆了又蓋，同一格可能換一個 footprint。記著舊的歸戶就會把錢算到別人頭上。
    const { grid, scratch } = scratchOn();
    const idx = 2 * W + 3;
    const before = scratch.chargeOf(grid, idx, 3, 2, () => 7);
    expect(before, '前置條件:空地要自己結算').toBe(-1);
    expect(scratch.demandAt(idx)).toBe(7);

    scratch.beginPass(grid);
    scratch.chargeOf(grid, idx, 3, 2, () => 99);

    expect(scratch.demandAt(idx), '換一輪還用著上一輪的金額').toBe(99);
  });

  it('should not let an out-of-grid facility mark a real cell', () => {
    // `"-1,2"` 折出來的索引正好是 `(W - 1, 1)`。不擋界外的話，地圖外的東西會讓
    // 那一格變成轉發點 —— 而它離真正的網路可能有半座城市遠。
    const victim = 1 * W + (W - 1);
    const { scratch } = scratchOn(new Set(['-1,2']));

    expect(scratch.isInfra(victim), '界外的基礎設施折回地圖裡了').toBe(false);
  });

  it('should record facilities that are inside the grid', () => {
    // 上一條的反面。整個 infra 都被丟掉的話，那一條也會過。
    const { scratch } = scratchOn(new Set(['3,2']));

    expect(scratch.isInfra(2 * W + 3)).toBe(true);
  });

  it('should clear the visited marks for each plant', () => {
    const { scratch } = scratchOn();
    scratch.beginFlood();
    expect(scratch.markVisited(5)).toBe(true);
    expect(scratch.markVisited(5), '同一座廠裡同一個節點走了兩次').toBe(false);

    scratch.beginFlood();

    expect(scratch.markVisited(5), '換一座廠還記著上一座走過哪裡').toBe(true);
  });
});
