import type { SidewalkGraph } from './SidewalkGraph';

/**
 * 從一個站牌走得到哪些格子，各要走多遠。
 *
 * 這是「大眾運輸涵蓋範圍」的定義來源。它沿著人行道量，而不是在地圖上畫一個菱形
 * —— 差別在馬路：行人只在路口過馬路，所以對街那一格在步行上其實很遠。用直線距離
 * 量的話它只有兩格，模擬會把住戶配給對街的站牌，行人到了現場才發現得繞到路口，
 * 於是畫面上出現一個繞大圈的人。繞路不是走錯，是被派錯。
 *
 * 附帶的效果是隔著河、隔著整排建築的格子也一併不算了 —— 直線距離同樣看不見那些。
 */
export interface StopReach {
  /** 從 (x, y) 這個站牌走 `maxDist` 之內到得了的格子 → 步行距離。 */
  cellsWithin(x: number, y: number, maxDist: number): ReadonlyMap<string, number>;
}

/**
 * 從站牌走到某一格要幾格。走不到、或超過 `maxDist`，回 `Infinity`。
 *
 * 挑站牌的地方都該用這一支，而不是各自算距離 —— 「走得到」只能有一個定義，
 * 否則評分認為他搭不到、派車卻把他派過去，兩邊會靜靜地不一致。
 */
export function walkDistanceToStop(
  reach: StopReach,
  stopX: number, stopY: number,
  x: number, y: number,
  maxDist: number,
): number {
  return reach.cellsWithin(stopX, stopY, maxDist).get(`${x},${y}`) ?? Infinity;
}

const EMPTY: ReadonlyMap<string, number> = new Map();

/**
 * 人行道圖上的有界 Dijkstra，每站一份、算過就留著。
 *
 * 快取是必要的而不是優化：重算的觸發條件（`isTransferGraphDirty`）對「玩家調整
 * 路線班次」也成立，而那跟人行道一點關係都沒有。沒有快取的話按一次 +/− 就要把
 * 全城站牌重走一遍。
 */
export class SidewalkStopReach implements StopReach {
  private readonly cache = new Map<string, ReadonlyMap<string, number>>();
  private syncedVersion: number;

  constructor(private readonly graph: SidewalkGraph) {
    this.syncedVersion = graph.version;
  }

  cellsWithin(x: number, y: number, maxDist: number): ReadonlyMap<string, number> {
    this.dropEverythingIfGraphMoved();
    const key = `${x},${y}|${maxDist}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const computed = this.walkOutwards(x, y, maxDist);
    this.cache.set(key, computed);
    return computed;
  }

  /**
   * 丟掉可能被這幾格影響到的站牌。
   *
   * 只有離改動夠近的站牌需要重算：一條路徑的長度不會短於它兩端的直線距離，所以
   * 直線距離超過 `radius` 的格子，步行距離一定也超過，不可能落在涵蓋範圍裡。
   *
   * 呼叫這個就等於宣告「圖的變動我已經處理過了」，所以順手把世代對齊 —— 不對齊
   * 的話下一次查詢會被安全網當成全圖換過而整批丟掉，精準失效就白做了。
   */
  invalidateNear(changedCells: Iterable<string>, radius: number): void {
    this.syncedVersion = this.graph.version;
    if (this.cache.size === 0) return;

    const changed: Array<[number, number]> = [];
    for (const key of changedCells) {
      const comma = key.indexOf(',');
      if (comma < 0) continue;
      changed.push([Number(key.slice(0, comma)), Number(key.slice(comma + 1))]);
    }
    if (changed.length === 0) return;

    const r2 = radius * radius;
    for (const cacheKey of [...this.cache.keys()]) {
      const bar = cacheKey.indexOf('|');
      const comma = cacheKey.indexOf(',');
      const sx = Number(cacheKey.slice(0, comma));
      const sy = Number(cacheKey.slice(comma + 1, bar));
      for (const [cx, cy] of changed) {
        const dx = cx - sx, dy = cy - sy;
        if (dx * dx + dy * dy <= r2) { this.cache.delete(cacheKey); break; }
      }
    }
  }

  /** 記了幾個站牌（測試與除錯用）。 */
  get size(): number { return this.cache.size; }

  private dropEverythingIfGraphMoved(): void {
    if (this.graph.version === this.syncedVersion) return;
    this.cache.clear();
    this.syncedVersion = this.graph.version;
  }

  private walkOutwards(x: number, y: number, maxDist: number): ReadonlyMap<string, number> {
    const cellKey = `${x},${y}`;
    const seeds = this.graph.getNodesInCell(cellKey);
    // 站牌在圖裡沒有節點 = 它沒有接上任何人行道，服務不到任何人。
    // 刻意不退回「找最近的節點」：那會讓「站牌沒進圖」這種錯誤靜靜地被蓋掉，
    // 而它正是這一輪要修的問題之一。
    if (seeds.length === 0) return EMPTY;

    const dist = new Map<string, number>();
    const heapId: string[] = [];
    const heapD: number[] = [];

    const push = (id: string, d: number): void => {
      heapId.push(id); heapD.push(d);
      let i = heapId.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapD[p]! <= heapD[i]!) break;
        [heapId[p], heapId[i]] = [heapId[i]!, heapId[p]!];
        [heapD[p], heapD[i]] = [heapD[i]!, heapD[p]!];
        i = p;
      }
    };

    const pop = (): [string, number] => {
      const topId = heapId[0]!, topD = heapD[0]!;
      const lastId = heapId.pop()!, lastD = heapD.pop()!;
      if (heapId.length > 0) {
        heapId[0] = lastId; heapD[0] = lastD;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heapD.length && heapD[l]! < heapD[m]!) m = l;
          if (r < heapD.length && heapD[r]! < heapD[m]!) m = r;
          if (m === i) break;
          [heapId[m], heapId[i]] = [heapId[i]!, heapId[m]!];
          [heapD[m], heapD[i]] = [heapD[i]!, heapD[m]!];
          i = m;
        }
      }
      return [topId, topD];
    };

    for (const node of seeds) { dist.set(node.id, 0); push(node.id, 0); }

    const cells = new Map<string, number>();
    while (heapId.length > 0) {
      const [id, d] = pop();
      if (d > (dist.get(id) ?? Infinity)) continue;

      const node = this.graph.getNode(id);
      if (node) {
        const known = cells.get(node.cellKey);
        if (known === undefined || d < known) cells.set(node.cellKey, d);
      }

      for (const edge of this.graph.getEdgesFrom(id)) {
        const next = d + edge.length;
        if (next > maxDist) continue;
        if (next < (dist.get(edge.to.id) ?? Infinity)) {
          dist.set(edge.to.id, next);
          push(edge.to.id, next);
        }
      }
    }
    return cells;
  }
}
