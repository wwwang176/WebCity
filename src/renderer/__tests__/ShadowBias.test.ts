import { describe, it, expect } from 'vitest';
import { SCENE } from '../SceneManager';
import { METRES_PER_CELL } from '../../core/grid/constants';

/**
 * 陰影與物體之間的距離（peter-panning）。
 *
 * `normalBias` 是把接收面的取樣點沿著法線推出去的距離，單位是**世界單位**。
 * 地面的法線朝上，所以取樣點被抬高 `normalBias`，而陰影因此沿著地面平移
 * `normalBias / tan(太陽仰角)` —— 物體的接觸陰影就與它的底部分家。
 *
 * 這個專案是 **1 單位 = 12 公尺**，不是 three.js 範例常見的 1 單位 = 1 公尺。
 * 教學裡的 0.02 在那裡是 2 公分，搬到這裡就是 24 公分。
 */

/** 太陽仰角。SUN_OFFSET 是光源相對於鏡頭焦點的位置。 */
function sunElevationTan(): number {
  const { x, y, z } = SCENE.SUN_OFFSET;
  return y / Math.hypot(x, z);
}

/** 陰影在地面上偏離物體的距離，單位是公尺。 */
function shadowOffsetMetres(): number {
  return (SCENE.SHADOW_NORMAL_BIAS * METRES_PER_CELL) / sunElevationTan();
}

describe('shadow bias', () => {
  it('should keep contact shadows attached to thin props', () => {
    // 路燈的柱子是半徑 0.07–0.09 m 的圓柱，也就是直徑 14–18 公分。陰影
    // 偏移若超過柱子本身的粗細，看起來就是「陰影沒有貼在燈桿底部」。
    //
    // 上限取 7 公分（柱子最細處的一半）—— 偏移小於這個值時，陰影與柱底
    // 仍然重疊。
    expect(shadowOffsetMetres(), '陰影與物體底部分家').toBeLessThan(0.07);
  });

  it('should express the bias in this project units, not metre-scale defaults', () => {
    // 這一條擋的是「又從別的專案抄一個 0.02 進來」。1 單位 = 12 公尺，
    // 所以任何看起來像公尺級預設值的數字在這裡都會大一個數量級。
    const biasMetres = SCENE.SHADOW_NORMAL_BIAS * METRES_PER_CELL;
    expect(biasMetres, 'normalBias 換算成公尺後大得不合理').toBeLessThan(0.1);
  });

  it('should still push the sample off the surface at all', () => {
    // 反方向的失敗：normalBias 設成 0 會讓平坦地面長出陰影痤瘡（acne），
    // 那是一片自我遮蔽的條紋。這一條擋的是「為了貼合而直接歸零」。
    expect(SCENE.SHADOW_NORMAL_BIAS, 'normalBias 被歸零了').toBeGreaterThan(0);
    expect(SCENE.SHADOW_BIAS, '深度 bias 應該是負的（把接收面往光源推）')
      .toBeLessThan(0);
  });

  it('should document the resolution limit that bias cannot fix', () => {
    // 陰影貼圖的一個 texel 有多大。這決定了多細的東西根本畫不出接觸陰影 ——
    // 調 bias 對這件事沒有幫助，只有提高 SHADOW_MAP_SIZE 才有。
    //
    // updateShadowCamera() 每幀會把陰影相機收到可見範圍再加 30%，所以實際
    // 的 texel 比這個保守估計小；這裡量的是初始設定的上界。
    const texelMetres = (2 * SCENE.SHADOW_EXTENT * METRES_PER_CELL) / SCENE.SHADOW_MAP_SIZE;
    expect(texelMetres, '一個 texel 已經大到連建築的邊都糊掉').toBeLessThan(1.0);
  });
});
