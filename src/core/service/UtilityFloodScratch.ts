import type { Grid } from '../grid/Grid';
import { parsePosKeyUnsafe } from '../grid/GridHelpers';
import { MAX_ELEVATION_LEVEL } from '../elevation/types';
import { MULTI_CELL_OCCUPIED, isPrimaryCellReserved, findPrimaryCell } from '../building/InfraPlacement';

/** 節點空間有幾層:地面加上高架的 1~3。 */
export const FLOOD_LEVELS = MAX_ELEVATION_LEVEL + 1;

/** `group` 還沒算過。 */
const GROUP_UNKNOWN = -2;
/** 這一格自己結算，不屬於任何多格建築。 */
export const GROUP_NONE = -1;

/**
 * 水電覆蓋 flood 的暫存 —— 走訪狀態與一輪之內跨廠共用的記錄。
 *
 * ## 為什麼要有這個東西
 *
 * 舊版每座廠開一個 `Set<string>` 當 visited、一個字串陣列當佇列，而 200x200 全蓋
 * 滿的城市裡每座廠都會走遍四萬格 —— 一輪三種公用事業、二十四座廠，就是幾十萬個
 * 短命字串與二十四個大 Set。實測那一輪要 4.3 秒，而剩下的成本幾乎全在字串上。
 *
 * 這裡把它們換成跨呼叫重複使用的 typed array:
 *
 * - **走訪**用世代戳記（`visitedGen[node] === gen`），所以換一座廠只要 `gen++`，
 *   不必清一百萬格。
 * - **佇列**是 `Int32Array` 加頭尾索引。
 * - **一輪共用的**三份記錄（基礎設施位置、多格建築歸戶、已付款的 footprint）
 *   以前是 `Set<string>` 與 `Map<string, CellCharge>` 由呼叫端傳進來。
 *
 * ## 節點編碼
 *
 * `node = level * totalCells + idx`，`idx = y * width + x`。地面是第 0 層，高架
 * 是 1~3 —— 跟 `cellKey` 的 `"x,y,level"` 同一套層級編號。
 *
 * ## 不可重入
 *
 * 一個 scratch 同時只能服務一次 flood。三種公用事業各拿一份，而同一份的各座廠
 * 是**依序**跑的（`calculateCoverage` 裡的 for 迴圈），所以夠用。
 */
export class UtilityFloodScratch {
  width = 0;
  height = 0;
  totalCells = 0;

  private visitedGen = new Int32Array(0);
  private gen = 0;
  private queue = new Int32Array(0);
  private head = 0;
  private tail = 0;

  private infraBits = new Uint8Array(0);
  private group = new Int32Array(0);
  private demand = new Float64Array(0);
  private paid = new Uint8Array(0);

  /**
   * 開始新的一輪覆蓋計算。
   *
   * @param infra 基礎設施位置（`"x,y"`）。攤成逐格旗標 —— flood 每個鄰居都要問
   *   一次，留著 `Set<string>` 就等於每個鄰居配一個字串。
   */
  beginPass(grid: Grid, infra?: Set<string>): void {
    const { width, height } = grid;
    const cells = width * height;
    if (this.totalCells !== cells) {
      this.visitedGen = new Int32Array(cells * FLOOD_LEVELS);
      this.queue = new Int32Array(cells * FLOOD_LEVELS);
      this.infraBits = new Uint8Array(cells);
      this.group = new Int32Array(cells);
      this.demand = new Float64Array(cells);
      this.paid = new Uint8Array(cells);
      this.gen = 0;
    } else {
      this.infraBits.fill(0);
      this.paid.fill(0);
    }
    this.width = width;
    this.height = height;
    this.totalCells = cells;
    this.group.fill(GROUP_UNKNOWN);

    if (infra) {
      for (const key of infra) {
        const p = parsePosKeyUnsafe(key);
        if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue;
        this.infraBits[p.y * width + p.x] = 1;
      }
    }
  }

  /** 開始一座廠的 flood:走訪狀態歸零、佇列清空。 */
  beginFlood(): void {
    this.gen++;
    this.head = 0;
    this.tail = 0;
  }

  isInfra(idx: number): boolean {
    return this.infraBits[idx] === 1;
  }

  /** @returns 這個節點本來沒走過。 */
  markVisited(node: number): boolean {
    if (this.visitedGen[node] === this.gen) return false;
    this.visitedGen[node] = this.gen;
    return true;
  }

  hasVisited(node: number): boolean {
    return this.visitedGen[node] === this.gen;
  }

  push(node: number): void {
    this.queue[this.tail++] = node;
  }

  get hasQueued(): boolean {
    return this.head < this.tail;
  }

  shift(): number {
    return this.queue[this.head++]!;
  }

  /**
   * 走到這一格要付多少、算在誰頭上。
   *
   * 兩個答案一起算、一起記 —— 它們本來就是同一件事:多格建築的**整份消耗都掛在
   * 主格上**，附屬格報 0（見 `calculateUtilityCellDemand`），所以問到附屬格時
   * 要付的是主格那一筆。分開記的話「歸戶」與「金額」會變成兩份可以各自過期的
   * 記錄。
   *
   * 記憶化的理由跟舊版的 `chargeCache` 一樣:`findPrimaryCell` 掃一個
   * O(max(w,h)^2) 的方框（大型機場的每個附屬格就是 81 次查詢），而同一輪裡
   * 格子不會變。
   *
   * @returns footprint 主格的索引，`GROUP_NONE` 代表這一格自己結算。
   *   金額用 `demandAt(idx)` 取 —— 不配物件就只能這樣回兩個值。
   */
  chargeOf(grid: Grid, idx: number, x: number, y: number,
           getDemand: (x: number, y: number) => number): number {
    const memo = this.group[idx]!;
    if (memo !== GROUP_UNKNOWN) return memo;

    let group = GROUP_NONE;
    let demandX = x, demandY = y;
    const buildingId = grid.getField(x, y, 'buildingId');
    const reserved = grid.getField(x, y, 'reserved');
    if (buildingId > 0
      && (reserved === MULTI_CELL_OCCUPIED || isPrimaryCellReserved(reserved))) {
      const primary = findPrimaryCell(grid, x, y);
      if (primary) {
        group = primary.y * this.width + primary.x;
        demandX = primary.x;
        demandY = primary.y;
      }
    }
    this.group[idx] = group;
    this.demand[idx] = getDemand(demandX, demandY);
    return group;
  }

  /** `chargeOf` 算出來的金額。 */
  demandAt(idx: number): number {
    return this.demand[idx]!;
  }

  isPaid(group: number): boolean {
    return this.paid[group] === 1;
  }

  markPaid(group: number): void {
    this.paid[group] = 1;
  }
}
