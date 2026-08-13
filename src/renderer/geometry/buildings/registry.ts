import type * as THREE from 'three';
import { ZoneType } from '../../../core/grid/types';

/**
 * 建築的尺寸表與共用型別。
 *
 * 量體幾何本身已經搬到 `massing/` —— 這裡曾經有十七個手寫變體與六個縮放函式，
 * 全部由參數化生成器取代（階段 2C-1）。留下的是「目標高度」「目標寬度」這類
 * 由遊戲數值推導的表，以及桶的識別方式。
 */

/** 產生一份幾何的函式。桶在建立時呼叫一次。 */
export type GeoBuilder = () => THREE.BufferGeometry;

export const LEVELS = [1, 2, 3] as const;

/** 三角形上限。展示區的計數器照這兩條線標示。 */
export const TRIANGLE_BUDGET = {
  HOUSE: 400,
  TOWER: 800,
  /**
   * 地面物件另外計算：它是獨立圖層，不佔量體的預算，而且遠距離時只要把
   * 這一層的 count 設 0 就等於免費（規格 §4.6）。
   *
   * 240 是階段 2B 只有住宅樹籬時訂的。2B-2 把詞彙擴到十二種零件、擴及所有
   * 分區之後，實測最高是住宅高 L3 的 272。320 留了兩成餘裕。
   * 圖元段數已經削過一輪（矮柱改方柱、球體降段數），砍到 240 以下就會開始
   * 傷到觀感，而這個專案的取捨是好看優先、效能寬鬆。
   */
  PROP: 320,
} as const;

// ===== Height ranges per zone =====

export type Density = 'LOW' | 'HIGH';

/** 高度表的 key：分區加密度。辦公區兩種密度差 11 倍人口（BUG-220）。 */
export function heightKey(zoneType: number, density: Density): string {
  return `${zoneType}:${density}`;
}

/**
 * 每個 (分區, 密度) 三個等級的目標高度，單位是**公尺**。
 *
 * 由容納人口推導（樓層 3 m、工業 6 m；佔地率 低密度 60% / 高密度 85% /
 * 工業 70%；每人樓地板 住宅低 35、住宅高 28、商業 30、工業 40、辦公 15 m2）。
 *
 * 低密度照實算。高密度壓縮：320 人塞進 144 m2 的一格是現實的三倍密度，
 * 照實算 L3 高層住宅要 220 m、比基地寬 18 倍，一整區會像針床。
 * 壓縮之後高密度建築的視覺密度低於它實際容納的人口 —— 這是刻意接受的取捨，
 * 要讓兩者一致該改的是遊戲的人口數值，不是渲染（規格修訂 1）。
 *
 * 高密度下修過兩輪：30/51/75 -> 22/36/52 -> 22/32/42（住宅高，其餘同步）。
 * 第二輪只壓 L2 與 L3，L1 維持不動，因為過高的觀感集中在頂端等級。
 * 住宅低與商業低三輪都不動 —— 它們本來就是照實算的。
 *
 * 低密度辦公上修 9/15/24 -> 12/18/24：9 m 的辦公樓在高密度旁邊顯得發育不良。
 * L3 停在 24 m 是有意的 —— 辦公低 L3 是 50 人、辦公高 L1 是 160 人，
 * 讓前者更高會把階梯倒過來。
 *
 * 工業三個等級一起下修（8/12/16 -> 7/10/13 -> 6/7.5/9）並把基地拉到上限。
 * 現代廠房幾乎都是單層挑高、鋪滿基地，多層工廠很少見，所以工業的等級階梯
 * 不該表現在高度上 —— 它應該表現在煙囪、筒倉、管架、貨櫃這些設備上，
 * 那是階段 2C 屋頂與地面物件的工作。
 */
export const TARGET_HEIGHTS_M: Record<string, [number, number, number]> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   [5, 7, 10],
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: [22, 32, 42],
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    [5, 8, 12],
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  [18, 27, 36],
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        [6, 7.5, 9],
  [heightKey(ZoneType.OFFICE, 'LOW')]:            [12, 18, 24],
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           [24, 36, 48],
};

/**
 * 有建築的分區。以前是從 `VARIANTS` 的 key 推導，那張表已經不存在了 ——
 * 量體由生成器產出，而「哪些分區有建築」的實體是高度表。
 */
export const ZONE_TYPES: number[] = [
  ...new Set(Object.keys(TARGET_HEIGHTS_M).map(k => Number(k.split(':')[0]))),
];

/**
 * 每個 (分區, 密度) 的目標基地寬度，單位是**公尺**。
 *
 * 以前是從 `FOOTPRINTS` 的抖動表推導出來的。生成器接手之後抖動不存在了 ——
 * 八個變體各自在目標的 85%–100% 之間取一個實際寬度，「最窄／最寬的牆面」
 * 是量出來的（見 `propBands`），不再是公式推出來的。
 *
 * 上限是 `MAX_BUILDING_WIDTH_M` 9.8 m —— 行人的門與走道節點放在建築牆面
 * 外側，超過就會讓行人走進建築裡面（BUG-221）。那個常數與 SidewalkGraph 共用。
 *
 * 建築原本一律 7–8 m 寬、只佔格子 60%，所以 42 m 的高層住宅是 5.5:1 的細針
 * —— 看起來「太高」有一半是因為太瘦。真實的高層幾乎鋪滿基地。
 *
 * 住宅低 7.2 → 6.0（階段 2B）：7.2 量的是「房子 + 車庫 + 樹」的包圍盒，
 * 房子本體只佔 4.3 m。庭院物件搬進獨立圖層之後若仍以 7.2 為目標，房子本體
 * 會被放大到 7.2 m、庭院只剩 0.76 m。
 *
 * 階段 2B-2 縮寬：商業低／辦公低 8.4 → 7.8（−7%），鋪滿基地者 9.8 → 9.0（−8%）。
 * 為的是讓每個分區都有 0.4 m 以上的矮物件帶 —— 那個寬度放得下矮柱、垃圾桶、
 * 單車架、消防栓。原本這些分區的帶寬是 0.07 m 或 0，什麼都放不下。
 */
export const TARGET_WIDTHS_M: Record<string, number> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   6.0,
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: 9.0,
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    7.8,
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  9.0,
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        9.0,
  [heightKey(ZoneType.OFFICE, 'LOW')]:            7.8,
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           9.0,
};

/**
 * 變體桶的完整識別。分區、密度、等級、變體序號四個維度缺一不可：
 * 少了密度，辦公區 15 人與 160 人的建築同桶（BUG-220）；
 * 少了等級，升級只能靠縮放。
 */
export function bucketKey(
  zoneType: number, density: Density, level: number, variantIndex: number,
): string {
  return `${zoneType}_${density}_${level}_${variantIndex}`;
}
