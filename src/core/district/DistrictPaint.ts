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
 * 一次筆刷動作實際改了什麼。
 *
 * 呼叫端要拿它說話。搶格子是對的（一格只屬於一個分區），錯的是不出聲 —— 玩家拖一塊
 * 蓋到別區上，二十幾格轉手了，畫面上只有顏色悄悄變了。扣除掃到別區則是什麼都不會
 * 發生，那個靜默失敗是這支筆刷最難懂的一件事。
 */
export interface DistrictPaintResult {
  /** 這一區多出來的格數。本來就是它的不算。 */
  added: number;
  /** 這一區被拿掉的格數。 */
  removed: number;
  /**
   * 矩形裡屬於別區的格數，分區 id → 格數。
   *
   * 併入與取代下是「搶過來的」，扣除下是「掃到但沒動的」—— 同一份資料，呼叫端
   * 照模式決定怎麼講。
   */
  fromOthers: Map<string, number>;
}

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
/** 一次滑鼠操作要做的事:撿起一個分區、放掉手上的，或是畫。 */
export type DistrictGesture =
  | { kind: 'select'; districtId: string }
  | { kind: 'deselect' }
  | { kind: 'paint' };

/**
 * 同一支筆刷上，點一下跟拖一塊是兩件事。
 *
 * 少了「點一下＝選取」，玩家要換成編輯另一區只剩一條路:打開條例面板從側邊選 ——
 * 而地圖上明明就看得到那一區。分區的顏色與名稱畫在圖層上，點它是最直覺的動作。
 *
 * 點自己這一區是放掉選取（點起來、改一改、再點一次放掉）—— 但**扣除模式除外**:
 * 拿著橡皮擦點自己的格子，意思沒有歧義就是擦掉那一格，而單格擦除沒有別的手勢做得到。
 * 併入模式下點自己的格子本來就不會有任何改變，取代模式下則是會把整區縮成一格 ——
 * 兩者都不是玩家點下去想要的東西。
 *
 * 拖出範圍永遠是畫，即使起點落在別區或自己身上 —— 拖一大塊卻只換到一次選取切換，
 * 玩家會以為筆刷壞了。
 */
export function resolveDistrictGesture(
  districts: Pick<DistrictManager, 'getDistrictAt'>,
  activeDistrictId: string | null,
  x1: number, y1: number, x2: number, y2: number,
  mode: DistrictPaintMode,
): DistrictGesture {
  if (x1 !== x2 || y1 !== y2) return { kind: 'paint' };
  const under = districts.getDistrictAt(x1, y1);
  if (!under) return { kind: 'paint' };
  if (under.id !== activeDistrictId) return { kind: 'select', districtId: under.id };
  return mode === 'subtract' ? { kind: 'paint' } : { kind: 'deselect' };
}

export function paintDistrictRect(
  districts: DistrictManager,
  districtId: string,
  x1: number, y1: number, x2: number, y2: number,
  mode: DistrictPaintMode,
): DistrictPaintResult {
  const result: DistrictPaintResult = { added: 0, removed: 0, fromOthers: new Map() };
  const district = districts.getDistrict(districtId);
  if (!district) return result;

  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

  // 誰的格子被動到，要在畫下去之前數 —— 畫完就查不出來了。
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const owner = districts.getDistrictAt(x, y);
      if (owner && owner.id !== districtId) {
        result.fromOthers.set(owner.id, (result.fromOthers.get(owner.id) ?? 0) + 1);
      } else if (mode === 'subtract') {
        if (owner) result.removed++;
      } else if (!owner) {
        result.added++;
      }
    }
  }
  // 併入與取代會把別區的格子搶過來，那些也是這一區新增的。扣除不會。
  if (mode !== 'subtract') {
    for (const n of result.fromOthers.values()) result.added += n;
  }

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
  return result;
}
