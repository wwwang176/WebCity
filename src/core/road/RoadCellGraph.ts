/**
 * 路網的格子層圖 —— workplace 距離的同步與非同步兩條路共用的資料結構。
 *
 * 節點是道路格（含高架），邊是 `UnifiedRoadLookup` 判定的合法鄰接。
 *
 * **樓層與匝道規則在建圖時就被消化掉了** —— 拿到這張圖的人（尤其是 worker）
 * 看不到樓層，也不需要重新解讀規則。那是它存在的理由：規則只有一份
 * （BUG-109 的成因正是 worker 有一份看不到高架的平面緩衝）。
 */

import { parsePosKeyUnsafe, parseLevelFromKey, toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { roadTileCost } from './roadCost';
import type { UnifiedRoadLookup } from './UnifiedRoadLookup';

/**
 * CSR（壓縮稀疏列）表示的路網圖。節點 i 的鄰接是
 * `targets[offsets[i] .. offsets[i+1])`。
 *
 * **權重是整數**（`Uint16Array`，9 ~ 60，見 `roadCost.ts`）。整數加法可交換，
 * 所以正向與反向 flood 對同一條路必然算出位元相同的總和。浮點做不到 ——
 * 那不是精度問題，是順序問題。
 */
export interface RoadCellGraph {
  readonly nodeKeys: readonly string[];
  readonly indexOf: ReadonlyMap<string, number>;
  /** 長度 n+1。 */
  readonly offsets: Uint32Array;
  readonly targets: Uint32Array;
  /** 走進 targets[j] 那一格要付的成本。整數。 */
  readonly weights: Uint16Array;
  readonly nodeX: Uint16Array;
  readonly nodeY: Uint16Array;
  /** 0 = 地面，1–3 = 高架。 */
  readonly nodeLevel: Uint8Array;
}

/** 從 key 取樓層。地面的 key 沒有第三段，回傳 0。 */
export function levelOfKey(key: string): number {
  return parseLevelFromKey(key);
}

/**
 * 從 lookup 建圖。O(路格數 × 4)。
 *
 * **不要每次查詢都呼叫它。** `roadDistanceToTargets` 是每個市民呼叫一次的，
 * 在裡面建圖等於把 O(路格數) 乘上市民數。圖只在路網改變時才變，所以由
 * `SimulationLoop` 以 `commuteCache.roadGeneration` 為鍵持有。
 */
export function buildRoadCellGraph(lookup: UnifiedRoadLookup): RoadCellGraph {
  const nodeKeys = lookup.getAllCellKeys();
  const n = nodeKeys.length;
  const indexOf = new Map<string, number>();
  for (let i = 0; i < n; i++) indexOf.set(nodeKeys[i]!, i);

  const nodeX = new Uint16Array(n);
  const nodeY = new Uint16Array(n);
  const nodeLevel = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const key = nodeKeys[i]!;
    const { x, y } = parsePosKeyUnsafe(key);
    if (x > 0xffff || y > 0xffff) throw new RangeError(`格子座標超過 Uint16 上限: ${key}`);
    nodeX[i] = x; nodeY[i] = y; nodeLevel[i] = levelOfKey(key);
  }

  const offsets = new Uint32Array(n + 1);
  const targetList: number[] = [];
  const weightList: number[] = [];

  for (let i = 0; i < n; i++) {
    offsets[i] = targetList.length;
    const key = nodeKeys[i]!;
    const x = nodeX[i]!, y = nodeY[i]!;
    for (const [dx, dy] of FOUR_NEIGHBORS) {
      const nx = x + dx!, ny = y + dy!;
      for (const nk of lookup.getCompatibleNeighborKeys(key, nx, ny)) {
        const j = indexOf.get(nk);
        if (j === undefined) continue;
        const info = lookup.getCellByKey(nk);
        if (!info) continue;
        const w = roadTileCost(info.roadType);
        if (!Number.isFinite(w)) continue;
        if (w > 0xffff) throw new RangeError(`道路成本超過 Uint16 上限: ${nk} = ${w}`);
        targetList.push(j);
        weightList.push(w);
      }
    }
  }
  offsets[n] = targetList.length;

  return {
    nodeKeys, indexOf, offsets,
    targets: Uint32Array.from(targetList),
    weights: Uint16Array.from(weightList),
    nodeX, nodeY, nodeLevel,
  };
}

