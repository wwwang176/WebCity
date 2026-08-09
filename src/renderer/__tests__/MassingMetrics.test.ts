import { describe, it, expect } from 'vitest';
import {
  HALF_ENVELOPE, CELL_EDGE, OVERHEAD_CLEARANCE, FLOOR_HEIGHT_UNITS,
  SHOPFRONT_CEILING, GROUND_LAYERS, M,
} from '../geometry/buildings/massing/metrics';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';

/**
 * 這些常數以前散在 propBands 裡，而 propBands 之後要 import massing —— 那是一個
 * 循環。搬到葉節點模組是為了斷開它，不是為了整齊。
 */
describe('massing metrics', () => {
  it('should agree with the shared building width constant', () => {
    // 包絡線與 SidewalkGraph 的 BUILDING_HALF_SIZE 是同一條線（BUG-221）。
    // 自己寫一個數字就會漂移。
    expect(HALF_ENVELOPE).toBeCloseTo(MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2, 12);
  });

  it('should convert metres to cells', () => {
    expect(M(12)).toBeCloseTo(1, 12);
    expect(M(2.2)).toBeCloseTo(OVERHEAD_CLEARANCE, 12);
  });

  it('should keep the pedestrian envelope inside the cell', () => {
    expect(HALF_ENVELOPE).toBeLessThan(CELL_EDGE);
  });

  it('should put the shopfront ceiling at the lowest floor the shader draws', () => {
    // 樓高由變體決定，懸挑物的幾何是整桶共用的一份 —— 取最低值才保證
    // 永遠不會越過一樓。
    expect(SHOPFRONT_CEILING).toBe(FLOOR_HEIGHT_UNITS.MIN);
    expect(FLOOR_HEIGHT_UNITS.MIN).toBeLessThan(FLOOR_HEIGHT_UNITS.MAX);
  });

  it('should leave room between head clearance and the shopfront ceiling', () => {
    expect((SHOPFRONT_CEILING - OVERHEAD_CLEARANCE) * METRES_PER_CELL)
      .toBeGreaterThan(0.3);
  });

  it('should stack the ground layers in drawing order', () => {
    // 標線要疊在鋪面上，光暈要疊在標線上。順序反了就 z-fighting。
    expect(GROUND_LAYERS.MARKING).toBeGreaterThan(GROUND_LAYERS.DECAL);
    expect(GROUND_LAYERS.LIGHT_SPOT).toBeGreaterThan(GROUND_LAYERS.MARKING);
    for (const [name, y] of Object.entries(GROUND_LAYERS)) {
      expect(y, `${name} 陷進地面`).toBeGreaterThan(0);
      expect(y * METRES_PER_CELL, `${name} 浮空`).toBeLessThan(0.1);
    }
  });
});
