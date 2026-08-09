import { describe, it, expect } from 'vitest';
import { SCENE } from '../SceneManager';
import {
  shadowDepthRange, shadowOffsetMetres, sunElevationRad, worstSunElevationRad,
  MAX_CASTER_HEIGHT,
} from '../shadowFit';
import { METRES_PER_CELL } from '../../core/grid/constants';

/**
 * 陰影與物體之間的距離（peter-panning）。
 *
 * 這一組測試的第一版量錯了東西：它拿 `SCENE.SUN_OFFSET`（y = 80，等於正午）
 * 算仰角，而**太陽是會動的** —— WeatherRenderer 每幀改寫 `sunOffset`，
 * 展示區的預設時間 0.3 只有 19.7 度。它也只算了 `normalBias`，漏掉深度
 * 空間的 `bias`，而後者大了一個數量級。於是測試綠燈、畫面照舊。
 *
 * 所以現在量的是**最壞情況的太陽**與**兩個 bias 的總和**。
 */

/** 光源到焦點的距離（格）。SUN_OFFSET 的 y 是絕對高度，xz 是相對位移。 */
const LIGHT_DISTANCE = Math.hypot(
  SCENE.SUN_OFFSET.x, SCENE.SUN_OFFSET.y, SCENE.SUN_OFFSET.z,
);

/** 預設縮放下陰影相機的半寬：視錐 60 格、16:9，取長邊再加 30% 餘裕。 */
const PADDED_DEFAULT = (60 * (16 / 9)) / 2 * 1.3;

function offsetAt(dayFraction: number, padded = PADDED_DEFAULT): number {
  const { near, far } = shadowDepthRange(LIGHT_DISTANCE, padded);
  return shadowOffsetMetres({
    normalBias: SCENE.SHADOW_NORMAL_BIAS,
    depthBias: SCENE.SHADOW_BIAS,
    near, far,
    sunElevationRad: sunElevationRad(dayFraction),
  });
}

describe('shadow offset', () => {
  it('should stay small at the showcase default time, not just at noon', () => {
    // 使用者是在展示區看到的，而展示區的 timeOverride 預設是 0.3。
    // 第一次修完之後這裡仍然是 2.4 公尺 —— 而當時的測試只量正午的
    // normalBias，得到 5 公分就放行了。
    expect(offsetAt(0.3), '展示區預設時間下陰影還是離物體很遠')
      .toBeLessThan(0.25);
  });

  it('should survive the lowest sun of the day', () => {
    // 太陽越低 tan 越小，偏移越大。最壞情況出現在 sunY 被夾在 80 × 0.1
    // 的那一段（清晨與黃昏），不是正午 —— 而那正是日夜循環一定會經過的。
    const worst = worstSunElevationRad();
    const { near, far } = shadowDepthRange(LIGHT_DISTANCE, PADDED_DEFAULT);
    const offset = shadowOffsetMetres({
      normalBias: SCENE.SHADOW_NORMAL_BIAS,
      depthBias: SCENE.SHADOW_BIAS,
      near, far, sunElevationRad: worst,
    });
    expect(offset, '低太陽時陰影整片脫離').toBeLessThan(1.0);
  });

  it('should not let the depth range inflate the depth bias', () => {
    // `shadow.bias` 是 [0, 1] 深度空間的值，世界距離要乘 (far - near)。
    // 寫死的 1 / 200 給了 199 格 = 2388 公尺的深度，而光源距焦點只有
    // 約 107 格 —— 那個寬度直接把 bias 放大了一倍有餘。
    const { near, far } = shadowDepthRange(LIGHT_DISTANCE, PADDED_DEFAULT);
    expect(far - near, '深度範圍比需要的寬').toBeLessThan(199);
    expect(near, 'near 不能落到 0 以下').toBeGreaterThan(0);
    // 投影者必須整個落在範圍內，否則陰影會被裁掉一截。
    expect(near, 'near 切到最近的投影者')
      .toBeLessThanOrEqual(LIGHT_DISTANCE - PADDED_DEFAULT - MAX_CASTER_HEIGHT + 1e-9);
    expect(far, 'far 切到最遠的投影者')
      .toBeGreaterThanOrEqual(LIGHT_DISTANCE + PADDED_DEFAULT + MAX_CASTER_HEIGHT);
  });

  it('should tighten the depth range when zoomed in on a lamp post', () => {
    // 縮近看燈桿時陰影相機收得很小，深度範圍也跟著收 —— 寫死的 near/far
    // 拿不到這個好處。
    //
    // 這裡量的是**深度範圍**而不是總偏移：深度項修好之後，主導的變成
    // `normalBias`，而它是固定的世界距離、依定義不隨縮放變化。拿總偏移
    // 去斷言「拉近會縮很多」等於在量另一項的權重，那正是這組測試上一版
    // 犯的錯。
    const closePadded = (20 * (16 / 9)) / 2 * 1.3;
    const wide = shadowDepthRange(LIGHT_DISTANCE, PADDED_DEFAULT);
    const close = shadowDepthRange(LIGHT_DISTANCE, closePadded);
    expect(close.far - close.near, '拉近之後深度範圍沒有跟著收')
      .toBeLessThan((wide.far - wide.near) * 0.5);

    // 而總偏移至少不能因為拉近而變大。
    expect(offsetAt(0.3, closePadded)).toBeLessThanOrEqual(offsetAt(0.3));
  });

  it('should still push the sample off the surface at all', () => {
    // 反方向的失敗：兩個 bias 都歸零會讓地面長出自我遮蔽的條紋（acne）。
    expect(SCENE.SHADOW_NORMAL_BIAS, 'normalBias 被歸零了').toBeGreaterThan(0);
    expect(SCENE.SHADOW_BIAS, '深度 bias 應該是負的').toBeLessThan(0);
  });

  it('should express normalBias in this project units', () => {
    // 1 單位 = 12 公尺，所以任何看起來像公尺級預設值的數字都會大一個數量級。
    expect(SCENE.SHADOW_NORMAL_BIAS * METRES_PER_CELL, 'normalBias 換算成公尺後過大')
      .toBeLessThan(0.1);
  });
});
