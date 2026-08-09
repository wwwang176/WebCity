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
 * 建築抖到最寬時的外緣。三類的內緣都是它。
 *
 * 用目標寬度乘最大向上抖動，而不是某個變體的實際寬度：物件是整個
 * (分區, 密度) 桶共用的，不能依賴這一格配到哪一個量體變體。
 */
export function buildingEdge(zoneType: number, density: Density): number | null {
  const target = TARGET_WIDTHS_M[heightKey(zoneType, density)];
  if (!target) return null;
  return (target / METRES_PER_CELL / 2) * (1 + widthJitterFor(zoneType, density).up);
}

function band(inner: number | null, outer: number, min: number): Band | null {
  if (inner === null || outer - inner < min) return null;
  return { inner, outer };
}

/** 貼片：建築外緣到格子邊界。行人走在上面，所以可以蓋過走道。 */
export function decalBand(zoneType: number, density: Density): Band | null {
  return band(buildingEdge(zoneType, density), CELL_EDGE, MIN_WIDE_BAND);
}

/** 矮物件：建築外緣到行人包絡線。窄於 0.4 m 回傳 null。 */
export function lowPropBand(zoneType: number, density: Density): Band | null {
  return band(buildingEdge(zoneType, density), HALF_ENVELOPE, MIN_LOW_BAND);
}

/** 懸挑：與貼片同寬，但物件的最低點必須高於 `OVERHEAD_CLEARANCE`。 */
export function overheadBand(zoneType: number, density: Density): Band | null {
  return band(buildingEdge(zoneType, density), CELL_EDGE, MIN_WIDE_BAND);
}
