# Workplace 距離改走路網圖 —— 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一張格子層的路網圖,讓 workplace 距離的同步與非同步兩條路共用同一個
flood 核心,消除「有高架就停用快取」的限制（BUG-109 治本）。

**Architecture:** `UnifiedRoadLookup` 是樓層與匝道規則的唯一來源。建圖時把規則
消化成「節點 + 邊」,worker 拿到的圖裡不再有樓層概念。同步 fallback 與 worker
呼叫同一個 `floodRoadCellGraph`,一致性由建構保證而非測試盯。

**Tech Stack:** TypeScript、Vitest、Web Worker、CSR（壓縮稀疏列）typed array。

**Spec:** `docs/superpowers/specs/2026-08-10-workplace-distance-graph-design.md`

## Global Constraints

- `src/core/` **禁止 import Three.js**。本計畫所有新檔案都在 `src/core/` 底下。
- **TDD 強制**:先寫紅燈測試 → 跑到紅 → 實作 → 跑到綠 → **還原修正確認轉紅**。
- 成本模型不變:`roadTileCost = 100 / (speedLimit × lanes/2)`，從
  `src/core/service/RoadCoverageFlood.ts` 匯出（已經是 `export function`）。
- `ZONE_ROAD_REACH = 2`，從 `src/core/grid/constants.ts` 匯入。
- 格子 key 格式:地面 `"x,y"`，高架 `"x,y,level"`（level 1–3）。
- 發現 Bug 必須寫入 `BUGS.md` 與 `TODO.md`。
- 每個 Task 結束時工作區必須乾淨、`npx tsc --noEmit` 0 錯、全測試綠。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/core/road/RoadCellGraph.ts`（新） | 圖的型別、`buildRoadCellGraph`、`floodRoadCellGraph`、`attachBuildingCells`、`seedNodesFor`。純算術，不碰 DOM/Worker |
| `src/core/road/RoadCellGraphBuffer.ts`（新） | 圖 ↔ ArrayBuffer 的序列化。只有格式，沒有演算法 |
| `src/core/service/RoadCoverageFlood.ts`（改） | `roadDistanceToTargets` 改用核心；舊實作暫時保留為 `roadDistanceToTargetsLegacy` |
| `src/workers/workplace-distance.worker.ts`（改） | 刪掉自己的 MinHeap 與 flood，改用核心 |
| `src/core/workplace/WorkplaceDistanceTypes.ts`（改） | 請求加上圖的緩衝 |
| `src/core/workplace/WorkplaceDistanceClient.ts`（改） | `compute()` 多收一個 graphBuffer |
| `src/core/simulation/SimulationLoop.ts`（改） | 刪掉兩處 `hasAnyElevatedRoad()` 閘門；建圖並傳入 |

拆成兩個新檔的理由:`RoadCellGraph` 是**演算法**，`RoadCellGraphBuffer` 是**格式**。
兩者的變動原因完全不同 —— 改權重公式不該碰序列化，改位元組佈局不該碰 Dijkstra。

---

## Task 1: RoadCellGraph 建圖

**Files:**
- Create: `src/core/road/RoadCellGraph.ts`
- Test: `src/core/road/__tests__/RoadCellGraph.test.ts`

**Interfaces:**
- Consumes: `UnifiedRoadLookup`（`src/core/road/UnifiedRoadLookup.ts`）的
  `getAllCellKeys(): string[]`、`getCompatibleNeighborKeys(sourceKey: string, nx: number, ny: number): string[]`、
  `getCellByKey(key: string): { roadType: number; roadFlags: number } | null`；
  `roadTileCost(roadType: number): number`（`src/core/service/RoadCoverageFlood.ts`）
- Produces: `RoadCellGraph` 介面與 `buildRoadCellGraph(lookup): RoadCellGraph`

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraph.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildRoadCellGraph } from '../RoadCellGraph';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { RoadType, RoadDirection } from '../types';
import { roadTileCost } from '../../service/RoadCoverageFlood';

/**
 * 圖是規則的「已消化」形式：樓層與匝道在建圖時就被 UnifiedRoadLookup 判完，
 * 之後 worker 只看得到節點與邊。所以建圖漏一格 = 那一格靜默地變成不可達，
 * 而畫面上只會是「某些市民找不到工作」。
 */

/** 一條東西向的路，y = 1，x 從 0 到 w-1。 */
function groundRoadGrid(w: number, h: number) {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < w; x++) {
    cells.set(`${x},1`, { roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST });
  }
  return {
    width: w,
    height: h,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (cell: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(this.getCell(x, y)!, x, y);
    },
    setRoad(x: number, y: number, roadType: number) {
      cells.set(`${x},${y}`, { roadType, roadFlags: RoadDirection.EAST | RoadDirection.WEST });
    },
  };
}

describe('buildRoadCellGraph', () => {
  it('should contain exactly the cells the lookup reports', () => {
    const grid = groundRoadGrid(6, 3);
    const lookup = new UnifiedRoadLookup(grid, new ElevationManager());
    const graph = buildRoadCellGraph(lookup);

    expect([...graph.nodeKeys].sort()).toEqual(lookup.getAllCellKeys().sort());
  });

  it('should charge the cost of the destination tile, not the source', () => {
    // 成本加在「走進去的那一格」。反過來寫的話，從高速公路走進鄉道會被算成
    // 高速公路的價格 —— 兩者差 6.7 倍。
    const grid = groundRoadGrid(4, 3);
    grid.setRoad(2, 1, RoadType.RURAL);
    const lookup = new UnifiedRoadLookup(grid, new ElevationManager());
    const graph = buildRoadCellGraph(lookup);

    const from = graph.indexOf.get('1,1')!;
    const to = graph.indexOf.get('2,1')!;
    let weight = -1;
    for (let j = graph.offsets[from]!; j < graph.offsets[from + 1]!; j++) {
      if (graph.targets[j] === to) weight = graph.weights[j]!;
    }
    expect(weight).toBeCloseTo(roadTileCost(RoadType.RURAL), 9);
  });

  it('should not connect levels without a ramp', () => {
    // 沒有匝道就不能上下層。少了這一條，市民會直接「飛」上高架。
    const grid = groundRoadGrid(4, 3);
    const em = new ElevationManager();
    em.set(2, 1, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
      railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0,
    });
    const lookup = new UnifiedRoadLookup(grid, em);
    const graph = buildRoadCellGraph(lookup);

    const ground = graph.indexOf.get('2,1')!;
    const elevated = graph.indexOf.get('2,1,1')!;
    const neighbours: number[] = [];
    for (let j = graph.offsets[ground]!; j < graph.offsets[ground + 1]!; j++) {
      neighbours.push(graph.targets[j]!);
    }
    expect(neighbours, '沒有匝道卻連上了高架').not.toContain(elevated);
  });

  it('should keep the graph and the key index in sync', () => {
    const grid = groundRoadGrid(5, 3);
    const lookup = new UnifiedRoadLookup(grid, new ElevationManager());
    const graph = buildRoadCellGraph(lookup);

    expect(graph.indexOf.size).toBe(graph.nodeKeys.length);
    for (let i = 0; i < graph.nodeKeys.length; i++) {
      expect(graph.indexOf.get(graph.nodeKeys[i]!)).toBe(i);
    }
    expect(graph.offsets.length).toBe(graph.nodeKeys.length + 1);
    expect(graph.offsets[graph.nodeKeys.length]).toBe(graph.targets.length);
  });
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraph.test.ts`
Expected: FAIL，`Cannot find module '../RoadCellGraph'`

