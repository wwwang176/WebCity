/**
 * 建築外觀亂數的唯一來源。
 *
 * 純邏輯模組 —— 不 import Three.js，因此展示區與遊戲共用同一份，
 * 也因此可以完整地單元測試。
 *
 * 取代 BuildingRenderer 原本的 `hash(x, y)` 加偏移輸入寫法：
 * `hash(x+100, y+100)` 在 (0,0) 的值等於 `hash(x, y)` 在 (100,100) 的值，
 * 所以相距 100 格的兩棟建築有多條亂數流共用同一批數字、只是換了角色。
 * 這裡改成把流編號混進雜湊，流數再多也不會互相汙染。
 */

/** 亂數流編號。每個用途一條，彼此獨立。 */
export const STREAM = {
  VARIANT: 0,
  HEIGHT: 1,
  WIDTH: 2,
  DEPTH: 3,
  ROTATION: 4,
  PALETTE: 5,
  HUE: 6,
  SATURATION: 7,
  LIGHTNESS: 8,
  FACADE_RHYTHM: 9,
  FACADE_PHASE: 10,
  FACADE_MATERIAL: 11,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

/**
 * 四輸入雜湊，回傳 [0, 1)。
 *
 * 用 Math.imul 而不是 `*`：JavaScript 的 `*` 在乘積超過 2^53 時會失去精度，
 * `(a * b) | 0` 得到的並不是正確的 32 位元乘法結果。
 */
export function hashCell(x: number, y: number, seedByte: number, stream: number): number {
  let h = (Math.imul(x, 374761393)
    + Math.imul(y, 668265263)
    + Math.imul(seedByte, 1442695041)
    + Math.imul(stream, 2246822519)
    + 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 11), 2246822519) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 這一格該用哪一個變體。variantCount 為 0 時回傳 0，不回傳 NaN。 */
export function variantIndexOf(
  x: number, y: number, seedByte: number, variantCount: number,
): number {
  if (variantCount <= 0) return 0;
  return Math.floor(hashCell(x, y, seedByte, STREAM.VARIANT) * variantCount) % variantCount;
}

export interface AppearanceInput {
  x: number;
  y: number;
  zoneType: number;
  level: number;
  /** 建築的身分證。第四階段之前一律傳 0。 */
  seedByte: number;
  /** 這個 (分區, 等級) 桶有幾個變體。 */
  variantCount: number;
  /** 這個分區的色盤長度。 */
  paletteSize: number;
}

export interface Appearance {
  variantIndex: number;
  /**
   * [0, 1) 的原始亂數，交給 `footprintScaleFor` 換算成縮放。
   *
   * 範圍以前寫在這裡（0.85 ~ 1.15），與「基地寬度上限」分屬兩個檔案，
   * 所以放寬目標寬度時沒人記得抖動是再乘上去的 —— 一半以上的建築因此
   * 越過行人包絡線（BUG-222）。現在容不容得下抖動由註冊表一處決定。
   */
  width01: number;
  depth01: number;
  /**
   * 0.9 ~ 1.1，套在目標高度上的自然差異。
   *
   * 原本是 +-17.5%，跨度整整一層樓，所以同一等級的兩棟房子會被讀成不同
   * 等級。目標高度表接手之後，這裡只該是「同一種建築之間的差異」——
   * +-10% 在 5 m 的房子上是半公尺，在 50 m 的塔樓上是五公尺，都還讀得出
   * 是同一種建築。
   */
  heightScale: number;
  /** 0 ~ 3，四分之一圈 */
  rotationQuarter: number;
  paletteIndex: number;
  /** -0.015 ~ 0.015 */
  hueShift: number;
  /** -0.05 ~ 0.05 */
  satShift: number;
  /** -0.05 ~ 0.05 */
  lightShift: number;
  /** 交給 shader 的 aSeed：節奏、相位、材質偏好。 */
  facadeSeed: readonly [number, number, number];
}

/**
 * 這些數值範圍刻意與重構前的 BuildingRenderer.setInstanceData 一致，
 * 好讓這個改動只搬家、不改外觀。
 */
export function appearanceOf(input: AppearanceInput): Appearance {
  const { x, y, seedByte, variantCount, paletteSize } = input;
  const at = (s: number) => hashCell(x, y, seedByte, s);

  return {
    variantIndex: variantIndexOf(x, y, seedByte, variantCount),
    width01: at(STREAM.WIDTH),
    depth01: at(STREAM.DEPTH),
    heightScale: 1.0 + (at(STREAM.HEIGHT) - 0.5) * 0.2,
    rotationQuarter: Math.floor(at(STREAM.ROTATION) * 4) % 4,
    paletteIndex: paletteSize > 0
      ? Math.floor(at(STREAM.PALETTE) * paletteSize) % paletteSize
      : 0,
    hueShift: (at(STREAM.HUE) - 0.5) * 0.03,
    satShift: (at(STREAM.SATURATION) - 0.5) * 0.1,
    lightShift: (at(STREAM.LIGHTNESS) - 0.5) * 0.1,
    facadeSeed: [
      at(STREAM.FACADE_RHYTHM),
      at(STREAM.FACADE_PHASE),
      at(STREAM.FACADE_MATERIAL),
    ],
  };
}
