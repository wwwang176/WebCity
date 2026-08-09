import { describe, it, expect } from 'vitest';
import { TARGET_HEIGHTS_M } from '../geometry/buildings/registry';
import { METRES_PER_CELL } from '../../core/grid/constants';
import { ZoneType } from '../../core/grid/types';

/**
 * 高度以前是「乘在幾何上的縮放係數」，語意隱晦而且與容納人口無關：
 * 4 人的 Small House 被畫成 2.4 m（不到一層樓），320 人的 High Rise 被畫成
 * 33.7 m（11 層）。改成公尺表之後，這裡斷言的是「畫出來真的是那個高度」。
 */
describe('TARGET_HEIGHTS_M', () => {
  it('should cover every zone and density that has buildings', () => {
    for (const key of ['1:LOW', '2:HIGH', '3:LOW', '4:HIGH', '5:LOW', '6:LOW', '6:HIGH']) {
      expect(TARGET_HEIGHTS_M[key], `missing ${key}`).toBeDefined();
      expect(TARGET_HEIGHTS_M[key]).toHaveLength(3);
    }
  });

  it('should grow with level in every bucket', () => {
    for (const [key, heights] of Object.entries(TARGET_HEIGHTS_M)) {
      expect(heights[1], `${key} L2 not taller than L1`).toBeGreaterThan(heights[0]!);
      expect(heights[2], `${key} L3 not taller than L2`).toBeGreaterThan(heights[1]!);
    }
  });

  it('should give a four-person house at least one full storey', () => {
    // 現況是 2.4 m，也就是 0.8 層。
    expect(TARGET_HEIGHTS_M['1:LOW']![0]).toBeGreaterThanOrEqual(4.5);
  });

  it('should make a high rise a tower, not a block', () => {
    // 320 人。照實算要 220 m。壓縮量是視覺調校、會反覆調整，所以這裡斷言的
    // 是「明顯高於基地寬度」這個意圖，不是某個調出來的數字 —— 把調校值寫死
    // 進測試，每次微調都得改測試，測試就變成阻力而不是保護。
    expect(TARGET_HEIGHTS_M['2:HIGH']![2]).toBeGreaterThanOrEqual(METRES_PER_CELL * 3);
  });

  it('should keep the office tower above the office block', () => {
    // BUG-220：高密度辦公 160/320/600 人，低密度 15/30/50 人。
    for (const lv of [0, 1, 2]) {
      expect(TARGET_HEIGHTS_M['6:HIGH']![lv]).toBeGreaterThan(TARGET_HEIGHTS_M['6:LOW']![lv]!);
    }
  });
});

// heightScaleFor 已不存在：生成器直接產出最終高度（階段 2C-1）。
// 「畫出來真的是那個高度」由 MassingGeometry 的
// `should reach the height the table asks for` 承接，
// 「每個變體高度不同」由 MassingDimensions 的
// `should use every height option across the eight variants` 承接。