- [ ] **Step 3: 實作**

建立 `src/core/road/RoadCellGraph.ts`：

```ts
import { parsePosKeyUnsafe, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { roadTileCost } from '../service/RoadCoverageFlood';
import type { UnifiedRoadLookup } from './UnifiedRoadLookup';

/**
 * 路網的格子層圖。節點是道路格（含高架），邊是 `UnifiedRoadLookup` 判定的
 * 合法鄰接。
 *
 * **樓層與匝道規則在建圖時就被消化掉了** —— 拿到這張圖的人（尤其是 worker）
 * 看不到樓層，也不需要重新解讀規則。那是它存在的理由：規則只有一份。
 *
 * CSR（壓縮稀疏列）：節點 i 的鄰接是 targets[offsets[i] .. offsets[i+1])。
 * 用 typed array 是為了能直接 transfer 給 worker，不必逐個物件複製。
 */
export interface RoadCellGraph {
  /** 節點 i 的格子 key（"x,y" 或 "x,y,level"）。 */
  readonly nodeKeys: readonly string[];
  /** key → 節點索引。 */
  readonly indexOf: ReadonlyMap<string, number>;
  /** 長度 n+1。 */
  readonly offsets: Uint32Array;
  readonly targets: Uint32Array;
  /** 走進 targets[j] 那一格要付的成本。 */
  readonly weights: Float32Array;
  readonly nodeX: Uint16Array;
  readonly nodeY: Uint16Array;
  /** 0 = 地面，1–3 = 高架。序列化與重組 key 時要用。 */
  readonly nodeLevel: Uint8Array;
}

/** 從 lookup 建圖。O(路格數 × 4)。 */
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
    if (x > 0xffff || y > 0xffff) {
      throw new RangeError(`格子座標超過 Uint16 上限: ${key}`);
    }
    nodeX[i] = x;
    nodeY[i] = y;
    const parts = key.split(',');
    nodeLevel[i] = parts.length > 2 ? Number(parts[2]) : 0;
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
        targetList.push(j);
        weightList.push(w);
      }
    }
  }
  offsets[n] = targetList.length;

  return {
    nodeKeys, indexOf, offsets,
    targets: Uint32Array.from(targetList),
    weights: Float32Array.from(weightList),
    nodeX, nodeY, nodeLevel,
  };
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraph.test.ts`
Expected: PASS（4 條）

- [ ] **Step 5: 回退驗證**

把 `roadTileCost(info.roadType)` 改成 `roadTileCost(lookup.getCellByKey(key)!.roadType)`
（改成算來源那一格），跑測試。
Expected: 「should charge the cost of the destination tile」轉紅。
確認之後改回來。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraph.ts src/core/road/__tests__/RoadCellGraph.test.ts
git commit -m "feat(road): 路網的格子層圖 —— 樓層與匝道規則在建圖時消化掉"
```

---

## Task 2: flood 核心

**Files:**
- Modify: `src/core/road/RoadCellGraph.ts`（新增 `floodRoadCellGraph`）
- Test: `src/core/road/__tests__/RoadCellGraphFlood.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `RoadCellGraph`、`buildRoadCellGraph`
- Produces: `floodRoadCellGraph(graph, seedNodes: readonly number[], maxBudget: number, onSettle?: (node: number, cost: number) => boolean): Float32Array`
  （回傳每個節點的成本，未到達為 `-1`）

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphFlood.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildRoadCellGraph, floodRoadCellGraph } from '../RoadCellGraph';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { RoadType, RoadDirection } from '../types';
import { roadTileCost } from '../../service/RoadCoverageFlood';

/**
 * 這個核心被同步 fallback 與 worker 兩邊共用，所以它的不變式就是兩邊的
 * 共同契約。三條裡有兩條是踩過坑才有的。
 */

function lineGrid(w: number, types: number[]) {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < w; x++) {
    cells.set(`${x},1`, { roadType: types[x] ?? RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST });
  }
  return {
    width: w, height: 3,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= w || y >= 3) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (cell: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < 3; y++) for (let x = 0; x < w; x++) fn(this.getCell(x, y)!, x, y);
    },
  };
}

function graphOf(w: number, types: number[] = []) {
  return buildRoadCellGraph(new UnifiedRoadLookup(lineGrid(w, types), new ElevationManager()));
}

