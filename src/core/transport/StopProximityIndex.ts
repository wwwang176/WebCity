import { toPosKey } from '../grid/GridHelpers';
import { walkRangeFor, WALK_RANGE_BY_TYPE } from './WalkRange';
import type { StopReach } from '../traffic/StopWalkReach';
import type { FlatRoute } from './MultiModalRouter';

/**
 * 從某一格走得到的一個站。
 *
 * 距離是**格數**，不是時間 —— 走多久要看走路速度，而挑站牌的兩條路徑各自有各自的
 * 用法（單一運具把兩端加起來再除，轉乘要逐段算）。存時間的話這裡就得先挑一個
 * 速度，而那個速度在建索引的時候還不一定是最後要用的那個。
 */
export interface NearbyStop {
  /** `routes` 陣列的索引。 */
  routeIdx: number;
  /** 該路線 `stops` 陣列的索引。 */
  stopIdx: number;
  /** 沿人行道走到那一站要幾格。 */
  walkDistance: number;
}

const NONE: readonly NearbyStop[] = [];

/**
 * 每一格走得到哪些站牌 —— 挑站牌那兩條路徑共用的逐格索引。
 *
 * 沒有它的話，每問一位市民就要把**全城每一個站牌**量一次步行距離，只為了挑出最近
 * 的那一站;而多模式那一支連出站那一側都在進站迴圈裡面重量一遍，儘管出站距離跟
 * 進站選哪一站無關。4 萬 2 千人的存檔實測（3 條路線、19 個站牌、一位市民平均走得到
 * 2.77 個站）:逐站掃描每問一位要 5.74µs，查兩次索引是 **0.25µs**。
 *
 * 「走得到」由 `StopReach` 定義，也就是沿人行道量 —— 跟 `TransitAccessField` 是同一
 * 份幾何，兩邊不能各寫一套。
 *
 * 跟 `TransitAccessField` 的差別是**每條路線留幾站**:那一份只留最近的（評分只要
 * 知道「這個人搭不搭得到」），這一份留全部，因為轉乘要在候選站牌之間挑。
 *
 * 索引跟著路線一起重建（`rebuildTransferGraphIfDirty`）。站牌位置與人行道都不會在
 * 兩次重建之間改變。
 */
export class StopProximityIndex {
  private readonly byCell = new Map<string, NearbyStop[]>();

  private constructor() {}

  static build(routes: readonly FlatRoute[], reach: StopReach): StopProximityIndex {
    const index = new StopProximityIndex();

    for (let ri = 0; ri < routes.length; ri++) {
      const route = routes[ri]!;
      // 掃描一律用最寬的半徑，再由這種運具自己的上限截斷 —— 涵蓋範圍的快取以半徑
      // 為鍵，各運具各掃各的會讓同一個站牌算好幾份。
      const limit = walkRangeFor(route.type);
      for (let si = 0; si < route.stops.length; si++) {
        const stop = route.stops[si]!;
        for (const [cellKey, walkDistance] of reach.cellsWithin(stop.x, stop.y, WALK_RANGE_BY_TYPE.WIDEST)) {
          if (walkDistance > limit) continue;
          const list = index.byCell.get(cellKey);
          if (list) list.push({ routeIdx: ri, stopIdx: si, walkDistance });
          else index.byCell.set(cellKey, [{ routeIdx: ri, stopIdx: si, walkDistance }]);
        }
      }
    }
    return index;
  }

  /** 這一格走得到的站。沒有就是空陣列。 */
  at(x: number, y: number): readonly NearbyStop[] {
    return this.byCell.get(toPosKey(x, y)) ?? NONE;
  }

  /** 記了幾格（測試與除錯用）。 */
  get size(): number {
    return this.byCell.size;
  }
}