// ── flood 核心 ──────────────────────────────────────────────────────

/** 二元堆。節點是整數索引，成本是整數。 */
class NodeHeap {
  private idx: number[] = [];
  private cost: number[] = [];
  get size(): number { return this.idx.length; }

  push(i: number, c: number): void {
    this.idx.push(i); this.cost.push(c);
    let k = this.idx.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.cost[k]! >= this.cost[p]!) break;
      this.swap(k, p); k = p;
    }
  }

  pop(): { node: number; cost: number } | undefined {
    if (this.idx.length === 0) return undefined;
    const top = { node: this.idx[0]!, cost: this.cost[0]! };
    const li = this.idx.pop()!, lc = this.cost.pop()!;
    if (this.idx.length > 0) {
      this.idx[0] = li; this.cost[0] = lc;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < this.idx.length && this.cost[l]! < this.cost[m]!) m = l;
        if (r < this.idx.length && this.cost[r]! < this.cost[m]!) m = r;
        if (m === k) break;
        this.swap(k, m); k = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.idx[a], this.idx[b]] = [this.idx[b]!, this.idx[a]!];
    [this.cost[a], this.cost[b]] = [this.cost[b]!, this.cost[a]!];
  }
}

/**
 * 從 `seedNodes` 出發的加權 flood。回傳每個節點的成本，未到達為 -1。
 *
 * 四個不變式 —— 同步查詢與 worker 都靠它們：
 *
 * 1. **成本加在目的地那一格**（`weights[j]` 是走進 `targets[j]` 的價格）。
 * 2. **`onSettle` 在 pop 時呼叫，不是 relax 時。** pop 順序就是成本遞增順序，
 *    所以第一次 settle 一定是最便宜的那條路。在 relax 時記錄會讓「先碰到的」
 *    永久獲勝 —— 門口一條鄉道贏過兩格外的高速公路（BUG-102）。
 * 3. **超過 `maxBudget` 的鄰居不入堆。**
 * 4. **成本全程整數。** `cost` 是 `Int32Array`，權重是 `Uint16Array`，兩者都
 *    精確；stale 判斷不可能因捨入而誤判。這也是「worker 與同步逐格相等」能
 *    成立的唯一理由 —— 浮點加法沒有結合律，反向走同一組邊會算出不同的位元。
 *
 * `onSettle` 回傳 true 表示提早結束（同步查詢找齊目標之後就不必再走）。
 *
 * 這是**通用**的加權圖 Dijkstra，不假設權重來自路網。路網圖恰好讓每個節點的
 * 入邊權重一致（成本加在目的地），於是「重新 relax 成更便宜的值」與「過期
 * 堆項」兩條分支走不到 —— 但契約對任何圖都成立，測試用一張合成圖守著它們。
 */
export function floodRoadCellGraph(
  graph: RoadCellGraph,
  seedNodes: readonly number[],
  maxBudget: number,
  onSettle?: (node: number, cost: number) => boolean,
): Int32Array {
  const n = graph.nodeKeys.length;
  const cost = new Int32Array(n).fill(-1);
  const heap = new NodeHeap();

  for (const s of seedNodes) {
    if (s < 0 || s >= n || cost[s]! >= 0) continue;
    cost[s] = 0;
    heap.push(s, 0);
  }

  while (heap.size > 0) {
    const cur = heap.pop()!;
    if (cost[cur.node]! < cur.cost) continue; // 過期的堆項
    if (onSettle && onSettle(cur.node, cur.cost)) return cost;

    for (let j = graph.offsets[cur.node]!; j < graph.offsets[cur.node + 1]!; j++) {
      const next = graph.targets[j]!;
      const nc = cur.cost + graph.weights[j]!;
      if (nc > maxBudget) continue;
      const prev = cost[next]!;
      if (prev < 0 || nc < prev) {
        cost[next] = nc;
        heap.push(next, nc);
      }
    }
  }
  return cost;
}

