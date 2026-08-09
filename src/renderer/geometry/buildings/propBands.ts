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
