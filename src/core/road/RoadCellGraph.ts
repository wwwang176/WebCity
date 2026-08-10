/**
 * 路網的格子層圖 —— workplace 距離的同步與非同步兩條路共用的資料結構。
 *
 * 節點是道路格（含高架），邊是 `UnifiedRoadLookup` 判定的合法鄰接。
 *
 * **樓層與匝道規則在建圖時就被消化掉了** —— 拿到這張圖的人（尤其是 worker）
 * 看不到樓層，也不需要重新解讀規則。那是它存在的理由：規則只有一份
 * （BUG-109 的成因正是 worker 有一份看不到高架的平面緩衝）。
 */

import { parsePosKeyUnsafe, parseLevelFromKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
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