// ── 種子與附掛 ──────────────────────────────────────────────────────

/**
 * 建築格附近的道路節點（所有樓層）。
 *
 * 家與工作都不是道路格，它們要「附掛」到 Chebyshev(reach) 內的路上 ——
 * 與 zone/civic 的內圈模型一致（`ZONE_ROAD_REACH`）。
 */
export function seedNodesFor(
  graph: RoadCellGraph, x: number, y: number, reach: number,
): number[] {
  const out: number[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0) continue;
      // 同一個 (x, y) 可能有多層，全部都要 —— 高架也是路。
      for (let lv = 0; lv <= 3; lv++) {
        const key = lv === 0 ? toPosKey(nx, ny) : `${nx},${ny},${lv}`;
        const i = graph.indexOf.get(key);
        if (i !== undefined) out.push(i);
      }
    }
  }
  return out;
}

/**
 * 一個節點 settle 時，附掛它周圍 Chebyshev(reach) 內、`accept` 接受的格子。
 *
 * **在 settle 當下呼叫，不是先收集整串再處理。** 這樣同步查詢才能在找齊目標
 * 時提早結束（舊實作有這個早退）；先收集再附掛等於永遠跑滿預算。
 *
 * 只記第一次 —— settle 順序即成本遞增順序，所以第一次就是最便宜的那條路
 * （BUG-102 的語意）。`dx`/`dy` 包含 `(0, 0)`，所以道路格自身也會被檢查。
 *
 * 注意這代表**一個路格拿到的不一定是它自己的成本** —— 它 reach 內若有更便宜
 * 的路格，就記那個。這是「附掛到最近的路」的正確語意，不是 bug。
 */
export function attachAtSettledNode(
  graph: RoadCellGraph,
  node: number,
  cost: number,
  reach: number,
  accept: (x: number, y: number) => boolean,
  out: Map<string, number>,
): void {
  const cx = graph.nodeX[node]!, cy = graph.nodeY[node]!;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0) continue;
      const key = toPosKey(nx, ny);
      if (out.has(key)) continue;
      if (!accept(nx, ny)) continue;
      out.set(key, cost);
    }
  }
}

// ── 轉置 ────────────────────────────────────────────────────────────

/**
 * 轉置：每條邊 `(i → j, w)` 變成 `(j → i, w)`。節點不變。
 *
 * **權重跟著邊走，不跟著端點走** —— 這是它存在的全部理由。成本加在目的地
 * 那一格，所以正向邊 A→B 的價格是 cost(B)；在轉置圖上從 B 往外跑 Dijkstra，
 * 得到的正是每個 A 沿正向走到 B 的成本。
 *
 * 直接在正向圖上從 B 反向擴散會付成 cost(A) —— 那是現行
 * `reverseFloodFromWorkplace` 的做法，也是 BUG-237。
 */
export function transposeRoadCellGraph(graph: RoadCellGraph): RoadCellGraph {
  const n = graph.nodeKeys.length;
  const e = graph.targets.length;

  // 先數每個節點的入度
  const counts = new Uint32Array(n);
  for (let j = 0; j < e; j++) counts[graph.targets[j]!]!++;

  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i]! + counts[i]!;

  const cursor = Uint32Array.from(offsets.subarray(0, n));
  const targets = new Uint32Array(e);
  const weights = new Uint16Array(e);

  for (let i = 0; i < n; i++) {
    for (let j = graph.offsets[i]!; j < graph.offsets[i + 1]!; j++) {
      const dst = graph.targets[j]!;
      const at = cursor[dst]!++;
      targets[at] = i;
      weights[at] = graph.weights[j]!;
    }
  }

  return {
    nodeKeys: graph.nodeKeys, indexOf: graph.indexOf,
    offsets, targets, weights,
    nodeX: graph.nodeX, nodeY: graph.nodeY, nodeLevel: graph.nodeLevel,
  };
}