describe('floodRoadCellGraph', () => {
  it('should accumulate the destination tile cost along the way', () => {
    const g = graphOf(5);
    const cost = floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1000);
    const per = roadTileCost(RoadType.TWO_LANE);
    expect(cost[g.indexOf.get('0,1')!]).toBeCloseTo(0, 9);
    expect(cost[g.indexOf.get('3,1')!]).toBeCloseTo(per * 3, 9);
  });

  it('should leave unreached nodes at -1', () => {
    const g = graphOf(5);
    const cost = floodRoadCellGraph(g, [g.indexOf.get('0,1')!], roadTileCost(RoadType.TWO_LANE) * 2);
    expect(cost[g.indexOf.get('2,1')!]).toBeGreaterThanOrEqual(0);
    expect(cost[g.indexOf.get('4,1')!], '超過預算的節點應該是 -1').toBe(-1);
  });

  it('should call onSettle in increasing cost order, never on relax', () => {
    // BUG-102：路型差到 6.7 倍（鄉道 3.33 vs 高速 0.5）。在 relax 時記錄，
    // 「先碰到的那條路」會永久獲勝 —— 門口一條鄉道贏過兩格外的高速公路，
    // 而 JobRelocation 就用那個錯誤的數字評分。settle（pop）順序就是成本
    // 遞增順序，所以第一次 settle 一定是最便宜的。
    const g = graphOf(5);
    const seen: number[] = [];
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1000, (_n, c) => { seen.push(c); return false; });
    const sorted = [...seen].sort((a, b) => a - b);
    expect(seen, 'settle 不是依成本遞增').toEqual(sorted);
  });

  it('should stop early when onSettle asks it to', () => {
    const g = graphOf(20);
    let count = 0;
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1000, () => { count++; return count >= 3; });
    expect(count, '沒有提早結束').toBe(3);
  });

  it('should prefer a cheaper road even when it settles later in insertion order', () => {
    // 具體版的 BUG-102：0 是高速、1 是鄉道，都連到 2。從 0 和 1 同時出發時，
    // 2 的成本必須是「較便宜的那條」。
    const g = graphOf(4, [RoadType.HIGHWAY, RoadType.RURAL, RoadType.TWO_LANE, RoadType.TWO_LANE]);
    const cost = floodRoadCellGraph(g, [g.indexOf.get('1,1')!], 1000);
    expect(cost[g.indexOf.get('0,1')!]).toBeCloseTo(roadTileCost(RoadType.HIGHWAY), 9);
  });
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphFlood.test.ts`
Expected: FAIL，`floodRoadCellGraph is not a function`

- [ ] **Step 3: 實作**

在 `src/core/road/RoadCellGraph.ts` 檔尾加上：

```ts
/** 二元堆。節點索引是整數，所以不需要字串 key 的版本。 */
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
 * 三個不變式 —— 兩條路（同步 fallback 與 worker）都靠它們，改動要非常小心：
 *
 * 1. **成本加在目的地那一格**（`weights[j]` 是走進 `targets[j]` 的價格）。
 * 2. **`onSettle` 在 pop 時呼叫，不是 relax 時。** pop 順序就是成本遞增順序，
 *    所以第一次 settle 一定是最便宜的那條路。在 relax 時記錄會讓「先碰到的」
 *    永久獲勝 —— 門口一條鄉道贏過兩格外的高速公路（BUG-102）。
 * 3. **超過 `maxBudget` 的鄰居不入堆。**
 *
 * `onSettle` 回傳 true 表示提早結束（同步路徑找齊目標之後就不必再走）。
 */
