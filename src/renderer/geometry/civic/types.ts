import type { Volume } from '../buildings/massing/volume';

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
   * 交給 shader 的 `aSeed`：樓層節奏、窗戶相位、材質微調。
   *
   * 分區建築由座標雜湊產生（同一種建築在城市各處長得不一樣）；公共建築相反
   * —— 三間小學必須長得一樣，所以由 plan 直接給定值。
   */
  seed: readonly [number, number, number];
  /** 量體。castShadow，遠景不關。 */
  massing: Volume[];
  /** 地面貼片。完全平，不投影，遠景**不關**（關掉會讓遠景整片地變空）。 */
  decals: CivicDecal[];
  /** 矮物件：樹、路燈、旗桿、垃圾桶、車輛。castShadow，遠景整層關掉。 */
  props: Volume[];
  /** 懸挑：雨棚、招牌、月台頂。castShadow，遠景整層關掉。 */
  overhead: Volume[];
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
 * 每格 300 是刻意低於塔樓的 800：一座 3×3 的大學若每格都照塔樓的密度做，
 * 單棟就 7200 三角形，而畫面上它只有一棟。
 *
 * **這四個數字是推的，不是量的。** 批 1 的六棟做完之後要用實測回頭校準
 * （計畫的 Task 11）。
 */
export const CIVIC_TRIANGLE_BUDGET = {
  MASSING_PER_CELL: 300,
  DECAL_PER_CELL: 60,
  PROP_PER_CELL: 120,
  OVERHEAD_PER_CELL: 80,
} as const;
