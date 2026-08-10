# Workplace 距離改走路網圖 —— 實作計畫（第 2 版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一張格子層的路網圖,讓 workplace 距離的同步與非同步兩條路共用同一個
flood 核心,消除「有高架就停用快取」的限制（BUG-109 治本）。

**Architecture:** `UnifiedRoadLookup` 是樓層與匝道規則的唯一來源。建圖時把規則
消化成「節點 + 邊」。同步查詢在**正向圖**上跑，worker 在**轉置圖**上跑 ——
因為成本加在目的地那一格，反向擴散必須讓權重跟著邊走。兩者呼叫同一個
`floodRoadCellGraph`。

**Tech Stack:** TypeScript、Vitest、Web Worker、CSR（壓縮稀疏列）typed array。

**Spec:** `docs/superpowers/specs/2026-08-10-workplace-distance-graph-design.md`

## 第 2 版改了什麼（Codex 審核的結果，逐項驗證過）

| 發現 | 處置 |
|---|---|
| 成本存 `Float32Array`、heap 拿 double → `cost[n] < cur.cost` 誤判成過期，flood 靜默停止（實測第 5 步就發生） | **全面改用 `Float64Array`**，序列化也用 Float64 |
| Task 1 的 `toBeCloseTo(..., 9)` 在 Float32 下永遠紅（差 7.9e-8） | 改 Float64 後可用 `toBe` 精確相等 |
| Task 3「cheapest road」期望值算錯：(0,1)→(2,2) 的 Chebyshev 是 2，在 reach 內，成本應為 0 | 重新設計 fixture，讓「最便宜 vs 最先碰到」真的可分辨 |
| Task 3「at any level」用空的 `ElevationManager` → 空轉 | fixture 加高架與匝道 |
| Task 2 的 `onSettle` 回退驗證空轉（等成本直線，relax 順序本來就遞增） | 改用混合路型的分岔 fixture |
| Task 2「prefer a cheaper road」沒有建立替代路徑 | 重寫成真的兩條候選路徑 |
| 現行 worker 反向擴散付錯端點的成本（既有 bug） | 新增**轉置圖**（Task 4），並記為 BUG-237 |
| 舊版找齊目標會提早結束，新版永遠跑滿預算 | 附掛改成 settle 當下逐節點，同步路徑恢復早退 |
| 既有測試會編不過（`reverseFloodFromWorkplace` / `computeAllDistances` 的 import、`requestUpdate` 五參數） | Task 8 明列遷移 |
| 新 worker handler 裸寫 `self.onmessage`，測試環境 `ReferenceError` | 保留 `typeof self !== 'undefined'` 防護 |
| `this._roadLookup!` 的非空斷言沒有執行期保護 | 改成明確的 null 檢查並提前返回 |
| 空圖時 `requestUpdate` 應回 false，計畫沒實作 | Task 8 加入 |
| spec §3 不用 LaneGraph 的理由不完整 | spec 已改：真正的理由是拓撲（`roadFlags`）與 buffer 缺 `viaCellKey` |

## Global Constraints

- `src/core/` **禁止 import Three.js**。
- **TDD 強制**:先寫紅燈測試 → 跑到紅 → 實作 → 跑到綠 → **還原修正確認轉紅**。
  回退驗證若沒轉紅，**那是測試的問題,不是可以略過的步驟**。
- 成本模型不變:`roadTileCost = 100 / (speedLimit × lanes/2)`（`RoadCoverageFlood.ts:32`）。
- **一律用 double（`Float64Array`）**。舊實作用 JS number，而硬約束是逐格精確相等。
- `ZONE_ROAD_REACH = 2`（`src/core/grid/constants.ts:18`）。
- 格子 key:地面 `"x,y"`，高架 `"x,y,level"`（level 1–3）。
- 發現 Bug 必須寫入 `BUGS.md` 與 `TODO.md`。
- 每個 Task 結束時工作區乾淨、`npx tsc --noEmit` 0 錯、`npx vitest run` 全綠。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/core/road/RoadCellGraph.ts`（新） | 圖的型別、建圖、轉置、flood 核心、種子、附掛 |
| `src/core/road/RoadCellGraphBuffer.ts`（新） | 圖 ↔ ArrayBuffer。只有格式，沒有演算法 |
| `src/core/service/RoadCoverageFlood.ts`（改） | `roadDistanceToTargets` 改用核心；舊實作暫留 `roadDistanceToTargetsLegacy` |
| `src/workers/workplace-distance.worker.ts`（改） | 刪自己的 MinHeap 與 flood，改用核心 + 轉置圖 |
| `src/core/workplace/WorkplaceDistanceTypes.ts`（改） | 請求加 `graphBuffer` |
| `src/core/workplace/WorkplaceDistanceClient.ts`（改） | `compute()` 加 `graphBuffer` |
| `src/core/workplace/WorkplaceDistanceCache.ts`（改） | `requestUpdate()` 加 `graphBuffer`；空圖回 false |
| `src/core/simulation/SimulationLoop.ts`（改） | 刪 `hasAnyElevatedRoad()` 閘門；建圖、轉置、序列化 |

---

## 共用測試素材（Task 1–8 都用）

**每個測試檔各自複製這一段。** 不抽成共用檔:測試的 fixture 一旦共用，改動
一個測試的需求就會牽動其他測試，而那正是測試最不該有的耦合。

```ts
import { RoadType, RoadDirection } from '../types';           // 路徑依測試檔位置調整
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';

const EW = RoadDirection.EAST | RoadDirection.WEST;
const NS = RoadDirection.NORTH | RoadDirection.SOUTH;

/**
 * 混合路型 + 高架 + 匝道的測試城市。
 *
 *   y=1   x 0..11  雙線道主幹
 *   y=3   x 2..8   鄉道支線（貴 1.67 倍）
 *   x=2   y=2      鄉道，連接主幹與支線
 *   level 1, y=1, x 4..9  高速高架，x=4 與 x=9 是匝道
 *
 * 建築在其餘的格子上。路型混合是必要的 —— 全部同路型時正向與反向剛好相等，
 * 而那正好會讓反向對稱性的 bug 測不出來（BUG-237 就是這樣漏掉的）。
 */
function testCity() {
  const w = 12, h = 6;
  const cells = new Map<string, { roadType: number; roadFlags: number }>();
  for (let x = 0; x < w; x++) cells.set(`${x},1`, { roadType: RoadType.TWO_LANE, roadFlags: EW });
  for (let x = 2; x <= 8; x++) cells.set(`${x},3`, { roadType: RoadType.RURAL, roadFlags: EW });
  cells.set('2,2', { roadType: RoadType.RURAL, roadFlags: NS });

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
    em.set(x, 1, 1, {
      roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0,
      isRamp: x === 4 || x === 9,
      rampAscendDirection: x === 4 ? RoadDirection.EAST : RoadDirection.WEST,
    });
  }
  return { grid, lookup: new UnifiedRoadLookup(grid, em) };
}