export function floodRoadCellGraph(
  graph: RoadCellGraph,
  seedNodes: readonly number[],
  maxBudget: number,
  onSettle?: (node: number, cost: number) => boolean,
): Float32Array {
  const n = graph.nodeKeys.length;
  const cost = new Float32Array(n).fill(-1);
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
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphFlood.test.ts`
Expected: PASS（5 條）

- [ ] **Step 5: 回退驗證**

把 `if (onSettle && onSettle(cur.node, cur.cost)) return cost;` 搬到 relax
迴圈裡（在 `cost[next] = nc;` 之後呼叫 `onSettle(next, nc)`），跑測試。
Expected: 「should call onSettle in increasing cost order」轉紅。
確認之後改回來。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraph.ts src/core/road/__tests__/RoadCellGraphFlood.test.ts
git commit -m "feat(road): 圖上的 flood 核心 —— 同步與 worker 共用的那一份"
```

---

## Task 3: 種子與建築附掛

**Files:**
- Modify: `src/core/road/RoadCellGraph.ts`
- Test: `src/core/road/__tests__/RoadCellGraphAttach.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `floodRoadCellGraph`
- Produces:
  - `seedNodesFor(graph: RoadCellGraph, x: number, y: number, reach: number): number[]`
  - `attachBuildingCells(graph, settled: readonly { node: number; cost: number }[], reach: number, accept: (x: number, y: number) => boolean, out: Map<string, number>): void`

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphAttach.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  buildRoadCellGraph, floodRoadCellGraph, seedNodesFor, attachBuildingCells,
} from '../RoadCellGraph';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { RoadType, RoadDirection } from '../types';
import { roadTileCost } from '../../service/RoadCoverageFlood';
import { ZONE_ROAD_REACH } from '../../grid/constants';

/** 路在 y=1，建築在 y=2。 */
function grid(w: number, types: number[] = []) {
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < w; x++) {
    cells.set(`${x},1`, { roadType: types[x] ?? RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST });
  }
  return {
    width: w, height: 4,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= w || y >= 4) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (cell: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < w; x++) fn(this.getCell(x, y)!, x, y);
    },
  };
}

function graphOf(w: number, types: number[] = []) {
  return buildRoadCellGraph(new UnifiedRoadLookup(grid(w, types), new ElevationManager()));
}

describe('seedNodesFor', () => {
  it('should pick up every road cell within reach, at any level', () => {
    const g = graphOf(8);
    const seeds = seedNodesFor(g, 3, 2, ZONE_ROAD_REACH);
    const keys = seeds.map(i => g.nodeKeys[i]!).sort();
    // Chebyshev 2 從 (3,2) 涵蓋 x 1..5 的那一排路
    expect(keys).toEqual(['1,1', '2,1', '3,1', '4,1', '5,1']);
  });

  it('should return nothing when no road is in reach', () => {
    const g = graphOf(8);
    expect(seedNodesFor(g, 3, 3 + ZONE_ROAD_REACH + 1, ZONE_ROAD_REACH)).toEqual([]);
  });
});

describe('attachBuildingCells', () => {
  it('should record the cheapest road, not the first one encountered', () => {
    // BUG-102 的完整重演：建築在 (2,2)。(2,1) 是鄉道（貴），(0,1) 是高速。
    // 依 settle 順序附掛時，先 settle 的一定比較便宜。
    const types = [RoadType.HIGHWAY, RoadType.HIGHWAY, RoadType.RURAL, RoadType.HIGHWAY];
    const g = graphOf(4, types);
    const settled: { node: number; cost: number }[] = [];
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1000, (node, cost) => {
      settled.push({ node, cost });
      return false;
    });

    const out = new Map<string, number>();
    attachBuildingCells(g, settled, ZONE_ROAD_REACH, (x, y) => x === 2 && y === 2, out);

    // (2,2) 附掛到 reach 內成本最低的路格，也就是 (0,1) 或 (1,1)（都是高速），
    // 不是正上方的鄉道 (2,1)。
    const viaHighway = roadTileCost(RoadType.HIGHWAY);
    expect(out.get('2,2'), '附掛到了比較貴的那條路').toBeCloseTo(viaHighway, 9);
  });

  it('should only record a cell once', () => {
    const g = graphOf(6);
    const settled: { node: number; cost: number }[] = [];
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1000, (node, cost) => {
      settled.push({ node, cost }); return false;
    });
    const out = new Map<string, number>();
    attachBuildingCells(g, settled, ZONE_ROAD_REACH, (x, y) => y === 2, out);
    // 多條路都在 reach 內，但每格只該有一個值，而且是最便宜的。
    expect(out.get('3,2')).toBeCloseTo(0, 9); // (0,1) 是種子，成本 0，reach 2 涵蓋不到 x=3
    expect(out.get('0,2')).toBeCloseTo(0, 9);
  });

  it('should ignore cells the accept predicate rejects', () => {
    const g = graphOf(6);
    const settled: { node: number; cost: number }[] = [];
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1000, (node, cost) => {
      settled.push({ node, cost }); return false;
    });
    const out = new Map<string, number>();
    attachBuildingCells(g, settled, ZONE_ROAD_REACH, () => false, out);
    expect(out.size).toBe(0);
  });
});
```

> **註:** 上面第二條測試裡 `out.get('3,2')` 的期望值取決於 reach 涵蓋範圍;
> 實作完成後若實際值不同,**先確認哪一個才是正確語意**(對照舊的
> `roadDistanceToTargets` 對同一個佈局的輸出),再調整測試或實作。這一條的
> 目的是「每格只記一次且取最便宜」,不是特定數字。

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphAttach.test.ts`
Expected: FAIL，`seedNodesFor is not a function`

- [ ] **Step 3: 實作**

在 `src/core/road/RoadCellGraph.ts` 檔尾加上：

```ts
import { toPosKey } from '../grid/GridHelpers';

/**
 * 建築格附近的道路節點（所有樓層）。
 *
 * 家與工作都不是道路格，它們要「附掛」到 Chebyshev(reach) 內的路上 ——
 * 這與 zone/civic 的內圈模型一致（`ZONE_ROAD_REACH`）。
 */
export function seedNodesFor(
  graph: RoadCellGraph, x: number, y: number, reach: number,
): number[] {
  const out: number[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0) continue;
      // 同一個 (x, y) 可能有多層，全部都要。
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
 * 把 flood 的結果攤到建築格上。
 *
 * `settled` **必須是 settle（pop）順序**，也就是成本遞增順序 —— 因為只記
 * 第一次，順序錯了就會記到比較貴的那條路（BUG-102）。
 *
 * `accept` 決定哪些格子要收，兩個呼叫端問的問題不同：同步路徑問「在不在
 * 目標集合裡」，worker 問「是不是非道路格」。
 */
export function attachBuildingCells(
  graph: RoadCellGraph,
  settled: readonly { node: number; cost: number }[],
  reach: number,
  accept: (x: number, y: number) => boolean,
  out: Map<string, number>,
): void {
  for (const { node, cost } of settled) {
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
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphAttach.test.ts`
Expected: PASS（5 條）。若「should only record a cell once」的期望值與實作
不符,依 Step 1 的註記先對照舊實作確認語意再調整。

- [ ] **Step 5: 回退驗證**

把 `attachBuildingCells` 裡的 `if (out.has(key)) continue;` 拿掉（改成永遠覆寫），
跑測試。
Expected: 「should record the cheapest road」轉紅。
確認之後改回來。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraph.ts src/core/road/__tests__/RoadCellGraphAttach.test.ts
git commit -m "feat(road): 種子與建築附掛 —— 依 settle 順序取最便宜的那條路"
```

---

## Task 4: 同步 fallback 改用核心（含對照舊實作的差異測試）

**Files:**
- Modify: `src/core/service/RoadCoverageFlood.ts`（`roadDistanceToTargets` 改寫；
  舊實作改名 `roadDistanceToTargetsLegacy` 並 `export`）
- Test: `src/core/road/__tests__/RoadDistanceParity.test.ts`

**Interfaces:**
- Consumes: Task 1–3 的 `buildRoadCellGraph`、`floodRoadCellGraph`、`seedNodesFor`、`attachBuildingCells`
- Produces: `roadDistanceToTargets` 簽章**完全不變**
  `(grid: ReadableGrid, home: {x,y}, targets: Set<string>, maxBudget: number, roadLookup?: UnifiedRoadLookup | null) => Map<string, number>`

- [ ] **Step 1: 把舊實作改名並匯出**

在 `src/core/service/RoadCoverageFlood.ts`，把現有的
`export function roadDistanceToTargets(` 改成
`export function roadDistanceToTargetsLegacy(`，內容一字不動。

在它上方加註解：

```ts
/**
 * 改用路網圖之前的實作。**只留給差異測試對照用** —— 它是唯一能證明重構沒有
 * 改變行為的東西。Task 6 結束後刪除。
 */
```

- [ ] **Step 2: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadDistanceParity.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { roadDistanceToTargets, roadDistanceToTargetsLegacy } from '../../service/RoadCoverageFlood';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { RoadType, RoadDirection } from '../types';
import { toPosKey } from '../../grid/GridHelpers';

/**
 * 重構的唯一證明。
 *
 * 新實作走圖，舊實作直接掃格子。**同一個世界、同一組查詢，兩者必須逐格
 * 精確相等** —— 不是「差不多」，因為那個成本會直接餵進 scoreWorkplaceWithCost。
 *
 * 城市必須有高架與匝道，否則測不到重構的重點。
 */
function cityWithViaduct() {
  const w = 12, h = 8;
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  const EW = RoadDirection.EAST | RoadDirection.WEST;
  // 地面主幹道 y=3
  for (let x = 0; x < w; x++) cells.set(`${x},3`, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  // 一段鄉道支線 y=5，x 2..6
  for (let x = 2; x <= 6; x++) cells.set(`${x},5`, { roadType: RoadType.RURAL, roadFlags: EW });
  // 連接支線與主幹 x=2
  cells.set('2,4', { roadType: RoadType.RURAL, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH });

  const grid = {
    width: w, height: h,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (cell: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(this.getCell(x, y)!, x, y);
    },
  };

  // 高架：y=3 上方 level 1，x 4..9，兩端是匝道
  const em = new ElevationManager();
  for (let x = 4; x <= 9; x++) {
    em.set(x, 3, 1, {
      roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0,
      isRamp: x === 4 || x === 9,
      rampAscendDirection: x === 4 ? RoadDirection.EAST : RoadDirection.WEST,
    });
  }
  return new UnifiedRoadLookup(grid, em);
}

describe('roadDistanceToTargets parity with the legacy implementation', () => {
  const lookup = cityWithViaduct();
  const grid = (lookup as unknown as { grid: any }).grid;

  /** 所有非道路格都當成潛在的家或工作。 */
  function allBuildingCells(): string[] {
    const out: string[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 12; x++) {
        if (grid.getCell(x, y)!.roadType === RoadType.NONE) out.push(toPosKey(x, y));
      }
    }
    return out;
  }

  it('should match the legacy result for every home, exactly', () => {
    const cells = allBuildingCells();
    const targets = new Set(cells);
    for (const homeKey of cells) {
      const [hx, hy] = homeKey.split(',').map(Number);
      const home = { x: hx!, y: hy! };
      const a = roadDistanceToTargets(grid, home, targets, 60, lookup);
      const b = roadDistanceToTargetsLegacy(grid, home, targets, 60, lookup);

      expect([...a.keys()].sort(), `家 ${homeKey}：到得了的目標集合不同`)
        .toEqual([...b.keys()].sort());
      for (const [k, v] of b) {
        expect(a.get(k), `家 ${homeKey} → ${k}：成本不同`).toBeCloseTo(v, 6);
      }
    }
  });

  it('should agree on the budget cutoff', () => {
    const targets = new Set(allBuildingCells());
    const home = { x: 0, y: 2 };
    for (const budget of [1, 5, 20, 60, 1000]) {
      const a = roadDistanceToTargets(grid, home, targets, budget, lookup);
      const b = roadDistanceToTargetsLegacy(grid, home, targets, budget, lookup);
      expect(a.size, `預算 ${budget}：到達數不同`).toBe(b.size);
    }
  });
});
```

- [ ] **Step 3: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadDistanceParity.test.ts`
Expected: FAIL，`roadDistanceToTargets is not a function`（舊的已改名，新的還沒寫）

- [ ] **Step 4: 實作新版**

在 `src/core/service/RoadCoverageFlood.ts` 加上新的 `roadDistanceToTargets`：

```ts
import {
  buildRoadCellGraph, floodRoadCellGraph, seedNodesFor, attachBuildingCells,
} from '../road/RoadCellGraph';

/**
 * 家 → 一組目標的道路距離。
 *
 * 走的是 `RoadCellGraph`，與 workplace-distance worker **同一個 flood 核心** ——
 * 兩條路不可能給出不同的決策（BUG-109）。舊的逐格實作保留為
 * `roadDistanceToTargetsLegacy`，只給差異測試對照用。
 *
 * `roadLookup` 為 null 時退回舊實作：沒有 lookup 就沒有樓層資訊，建不出圖。
 */
export function roadDistanceToTargets(
  grid: ReadableGrid,
  home: { x: number; y: number },
  targets: Set<string>,
  maxBudget: number,
  roadLookup?: UnifiedRoadLookup | null,
): Map<string, number> {
  if (!roadLookup) return roadDistanceToTargetsLegacy(grid, home, targets, maxBudget, roadLookup);

  const result = new Map<string, number>();
  if (targets.size === 0) return result;

  const graph = buildRoadCellGraph(roadLookup);
  const seeds = seedNodesFor(graph, home.x, home.y, ZONE_ROAD_REACH);
  if (seeds.length === 0) return result;

  // settle 順序要留著 —— attachBuildingCells 靠它取最便宜的那條路。
  const settled: { node: number; cost: number }[] = [];
  floodRoadCellGraph(graph, seeds, maxBudget, (node, cost) => {
    settled.push({ node, cost });
    return false;
  });

  attachBuildingCells(graph, settled, ZONE_ROAD_REACH, (x, y) => targets.has(toPosKey(x, y)), result);
  return result;
}
```

- [ ] **Step 5: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadDistanceParity.test.ts`
Expected: PASS。

**若不相等,不要改測試去遷就實作。** 逐項比對差異來源:種子範圍、附掛 reach、
預算截斷的比較方向（`>` vs `>=`）、道路格本身是否算目標。舊實作在
`RoadCoverageFlood.ts` 裡有一段「Check seeds for adjacent targets」與
「道路格本身也可能是目標」的處理,新版必須有對應行為。

- [ ] **Step 6: 跑完整測試套件**

Run: `npx vitest run`
Expected: 全綠。`JobRelocation.test.ts` 與 `SimulationLoop` 的相關測試都會經過
新的 `roadDistanceToTargets`，是額外的保護。

- [ ] **Step 7: 回退驗證**

把新版的 `attachBuildingCells` 呼叫改成傳入未排序的 settle 陣列
（`[...settled].reverse()`），跑差異測試。
Expected: 「should match the legacy result」轉紅。
確認之後改回來。

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/core/service/RoadCoverageFlood.ts src/core/road/__tests__/RoadDistanceParity.test.ts
git commit -m "refactor(road): 同步的距離查詢改走路網圖，對照舊實作逐格驗證"
```

---

## Task 5: 圖的序列化

**Files:**
- Create: `src/core/road/RoadCellGraphBuffer.ts`
- Test: `src/core/road/__tests__/RoadCellGraphBuffer.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `RoadCellGraph`
- Produces:
  - `GRAPH_BUFFER_VERSION = 1`
  - `serializeRoadCellGraph(graph: RoadCellGraph): ArrayBuffer`
  - `deserializeRoadCellGraph(buffer: ArrayBuffer): RoadCellGraph`（版本不符時丟 `Error`）

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphBuffer.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildRoadCellGraph } from '../RoadCellGraph';
import {
  serializeRoadCellGraph, deserializeRoadCellGraph, GRAPH_BUFFER_VERSION,
} from '../RoadCellGraphBuffer';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { RoadType, RoadDirection } from '../types';

function sampleGraph() {
  const w = 6, h = 4;
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  const EW = RoadDirection.EAST | RoadDirection.WEST;
  for (let x = 0; x < w; x++) cells.set(`${x},1`, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  const grid = {
    width: w, height: h,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(this.getCell(x, y)!, x, y);
    },
  };
  const em = new ElevationManager();
  em.set(3, 1, 1, {
    roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0,
    isRamp: true, rampAscendDirection: RoadDirection.EAST,
  });
  return buildRoadCellGraph(new UnifiedRoadLookup(grid, em));
}

describe('RoadCellGraph serialization', () => {
  it('should round-trip every field', () => {
    // 位元組佈局錯位不會報錯 —— 它會把 Uint32 當 Float32 讀出一堆看似合理的
    // 距離。所以每個欄位都要比。
    const g = sampleGraph();
    const back = deserializeRoadCellGraph(serializeRoadCellGraph(g));

    expect(back.nodeKeys).toEqual(g.nodeKeys);
    expect([...back.offsets]).toEqual([...g.offsets]);
    expect([...back.targets]).toEqual([...g.targets]);
    expect([...back.weights]).toEqual([...g.weights]);
    expect([...back.nodeX]).toEqual([...g.nodeX]);
    expect([...back.nodeY]).toEqual([...g.nodeY]);
    expect([...back.nodeLevel]).toEqual([...g.nodeLevel]);
  });

  it('should rebuild the key index from coordinates, not from a serialized list', () => {
    // key 字串不序列化（省 structured clone），所以反序列化端必須組得回來，
    // 而且組出來的要與原本一致 —— 高架的 key 有第三段。
    const g = sampleGraph();
    const back = deserializeRoadCellGraph(serializeRoadCellGraph(g));
    expect(back.nodeKeys, '高架的 key 沒有帶樓層').toContain('3,1,1');
    for (let i = 0; i < back.nodeKeys.length; i++) {
      expect(back.indexOf.get(back.nodeKeys[i]!)).toBe(i);
    }
  });

  it('should refuse a buffer with the wrong version', () => {
    // 格式改了但 worker 沒更新時要明確報錯，而不是算出一堆錯的距離。
    const buf = serializeRoadCellGraph(sampleGraph());
    new DataView(buf).setUint32(8, GRAPH_BUFFER_VERSION + 1, true);
    expect(() => deserializeRoadCellGraph(buf)).toThrow(/version/i);
  });
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphBuffer.test.ts`
Expected: FAIL，`Cannot find module '../RoadCellGraphBuffer'`

- [ ] **Step 3: 實作**

建立 `src/core/road/RoadCellGraphBuffer.ts`：

```ts
import { toPosKey } from '../grid/GridHelpers';
import type { RoadCellGraph } from './RoadCellGraph';

/**
 * `RoadCellGraph` 的扁平位元組佈局，給 worker 用。
 *
 * 只有格式，沒有演算法 —— 改權重公式不該碰這個檔案，改佈局不該碰 Dijkstra。
 *
 * 佈局（全部 little-endian）：
 *   Header 16 bytes: nodeCount u32 / edgeCount u32 / version u32 / reserved u32
 *   nodeX     Uint16[n]
 *   nodeY     Uint16[n]
 *   nodeLevel Uint8[n]（對齊到 4 的倍數）
 *   offsets   Uint32[n+1]
 *   targets   Uint32[e]
 *   weights   Float32[e]
 *
 * **key 字串不序列化** —— 從座標與樓層現組，省下數百個字串的 structured clone。
 */
export const GRAPH_BUFFER_VERSION = 1;

const HEADER_BYTES = 16;
const align4 = (n: number) => (n + 3) & ~3;

export function serializeRoadCellGraph(graph: RoadCellGraph): ArrayBuffer {
  const n = graph.nodeKeys.length;
  const e = graph.targets.length;

  const oNodeX = HEADER_BYTES;
  const oNodeY = oNodeX + align4(n * 2);
  const oLevel = oNodeY + align4(n * 2);
  const oOffsets = oLevel + align4(n);
  const oTargets = oOffsets + (n + 1) * 4;
  const oWeights = oTargets + e * 4;
  const total = oWeights + e * 4;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  dv.setUint32(0, n, true);
  dv.setUint32(4, e, true);
  dv.setUint32(8, GRAPH_BUFFER_VERSION, true);
  dv.setUint32(12, 0, true);

  new Uint16Array(buf, oNodeX, n).set(graph.nodeX);
  new Uint16Array(buf, oNodeY, n).set(graph.nodeY);
  new Uint8Array(buf, oLevel, n).set(graph.nodeLevel);
  new Uint32Array(buf, oOffsets, n + 1).set(graph.offsets);
  new Uint32Array(buf, oTargets, e).set(graph.targets);
  new Float32Array(buf, oWeights, e).set(graph.weights);
  return buf;
}

export function deserializeRoadCellGraph(buffer: ArrayBuffer): RoadCellGraph {
  const dv = new DataView(buffer);
  const n = dv.getUint32(0, true);
  const e = dv.getUint32(4, true);
  const version = dv.getUint32(8, true);
  if (version !== GRAPH_BUFFER_VERSION) {
    throw new Error(
      `RoadCellGraph buffer version mismatch: got ${version}, expected ${GRAPH_BUFFER_VERSION}`,
    );
  }

  const oNodeX = HEADER_BYTES;
  const oNodeY = oNodeX + align4(n * 2);
  const oLevel = oNodeY + align4(n * 2);
  const oOffsets = oLevel + align4(n);
  const oTargets = oOffsets + (n + 1) * 4;
  const oWeights = oTargets + e * 4;

  const nodeX = new Uint16Array(buffer, oNodeX, n);
  const nodeY = new Uint16Array(buffer, oNodeY, n);
  const nodeLevel = new Uint8Array(buffer, oLevel, n);

  const nodeKeys: string[] = new Array(n);
  const indexOf = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const lv = nodeLevel[i]!;
    const key = lv === 0 ? toPosKey(nodeX[i]!, nodeY[i]!) : `${nodeX[i]},${nodeY[i]},${lv}`;
    nodeKeys[i] = key;
    indexOf.set(key, i);
  }

  return {
    nodeKeys, indexOf,
    offsets: new Uint32Array(buffer, oOffsets, n + 1),
    targets: new Uint32Array(buffer, oTargets, e),
    weights: new Float32Array(buffer, oWeights, e),
    nodeX, nodeY, nodeLevel,
  };
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphBuffer.test.ts`
Expected: PASS（3 條）

- [ ] **Step 5: 回退驗證**

把 `deserializeRoadCellGraph` 裡的版本檢查整段拿掉，跑測試。
Expected: 「should refuse a buffer with the wrong version」轉紅。
確認之後改回來。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraphBuffer.ts src/core/road/__tests__/RoadCellGraphBuffer.test.ts
git commit -m "feat(road): 路網圖的序列化 —— key 不入緩衝，從座標現組"
```

---

## Task 6: worker 改用圖，並刪掉高架閘門

**Files:**
- Modify: `src/core/workplace/WorkplaceDistanceTypes.ts`（請求加 `graphBuffer`）
- Modify: `src/core/workplace/WorkplaceDistanceClient.ts`（`compute()` 多收 `graphBuffer`）
- Modify: `src/workers/workplace-distance.worker.ts`（刪自己的 MinHeap 與 flood）
- Modify: `src/core/simulation/SimulationLoop.ts:1195` 與 `:1333`（刪 `hasAnyElevatedRoad()` 判斷）
- Modify: `src/core/service/RoadCoverageFlood.ts`（刪 `roadDistanceToTargetsLegacy`）
- Test: `src/core/workplace/__tests__/WorkerGraphParity.test.ts`

**Interfaces:**
- Consumes: Task 1–5 全部
- Produces: 無新公開 API；`WDWorkerRequest` 多一個 `graphBuffer: ArrayBuffer` 欄位

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/workplace/__tests__/WorkerGraphParity.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { reverseFloodFromGraph } from '../../../workers/workplace-distance.worker';
import { roadDistanceToTargets } from '../../service/RoadCoverageFlood';
import { buildRoadCellGraph } from '../../road/RoadCellGraph';
import { serializeRoadCellGraph } from '../../road/RoadCellGraphBuffer';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { RoadType, RoadDirection } from '../../road/types';
import { toPosKey } from '../../grid/GridHelpers';

/**
 * 本設計的硬約束：**worker 算的必須等於同步 fallback 算的。**
 *
 * 兩者共用同一個 flood 核心，所以這條測試理應永遠綠 —— 它守的是「有人哪天
 * 為了效能在 worker 裡另外寫一份」。城市必須有高架與匝道。
 */
function cityWithViaduct() {
  const w = 12, h = 8;
  const EW = RoadDirection.EAST | RoadDirection.WEST;
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < w; x++) cells.set(`${x},3`, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  for (let x = 2; x <= 6; x++) cells.set(`${x},5`, { roadType: RoadType.RURAL, roadFlags: EW });
  cells.set('2,4', { roadType: RoadType.RURAL, roadFlags: RoadDirection.NORTH | RoadDirection.SOUTH });

  const grid = {
    width: w, height: h,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(this.getCell(x, y)!, x, y);
    },
  };
  const em = new ElevationManager();
  for (let x = 4; x <= 9; x++) {
    em.set(x, 3, 1, {
      roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0,
      isRamp: x === 4 || x === 9,
      rampAscendDirection: x === 4 ? RoadDirection.EAST : RoadDirection.WEST,
    });
  }
  return { grid, lookup: new UnifiedRoadLookup(grid, em) };
}

describe('worker result equals the synchronous fallback', () => {
  it('should agree on every home → workplace cost, exactly', () => {
    const { grid, lookup } = cityWithViaduct();
    const graph = buildRoadCellGraph(lookup);
    const buffer = serializeRoadCellGraph(graph);

    const buildings: string[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 12; x++) {
        if (grid.getCell(x, y)!.roadType === RoadType.NONE) buildings.push(toPosKey(x, y));
      }
    }
    const isBuilding = (x: number, y: number) =>
      grid.getCell(x, y) !== null && grid.getCell(x, y)!.roadType === RoadType.NONE;

    for (const wpKey of buildings) {
      const [wx, wy] = wpKey.split(',').map(Number);
      // worker：從工作地點反向 flood，得到「每個家 → 這個工作」的成本
      const fromWorker = reverseFloodFromGraph(buffer, { pos: wpKey, x: wx!, y: wy! }, 60, isBuilding);

      for (const homeKey of buildings) {
        const [hx, hy] = homeKey.split(',').map(Number);
        const sync = roadDistanceToTargets(
          grid, { x: hx!, y: hy! }, new Set([wpKey]), 60, lookup,
        );
        const a = fromWorker[homeKey];
        const b = sync.get(wpKey);
        if (b === undefined) {
          expect(a, `${homeKey} → ${wpKey}：同步說到不了，worker 說到得了`).toBeUndefined();
        } else {
          expect(a, `${homeKey} → ${wpKey}：worker 說到不了`).toBeDefined();
          expect(a!, `${homeKey} → ${wpKey}：成本不同`).toBeCloseTo(b, 6);
        }
      }
    }
  });
});
```

> **註:** 反向 flood 的對稱性成立的前提是「邊的權重與方向無關」。目前
> `roadTileCost` 只看目的地那一格的路型,所以 A→B 與 B→A 的單邊成本不同
> （各自付對方那格的價格）。**若這條測試因此失敗,那是真實的語意差異,不是
> 測試寫錯** —— 記入 BUGS.md,並在 worker 端改為「以家為起點」的正向 flood
> 或讓權重對稱化,擇一並在 spec 補記決定。

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/workplace/__tests__/WorkerGraphParity.test.ts`
Expected: FAIL，`reverseFloodFromGraph is not a function`

- [ ] **Step 3: 改寫 worker**

在 `src/workers/workplace-distance.worker.ts`：刪掉 `BYTES_PER_CELL`、
`FOUR_DIRS`、`roadTileCost`、`class MinHeap`、`reverseFloodFromWorkplace`，
改成：

```ts
import { deserializeRoadCellGraph } from '../core/road/RoadCellGraphBuffer';
import { floodRoadCellGraph, attachBuildingCells } from '../core/road/RoadCellGraph';
import { ZONE_ROAD_REACH } from '../core/grid/constants';
import { seedNodesFor } from '../core/road/RoadCellGraph';
import type { WDWorkerRequest, WDWorkerResponse, WorkplaceDistanceEntry, WorkplacePosition } from '../core/workplace/WorkplaceDistanceTypes';

/**
 * 從一個工作地點反向 flood，回傳每個建築格到它的道路成本。
 *
 * worker 不再有自己的 Dijkstra —— 它跟同步 fallback 用同一個
 * `floodRoadCellGraph`。圖裡已經沒有樓層概念，規則在建圖時就被消化掉了。
 */
export function reverseFloodFromGraph(
  graphBuffer: ArrayBuffer,
  wp: WorkplacePosition,
  maxBudget: number,
  isBuilding: (x: number, y: number) => boolean,
): Record<string, number> {
  const graph = deserializeRoadCellGraph(graphBuffer);
  const seeds = seedNodesFor(graph, wp.x, wp.y, ZONE_ROAD_REACH);
  const out = new Map<string, number>();
  if (seeds.length === 0) return {};

  const settled: { node: number; cost: number }[] = [];
  floodRoadCellGraph(graph, seeds, maxBudget, (node, cost) => {
    settled.push({ node, cost });
    return false;
  });
  attachBuildingCells(graph, settled, ZONE_ROAD_REACH, isBuilding, out);

  return Object.fromEntries(out);
}
```

訊息處理端改成從 `gridBuffer` 造 `isBuilding`（`roadType` 在 offset+5，
`BYTES_PER_CELL = 12`，這兩個常數留在訊息處理端）：

```ts
self.onmessage = (ev: MessageEvent<WDWorkerRequest>) => {
  const req = ev.data;
  if (req.type !== 'COMPUTE') return;
  try {
    const view = new DataView(req.gridBuffer as ArrayBuffer);
    const BYTES_PER_CELL = 12;
    const isBuilding = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= req.gridWidth || y >= req.gridHeight) return false;
      return view.getUint8((y * req.gridWidth + x) * BYTES_PER_CELL + 5) === 0;
    };
    const entries: WorkplaceDistanceEntry[] = req.workplaces.map(wp => ({
      workplacePos: wp.pos,
      distances: reverseFloodFromGraph(req.graphBuffer, wp, req.maxBudget, isBuilding),
    }));
    const res: WDWorkerResponse = { type: 'RESULT', requestId: req.requestId, entries };
    (self as unknown as Worker).postMessage(res);
  } catch (err) {
    const res: WDWorkerResponse = {
      type: 'ERROR', requestId: req.requestId, message: String(err),
    };
    (self as unknown as Worker).postMessage(res);
  }
};
```

- [ ] **Step 4: 型別與 client 加上 graphBuffer**

`src/core/workplace/WorkplaceDistanceTypes.ts` 的 `WDWorkerRequest` 加上：

```ts
  /** 序列化的 RoadCellGraph。走訪規則在建圖時就消化掉了，worker 不解讀樓層。 */
  graphBuffer: ArrayBuffer;
```

`src/core/workplace/WorkplaceDistanceClient.ts` 的 `compute()` 在
`gridBuffer` 之後加上 `graphBuffer: ArrayBuffer` 參數，並放進 postMessage 的
payload。

- [ ] **Step 5: 刪掉 SimulationLoop 的閘門並傳圖**

`src/core/simulation/SimulationLoop.ts`：

- `:1195` 與 `:1333` 兩處
  `const canUseWpCache = !this._elevationManager || !this._elevationManager.hasAnyElevatedRoad();`
  **整行刪除**，所有 `canUseWpCache &&` 的用法一併移除。
- `requestUpdate` 的呼叫加上圖：

```ts
      const graphBuffer = serializeRoadCellGraph(buildRoadCellGraph(this._roadLookup!));
      this.wpDistCache.requestUpdate(
        this.state.grid.width, this.state.grid.height,
        copy, graphBuffer, wpPositions, DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget,
      );
```

（`WorkplaceDistanceCache.requestUpdate` 的簽章同步加上 `graphBuffer`，
往下傳給 `client.compute`。）

把兩處註解「Correctness wins over speed: the cache is simply not used while any
elevated ROAD exists」與「It is currently unreachable — requestUpdate is blocked
upstream」**刪掉** —— 它們描述的狀況已經不存在。

- [ ] **Step 6: 刪掉 legacy 實作**

`src/core/service/RoadCoverageFlood.ts`：刪掉 `roadDistanceToTargetsLegacy` 與
它專用的字串版 `MinHeap`（若沒有其他使用者）。
同時刪掉 `src/core/road/__tests__/RoadDistanceParity.test.ts` —— 對照對象已經
不存在。`WorkerGraphParity.test.ts` 接手守護同一個約束。

- [ ] **Step 7: 跑完整測試套件**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全綠。

- [ ] **Step 8: 回退驗證**

把 `SimulationLoop` 的 `canUseWpCache` 判斷加回去（改成永遠 false，模擬閘門
仍在），跑一次遊戲層級的測試。
Expected: 行為回到 fallback。**這一步沒有測試會轉紅**（fallback 本來就是合法
路徑）—— 所以改用實機驗收（Step 9）。

- [ ] **Step 9: 實機驗收**

```bash
npx vite --host 127.0.0.1 --port 5180 --strictPort
```

載入 `C:\Users\weiwe\Downloads\測試.webcity (1).json`，在 console 執行：

```js
const g = window.__game;
g.state.clock.setSpeed(5);
await new Promise(r => setTimeout(r, 5000));
({ ready: g.simLoop.wpDistCache.isReady, status: g.simLoop.wpDistCache.getStatus() })
```

Expected: `ready: true`。接著逐 tick 計時，`runJobRelocation` 的成本應接近 0
（查表是 O(1)）。

- [ ] **Step 10: 更新文件並 Commit**

在 `BUGS.md` 把 BUG-109 標記為已治本，記錄實機數字；在 `TODO.md` 勾掉
「BUG-109 治本」那一項。

```bash
npx tsc --noEmit && npx vitest run && npx vite build
git add -A
git commit -m "perf(sim): workplace 距離改走路網圖，高架不再停用快取（BUG-109 治本）"
```

---

## Self-Review 結果

**Spec 覆蓋:**

| Spec 章節 | 對應 Task |
|---|---|
| §5.1 `RoadCellGraph` | Task 1 |
| §5.2 `floodRoadCellGraph` + 三個不變式 | Task 2（不變式各有一條測試） |
| §5.3 `attachBuildingCells` | Task 3 |
| §5.4 `seedNodesFor` | Task 3 |
| §5.5 序列化 + 版本欄位 | Task 5 |
| §5.6 修改清單 | Task 4（RoadCoverageFlood）、Task 6（其餘） |
| §7 錯誤處理：版本不符 | Task 5 Step 1 第三條測試 |
| §7 錯誤處理：worker 例外 | Task 6 Step 3 的 try/catch |
| §7 錯誤處理：座標超過 Uint16 | Task 1 Step 3 的 `RangeError` |
| §7 錯誤處理：圖是空的 | Task 4 Step 4（`seeds.length === 0` 提前回傳） |
| §9 測試策略八條 | Task 1–6 分散覆蓋 |
| §11 三階段 | Task 1–3（階段 1）、Task 4（階段 2）、Task 5–6（階段 3） |

**已知的兩個風險點（都在計畫裡明講，不是留白）:**

1. Task 3 的「should only record a cell once」期望值依賴 reach 的實際涵蓋範圍，
   Step 1 的註記說明了對照方式。
2. Task 6 的反向 flood 對稱性 —— `roadTileCost` 只看目的地那格，所以 A→B 與
   B→A 的單邊成本不同。Step 1 的註記給了兩個處置方向與「記入 BUGS.md」的要求。
   **這是本計畫最可能真正卡住的地方**，實作者遇到時不要硬改測試。
