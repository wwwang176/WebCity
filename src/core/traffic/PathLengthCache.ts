import type { LaneEdge } from './LaneGraph';

/**
 * 「這台車沿著它的路徑總共走了多遠」。
 *
 * 車輛每幀要由前往後處理（後車讀的是前車剛算好的狀態），而排序的鍵就是這個距離。
 * 原本每台車每幀都從路徑開頭重加一次前面所有邊的長度 —— 路徑長達數十條邊時，
 * 12 288 人的存檔實測每幀為了排序掃過 14 438 條邊。
 *
 * 前綴和只跟**路徑**有關，跟哪台車無關。而通勤路線是共用的:`CommuteCache` 的
 * 路線池把同一個陣列交給每個走這條路的人，所以走同一條路的幾百台車共用同一份。
 *
 * 用 `WeakMap` 以路徑陣列本身當 key:路線被淘汰時這份跟著被回收，不必有人記得清。
 * 前提是路徑陣列建好之後不會被就地修改 —— 目前所有產生路徑的地方都是產生新陣列。
 */
export class PathLengthCache {
  private readonly prefixes = new WeakMap<readonly LaneEdge[], Float64Array>();

  /**
   * 走到 `edgePath[edgeIndex]` 的 `edgeProgress` 處，總共走了多遠。
   *
   * `edgeIndex` 超出路徑範圍時，前綴取整條路徑的長度，`edgeProgress` **照樣加上去**
   * —— 車開到盡頭時它會停在 `edgeIndex = length - 1`、`edgeProgress = 最後一段的長度`，
   * 那一筆本來就該算成走完全程。這與原本逐次累加的寫法同義（那個迴圈的上界也是
   * `min(edgeIndex, length)`），不是新的行為。
   */
  totalProgress(edgePath: readonly LaneEdge[], edgeIndex: number, edgeProgress: number): number {
    if (edgePath.length === 0) return edgeProgress;
    let prefix = this.prefixes.get(edgePath);
    if (!prefix) {
      prefix = new Float64Array(edgePath.length + 1);
      for (let i = 0; i < edgePath.length; i++) {
        prefix[i + 1] = prefix[i]! + edgePath[i]!.length;
      }
      this.prefixes.set(edgePath, prefix);
    }
    const i = edgeIndex < 0 ? 0 : Math.min(edgeIndex, edgePath.length);
    return prefix[i]! + edgeProgress;
  }
}
