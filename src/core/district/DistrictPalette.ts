/**
 * 分區的色票。
 *
 * 顏色原本是從 id 用黃金比例雜湊出來的 —— 分得開，但玩家沒得選，而分區的顏色是
 * 玩家在地圖上唯一認得出「這是哪一區」的線索。
 *
 * 色票存的是**圖層的數值**（1–100）而不是色相，因為那條管線只認這個數字:
 * `buildOverlayData` 丟掉 0（代表「這一格沒東西」），`OverlayRenderer` 再把它除以
 * 100 當色相。存色相的話兩邊要各自換算一次，而換算漏掉一邊不會有任何徵兆 ——
 * 面板上的色塊跟地圖上的顏色就是會不一樣。
 */

export interface DistrictSwatch {
  /** 圖層數值，1–100。0 是保留給「這一格不屬於任何分區」的。 */
  value: number;
  /** 面板上色塊的顏色。跟圖層算出來的是同一個色相。 */
  css: string;
}

/** 色票數量。八個在色相環上分得開，也塞得進面板一列。 */
const SWATCH_COUNT = 8;

/** 圖層與面板共用的飽和度與亮度，跟 `OverlayRenderer.getColor` 對齊。 */
const SATURATION = 0.7;
const LIGHTNESS = 0.5;

export const DISTRICT_SWATCHES: readonly DistrictSwatch[] = Array.from(
  { length: SWATCH_COUNT },
  (_, i) => {
    const value = 1 + (i * 99) / SWATCH_COUNT;
    return {
      value,
      css: `hsl(${(value / 100) * 360} ${SATURATION * 100}% ${LIGHTNESS * 100}%)`,
    };
  },
);

/** 這個索引有對應的色票嗎。存檔是可以編輯的，超出範圍要退回預設。 */
export function isValidSwatchIndex(index: number | undefined): boolean {
  return index !== undefined && Number.isInteger(index)
    && index >= 0 && index < DISTRICT_SWATCHES.length;
}

/** 面板上要把哪一個色塊畫成選取狀態。沒有選過就回 undefined。 */
export function swatchCssFor(index: number | undefined): string | undefined {
  return isValidSwatchIndex(index) ? DISTRICT_SWATCHES[index!]!.css : undefined;
}