/** 所有非道路格 —— 潛在的家與工作。 */
function buildingCells(grid: { width: number; height: number; getCell(x: number, y: number): { roadType: number } | null }) {
  const out: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.getCell(x, y)!.roadType === RoadType.NONE) out.push(`${x},${y}`);
    }
  }
  return out;
}
```

---

## Task 1: 建圖

**Files:**
- Create: `src/core/road/RoadCellGraph.ts`
- Test: `src/core/road/__tests__/RoadCellGraph.test.ts`

**Interfaces:**
- Consumes: `UnifiedRoadLookup.getAllCellKeys(): string[]`、
  `.getCompatibleNeighborKeys(sourceKey: string, nx: number, ny: number): string[]`、
  `.getCellByKey(key: string): { roadType: number; roadFlags: number } | null`；
  `roadTileCost(roadType: number): number`（`src/core/service/RoadCoverageFlood.ts`，已 export）
- Produces: `RoadCellGraph`、`buildRoadCellGraph(lookup): RoadCellGraph`

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraph.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import { buildRoadCellGraph } from '../RoadCellGraph';
import { roadTileCost } from '../../service/RoadCoverageFlood';

/** 節點 from → to 的邊權重；不相連回傳 undefined。 */
function edgeWeight(g: ReturnType<typeof buildRoadCellGraph>, fromKey: string, toKey: string) {
  const i = g.indexOf.get(fromKey), j = g.indexOf.get(toKey);
  if (i === undefined || j === undefined) return undefined;
  for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
    if (g.targets[k] === j) return g.weights[k]!;
  }
  return undefined;
}

describe('buildRoadCellGraph', () => {
  it('should contain exactly the cells the lookup reports', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect([...g.nodeKeys].sort()).toEqual(lookup.getAllCellKeys().sort());
  });

  it('should charge the destination tile exactly, in full double precision', () => {
    // 用 toBe 而不是 toBeCloseTo：硬約束是與舊實作「逐格精確相等」，而舊版
    // 用的是 JS number。Float32 會差 7.9e-8，那不只是精度問題 —— 它會讓
    // flood 的 stale 判斷誤判（見 Task 2）。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    // (1,1) 雙線道 → (2,1) 雙線道
    expect(edgeWeight(g, '1,1', '2,1')).toBe(roadTileCost(RoadType.TWO_LANE));
    // (2,1) 雙線道 → (2,2) 鄉道：付鄉道的價，不是雙線道的
    expect(edgeWeight(g, '2,1', '2,2')).toBe(roadTileCost(RoadType.RURAL));
    // 反方向：(2,2) 鄉道 → (2,1) 雙線道，付雙線道的價
    expect(edgeWeight(g, '2,2', '2,1')).toBe(roadTileCost(RoadType.TWO_LANE));
  });

  it('should connect ground to the viaduct only through a ramp', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    // x=4 是匝道 → 地面與高架相連
    expect(edgeWeight(g, '4,1', '4,1,1'), '匝道沒有把地面接上高架').toBeDefined();
    // x=6 不是匝道 → 不得相連
    expect(edgeWeight(g, '6,1', '6,1,1'), '沒有匝道卻連上了高架').toBeUndefined();
    expect(edgeWeight(g, '6,1,1', '6,1'), '沒有匝道卻能從高架下來').toBeUndefined();
  });

  it('should keep CSR structurally consistent', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(g.indexOf.size).toBe(g.nodeKeys.length);
    for (let i = 0; i < g.nodeKeys.length; i++) {
      expect(g.indexOf.get(g.nodeKeys[i]!)).toBe(i);
    }
    expect(g.offsets.length).toBe(g.nodeKeys.length + 1);
    expect(g.offsets[g.nodeKeys.length]).toBe(g.targets.length);
    expect(g.weights.length).toBe(g.targets.length);
    expect(g.weights).toBeInstanceOf(Float64Array);
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
 * CSR：節點 i 的鄰接是 targets[offsets[i] .. offsets[i+1])。
 *
 * **所有成本都是 double。** 舊實作用 JS number，而硬約束是逐格精確相等；
 * 更關鍵的是 Float32 會讓 flood 的 stale 判斷誤判（見 `floodRoadCellGraph`）。
 */
export interface RoadCellGraph {
  readonly nodeKeys: readonly string[];
  readonly indexOf: ReadonlyMap<string, number>;
  /** 長度 n+1。 */
  readonly offsets: Uint32Array;
  readonly targets: Uint32Array;
  /** 走進 targets[j] 那一格要付的成本。 */
  readonly weights: Float64Array;
  readonly nodeX: Uint16Array;
  readonly nodeY: Uint16Array;
  /** 0 = 地面，1–3 = 高架。 */
  readonly nodeLevel: Uint8Array;
}

/** 從 key 取樓層。地面沒有第三段。 */
function levelOf(key: string): number {
  const i = key.indexOf(',', key.indexOf(',') + 1);
  return i < 0 ? 0 : Number(key.slice(i + 1));
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
    if (x > 0xffff || y > 0xffff) throw new RangeError(`格子座標超過 Uint16 上限: ${key}`);
    nodeX[i] = x; nodeY[i] = y; nodeLevel[i] = levelOf(key);
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
    weights: Float64Array.from(weightList),
    nodeX, nodeY, nodeLevel,
  };
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraph.test.ts`
Expected: PASS（4 條）

- [ ] **Step 5: 回退驗證（兩次）**

**(a)** 把 `roadTileCost(info.roadType)` 改成
`roadTileCost(lookup.getCellByKey(key)!.roadType)`（改算來源那格）。
Expected: 「should charge the destination tile exactly」轉紅。改回。

**(b)** 把 `Float64Array.from(weightList)` 改成 `Float32Array.from(weightList)`
（型別宣告一併改）。
Expected: 「should charge the destination tile exactly」與
「should keep CSR structurally consistent」都轉紅。改回。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraph.ts src/core/road/__tests__/RoadCellGraph.test.ts
git commit -m "feat(road): 路網的格子層圖 —— 規則在建圖時消化，成本全程 double"
```

---

## Task 2: flood 核心

**Files:**
- Modify: `src/core/road/RoadCellGraph.ts`
- Test: `src/core/road/__tests__/RoadCellGraphFlood.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces: `floodRoadCellGraph(graph, seedNodes: readonly number[], maxBudget: number, onSettle?: (node: number, cost: number) => boolean): Float64Array`
  （未到達為 `-1`；`onSettle` 回 true 表示提早結束）

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphFlood.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import { buildRoadCellGraph, floodRoadCellGraph } from '../RoadCellGraph';
import { roadTileCost } from '../../service/RoadCoverageFlood';

const TWO = roadTileCost(RoadType.TWO_LANE);   // 100/(50*1) = 2
const RUR = roadTileCost(RoadType.RURAL);      // 100/(30*1) = 3.333…

