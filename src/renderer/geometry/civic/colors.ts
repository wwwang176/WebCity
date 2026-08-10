import type { InfraType } from '../../../core/building/InfraConfig';

/**
 * 公共建築的代表色。
 *
 * 這是玩家辨認它們的**主要**訊號。等角視角下，剪影要縮到很近才分得出
 * 「L 形加瞭望塔」與「雙翼加連廊」，顏色卻一眼就看得出來 —— 所以警局是藍的、
 * 消防局是紅的，而那不是裝飾，是功能。
 *
 * 數值直接沿用舊版手寫模型的十六進位色（`BuildingRenderer.buildCivicBuilding`
 * 的 `configs` 表）。玩家已經認得它們，換掉等於把辨識度歸零。
 *
 * 0..1 三元組而不是 `0x` 整數：shader 直接把它乘上光照，而 `ROOF_PALETTE_TABLE`
 * 也是這個形式。兩種表示法混用的話，每次改顏色都要先想「這張表是哪一種」。
 */
export type CivicColor = readonly [number, number, number];

/** `0xRRGGBB` → 0..1 三元組。寫成十六進位是為了與舊表逐位對得上。 */
const rgb = (hex: number): CivicColor => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
];

export const CIVIC_COLORS: Partial<Record<InfraType, CivicColor>> = {
  // ── 民生服務。這六種必須彼此分得開 —— 玩家最常同時看到它們。 ──
  police: rgb(0x3f51b5),        // 靛藍
  fire: rgb(0xd32f2f),          // 消防紅
  hospital: rgb(0xe8e8e8),      // 醫療白
  school: rgb(0x795548),        // 磚褐
  school_high: rgb(0x6d4c41),   // 深磚褐
  school_univ: rgb(0x4e342e),   // 學院深褐

  // ── 綠地 ──
  park: rgb(0x4caf50),          // 草綠
  cemetery: rgb(0x9e9e9e),      // 石灰

  // ── 公用設施。工業語彙，彼此接近是刻意的 —— 它們本來就是同一類東西。 ──
  //
  // 垃圾場的舊值與小學一模一樣（都是 0x795548）。那在舊版看不出來，因為
  // 兩者的造型差很多；改走同一套立面之後，「褐色的方塊」會真的分不出來。
  // 所以這裡改成偏橄欖的工業褐。
  garbage: rgb(0x6b6242),
  sewage: rgb(0x607d8b),        // 藍灰
  power: rgb(0x8d8d8d),         // 廠房灰
  water: rgb(0x4d8fac),         // 水藍

  // ── 交通站點 ──
  bus_stop: rgb(0xff9800),      // 公車橘
  metro_station: rgb(0x2196f3), // 捷運藍
  train_station: rgb(0x795548), // 車站磚褐
  ferry_dock: rgb(0x00bcd4),    // 水青
  airport_s: rgb(0xeceff1),     // 航廈白
  airport_m: rgb(0xeceff1),
  airport_l: rgb(0xeceff1),
};

/** 預設灰。舊版 `configs` 表查不到時給的也是灰（0x888888）。 */
export const CIVIC_DEFAULT_COLOR: CivicColor = [0.7, 0.7, 0.7];

/** 這種公共建築的代表色。沒定義的回傳灰，不回傳 undefined。 */
export function civicColorOf(type: InfraType): CivicColor {
  return CIVIC_COLORS[type] ?? CIVIC_DEFAULT_COLOR;
}
