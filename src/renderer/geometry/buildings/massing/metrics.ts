import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../../../core/grid/constants';

/**
 * 量體生成器與地面物件層共用的純量常數。
 *
 * 這個模組**不 import 任何本套件內的東西**，那是它存在的理由：`propBands` 要量
 * `massing` 產出的量體，而 `massing` 要用 `SHOPFRONT_CEILING` —— 常數留在
 * `propBands` 裡就是一個 import 循環。
 */

/** 公尺 → 格。1 格 = 12 m。 */
export function M(metres: number): number {
  return metres / METRES_PER_CELL;
}

/**
 * 行人包絡線半寬。
 *
 * `SidewalkGraph` 的門節點放在這裡外側，所以建築越過它就是行人走進牆裡
 * （BUG-221）。實體是 `MAX_BUILDING_WIDTH_M`，這裡只換算單位 —— 自己寫一個
 * 數字就會漂移，而漂移不會有任何東西報錯。
 */
export const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/** 格子邊界。再過去就是鄰居家或馬路。 */
export const CELL_EDGE = 0.5;

/** 行人頭頂淨空 2.2 m。低於它的懸挑物會打到人。 */
export const OVERHEAD_CLEARANCE = M(2.2);

/**
 * 立面 shader 的樓層高度範圍（格）。2.64 m 到 3.6 m。
 *
 * 實體在這裡而不是 GLSL 裡：量體的樓層數要用它，而幾何與 shader 對不上的話，
 * 雨遮會掛在窗戶中間 —— 那種錯不會有任何東西報錯。
 */
export const FLOOR_HEIGHT_UNITS = { MIN: 0.22, MAX: 0.30 } as const;

/**
 * 一樓樓板線 —— 掛在店面上的東西不得高過它。
 *
 * 取**最低**的樓高：每一棟的樓高由變體決定，懸挑物的幾何是整桶共用的一份，
 * 不知道自己掛在哪一個變體上。取最低值才保證永遠不會越過一樓。
 */
export const SHOPFRONT_CEILING = FLOOR_HEIGHT_UNITS.MIN;

/**
 * 貼著地面的東西該放多高（格）。
 *
 * 這張表存在的理由是 BUG-224：分區建築原本放在 y = 0.05，那是**路面**的高度，
 * 不是地面的高度，所以每一棟都浮空 0.6 m。這些數字彼此有順序關係（標線要疊在
 * 鋪面上），散在四個檔案裡改一個就會壓到另一個。
 */
export const GROUND_LAYERS = {
  /** 建築與地面物件的底面。2.4 cm 足以避開與地形共面的 z-fighting。 */
  BUILDING: 0.002,
  /** 鋪面貼片。與建築同高，兩者在平面上不重疊。 */
  DECAL: 0.002,
  /** 停車格線與入口踏板，疊在鋪面上。 */
  MARKING: 0.003,
  /** 夜間的地面光暈，疊在標線上。 */
  LIGHT_SPOT: 0.004,
} as const;
