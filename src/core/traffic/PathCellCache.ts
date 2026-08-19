import type { LaneEdge } from './LaneGraph';
import { collectEdgeCells } from './CommuteCacheHelpers';

/**
 * 「這條路徑經過哪些格子」。
 *
 * 壅塞流量圖每 60 tick 重算一次，做法是把所有快取路線攤開，逐格累加人數。玩家存檔
 * 實測（人口 12 351）:一次重算走過 4 505 318 條邊，而產出的流量圖只有 314 個鍵 ——
 * 整座城市只有 284 格路。292ms 全部落在單一個 tick 上（BUG-327）。
 *
 * 這個答案只跟**路徑**有關:路不會自己動，今天塞不塞也不影響它經過哪些格子。而通勤
 * 路線是共用的（`CommuteCache` 的路線池把同一個陣列交給每個走這條路的人），所以走
 * 同一條路的幾千個人共用同一份。實測 217 → 57ms，逐格數值完全相同。
 *
 * 與 `PathLengthCache` 同一個模式:用 `WeakMap` 以路徑陣列本身當 key，路線被淘汰時
 * 這份跟著被回收，不必有人記得清。前提是路徑陣列建好之後不會被就地修改 —— 目前所有
 * 產生路徑的地方都是產生新陣列。
 */
export class PathCellCache {
  private readonly cells = new WeakMap<readonly LaneEdge[], readonly string[]>();
  private derived = 0;

  /**
   * 到目前為止真的走過幾條路徑。
   *
   * `WeakMap` 沒有 size，而「快取有沒有被共用」是這個類別存在的唯一理由 ——
   * 每次重新 new 一個的話輸出完全一樣，沒有任何看結果的斷言會紅。這個數字讓
   * 那件事測得到。
   */
  get derivations(): number { return this.derived; }

  /** 這條路徑經過的相異格子。回傳的陣列是共用的，呼叫端不可以改它。 */
  cellsOf(path: readonly LaneEdge[]): readonly string[] {
    let cached = this.cells.get(path);
    if (cached === undefined) {
      cached = Array.from(collectEdgeCells(path));
      this.cells.set(path, cached);
      this.derived++;
    }
    return cached;
  }
}
