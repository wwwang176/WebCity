import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../../core/grid/constants';
import { TARGET_WIDTHS_M, heightKey, widthJitterFor, type Density } from './registry';

/**
 * 地面物件的三類放置帶。
 *
 * 階段 2B 只推導了一類（矮物件），結論是「只有住宅低密度有空間」。那個結論
 * 沒有錯，但它只涵蓋「站在地上、佔據高度、行人會撞到」的東西。另外兩類的
 * 限制完全不同：
 *
 *   貼片  完全平，行人走在上面 —— 那本來就是人行道，可以鋪到格子邊界
 *   懸挑  最低點高過人頭，行人從下面走過 —— 可以像騎樓一樣挑出去
 *
 * 兩者對每個分區都有一公尺以上的空間，而且不必動任何建築尺寸。
 */

/** 行人的門節點在這裡外側。矮物件的外緣。 */
const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/** 格子邊界。再過去就是鄰居家或馬路。 */
const CELL_EDGE = 0.5;

/** 行人頭頂淨空 2.2 m。低於它的懸挑物會打到人。 */
export const OVERHEAD_CLEARANCE = 2.2 / METRES_PER_CELL;

/** 矮物件帶窄於 0.4 m 就不給 —— 那個寬度塞不下任何看得見的東西。 */
const MIN_LOW_BAND = 0.4 / METRES_PER_CELL;

/** 貼片與懸挑帶窄於 1 m 就不給。 */
const MIN_WIDE_BAND = 1.0 / METRES_PER_CELL;

/**
 * 貼著地面的東西該放多高（格）。
 *
 * 這張表存在的理由是 BUG-224：分區建築原本放在 y = 0.05，那是**路面**的高度
 * （`ROAD_Y` 0.025 加板厚 0.05 的一半），不是地面的高度。地形表面是 y = 0，
 * 所以每一棟建築都浮空 0.6 m —— 影子投在地上、建築從 0.6 m 才開始，太陽斜射
 * 時兩者分家。基礎設施建築用的是 0，兩者不一致本身就是筆誤的證據。
 *
 * 分區建築永遠不會蓋在馬路格上，所以對齊路面高度沒有任何理由。
 *
 * 全部收成一張表而不是各寫各的：這些數字彼此有順序關係（標線要疊在鋪面上），
 * 散在四個檔案裡改一個就會壓到另一個。
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

export interface Band {
  inner: number;
  outer: number;
}

/**
 * 立面 shader 的樓層高度範圍（格）。2.64 m 到 3.6 m。
 *
 * 實體在這裡而不是 GLSL 裡：`SHOPFRONT_CEILING` 要用它，而幾何與 shader
 * 對不上的話，雨遮會掛在窗戶中間 —— 那種錯不會有任何東西報錯。
 */
export const FLOOR_HEIGHT_UNITS = { MIN: 0.22, MAX: 0.30 } as const;

/**
 * 一樓樓板線 —— 掛在店面上的東西不得高過它。
 *
 * 取**最低**的樓高：每一棟的樓高是逐實例亂數（`aSeed.x`），懸挑物的幾何是
 * 整個桶共用的一份，不知道自己掛在哪一棟上。取最低值才保證永遠不會越過一樓。
 */
export const SHOPFRONT_CEILING = FLOOR_HEIGHT_UNITS.MIN;

/**
 * 建築牆面的位置 —— 但每一棟的寬度是逐實例抖動的（±15%），所以「牆面在哪」
 * 有兩個答案，用哪一個取決於這個物件**要不要碰到牆**：
 *
 *   最寬（`widest`）    自立的東西用它。樹、垃圾桶要放在**所有**建築之外，
 *                       否則最寬的那一棟會把它們吃進牆裡。
 *   最窄（`narrowest`）  要貼牆的東西用它。雨遮、鋪面要碰到**所有**建築，
 *                       多出來的部分埋在牆內、被擋住，看不見。
 *
 * 貼牆的東西用最寬值就是 BUG-226：只有剛好抖到最寬的那一棟碰得到牆，
 * 其餘每一棟上都浮空 0.68–1.17 m。
 */
function halfTarget(zoneType: number, density: Density): number | null {
  const target = TARGET_WIDTHS_M[heightKey(zoneType, density)];
  return target ? target / METRES_PER_CELL / 2 : null;
}

/** 抖到最寬時的牆面。自立物件的內緣。 */
export function widestBuildingEdge(zoneType: number, density: Density): number | null {
  const half = halfTarget(zoneType, density);
  return half === null ? null : half * (1 + widthJitterFor(zoneType, density).up);
}

/** 抖到最窄時的牆面。貼牆物件的內緣。 */
export function narrowestBuildingEdge(zoneType: number, density: Density): number | null {
  const half = halfTarget(zoneType, density);
  return half === null ? null : half * (1 - widthJitterFor(zoneType, density).down);
}

function band(inner: number | null, outer: number, min: number): Band | null {
  if (inner === null || outer - inner < min) return null;
  return { inner, outer };
}

/**
 * 貼片：建築牆面到格子邊界。行人走在上面，所以可以蓋過走道。
 *
 * 內緣用最窄的牆面 —— 鋪面要碰得到每一棟的牆腳，伸進建築底下的部分被
 * 建築本身擋住。用最寬值的話，窄的那些建築腳下會露出一圈裸地。
 */
export function decalBand(zoneType: number, density: Density): Band | null {
  return band(narrowestBuildingEdge(zoneType, density), CELL_EDGE, MIN_WIDE_BAND);
}

/** 矮物件：建築牆面到行人包絡線。自立，所以內緣用最寬的牆面。窄於 0.4 m 回傳 null。 */
export function lowPropBand(zoneType: number, density: Density): Band | null {
  return band(widestBuildingEdge(zoneType, density), HALF_ENVELOPE, MIN_LOW_BAND);
}

/** 懸挑：與貼片同寬同理由，但物件的最低點必須高於 `OVERHEAD_CLEARANCE`。 */
export function overheadBand(zoneType: number, density: Density): Band | null {
  return band(narrowestBuildingEdge(zoneType, density), CELL_EDGE, MIN_WIDE_BAND);
}
