import { METRES_PER_CELL } from '../core/grid/constants';

/**
 * 陰影相機的深度範圍，以及兩個 bias 換算成地面上的位移。
 *
 * 純算術、不 import Three.js —— 這裡的數字全都是「算得出來但看不出來」的
 * 那一類：bias 調錯只會表現成陰影與物體有點距離，或是地面長出條紋，
 * 兩者都沒有任何東西會報錯。BUG-234 第一次就修錯了項，因為推導留在腦子裡
 * 而不是在程式碼裡。
 */

/** 建築最高 48 m = 4 格。投影者高過焦點平面的部分要算進深度範圍。 */
export const MAX_CASTER_HEIGHT = 4;

/**
 * 陰影相機的 near / far。
 *
 * 深度範圍要剛好包住投影者，不能更寬：`shadow.bias` 是 [0, 1] 深度空間的值，
 * 換算成世界距離要**乘上 (far - near)**。開得越寬，同一個 bias 推得越遠，
 * 陰影就離物體越遠。原本寫死的 1 / 200 給了 199 格 = 2388 公尺的深度，
 * 而光源距焦點只有約 107 格。
 *
 * @param lightDistance 光源到焦點的距離（格）
 * @param padded        陰影相機的半寬（格），已含 off-screen 投影者的餘裕
 */
export function shadowDepthRange(
  lightDistance: number, padded: number,
): { near: number; far: number } {
  const span = padded + MAX_CASTER_HEIGHT;
  return {
    // 不能小於等於 0：正交相機的 near 為負沒有意義，也會讓深度精度失衡。
    near: Math.max(1, lightDistance - span),
    far: lightDistance + span,
  };
}

/**
 * 陰影在地面上偏離物體的距離，單位是公尺。
 *
 * 兩個 bias 的幾何完全不同：
 *
 *   normalBias 沿接收面的法線推。地面法線朝上，抬高 h 會讓陰影沿地面
 *              平移 `h / tan(仰角)`。
 *   bias       在深度空間推，等於把接收點沿**光軸**朝光源移動
 *              `bias × (far - near)`。那個位移同時有水平與垂直分量，
 *              兩者都會讓陰影退開 —— 合計約 `2d × cos(仰角)`。
 *
 * 太陽越低 `tan` 越小，所以最糟的情況是清晨與黃昏，不是正午。
 */
export function shadowOffsetMetres(opts: {
  normalBias: number;
  depthBias: number;
  near: number;
  far: number;
  sunElevationRad: number;
}): number {
  const { normalBias, depthBias, near, far, sunElevationRad } = opts;
  const fromNormal = normalBias / Math.tan(sunElevationRad);
  const alongLight = Math.abs(depthBias) * (far - near);
  const fromDepth = 2 * alongLight * Math.cos(sunElevationRad);
  return (fromNormal + fromDepth) * METRES_PER_CELL;
}

/**
 * WeatherRenderer 擺太陽的方式，抽成純函式好讓陰影的算式吃得到。
 *
 * `sunY` 的下限是 `80 × 0.1` —— 太陽不會真的落到地平線，否則影子會無限長。
 * 那個下限決定了**最糟的仰角**，而陰影的偏移正是在那裡最大。
 */
export function sunElevationRad(dayFraction: number): number {
  const sunAngle = dayFraction * Math.PI * 2 - Math.PI / 2;
  const sunFactor = Math.max(0, Math.sin(sunAngle));
  const y = 80 * Math.max(0.1, sunFactor);
  const x = 50 * Math.cos(sunAngle);
  return Math.atan2(y, Math.hypot(x, 50));
}

/** 一天之中最低的太陽 —— 陰影偏移的最壞情況。 */
export function worstSunElevationRad(): number {
  let worst = Infinity;
  for (let i = 0; i <= 200; i++) worst = Math.min(worst, sunElevationRad(i / 200));
  return worst;
}
