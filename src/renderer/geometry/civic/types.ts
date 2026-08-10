import type { Volume } from '../buildings/massing/volume';
import type { CivicColor } from './colors';
import type { Plant } from '../plants';

/**
 * 公共建築的宣告式描述。
 *
 * 它與分區建築的差別只有三點，其餘一律沿用 `buildings/` 那一套：
 *
 * 1. **多格。** 分區建築一格一棟，公共建築佔 2×2 到 9×6。所以護欄擋的是
 *    佔地邊界，不是格內的行人包絡線。
 * 2. **沒有變體。** 一座城市裡的三間小學長得一樣是可接受的 —— 公共建築的
 *    辨識度比多樣性重要。所以沒有 `variantIndex`、不吃 `seedByte`。
 * 3. **沒有等級。** 公共建築不會升級。
 *
 * 座標單位是**格**（1 格 = 12 m），原點是佔地的中心。2×2 的可用範圍是
 * x ∈ [−1, 1]、z ∈ [−1, 1]；2×3 是 x ∈ [−1, 1]、z ∈ [−1.5, 1.5]。
 */

/** 佔地格數。必須與 `InfraConfig` 的 width / height 一致。 */
export interface Footprint {
  w: number;
  h: number;
}

/**
 * 帶標籤的量體。
 *
 * `tag` 完全不影響幾何 —— `shapeOf` 看都不看它。它存在的理由是**測試讀得懂
 * 這棟建築**：「瞭望塔要高過兩支翼」寫成 `find(v => v.tag === 'tower')` 是
 * 一句話，寫成「第三個量體」則是在測試裡複製一份量體表的順序，而順序一改
 * 測試就開始測錯東西。
 *
 * 沒有加進共用的 `Volume`：分區建築的量體是生成器產出的，沒有人手寫，
 * 也就沒有東西可以標。
 */
export type CivicVolume = Volume & {
  tag?: string;
  /**
   * 只有這一塊量體的顏色，蓋過 `CivicPlan.color`。
   *
   * 給重點用：醫院的紅十字、大學的金頂、車站的識別帶。整棟只有一個顏色的話，
   * 這些東西只能跟牆同色 —— 而它們正是「一眼認出這是醫院」的那個東西。
   */
  color?: CivicColor;
};

/**
 * 一塊平鋪面。
 *
 * **不是 `Volume`。** `Volume` 產出的是稜台，有側面 —— 而側面是牆，牆會長出
 * 窗戶。`decals.ts` 的註解已經寫過這件事：「有厚度的話側面會長出牆，而牆會
 * 長出窗戶。所以一律用 `PlaneGeometry`」。
 */
export interface CivicDecal {
  /** 中心。 */
  x: number;
  z: number;
  /** 寬深。 */
  w: number;
  d: number;
  /**
   * 明度，寫進頂點色的 B 通道。0 = 柏油，1 = 白漆。
   *
   * `lawn` 為真時這個值不影響顏色 —— 草地走 `PART_FOLIAGE` 的分支。
   */
  shade: number;
  /**
   * 疊放層。`mark`（標線、入口踏板）疊在 `base`（鋪面）之上。
   *
   * **底層彼此不得重疊** —— 兩塊同高同位的四邊形會 z-fighting，靜態截圖看不
   * 出來，一移動鏡頭就整片閃爍。這條由 `assembleDecals` 守。
   */
  layer?: 'base' | 'mark';
  /** 草地。走 `PART_FOLIAGE` 拿到綠色，而不是 `PART_GROUND` 的灰階。 */
  lawn?: boolean;
}

/** 一棟公共建築的完整描述。四層與分區建築的附掛層逐項對應。 */
export interface CivicPlan {
  footprint: Footprint;
  /** 立面類別。`parts.ts` 的 `FACADE_*` 之一，決定 shader 走哪條立面分支。 */
  facade: number;
  /**
   * 代表色 —— 牆的底色。
   *
   * 等角視角下顏色比剪影更早被認出來，所以警局是藍的、消防局是紅的。
   * 實體在 `colors.ts`，這裡只是引用；兩邊各寫一份的話，改了顏色表而某一棟
   * 沒跟著改，只表現為「那一棟顏色怪怪的」。
   */
  color: CivicColor;
  /**
   * 交給 shader 的 `aSeed`：樓層節奏、窗戶相位、材質微調。
   *
   * 分區建築由座標雜湊產生（同一種建築在城市各處長得不一樣）；公共建築相反
   * —— 三間小學必須長得一樣，所以由 plan 直接給定值。
   */
  seed: readonly [number, number, number];
  /** 量體。castShadow，遠景不關。 */
  massing: CivicVolume[];
  /** 地面貼片。完全平，不投影，遠景**不關**（關掉會讓遠景整片地變空）。 */
  decals: CivicDecal[];
  /** 矮物件：樹、路燈、旗桿、垃圾桶、車輛。castShadow，遠景整層關掉。 */
  props: CivicVolume[];
  /** 懸挑：雨棚、招牌、月台頂。castShadow，遠景整層關掉。 */
  overhead: CivicVolume[];
  /**
   * 植栽 —— 樹與灌木。
   *
   * 與 `props` 分開是**必要的**，不是分類上的潔癖：樹冠是圓錐、灌木是球，
   * 兩者用 `THREE` 的圖元產生，帶著 uv 而且是索引幾何；`props` 走
   * `shapeOf`，產出的是非索引、沒有 uv 的稜台。`mergeGeometries` 要求
   * 屬性集合一致，所以這兩種東西**合併不起來**，只能各自一層。
   *
   * 樹本身與住宅的庭院共用（`geometry/plants`）—— 一座城市裡的樹該是同一種樹。
   * 三角形預算算在 `prop` 那一格，因為它們就是矮物件。
   */
  plants: Plant[];
}

/**
 * 量體要從佔地邊界內縮多少（格）。0.02 格 = 24 cm。
 *
 * 剛好貼齊邊界的話，兩棟相鄰的公共建築會共面 —— z-fighting 在靜態截圖上
 * 看不出來，一移動鏡頭就整片閃爍。
 *
 * **貼片不吃這個。** 它是平的鋪面，鋪到格子邊界是對的：人行道本來就一路
 * 鋪到路邊。
 */
export const CIVIC_INSET = 0.02;

/**
 * 逐**格**的三角形上限。
 *
 * 分區建築的預算是逐棟的（`HOUSE: 400` / `TOWER: 800`），因為它們一格一棟。
 * 公共建築佔 4 到 54 格，套同一條線沒有意義。
 *
 * **物件與綠化的額度刻意開得比分區建築寬。** 分區建築鋪滿整張地圖，一棟多
 * 十個三角形要乘上幾千棟；公共建築一座城市裡也就幾十棟，單棟多花的成本
 * 幾乎量不到。所以「這裡多種幾棵樹」是划算的，而在住宅區同樣的想法會直接
 * 打爆預算 —— 兩者的取捨本來就不同，用同一組數字才是錯的。
 *
 * 對照：分區建築的矮物件上限是每棟 320（`TRIANGLE_BUDGET.PROP`）。
 *
 * **這四個數字仍然是推的，不是量的。** 批 1 的六棟做完之後要用實測回頭校準
 * （計畫的 Task 11）。
 */
export const CIVIC_TRIANGLE_BUDGET = {
  MASSING_PER_CELL: 400,
  DECAL_PER_CELL: 120,
  /** 樹、灌木、路燈、長椅、花台、腳踏車架、停著的車。 */
  PROP_PER_CELL: 400,
  OVERHEAD_PER_CELL: 150,
} as const;
