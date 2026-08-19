import type { CommuteCache } from './CommuteCache';
import type { PathCellCache } from './PathCellCache';

/**
 * 把壅塞流量圖的重算攤到好幾個 tick 上。
 *
 * 流量圖每 60 tick 才換一次，卻是一次算完的。玩家存檔實測（人口 12 351）:快取
 * 「路徑經過哪些格子」之後仍然要 60ms 落在單一個 tick 上，而速度 1 的一個 tick 只有
 * 250ms，算繪還跟它搶同一個執行緒（BUG-327）。
 *
 * 結果既然本來就落後 60 個 tick，攤開來算不會讓它更舊 —— 但**不能讓別人讀到做到
 * 一半的表**。半張表說的是「只有這幾條路上有人，其他都是空的」，那比上一輪的舊資料
 * 還糟。所以累加做在自己的一張紙上，掃完才整張交出去。
 *
 * 名單在開掃時拍下來。掃到一半路線被增刪都不影響手上這份 —— 消失的那些
 * `forRouteKey` 會跳過，新來的等下一輪。路網整個改掉（`roadGeneration` 跳號，
 * `routeIndex` 被清空）時這一輪直接作廢:半舊半新拼出來的表是假的，寧可讓上一輪的
 * 舊表多留 60 個 tick。
 */
export class CongestionFlowSweep {
  private keys: string[] = [];
  private cursor = 0;
  private active = false;
  private generation = -1;
  private acc = new Map<string, number>();
  private refTotal = 0;

  /** 這一輪還在掃。 */
  get inProgress(): boolean { return this.active; }

  /** 這一輪總共要掃幾條路線。呼叫端用它決定一個 tick 掃多少。 */
  get size(): number { return this.keys.length; }

  /** 開始新的一輪。上一輪沒掃完的話直接丟掉。 */
  begin(cache: CommuteCache): void {
    cache.routeKeysWithRiders(this.keys);
    this.cursor = 0;
    this.active = true;
    this.generation = cache.roadGeneration;
    this.acc = new Map();
    this.refTotal = 0;
  }

  /**
   * 掃下一批。這一輪還沒掃完（或根本沒在掃）回 `null`。
   *
   * @param keysPerTick 這個 tick 最多處理幾條路線
   * @param getLaneCount 車道數只在交件時除一次 —— 每批各除一次的話，一條路線分兩批
   *   掃到的格子會被除兩次
   */
  step(
    cache: CommuteCache,
    cellCache: PathCellCache,
    keysPerTick: number,
    getLaneCount: (cellKey: string) => number,
  ): { flowMap: Map<string, number>; totalRefCount: number } | null {
    if (!this.active) return null;
    if (cache.roadGeneration !== this.generation) {
      this.abandon();
      return null;
    }

    const end = Math.min(this.keys.length, this.cursor + Math.max(1, keysPerTick));
    for (; this.cursor < end; this.cursor++) {
      cache.forRouteKey(this.keys[this.cursor]!, (path, refCount) => {
        this.refTotal += refCount;
        const cells = cellCache.cellsOf(path);
        for (let i = 0; i < cells.length; i++) {
          const cellKey = cells[i]!;
          this.acc.set(cellKey, (this.acc.get(cellKey) ?? 0) + refCount);
        }
      });
    }
    if (this.cursor < this.keys.length) return null;

    const flowMap = this.acc;
    const totalRefCount = this.refTotal;
    this.abandon();

    for (const [cellKey, rawFlow] of flowMap) {
      const lanes = getLaneCount(cellKey);
      if (lanes > 1) flowMap.set(cellKey, rawFlow / lanes);
    }
    return { flowMap, totalRefCount };
  }

  private abandon(): void {
    this.active = false;
    this.keys.length = 0;
    this.cursor = 0;
    this.acc = new Map();
    this.refTotal = 0;
  }
}
