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

/**
 * 圖層、面板色塊、標籤底色共用的飽和度與亮度。
 *
 * 三個地方原本各寫各的（圖層 `setHSL(v, 0.7, 0.5)`、面板 CSS、標籤 canvas），調一次
 * 要記得改三個地方，而漏掉哪一個不會有任何徵兆 —— 只會看起來「怪怪的」。
 *
 * 飽和度壓到 0.45:分區的顏色是要能長時間看著的底色，不是警示。
 */
export const DISTRICT_COLOR = { saturation: 0.45, lightness: 0.55 } as const;

/** 標籤底色比色塊暗一階，白字才壓得住。 */
export const DISTRICT_LABEL_LIGHTNESS = 0.3;

const SATURATION = DISTRICT_COLOR.saturation;
const LIGHTNESS = DISTRICT_COLOR.lightness;

/**
 * 八個色相。刻意避開 80–150 度那一段。
 *
 * 那一段是草地的顏色。飽和度壓低之後，落在那裡的色票鋪在地圖上幾乎看不見 ——
 * 均勻切色相環的版本裡有兩個色票（93 度與 137 度）就是這樣化在草地裡。
 *
 * 顏色是玩家在地圖上認出「這是哪一區」的線索，看不見的色票等於少了一個選項。
 */
const SWATCH_HUES = [352, 20, 42, 66, 172, 196, 224, 288] as const;

export const DISTRICT_SWATCHES: readonly DistrictSwatch[] = SWATCH_HUES.map((hue) => ({
  // 圖層的數值就是色相除以 3.6。存這個數字而不是色相，是因為那條管線只認它。
  value: hue / 3.6,
  css: `hsl(${hue} ${SATURATION * 100}% ${LIGHTNESS * 100}%)`,
}));

/** 這個索引有對應的色票嗎。存檔是可以編輯的，超出範圍要退回預設。 */
export function isValidSwatchIndex(index: number | undefined): boolean {
  return index !== undefined && Number.isInteger(index)
    && index >= 0 && index < DISTRICT_SWATCHES.length;
}

/**
 * 發配色票的順序。不是 0、1、2、3。
 *
 * 玩家連續畫出來的分區拿的是連續發配的色票，而色票是照色相排的 —— 照索引順序發的話，
 * 前兩區必然拿到相鄰的兩個色相（352 度與 20 度），那是這八個裡最像的一對。
 *
 * 這串是位元反轉序:每次都跳到目前最大的那個空隙中間，所以無論停在第幾個，已發出去
 * 的那幾個都是散開的。等於黃金比例序列的離散版 —— 舊的雜湊色相本來就是為了同一件事。
 */
const SWATCH_HANDOUT_ORDER = [0, 4, 2, 6, 1, 5, 3, 7] as const;

/**
 * 一個新分區該配哪一個色票。
 *
 * 分區一建立就要有顏色。沒配的話它會落在 id 雜湊出來的色相上 —— 那個色相不在這八個
 * 裡面，可能落進草地那一段看不見，而且玩家沒得「改回原本那個」，因為原本那個不是
 * 色票。
 *
 * 先給沒人用的。八個都用掉之後給重複次數最少的 —— 單純取模會一直疊在同一個上，
 * 而刪掉一區之後那個顏色也該被放回去。
 */
export function nextSwatchIndex(existing: readonly (number | undefined)[]): number {
  const used = new Array<number>(DISTRICT_SWATCHES.length).fill(0);
  for (const index of existing) {
    // 壞掉的索引不算用掉了。這件事**沒有測試守得到** —— 下面找的是「用最少的」，
    // 而雜散的鍵永遠 ≥ 那些沒被碰過的 0，所以算不算進去結果都一樣。留著是因為
    // 這裡改成別的挑法（取模、輪流、取最多）時它就會開始有影響。
    if (isValidSwatchIndex(index)) used[index!]!++;
  }
  let best: number = SWATCH_HANDOUT_ORDER[0]!;
  for (const i of SWATCH_HANDOUT_ORDER) {
    if (used[i]! < used[best]!) best = i;
  }
  return best;
}

/** 面板上要把哪一個色塊畫成選取狀態。沒有選過就回 undefined。 */
export function swatchCssFor(index: number | undefined): string | undefined {
  return isValidSwatchIndex(index) ? DISTRICT_SWATCHES[index!]!.css : undefined;
}
