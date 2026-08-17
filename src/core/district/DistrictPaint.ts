import type { DistrictManager } from './DistrictManager';
import { parsePosKeyUnsafe } from '../grid/GridHelpers';

/**
 * 分區筆刷的三種模式。
 *
 * 有「取代」是因為分區邊界常常要重畫 —— 少了它，玩家得先把整區擦乾淨才能重畫，
 * 而擦除本身也要一格一格拖。
 */
export type DistrictPaintMode = 'replace' | 'add' | 'subtract';

/**
 * 把一個矩形套用到某個分區上。
 *
 * 兩個角哪個先畫都可以，這裡自己正規化 —— 呼叫端記得排序是遲早會漏的一件事。
 *
 * 「取代」與「扣除」都只動這一個分區:取代不會清掉別區在矩形外的格子，扣除也不會
 * 挖掉別區在矩形內的格子。你正在編輯的是這一區，掃到別區的話玩家會在完全沒有
 * 意識的情況下拆掉另一區的邊界。
 *
 * 矩形內原本屬於別區的格子則會被搶過來 —— 那不是這裡決定的，`addCellToDistrict`
 * 本來就維持「一格只屬於一個分區」，而那正是重疊處該有的行為:一格屬於兩個分區的
 * 話，收入乘數與費用都會算兩次。
 */
export function paintDistrictRect(
  districts: DistrictManager,
  districtId: string,
  x1: number, y1: number, x2: number, y2: number,
  mode: DistrictPaintMode,
): void {
  const district = districts.getDistrict(districtId);
  if (!district) return;

  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

  if (mode === 'replace') {
    // 先清空這一區。逐格走 `removeCellFromDistrict` 而不是直接清 Set —— 反向索引
    // （格子 → 分區）也要一起維護，少了它 `getDistrictAt` 會指向一個已經不含這格
    // 的分區。
    for (const key of [...district.cells]) {
      const { x, y } = parsePosKeyUnsafe(key);
      districts.removeCellFromDistrict(districtId, x, y);
    }
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (mode === 'subtract') districts.removeCellFromDistrict(districtId, x, y);
      else districts.addCellToDistrict(districtId, x, y);
    }
  }
}