describe('floodRoadCellGraph', () => {
  it('should accumulate the destination tile cost along the way', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const cost = floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1e9);
    expect(cost[g.indexOf.get('0,1')!]).toBe(0);
    expect(cost[g.indexOf.get('3,1')!]).toBe(TWO * 3);
  });

  it('should not stall on floating point rounding', () => {
    // 這一條擋的是「把成本存進 Float32Array、heap 卻拿著未捨入的 double」。
    // 鄉道成本 100/30 無法用二進位精確表示，走到第 5 格時 Float32 的儲存值
    // 會小於 heap 值，stale 判斷 `cost[n] < cur.cost` 因此成立，那個節點
    // 永遠不展開 —— flood 就地靜默停止（實測第 5 步發生）。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    // 沿鄉道支線走滿 7 格（x 2..8）
    const cost = floodRoadCellGraph(g, [g.indexOf.get('2,3')!], 1e9);
    expect(cost[g.indexOf.get('8,3')!], '鄉道走到底斷了').toBeGreaterThan(0);
    expect(cost[g.indexOf.get('8,3')!]).toBe(RUR * 6);
  });

  it('should leave unreached nodes at -1', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const cost = floodRoadCellGraph(g, [g.indexOf.get('0,1')!], TWO * 2);
    expect(cost[g.indexOf.get('2,1')!]).toBe(TWO * 2);
    expect(cost[g.indexOf.get('5,1')!], '超過預算的節點應該是 -1').toBe(-1);
  });

  it('should settle in strictly increasing cost order across a branch', () => {
    // BUG-102 的守門。fixture 必須有**分岔且路型不同**的路徑，否則 relax
    // 順序本來就等於 settle 順序，把 onSettle 搬到 relax 也不會轉紅。
    // testCity 從 (2,1) 出發有兩條：沿雙線道主幹（每格 2.0）與經 (2,2) 下到
    // 鄉道支線（每格 3.33）。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const seen: number[] = [];
    floodRoadCellGraph(g, [g.indexOf.get('2,1')!], 1e9, (_n, c) => { seen.push(c); return false; });
    const sorted = [...seen].sort((a, b) => a - b);
    expect(seen, 'settle 不是依成本遞增').toEqual(sorted);
    expect(seen.length, '只 settle 了種子，這條測試等於沒測').toBeGreaterThan(5);
  });

  it('should reach a node by its cheapest route, not the first one found', () => {
    // (5,3) 在鄉道支線上。兩條路徑：
    //   A：沿主幹到 (5,1) 再往下 —— 但 (5,2) 不是路，走不通
    //   B：(2,1) → (2,2) → (2,3) → 沿支線東行
    // 真正的分岔在 (2,3) 之後只有一條，所以改用兩個種子來製造競爭：
    // 從 (0,1) 與 (8,3) 同時出發，(5,3) 應取兩者中較便宜的。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const viaWest = floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1e9)[g.indexOf.get('5,3')!]!;
    const viaEast = floodRoadCellGraph(g, [g.indexOf.get('8,3')!], 1e9)[g.indexOf.get('5,3')!]!;
    const both = floodRoadCellGraph(g, [g.indexOf.get('0,1')!, g.indexOf.get('8,3')!], 1e9)[g.indexOf.get('5,3')!]!;
    expect(viaWest).not.toBe(viaEast);            // 兩條路真的不同價，否則測不出東西
    expect(both).toBe(Math.min(viaWest, viaEast));
  });

  it('should stop early when onSettle asks it to', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    let count = 0;
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1e9, () => { count++; return count >= 3; });
    expect(count).toBe(3);
  });
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphFlood.test.ts`
Expected: FAIL，`floodRoadCellGraph is not a function`

- [ ] **Step 3: 實作**

在 `src/core/road/RoadCellGraph.ts` 檔尾加上：

```ts
/** 二元堆。節點是整數索引，成本是 double。 */
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
 * 4. **成本全程 double。** `cost` 是 `Float64Array`，與推進 heap 的值**位元相同**。
 *    用 `Float32Array` 的話儲存值會被捨入到比 heap 值小，stale 判斷
 *    `cost[node] < cur.cost` 就會誤判成過期，那個節點永遠不展開，flood 靜默
 *    停止 —— 鄉道（100/30）走到第 5 格就會發生。
 *
 * `onSettle` 回傳 true 表示提早結束（同步查詢找齊目標之後就不必再走）。
 */
