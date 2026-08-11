import { PART_WALL } from '../parts';

/**
 * 量體 —— 生成器的中間表示。
 *
 * 生成器不直接產出 `BufferGeometry`，而是先產出一串盒子的座標。多這一層是為了
 * 讓「不對稱、重疊、越界」能用算術精確驗證：階段 2B 的 BUG-222 正是因為只能量
 * 合併後的包圍盒，而漏掉了「離格心最大距離」與「包圍盒寬度」的差別。
 *
 * 座標單位是格（1 格 = 12 m），y0 = 0 是地面，格心是 (0, 0)。
 */

/**
 * `cylinder` 是唯一不由 `frustum` 產生的形狀 —— 煙囪與筒倉是圓的，而八邊形
 * 在等角視角下就已經讀得出圓。它仍然填滿宣告的 w × d 盒子（八邊形有頂點落在
 * ±x 與 ±z 上），所以 `maxAbsOf`、`overlapOf`、`rasterise` 不必知道它是圓的。
 */
export type VolumeShape =
  'box' | 'gable' | 'hip' | 'shed' | 'sawtooth'
  | 'cylinder' | 'dome' | 'cooling' | 'stack';

export interface Volume {
  /** 中心 */
  x: number;
  z: number;
  /** 寬深 */
  w: number;
  d: number;
  /** 底與頂 */
  y0: number;
  y1: number;
  /** 畫成什麼。預設是盒子。 */
  shape?: VolumeShape;
  /** 零件標籤，預設 `PART_WALL`。 */
  part?: number;
  /** 斜面朝向：0 = +z、1 = +x、2 = −z、3 = −x。只有斜屋頂用得到。 */
  facing?: 0 | 1 | 2 | 3;
}

/** 輪廓光柵的邊長。16 夠細到分得出偏屋，又夠粗到不受浮點誤差影響。 */
export const RASTER = 16;

export const partOf = (v: Volume): number => v.part ?? PART_WALL;

const x0 = (v: Volume) => v.x - v.w / 2;
const x1 = (v: Volume) => v.x + v.w / 2;
const z0 = (v: Volume) => v.z - v.d / 2;
const z1 = (v: Volume) => v.z + v.d / 2;

/**
 * 離格心的最大距離。
 *
 * 用它而不是包圍盒寬度：非置中的量體會單邊外凸，而寬度看不出來。行人的門節點
 * 在 `HALF_ENVELOPE` 外側，所以越過它就是行人穿牆（BUG-221/222）。
 */
export function maxAbsOf(vs: readonly Volume[]): number {
  let m = 0;
  for (const v of vs) {
    m = Math.max(m, Math.abs(x0(v)), Math.abs(x1(v)), Math.abs(z0(v)), Math.abs(z1(v)));
  }
  return m;
}

/** 最高點。 */
export function topOf(vs: readonly Volume[]): number {
  let m = 0;
  for (const v of vs) m = Math.max(m, v.y1);
  return m;
}

/**
 * 兩個量體的交集體積。接觸（共面）回傳 0。
 *
 * 重疊的量體會產生看不見的內部面 —— 白吃三角形，而且畫面上完全看不出來，
 * 所以只能用算術擋。
 */
export function overlapOf(a: Volume, b: Volume): number {
  const ox = Math.min(x1(a), x1(b)) - Math.max(x0(a), x0(b));
  const oz = Math.min(z1(a), z1(b)) - Math.max(z0(a), z0(b));
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return ox > 0 && oz > 0 && oy > 0 ? ox * oz * oy : 0;
}

/**
 * 體積重心偏離包圍盒中心的距離，除以包圍盒的邊長。0 就是完全對稱。
 *
 * 這是「旋轉有沒有意義」的指標，而不是用光柵差異：一個 7.5 × 8.2 的盒子轉
 * 90° 之後光柵差異可以到 15%，但它看起來還是同一個盒子。重心看得出真正的
 * 不對稱（L 形、偏屋、偏置塔），看不出「只是寬深不同」。
 */
export function centroidOffset(vs: readonly Volume[]): number {
  let mass = 0;
  let cx = 0;
  let cz = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of vs) {
    const m = v.w * v.d * (v.y1 - v.y0);
    mass += m;
    cx += v.x * m;
    cz += v.z * m;
    minX = Math.min(minX, x0(v));
    maxX = Math.max(maxX, x1(v));
    minZ = Math.min(minZ, z0(v));
    maxZ = Math.max(maxZ, z1(v));
  }
  if (mass <= 0) return 0;
  const dx = cx / mass - (minX + maxX) / 2;
  const dz = cz / mass - (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ);
  return span > 0 ? Math.hypot(dx, dz) / span : 0;
}

/**
 * 把量體光柵化成 `RASTER × RASTER` 的高度圖，涵蓋整個格子 [−0.5, 0.5]。
 *
 * 格值是該處的最高點，沒有量體的格是 0。這讓「兩個形狀像不像」變成一個算得
 * 出來的數字，而不是憑感覺。
 */
export function rasterise(vs: readonly Volume[]): Float32Array {
  const g = new Float32Array(RASTER * RASTER);
  for (let r = 0; r < RASTER; r++) {
    const z = -0.5 + (r + 0.5) / RASTER;
    for (let c = 0; c < RASTER; c++) {
      const x = -0.5 + (c + 0.5) / RASTER;
      let h = 0;
      for (const v of vs) {
        if (x >= x0(v) && x <= x1(v) && z >= z0(v) && z <= z1(v)) h = Math.max(h, v.y1);
      }
      g[r * RASTER + c] = h;
    }
  }
  return g;
}

/** 高度圖轉四分之一圈。 */
export function rotate90(grid: Float32Array): Float32Array {
  const out = new Float32Array(grid.length);
  for (let r = 0; r < RASTER; r++) {
    for (let c = 0; c < RASTER; c++) {
      out[c * RASTER + (RASTER - 1 - r)] = grid[r * RASTER + c]!;
    }
  }
  return out;
}

/**
 * 兩個高度圖的差異率：高度差超過 `tolerance` 的格子，佔**兩者聯集**的比例。
 *
 * 分母是聯集而不是整張圖 —— 用整張圖的話，形狀愈小愈容易被判定成相同：
 * L 形的缺口是建築本身的 20%，但建築只佔格子的一半，所以稀釋成 10%，
 * 剛好卡在門檻上。聯集當分母讓這個指標與尺度無關。
 *
 * `tolerance` 通常取半層樓 —— 矮了十公分不算「不一樣的形狀」。
 */
export function differenceRatio(
  a: Float32Array, b: Float32Array, tolerance: number,
): number {
  let diff = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]! > 0 || b[i]! > 0) union++;
    if (Math.abs(a[i]! - b[i]!) > tolerance) diff++;
  }
  return union === 0 ? 0 : diff / union;
}
