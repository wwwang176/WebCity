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
/** 一次滑鼠操作要做的事:撿起一個分區，或是畫。 */
export type DistrictGesture =
  | { kind: 'select'; districtId: string }
  | { kind: 'paint' };

/**
 * 同一支筆刷上，點一下跟拖一塊是兩件事。
 *
 * 少了「點一下＝選取」，玩家要換成編輯另一區只剩一條路:打開條例面板從側邊選 ——
 * 而地圖上明明就看得到那一區。分區的顏色與名稱畫在圖層上，點它是最直覺的動作。
 *
 * 點在自己這一區身上仍然是畫。單格點擊是「從這一區挖掉一格」唯一的手勢，改成選取
 * 的話扣除模式就再也扣不掉一格。
 *
 * 拖出範圍永遠是畫，即使起點落在別區身上 —— 拖一大塊卻只換到一個選取，玩家會以為
 * 筆刷壞了。
 */
export function resolveDistrictGesture(
  districts: Pick<DistrictManager, 'getDistrictAt'>,
  activeDistrictId: string | null,
  x1: number, y1: number, x2: number, y2: number,
): DistrictGesture {
  if (x1 !== x2 || y1 !== y2) return { kind: 'paint' };
  const under = districts.getDistrictAt(x1, y1);
  if (!under || under.id === activeDistrictId) return { kind: 'paint' };
  return { kind: 'select', districtId: under.id };
}

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