export function floodRoadCellGraph(
  graph: RoadCellGraph,
  seedNodes: readonly number[],
  maxBudget: number,
  onSettle?: (node: number, cost: number) => boolean,
): Float64Array {
  const n = graph.nodeKeys.length;
  const cost = new Float64Array(n).fill(-1);
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
Expected: PASS（6 條）

- [ ] **Step 5: 回退驗證（三次）**

**(a)** 把 `const cost = new Float64Array(n)` 改成 `new Float32Array(n)`。
Expected: 「should not stall on floating point rounding」轉紅。改回。

**(b)** 把 `if (onSettle && onSettle(...)) return cost;` 從 pop 之後搬到 relax
迴圈裡（`cost[next] = nc;` 之後呼叫 `onSettle(next, nc)`）。
Expected: 「should settle in strictly increasing cost order across a branch」轉紅。改回。

**(c)** 把 `if (nc > maxBudget) continue;` 拿掉。
Expected: 「should leave unreached nodes at -1」轉紅。改回。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraph.ts src/core/road/__tests__/RoadCellGraphFlood.test.ts
git commit -m "feat(road): 圖上的 flood 核心 —— 成本全程 double，避免 stale 誤判"
```

---

## Task 3: 種子與附掛

**Files:**
- Modify: `src/core/road/RoadCellGraph.ts`
- Test: `src/core/road/__tests__/RoadCellGraphAttach.test.ts`

**Interfaces:**
- Consumes: Task 1–2
- Produces:
  - `seedNodesFor(graph, x: number, y: number, reach: number): number[]`
  - `attachAtSettledNode(graph, node: number, cost: number, reach: number, accept: (x: number, y: number) => boolean, out: Map<string, number>): void`

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphAttach.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import {
  buildRoadCellGraph, floodRoadCellGraph, seedNodesFor, attachAtSettledNode,
} from '../RoadCellGraph';
import { roadTileCost } from '../../service/RoadCoverageFlood';
import { ZONE_ROAD_REACH } from '../../grid/constants';

describe('seedNodesFor', () => {
  it('should pick up elevated road cells, not just the ground', () => {
    // 這一條的第一版用空的 ElevationManager，所以「涵蓋所有樓層」是空轉的 ——
    // 完全不處理高架的實作也會通過。fixture 必須真的有高架。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const keys = seedNodesFor(g, 6, 0, ZONE_ROAD_REACH).map(i => g.nodeKeys[i]!);
    expect(keys, '沒有撿到高架的路格').toContain('6,1,1');
    expect(keys, '沒有撿到地面的路格').toContain('6,1');
  });

  it('should return nothing when no road is in reach', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(seedNodesFor(g, 11, 5, ZONE_ROAD_REACH)).toEqual([]);
  });
});

describe('attachAtSettledNode', () => {
  /** 跑一次 flood，並在 settle 當下附掛。 */
  function floodAndAttach(startKey: string, accept: (x: number, y: number) => boolean) {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const out = new Map<string, number>();
    floodRoadCellGraph(g, [g.indexOf.get(startKey)!], 1e9, (node, cost) => {
      attachAtSettledNode(g, node, cost, ZONE_ROAD_REACH, accept, out);
      return false;
    });
    return out;
  }

  it('should record a building once, at its cheapest road', () => {
    // (5,5) 只有鄉道支線 (5,3) 在 reach 2 內（Chebyshev = 2）。
    // 從 (0,1) 出發，到 (5,3) 的成本必須是走主幹再下支線的那條，
    // 而不是任何「先碰到」的值。
    const out = floodAndAttach('0,1', (x, y) => x === 5 && y === 5);
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const cost = floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 1e9);
    expect(out.get('5,5')).toBe(cost[g.indexOf.get('5,3')!]);
  });

  it('should attach the road cell itself when it is a target', () => {
    // 舊實作有一段「道路格本身也可能是目標」。dx/dy 包含 (0,0) 就涵蓋了，
    // 但那是實作細節 —— 這一條把它釘成契約。
    const out = floodAndAttach('0,1', (x, y) => x === 3 && y === 1);
    expect(out.get('3,1'), '道路格自己沒有被收').toBe(roadTileCost(RoadType.TWO_LANE) * 3);
  });

  it('should ignore cells the accept predicate rejects', () => {
    expect(floodAndAttach('0,1', () => false).size).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphAttach.test.ts`
Expected: FAIL，`seedNodesFor is not a function`

- [ ] **Step 3: 實作**

在 `src/core/road/RoadCellGraph.ts` 檔尾加上（`toPosKey` 加進頂部的 import）：

```ts
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
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphAttach.test.ts`
Expected: PASS（5 條）

- [ ] **Step 5: 回退驗證（兩次）**

**(a)** 把 `seedNodesFor` 的內層樓層迴圈改成只看 `lv = 0`。
Expected: 「should pick up elevated road cells」轉紅。改回。

**(b)** 把 `attachAtSettledNode` 的 `if (out.has(key)) continue;` 拿掉（永遠覆寫）。
Expected: 「should record a building once, at its cheapest road」轉紅
（覆寫成較貴的後續值）。改回。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraph.ts src/core/road/__tests__/RoadCellGraphAttach.test.ts
git commit -m "feat(road): 種子與附掛 —— settle 當下逐節點，保住早退與最便宜語意"
```

---

## Task 4: 轉置圖（修掉 BUG-237）

**Files:**
- Modify: `src/core/road/RoadCellGraph.ts`
- Test: `src/core/road/__tests__/RoadCellGraphTranspose.test.ts`
- Modify: `BUGS.md`（記 BUG-237）

**Interfaces:**
- Consumes: Task 1–3
- Produces: `transposeRoadCellGraph(graph: RoadCellGraph): RoadCellGraph`

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphTranspose.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import {
  buildRoadCellGraph, transposeRoadCellGraph, floodRoadCellGraph,
} from '../RoadCellGraph';

/**
 * 成本加在**目的地**那一格，所以正向邊 A→B 的價格是 cost(B)。
 * 反向擴散必須讓權重跟著邊走 —— 直接在正向圖上從 B 往外走會付成 cost(A)。
 *
 * 現行的 `reverseFloodFromWorkplace` 就是後者（BUG-237）。既有測試沒抓到，
 * 因為它們只用單一路型 —— 全部一樣貴時正反向剛好相等。
 */
describe('transposeRoadCellGraph', () => {
  it('should keep the weight with the edge, not with the endpoint', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const t = transposeRoadCellGraph(g);

    const edge = (gr: typeof g, a: string, b: string) => {
      const i = gr.indexOf.get(a)!, j = gr.indexOf.get(b)!;
      for (let k = gr.offsets[i]!; k < gr.offsets[i + 1]!; k++) {
        if (gr.targets[k] === j) return gr.weights[k]!;
      }
      return undefined;
    };

    // 正向 (2,1)→(2,2) 付鄉道；轉置後 (2,2)→(2,1) 應該**還是**付鄉道
    const forward = edge(g, '2,1', '2,2')!;
    expect(edge(t, '2,2', '2,1'), '轉置後權重跑掉了').toBe(forward);
  });

  it('should give the same cost as a forward flood, for every pair', () => {
    // 這是轉置存在的唯一理由：在轉置圖上從工作往外跑一次，等於對每一個家
    // 各跑一次正向 flood。路型混合時才測得出來。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const t = transposeRoadCellGraph(g);
    const target = g.indexOf.get('8,3')!;              // 當成「工作」的路格

    const reverse = floodRoadCellGraph(t, [target], 1e9);
    for (let home = 0; home < g.nodeKeys.length; home++) {
      const forward = floodRoadCellGraph(g, [home], 1e9)[target]!;
      expect(reverse[home]!, `${g.nodeKeys[home]} → 8,3 的成本不一致`).toBe(forward);
    }
  });

  it('should preserve node identity and CSR shape', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const t = transposeRoadCellGraph(g);
    expect(t.nodeKeys).toEqual(g.nodeKeys);
    expect(t.targets.length).toBe(g.targets.length);
    expect(t.offsets.length).toBe(g.offsets.length);
    expect([...t.nodeX]).toEqual([...g.nodeX]);
  });
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphTranspose.test.ts`
Expected: FAIL，`transposeRoadCellGraph is not a function`

- [ ] **Step 3: 實作**

在 `src/core/road/RoadCellGraph.ts` 檔尾加上：

```ts
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
  const weights = new Float64Array(e);

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
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphTranspose.test.ts`
Expected: PASS（3 條）

- [ ] **Step 5: 回退驗證**

把 `weights[at] = graph.weights[j]!;` 改成
`weights[at] = graph.weights[graph.offsets[dst]!]!;`（改成取端點的第一條邊，
模擬「權重跟著端點走」）。
Expected: 「should keep the weight with the edge」與
「should give the same cost as a forward flood」都轉紅。改回。

- [ ] **Step 6: 記 BUG-237**

在 `BUGS.md` 末尾加上：

```markdown
## BUG-237 已修：反向 flood 付錯端點的成本

| ID | 位置 | 問題 | 嚴重度 |
|---|---|---|---|
| BUG-237 | workplace-distance.worker.ts:88-129 | 從工作地點反向擴散時付 `roadTileCost(鄰居)`，也就是來源那格的價格，而正向是付目的地那格 | Medium |

**發現方式：** 送 Codex 審核 BUG-109 的實作計畫時，它比對了同步與非同步兩條
路徑，指出現行 worker 的反向擴散與同步版本不一致。

成本加在**目的地**那一格（`RoadCoverageFlood.ts:558`）。正向邊 A→B 的價格是
`cost(B)`；反向 Dijkstra 從 B 走回 A 應該仍用 `cost(B)`，但現行 worker 用的是
`cost(A)`：

```ts
const rt = getRoadType(nx, ny);            // 鄰居 = 反向的下一格 = 正向的來源
const newCost = cur.cost + roadTileCost(rt);
```

**既有測試為什麼沒抓到：** 它們只用單一路型（`WorkplaceDistanceWorker.test.ts:32-72`）。
所有格子一樣貴時，正向與反向剛好相等。路型混合的城市（高速 0.5、鄉道 3.33，
差 6.7 倍）就會給出不同的通勤成本，而那個成本直接餵進 `scoreWorkplaceWithCost`。

**修法：** 引入 `transposeRoadCellGraph` —— 每條邊 `(i→j, w)` 變成 `(j→i, w)`，
權重跟著邊走。worker 在轉置圖上跑，得到的正是每個家沿正向走到該工作的成本。
```

在 `TODO.md` 的效能段落加一行：
`- [x] BUG-237：反向 flood 付錯端點的成本（隨 BUG-109 治本一併修）`

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/core/road/RoadCellGraph.ts src/core/road/__tests__/RoadCellGraphTranspose.test.ts BUGS.md TODO.md
git commit -m "fix(road): 轉置圖 —— 反向 flood 付錯端點成本（BUG-237）"
```

---

## Task 5: 同步查詢改用核心（對照舊實作逐格驗證）

**Files:**
- Modify: `src/core/service/RoadCoverageFlood.ts`
- Test: `src/core/road/__tests__/RoadDistanceParity.test.ts`

**Interfaces:**
- Consumes: Task 1–3
- Produces: `roadDistanceToTargets` 簽章**完全不變**；
  新增 `export function roadDistanceToTargetsLegacy(...)`（同簽章，Task 8 刪除）

- [ ] **Step 1: 把舊實作改名並匯出**

在 `src/core/service/RoadCoverageFlood.ts:430`，把
`export function roadDistanceToTargets(` 改名為
`export function roadDistanceToTargetsLegacy(`，**內容一字不動**，並在上方加：

```ts
/**
 * 改用路網圖之前的實作。**只留給差異測試對照用** —— 它是唯一能證明重構沒有
 * 改變行為的東西。Task 8 結束後刪除。
 */
```

- [ ] **Step 2: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadDistanceParity.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import { roadDistanceToTargets, roadDistanceToTargetsLegacy } from '../../service/RoadCoverageFlood';

/**
 * 重構的唯一證明。
 *
 * 新實作走圖，舊實作直接掃格子。同一個世界、同一組查詢，兩者必須**逐格精確
 * 相等** —— 用 toBe，不是 toBeCloseTo。那個成本會直接餵進
 * scoreWorkplaceWithCost，差一點點就是不同的選擇。
 *
 * 城市有高架與匝道，路型混合。
 */
describe('roadDistanceToTargets parity with the legacy implementation', () => {
  it('should match the legacy result for every home, exactly', () => {
    const { grid, lookup } = testCity();
    const cells = buildingCells(grid);
    const targets = new Set(cells);

    for (const homeKey of cells) {
      const [hx, hy] = homeKey.split(',').map(Number);
      const home = { x: hx!, y: hy! };
      const a = roadDistanceToTargets(grid, home, targets, 60, lookup);
      const b = roadDistanceToTargetsLegacy(grid, home, targets, 60, lookup);

      expect([...a.keys()].sort(), `家 ${homeKey}：到得了的目標集合不同`)
        .toEqual([...b.keys()].sort());
      for (const [k, v] of b) {
        expect(a.get(k), `家 ${homeKey} → ${k}：成本不同`).toBe(v);
      }
    }
  });

  it('should agree at every budget', () => {
    const { grid, lookup } = testCity();
    const targets = new Set(buildingCells(grid));
    const home = { x: 0, y: 0 };
    for (const budget of [1, 5, 20, 60, 1000]) {
      const a = roadDistanceToTargets(grid, home, targets, budget, lookup);
      const b = roadDistanceToTargetsLegacy(grid, home, targets, budget, lookup);
      expect([...a.keys()].sort(), `預算 ${budget}`).toEqual([...b.keys()].sort());
    }
  });

  it('should fall back to the legacy path when there is no lookup', () => {
    // 沒有 lookup 就沒有樓層資訊，建不出圖。
    const { grid } = testCity();
    const targets = new Set(buildingCells(grid));
    const home = { x: 0, y: 0 };
    expect(roadDistanceToTargets(grid, home, targets, 60, null))
      .toEqual(roadDistanceToTargetsLegacy(grid, home, targets, 60, null));
  });
});
```

- [ ] **Step 3: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadDistanceParity.test.ts`
Expected: FAIL，`roadDistanceToTargets is not a function`

- [ ] **Step 4: 實作新版**

在 `src/core/service/RoadCoverageFlood.ts` 加上：

```ts
import {
  buildRoadCellGraph, floodRoadCellGraph, seedNodesFor, attachAtSettledNode,
} from '../road/RoadCellGraph';

/**
 * 家 → 一組目標的道路距離。
 *
 * 走 `RoadCellGraph`，與 workplace-distance worker **同一個 flood 核心** ——
 * 兩條路不可能給出不同的決策（BUG-109）。舊的逐格實作保留為
 * `roadDistanceToTargetsLegacy`，只給差異測試對照用。
 *
 * 找齊目標就提早結束 —— 舊實作有這個早退，少了它同步路徑會永遠跑滿預算。
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

  floodRoadCellGraph(graph, seeds, maxBudget, (node, cost) => {
    attachAtSettledNode(graph, node, cost, ZONE_ROAD_REACH,
      (x, y) => targets.has(toPosKey(x, y)), result);
    return result.size >= targets.size;   // 找齊就停
  });
  return result;
}
```

- [ ] **Step 5: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadDistanceParity.test.ts`
Expected: PASS（3 條）

**若不相等,不要改測試去遷就實作。** 逐項比對:種子範圍、附掛 reach、
預算截斷的比較方向（`>` vs `>=`）、`(0,0)` 有沒有被涵蓋。

- [ ] **Step 6: 跑完整測試套件**

Run: `npx vitest run`
Expected: 全綠。`JobRelocation.test.ts` 與 SimulationLoop 的相關測試都會經過
新的 `roadDistanceToTargets`。

- [ ] **Step 7: 回退驗證**

把 `return result.size >= targets.size;` 改成 `return false;`（拿掉早退）。
Expected: **不會轉紅** —— 早退只影響效能，不影響結果。這是預期的;
早退的正確性由「should match the legacy result」的**結果相等**保證，
效能行為不寫測試（那會是脆弱的計時測試）。改回。

改測 stale 那一條:把 `attachAtSettledNode` 的呼叫從 `onSettle` 內搬到
flood 之後（用回傳的 cost 陣列逐節點附掛，順序改成節點索引順序）。
Expected: 「should match the legacy result」轉紅（附掛順序不再是成本遞增）。改回。

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/core/service/RoadCoverageFlood.ts src/core/road/__tests__/RoadDistanceParity.test.ts
git commit -m "refactor(road): 同步的距離查詢改走路網圖，對照舊實作逐格驗證"
```

---

## Task 6: 序列化

**Files:**
- Create: `src/core/road/RoadCellGraphBuffer.ts`
- Test: `src/core/road/__tests__/RoadCellGraphBuffer.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces: `GRAPH_BUFFER_VERSION = 1`、
  `serializeRoadCellGraph(graph): ArrayBuffer`、
  `deserializeRoadCellGraph(buffer): RoadCellGraph`（版本不符丟 `Error`）

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphBuffer.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import { buildRoadCellGraph } from '../RoadCellGraph';
import {
  serializeRoadCellGraph, deserializeRoadCellGraph, GRAPH_BUFFER_VERSION,
} from '../RoadCellGraphBuffer';

describe('RoadCellGraph serialization', () => {
  it('should round-trip every field bit-for-bit', () => {
    // 位元組佈局錯位不會報錯 —— 它會把 Uint32 當 Float64 讀出一堆看似合理的
    // 距離。所以每個欄位都要比，而且成本要精確相等。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const back = deserializeRoadCellGraph(serializeRoadCellGraph(g));

    expect(back.nodeKeys).toEqual(g.nodeKeys);
    expect([...back.offsets]).toEqual([...g.offsets]);
    expect([...back.targets]).toEqual([...g.targets]);
    expect([...back.weights]).toEqual([...g.weights]);
    expect([...back.nodeX]).toEqual([...g.nodeX]);
    expect([...back.nodeY]).toEqual([...g.nodeY]);
    expect([...back.nodeLevel]).toEqual([...g.nodeLevel]);
  });

  it('should rebuild elevated keys from coordinates', () => {
    // key 字串不序列化（省 structured clone），所以反序列化端必須組得回來 ——
    // 高架的 key 有第三段。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const back = deserializeRoadCellGraph(serializeRoadCellGraph(g));
    expect(back.nodeKeys, '高架的 key 沒有帶樓層').toContain('6,1,1');
    for (let i = 0; i < back.nodeKeys.length; i++) {
      expect(back.indexOf.get(back.nodeKeys[i]!)).toBe(i);
    }
  });

  it('should refuse a buffer with the wrong version', () => {
    const { lookup } = testCity();
    const buf = serializeRoadCellGraph(buildRoadCellGraph(lookup));
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
 * 佈局（little-endian）。**`weights` 是 Float64，需要 8 byte 對齊**，
 * 所以它排在最後並把起點對齊到 8 的倍數：
 *
 *   Header 16 bytes: nodeCount u32 / edgeCount u32 / version u32 / reserved u32
 *   nodeX     Uint16[n]      （align 4）
 *   nodeY     Uint16[n]      （align 4）
 *   nodeLevel Uint8[n]       （align 4）
 *   offsets   Uint32[n+1]
 *   targets   Uint32[e]
 *   weights   Float64[e]     （起點 align 8）
 *
 * **key 字串不序列化** —— 從座標與樓層現組，省下數百個字串的 structured clone。
 */
export const GRAPH_BUFFER_VERSION = 1;

const HEADER_BYTES = 16;
const align4 = (n: number) => (n + 3) & ~3;
const align8 = (n: number) => (n + 7) & ~7;

/** 各段的起始位移。序列化與反序列化共用，避免兩邊算式漂移。 */
function layoutOf(n: number, e: number) {
  const oNodeX = HEADER_BYTES;
  const oNodeY = oNodeX + align4(n * 2);
  const oLevel = oNodeY + align4(n * 2);
  const oOffsets = oLevel + align4(n);
  const oTargets = oOffsets + (n + 1) * 4;
  const oWeights = align8(oTargets + e * 4);
  return { oNodeX, oNodeY, oLevel, oOffsets, oTargets, oWeights, total: oWeights + e * 8 };
}

export function serializeRoadCellGraph(graph: RoadCellGraph): ArrayBuffer {
  const n = graph.nodeKeys.length;
  const e = graph.targets.length;
  const L = layoutOf(n, e);

  const buf = new ArrayBuffer(L.total);
  const dv = new DataView(buf);
  dv.setUint32(0, n, true);
  dv.setUint32(4, e, true);
  dv.setUint32(8, GRAPH_BUFFER_VERSION, true);
  dv.setUint32(12, 0, true);

  new Uint16Array(buf, L.oNodeX, n).set(graph.nodeX);
  new Uint16Array(buf, L.oNodeY, n).set(graph.nodeY);
  new Uint8Array(buf, L.oLevel, n).set(graph.nodeLevel);
  new Uint32Array(buf, L.oOffsets, n + 1).set(graph.offsets);
  new Uint32Array(buf, L.oTargets, e).set(graph.targets);
  new Float64Array(buf, L.oWeights, e).set(graph.weights);
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
  const L = layoutOf(n, e);

  const nodeX = new Uint16Array(buffer, L.oNodeX, n);
  const nodeY = new Uint16Array(buffer, L.oNodeY, n);
  const nodeLevel = new Uint8Array(buffer, L.oLevel, n);

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
    offsets: new Uint32Array(buffer, L.oOffsets, n + 1),
    targets: new Uint32Array(buffer, L.oTargets, e),
    weights: new Float64Array(buffer, L.oWeights, e),
    nodeX, nodeY, nodeLevel,
  };
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphBuffer.test.ts`
Expected: PASS（3 條）

- [ ] **Step 5: 回退驗證（兩次）**

**(a)** 把 `layoutOf` 的 `align8(oTargets + e * 4)` 改成 `oTargets + e * 4`。
Expected: 節點數為奇數時 `new Float64Array(buffer, oWeights, e)` 會丟
`RangeError: start offset ... should be a multiple of 8` → round-trip 測試轉紅。
（若 testCity 的 `n`、`e` 恰好讓它對齊，把 fixture 的 `for (let x = 2; x <= 8; x++)`
改成 `x <= 7` 讓邊數變成奇數再驗。）改回。

**(b)** 把版本檢查整段拿掉。
Expected: 「should refuse a buffer with the wrong version」轉紅。改回。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraphBuffer.ts src/core/road/__tests__/RoadCellGraphBuffer.test.ts
git commit -m "feat(road): 路網圖的序列化 —— Float64 對齊，key 從座標現組"
```

---

## Task 7: worker 改用轉置圖

**Files:**
- Modify: `src/workers/workplace-distance.worker.ts`
- Modify: `src/core/workplace/WorkplaceDistanceTypes.ts`
- Test: `src/core/workplace/__tests__/WorkerGraphParity.test.ts`

**Interfaces:**
- Consumes: Task 1–6
- Produces: `reverseFloodFromGraph(graphBuffer: ArrayBuffer, wp: WorkplacePosition, maxBudget: number, isBuilding: (x: number, y: number) => boolean): Record<string, number>`
  （`graphBuffer` 必須是**轉置後**的圖）

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/workplace/__tests__/WorkerGraphParity.test.ts`，貼上共用測試素材
（import 路徑調整為 `../../road/...`），再加：

```ts
import { describe, it, expect } from 'vitest';
import { reverseFloodFromGraph } from '../../../workers/workplace-distance.worker';
import { roadDistanceToTargets } from '../../service/RoadCoverageFlood';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../../road/RoadCellGraph';
import { serializeRoadCellGraph } from '../../road/RoadCellGraphBuffer';
import { RoadType } from '../../road/types';

/**
 * 本設計的硬約束：**worker 算的必須等於同步查詢算的。**
 *
 * 兩者共用同一個 flood 核心，所以這條理應永遠綠 —— 它守的是「有人哪天為了
 * 效能在 worker 裡另外寫一份」。城市有高架、匝道，而且**路型混合** ——
 * 全部同路型時正反向剛好相等，BUG-237 就是這樣漏掉的。
 */
describe('worker result equals the synchronous query', () => {
  it('should agree on every home → workplace cost, exactly', () => {
    const { grid, lookup } = testCity();
    const transposed = serializeRoadCellGraph(transposeRoadCellGraph(buildRoadCellGraph(lookup)));
    const cells = buildingCells(grid);
    const isBuilding = (x: number, y: number) => {
      const c = grid.getCell(x, y);
      return c !== null && c.roadType === RoadType.NONE;
    };

    for (const wpKey of cells) {
      const [wx, wy] = wpKey.split(',').map(Number);
      const fromWorker = reverseFloodFromGraph(
        transposed, { pos: wpKey, x: wx!, y: wy! }, 60, isBuilding,
      );
      for (const homeKey of cells) {
        const [hx, hy] = homeKey.split(',').map(Number);
        const sync = roadDistanceToTargets(grid, { x: hx!, y: hy! }, new Set([wpKey]), 60, lookup);
        const a = fromWorker[homeKey];
        const b = sync.get(wpKey);
        if (b === undefined) {
          expect(a, `${homeKey} → ${wpKey}：同步說到不了，worker 說到得了`).toBeUndefined();
        } else {
          expect(a, `${homeKey} → ${wpKey}：成本不同`).toBe(b);
        }
      }
    }
  });

  it('should disagree if given the forward graph instead of the transpose', () => {
    // 這一條證明「用轉置圖」不是可有可無的裝飾。路型混合時，拿正向圖跑反向
    // flood 會得到不同的答案 —— 那正是 BUG-237。
    const { grid, lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const isBuilding = (x: number, y: number) => {
      const c = grid.getCell(x, y);
      return c !== null && c.roadType === RoadType.NONE;
    };
    const wp = { pos: '0,0', x: 0, y: 0 };
    const withTranspose = reverseFloodFromGraph(
      serializeRoadCellGraph(transposeRoadCellGraph(g)), wp, 60, isBuilding);
    const withForward = reverseFloodFromGraph(serializeRoadCellGraph(g), wp, 60, isBuilding);
    expect(withForward, '正向圖與轉置圖給出相同結果 —— fixture 的路型不夠混合')
      .not.toEqual(withTranspose);
  });
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/workplace/__tests__/WorkerGraphParity.test.ts`
Expected: FAIL，`reverseFloodFromGraph is not a function`

- [ ] **Step 3: 改寫 worker**

在 `src/workers/workplace-distance.worker.ts`：刪掉 `BYTES_PER_CELL` 之外的
`FOUR_DIRS`、`roadTileCost`、`class MinHeap`、`reverseFloodFromWorkplace`，
新增：

```ts
import { deserializeRoadCellGraph } from '../core/road/RoadCellGraphBuffer';
import { floodRoadCellGraph, seedNodesFor, attachAtSettledNode } from '../core/road/RoadCellGraph';
import { ZONE_ROAD_REACH } from '../core/grid/constants';

/**
 * 從一個工作地點反向 flood，回傳每個建築格到它的道路成本。
 *
 * `graphBuffer` **必須是轉置後的圖** —— 成本加在目的地那一格，直接用正向圖
 * 反向擴散會付成來源那格的價格（BUG-237）。
 *
 * worker 不再有自己的 Dijkstra —— 它跟同步查詢用同一個 `floodRoadCellGraph`。
 */
export function reverseFloodFromGraph(
  graphBuffer: ArrayBuffer,
  wp: WorkplacePosition,
  maxBudget: number,
  isBuilding: (x: number, y: number) => boolean,
): Record<string, number> {
  const graph = deserializeRoadCellGraph(graphBuffer);
  const seeds = seedNodesFor(graph, wp.x, wp.y, ZONE_ROAD_REACH);
  if (seeds.length === 0) return {};

  const out = new Map<string, number>();
  floodRoadCellGraph(graph, seeds, maxBudget, (node, cost) => {
    attachAtSettledNode(graph, node, cost, ZONE_ROAD_REACH, isBuilding, out);
    return false;   // 反向要走完整個預算範圍，沒有目標集合可以早退
  });
  return Object.fromEntries(out);
}
```

訊息處理端**保留現有的 `typeof self !== 'undefined'` 防護**（原本在第 176 行），
只改內容：

```ts
/* istanbul ignore next -- worker entry point, not executed in test environment */
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  (self as any).onmessage = (e: MessageEvent<WDWorkerRequest>) => {
    const req = e.data;
    if (req.type !== 'COMPUTE') return;
    try {
      const view = new DataView(req.gridBuffer as ArrayBuffer);
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
}
```

`src/core/workplace/WorkplaceDistanceTypes.ts` 的 `WDWorkerRequest` 加上：

```ts
  /**
   * 序列化的**轉置** RoadCellGraph。走訪規則在建圖時就消化掉了，
   * worker 不解讀樓層。轉置的理由見 BUG-237。
   */
  graphBuffer: ArrayBuffer;
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/workplace/__tests__/WorkerGraphParity.test.ts`
Expected: PASS（2 條）

- [ ] **Step 5: 回退驗證**

把 `reverseFloodFromGraph` 的呼叫端改成傳入**正向**圖（測試裡改成
`serializeRoadCellGraph(buildRoadCellGraph(lookup))`）。
Expected: 「should agree on every home → workplace cost」轉紅。改回。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/workers/workplace-distance.worker.ts src/core/workplace/WorkplaceDistanceTypes.ts src/core/workplace/__tests__/WorkerGraphParity.test.ts
git commit -m "refactor(worker): workplace 距離改走轉置圖，與同步查詢共用核心"
```

---

## Task 8: 接線、刪閘門、遷移既有測試

**Files:**
- Modify: `src/core/workplace/WorkplaceDistanceClient.ts`
- Modify: `src/core/workplace/WorkplaceDistanceCache.ts`
- Modify: `src/core/simulation/SimulationLoop.ts`
- Modify: `src/core/service/RoadCoverageFlood.ts`（刪 legacy）
- Modify: `src/core/workplace/__tests__/WorkplaceDistanceWorker.test.ts`（遷移）
- Modify: `src/core/workplace/__tests__/WorkplaceDistanceCache.test.ts`（遷移）
- Delete: `src/core/road/__tests__/RoadDistanceParity.test.ts`

**Interfaces:**
- Consumes: Task 1–7
- Produces: 無新公開 API

- [ ] **Step 1: 遷移既有測試（先做，否則後面每一步都紅）**

`src/core/workplace/__tests__/WorkplaceDistanceWorker.test.ts:2` 目前是：

```ts
import { reverseFloodFromWorkplace, computeAllDistances } from '../../../workers/workplace-distance.worker';
```

這兩個函式在 Task 7 已刪除。改成用 `reverseFloodFromGraph`：把每個
`reverseFloodFromWorkplace(view, w, h, wp, budget)` 的呼叫改成先建圖、轉置、
序列化，再呼叫 `reverseFloodFromGraph(buffer, wp, budget, isBuilding)`。
`computeAllDistances` 的測試改成逐個工作地點呼叫 `reverseFloodFromGraph`。

**注意:這些測試原本只用單一路型,所以它們測不出 BUG-237。** 遷移時保持原樣
即可 —— 硬約束由 `WorkerGraphParity.test.ts` 守。

`src/core/workplace/__tests__/WorkplaceDistanceCache.test.ts:84` 目前是：

```ts
const result = cache.requestUpdate(10, 10, new ArrayBuffer(10), [], 60);
```

`requestUpdate` 在 Step 3 會多一個 `graphBuffer` 參數。改成：

```ts
const result = cache.requestUpdate(10, 10, new ArrayBuffer(10), new ArrayBuffer(16), [], 60);
```

並新增一條測試（空圖要回 false）：

```ts
it('should refuse to request an update with an empty graph', () => {
  // 空圖送出去，worker 會回一張空表，而空表會被標成 READY —— 全城變成
  // 互相到不了。寧可維持 EMPTY 走 fallback。
  const cache = new WorkplaceDistanceCache(fakeClient());
  expect(cache.requestUpdate(10, 10, new ArrayBuffer(10), new ArrayBuffer(0), [], 60)).toBe(false);
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/workplace/`
Expected: FAIL（新的空圖測試紅，`requestUpdate` 參數數量錯）

- [ ] **Step 3: client 與 cache 加上 graphBuffer**

`WorkplaceDistanceClient.compute()` 在 `gridBuffer` 之後加
`graphBuffer: ArrayBuffer`，放進 postMessage payload。

`WorkplaceDistanceCache.requestUpdate()` 同樣加參數，並在最前面加空圖判斷：

```ts
    // 空圖代表城市還沒有路。送出去只會拿回一張空表，而空表會被標成 READY ——
    // 全城互相到不了。寧可維持 EMPTY 走 fallback。
    if (graphBuffer.byteLength === 0) return false;
```

- [ ] **Step 4: SimulationLoop 刪閘門、傳轉置圖**

刪掉兩處（原第 1195 與 1333 行）：

```ts
const canUseWpCache = !this._elevationManager || !this._elevationManager.hasAnyElevatedRoad();
```

以及所有 `canUseWpCache &&` 的用法。同時刪掉它們上方描述舊限制的註解
（「Correctness wins over speed…」與「It is currently unreachable…」）——
那些狀況已經不存在。

`requestUpdate` 的呼叫改成（**用明確的 null 檢查，不用 `!`**）：

```ts
      const lookup = this._roadLookup;
      if (!lookup) return;      // 沒有 lookup 就建不出圖，這一輪走 fallback
      const graphBuffer = serializeRoadCellGraph(
        transposeRoadCellGraph(buildRoadCellGraph(lookup)),
      );
      this.wpDistCache.requestUpdate(
        this.state.grid.width, this.state.grid.height,
        copy, graphBuffer, wpPositions, DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget,
      );
```

- [ ] **Step 5: 刪掉 legacy 與它的差異測試**

`src/core/service/RoadCoverageFlood.ts`：刪 `roadDistanceToTargetsLegacy` 與
它專用的字串版 `MinHeap`（確認沒有其他使用者:`grep -n "MinHeap" src/core/service/RoadCoverageFlood.ts`）。
刪掉 `src/core/road/__tests__/RoadDistanceParity.test.ts` —— 對照對象不存在了，
硬約束由 `WorkerGraphParity.test.ts` 接手。

- [ ] **Step 6: 跑完整測試套件**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全綠。

- [ ] **Step 7: 實機驗收**

```bash
npx vite --host 127.0.0.1 --port 5180 --strictPort
```

載入 `C:\Users\weiwe\Downloads\測試.webcity (1).json`（60×60、2146 人、
60 格高架道路），在 console 執行：

```js
const g = window.__game;
g.state.clock.setSpeed(5);
await new Promise(r => setTimeout(r, 5000));
({ ready: g.simLoop.wpDistCache.isReady, status: g.simLoop.wpDistCache.getStatus() })
```

Expected: `ready: true`。

再量一次逐 tick 成本：

```js
const loop = g.simLoop, orig = loop.tick.bind(loop);
let max = 0;
loop.tick = function () { const t = performance.now(); orig(); max = Math.max(max, performance.now() - t); };
await new Promise(r => setTimeout(r, 20000));
loop.tick = orig;
max
```

Expected: 最慢的 tick 明顯低於切片化之後的 49 ms（查表是 O(1)）。

- [ ] **Step 8: 更新文件並 Commit**

`BUGS.md`：把 BUG-109 標記為已治本，附實機數字。
`TODO.md`：勾掉「BUG-109 治本」。

```bash
npx tsc --noEmit && npx vitest run && npx vite build
git add -A
git commit -m "perf(sim): workplace 距離改走路網圖，高架不再停用快取（BUG-109 治本）"
```

---

## Self-Review

**Spec 覆蓋:**

| Spec 章節 | Task |
|---|---|
| §5.1 `RoadCellGraph` | 1 |
| §5.2 `floodRoadCellGraph` + 四個不變式 | 2（每個不變式一條測試 + 一次回退驗證） |
| §5.3 `attachAtSettledNode` | 3 |
| §5.4 `seedNodesFor` | 3 |
| §5.4b `transposeRoadCellGraph` / BUG-237 | 4 |
| §5.5 序列化 + 版本欄位 | 6 |
| §5.6 修改清單 | 5（RoadCoverageFlood）、7（worker）、8（其餘） |
| §7 版本不符 | 6 Step 1 第三條 |
| §7 worker 例外 | 7 Step 3 的 try/catch |
| §7 座標超過 Uint16 | 1 Step 3 的 `RangeError` |
| §7 空圖回 false | 8 Step 1 與 Step 3 |
| §9 測試策略 | 1–8 分散覆蓋 |

**回退驗證清單（共 11 次，每一次都指明預期轉紅的那一條）:**

| Task | 破壞什麼 | 預期轉紅 |
|---|---|---|
| 1a | 權重改算來源那格 | destination tile exactly |
| 1b | 權重改 Float32 | destination tile exactly + CSR consistent |
| 2a | cost 改 Float32Array | should not stall on floating point rounding |
| 2b | onSettle 搬到 relax | settle in strictly increasing cost order |
| 2c | 拿掉 budget 截斷 | leave unreached nodes at -1 |
| 3a | seedNodesFor 只看地面 | pick up elevated road cells |
| 3b | 拿掉 `out.has(key)` 早退 | record a building once, at its cheapest road |
| 4 | 轉置時權重取端點 | keep the weight with the edge + same cost as forward |
| 5 | 附掛搬到 flood 之後 | match the legacy result |
| 6a | 拿掉 align8 | round-trip（`RangeError`） |
| 6b | 拿掉版本檢查 | refuse a buffer with the wrong version |
| 7 | 傳正向圖而非轉置 | agree on every home → workplace cost |

**Task 5 Step 7 的早退回退明講「不會轉紅」** —— 早退只影響效能不影響結果，
正確性由結果相等保證。不寫計時測試（那會是脆弱的）。

**已知風險:**

Task 6 Step 5(a) 的對齊回退驗證,是否轉紅取決於 `testCity` 產生的邊數奇偶。
計畫已寫明「若恰好對齊就改 fixture 讓邊數變奇數再驗」。
