import type { GeoBuilder, Density } from '../registry';
import { VARIANT_COUNT, dimensionsFor } from './dimensions';
import { FLOOR_HEIGHT_UNITS } from './metrics';
import { variantRng } from './rng';
import { prototypeFor } from './prototypes';
import { roofFor, buildRoof } from './roofForms';
import { assemble } from './assemble';
import { topOf, type Volume } from './volume';

export { VARIANT_COUNT };

/**
 * 這個變體的量體（不含幾何）。
 *
 * `propBands` 與測試都吃這一個 —— 「建築牆面在哪」「輪廓對不對稱」是算術問題，
 * 不必先把八個變體的幾何都建出來。
 */
export function volumesFor(
  zoneType: number, density: Density, level: number, variantIndex: number,
): Volume[] {
  const dims = dimensionsFor(zoneType, density, level, variantIndex);
  if (!dims) return [];

  // 量體與屋頂各用一條亂數流。屋頂**形式**是由 variantIndex 分層決定的，
  // 不吃亂數，所以共用不會鎖死形式 —— 會鎖死的是屋脊朝向：裙樓塔的偏置方向
  // 與山牆的朝向會完全相關。分開是便宜的保險，不是必要條件。
  const bodyRng = variantRng(zoneType, density, level, variantIndex);
  const roofRng = variantRng(zoneType, density, level, variantIndex + VARIANT_COUNT);

  const body = prototypeFor(zoneType, level, variantIndex).compose(dims, bodyRng);
  const top = body.reduce((a, b) => (b.y1 > a.y1 ? b : a), body[0]!);
  const roof = buildRoof(roofFor(zoneType, level, variantIndex), top, dims, roofRng);
  return [...body, ...roof];
}

/**
 * 這個 (分區, 密度, 等級) 的八個量體變體。沒有建築時回傳空陣列。
 *
 * 幾何直接產出**最終尺寸** —— 沒有高度縮放也沒有基地縮放。那正是取消實例縮放的
 * 前提：BUG-219（樹跟著房子長高）與 BUG-226（雨遮貼假想牆）都是縮放的產物。
 */
export function getMassingVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  if (!dimensionsFor(zoneType, density, level, 0)) return [];
  const out: GeoBuilder[] = [];
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    out.push(() => assemble(volumesFor(zoneType, density, level, vi)));
  }
  return out;
}

/** 這個變體的高度（格）。 */
export function heightOf(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return topOf(volumesFor(zoneType, density, level, variantIndex));
}

/** 這個變體的樓高（格）。立面 shader 的窗戶橫列要對齊它。 */
export function floorHeightOf(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return dimensionsFor(zoneType, density, level, variantIndex)?.floorHeight
    ?? (FLOOR_HEIGHT_UNITS.MIN + FLOOR_HEIGHT_UNITS.MAX) / 2;
}
