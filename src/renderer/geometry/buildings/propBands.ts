import { METRES_PER_CELL } from '../../../core/grid/constants';
import { TARGET_WIDTHS_M, heightKey, widthJitterFor, type Density } from './registry';
import {
  HALF_ENVELOPE, CELL_EDGE, OVERHEAD_CLEARANCE, FLOOR_HEIGHT_UNITS,
  SHOPFRONT_CEILING, GROUND_LAYERS,
} from './massing/metrics';

// 既有呼叫端從 propBands 取這些常數。實體在 massing/metrics —— 這裡只轉出，
// 不再定義：propBands 之後要量 massing 產出的量體，常數留在這裡就是循環。
export { OVERHEAD_CLEARANCE, FLOOR_HEIGHT_UNITS, SHOPFRONT_CEILING, GROUND_LAYERS };

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

/** 矮物件帶窄於 0.4 m 就不給 —— 那個寬度塞不下任何看得見的東西。 */
const MIN_LOW_BAND = 0.4 / METRES_PER_CELL;

/** 貼片與懸挑帶窄於 1 m 就不給。 */
const MIN_WIDE_BAND = 1.0 / METRES_PER_CELL;

export interface Band {
  inner: number;
  outer: number;
}

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
