# Workplace 距離改走路網圖 —— 實作計畫（第 4 版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一張格子層的路網圖,讓 workplace 距離的同步與非同步兩條路共用同一個
flood 核心,消除「有高架就停用快取」的限制（BUG-109 治本）。

**Architecture:** `UnifiedRoadLookup` 是樓層與匝道規則的唯一來源。建圖時把規則
消化成「節點 + 邊」。同步查詢在**正向圖**上跑，worker 在**轉置圖**上跑 ——
因為成本加在目的地那一格，反向擴散必須讓權重跟著邊走。兩者呼叫同一個
`floodRoadCellGraph`。圖**每個道路世代只建一次**，兩條路共用同一份。

**Tech Stack:** TypeScript、Vitest、Web Worker、CSR（壓縮稀疏列）typed array。

**Spec:** `docs/superpowers/specs/2026-08-10-workplace-distance-graph-design.md`

---

## 第 4 版改了什麼

第 3 版送了第三輪審核。這一輪 Codex 是**實際動手**的：49 次唯讀命令、跑完整
測試套件（330 檔 4600 測試）、`tsc`、以及照計畫的 fixture 與規則寫 Node 探針
把 20 條回退驗證全部實算一遍。結論仍是「不建議直接照計畫實作」。

以下每一項我都親自驗證過才採納。

### 已先行落地（不在本計畫範圍內）

**成本整數化漏掉一個消費端**（已修，commit `7cf346e`）。
`GlobalCoverageService.collectPending` 的 `1 / Math.max(1, cost)` 下限留在舊
尺度，×18 之後設施門口那塊等權重平台塌掉，垃圾車與靈車的挑選分布變了。
改成 `roadTileCost(RoadType.FOUR_LANE)`（＝舊制的 `1`，語意相同）。
順帶修掉 `docs/citizen-system.md` 過時的 `dijkstraMaxBudget = 60`。

Codex 同時確認**沒有第二處遺漏**，而且存檔不需要 migration。

### 本計畫的修正

| 發現 | 我的驗證 | 處置 |
|---|---|---|
| Task 3 的「道路格應附掛自己」斷言會讓**正確實作紅燈** | 屬實，而且是我推理錯。附掛取的是「reach 內最便宜的路格」，自己當然可能被鄰居擊敗 —— fixture 裡 26 個道路格有 19 個是反例（例如 `1,1` 構得到種子 `0,1`，拿到 0 而不是自己的 36） | **刪掉那條斷言**，並刪掉我那段錯誤的論證註解 |
| 回退 2a（不再 relax 成更便宜的值）**空轉** | 屬實，而且有結構性原因：成本加在**目的地**，所以進入節點 j 的每條邊權重都相同，`dist[j] = w_j + min(已 settle 的前驅)`。Dijkstra 依成本遞增 settle，第一次 relax 就已經最佳 —— 重新 relax 的分支在路網圖上**永遠走不到** | 加一組**合成 CSR 圖**測試（入邊權重不同），讓該分支真的被執行 |
| 回退 2d（拿掉 stale 過濾）空轉 | 同一個結構原因：永遠不會產生 stale 堆項 | 同上，合成圖會製造 stale 項 |
| 回退 2b 只有一半有效 | 屬實：settle 順序那條會紅（6 次下降），「每節點只 settle 一次」不會 | 表格只承諾會紅的那一半 |
| 回退 8b（傳正向圖）空轉 | 屬實：`bridgedCity` 全是 `TWO_LANE`，權重全 36 且邊集對稱，forward 與 transpose **完全相同** | fixture 混入不同路型 |
| Task 8 的驗收測試**在正確程式碼上會失敗**，而且測不到快取 | 屬實。`postMessage` 裡同步呼叫 `onmessage` 不會掉訊息（client 先登記 pending），但 `.then(applyResult)` 在 microtask。24 次 `tick()` 全發生在 READY 之前，就業結果來自**同步 fallback** | 補 microtask 等待 + spy `getDistancesFromHome`，明確證明命中快取 |
| Task 7 說既有 worker fixture 有完整 Grid 可餵 `fromGrid()` | 不實。讀 `WorkplaceDistanceWorker.test.ts`：只有 `Map<string, RoadType>` 與手捏的 `ArrayBuffer` | 明列 `GridLike` adapter 的建法；預算也要 ×18（fixture 寫死 `60`） |
| Task 8 的 cache 測試片段引用未建立的 `lookup` | 屬實 | 補上 grid 與 lookup 的建構 |
| `state.commuteCache.roadGeneration` 不存在 | 屬實，正確是 `this.commuteCache.roadGeneration`（`commuteCache` 是 `SimulationLoop` 欄位） | 改正 |
| `loop.getRoadLookup` 不存在 | 屬實。只有 `setRoadLookup` 與私有 `_roadLookup` | Task 8 新增對稱的 getter |
| `ElevatedAwareReachability.test.ts` 是 **5** 個案例不是 4 個 | 屬實，第 5 個是「should disable the cache for an elevated road」 | 表格補上第 5 個並交代處置 |
| `ElevationManager` 自身沒有 generation/event，直接 `set/delete` 不連動 | 屬實。目前正式路徑 `Game → markLaneGraphDirty → commuteCache.bumpGeneration` 是對的，但那是**呼叫紀律不是不變量** | 新增一條整合回歸測試釘住它 |
| spec 與 plan 有 11 處矛盾 | 屬實 | Task 0 一次修完 |
| 自評文字「18 次」與表格「20 條」打架 | 屬實 | 逐條重數 |

### Codex 確認正確、不再改動的部分

整數化確實解決 parity（它自己跑探針：新權重正反向都是 344 且 `Object.is` 為
true）、存檔不需 migration、legacy 永久保留必要（AST 數出 16 個呼叫點、13 個
沒有 lookup）、圖按 generation 建一次的方向正確、高架 build/demolish 確實會
bump generation、transpose 設計正確、Bellman-Ford 與 `cheapestNearby` 都是
合格的獨立參考、其餘 15 條回退驗證都有實際辨識力（7a 有 181 組 pair 不同、
7b 有 560 組）。

---

## 第 3 版改了什麼（保留，作為背景）

第 2 版送 Codex 複審，結論是「仍不可直接執行；有數個會讓正確實作本身紅燈的
阻斷問題」。以下每一項我都親自驗證過才採納。

### 一、成本改成整數 —— 已先行落地（commit `95fdc5e`）

第 2 版的硬約束是「worker 與同步逐格精確相等，用 `.toBe`」。**那在浮點下
做不到**：

```
10/3 + 10/3 + 10/3 + 2 + 2 === 14
2 + 2 + 10/3 + 10/3 + 10/3 === 14.000000000000002
```

浮點加法沒有結合律。反向 Dijkstra 走的是同一組邊、**相反的順序**，所以兩者
不可能位元相同 —— 換 Float64 也一樣，這與精度無關。Codex 推演整份 fixture：
2704 對裡有 92 對不相等。

治法不是放寬契約，是換掉成本表示。分母 `speedLimit × 車道數/2` 只有 30、50、
100、180、200 五種，最小公倍數 1800；把分子從 100 換成 1800，六種道路的成本
全部落在整數：

| 道路 | 舊（浮點） | 新（整數） |
|---|---|---|
| RURAL | 3.333… | 60 |
| TWO_LANE | 2 | 36 |
| FOUR_LANE | 1 | 18 |
| SIX_LANE | 0.555… | 10 |
| HIGHWAY | 0.5 | 9 |
| ONE_WAY | 2 | 36 |

整數加法完全可交換，兩個方向必然相同。**這連帶解掉了 Float32 vs Float64 的
整個爭論** —— 權重存 `Uint16Array`（最大 60），成本存 `Int32Array`（−1 = 未
到達），沒有捨入，stale 判斷不可能誤判。

已完成的部分：整數化本身、九項服務預算與 `dijkstraMaxBudget` ×18、
`COMMUTE_SCORE` 距離門檻、`FIRE.RESPONSE_SPEED` ×18、把 `roadTileCost` 抽成
`core/road/roadCost.ts` 讓 worker 與主執行緒共用（worker 原本有一份手抄複本）。
特徵測試 `RoadCostInteger.test.ts` 鎖住「涵蓋半徑、通勤評分、消防反應時間全部
不變」。

### 二、期望值一律從實作推導，不再手算

我在同一個 fixture 上**連續兩次**算錯拓撲（Task 3 的 reach 範圍算錯兩次）。
這不是粗心，是方法錯了 —— 手算的期望值在 12×6 的圖上就已經不可靠。

第 3 版的規則：**凡是我得心算才知道答案的斷言，一律改成從一個獨立的、
明顯正確的參考計算導出。**

| 原本 | 改成 |
|---|---|
| 「(2,1)→(2,2) 的權重是鄉道價」 | 對**每一個節點**比對圖的鄰接與 `lookup` 直接問出來的鄰接 |
| 「(5,5) 應該掛在 (5,3) 上，成本 20.67」 | 掛上去的成本 = reach 內所有路格 flood 成本的**最小值**（測試裡暴力算） |
| 「(3,1) 的成本是 TWO × 3」 | 全圖對照獨立實作的 **Bellman-Ford** |
| 「x=4 是匝道所以 4,1 連 4,1,1」 | 列出所有地面→高架的邊，斷言**每一條的高架端都是匝道** |

手寫座標只保留一種用途：**fixture 健全性檢查**（「至少要有一條地面→高架的
邊，否則這個 fixture 根本沒在測高架」）。那種斷言算錯也只會讓測試更嚴格，
不會讓正確實作紅燈。

### 三、其餘 Codex findings（逐項驗證後的處置）

| 發現 | 我的驗證 | 處置 |
|---|---|---|
| Task 1 斷言 `'4,1' → '4,1,1'` 有邊 | 讀 `UnifiedRoadLookup.ts:69-103`：`getCompatibleNeighborKeys(sourceKey, nx, ny)` **只檢查 (nx,ny)**，同座標從不在範圍內 | 屬實。改成全域鄰接比對，同座標改斷言**沒有**邊 |
| Task 3 cheapest road 期望值錯（(3,3)…(7,3) 五格都在 reach 內） | 屬實 | 改成暴力最小值推導 |
| Task 2「兩條候選路徑」仍是空轉 | 屬實 | 改成 Bellman-Ford 全圖對照 |
| `if (!lookup) return` 會退出整個 `assignCitizenHousing()` | 讀 `SimulationLoop.ts` 確認 | 改成只跳過快取請求，不影響同步指派 |
| 空圖防護空轉（空圖序列化是 24 bytes，不是 0） | 屬實 | 改成讀 header 的 `nodeCount === 0` |
| align8 的回退驗證無效（`n=26,e=56` → `oWeights=480` 本來就對齊） | 屬實 | 權重改 Uint16 後不需要 8-byte 對齊；改成**直接斷言各段位移的對齊性**，與 fixture 的奇偶無關 |
| Task 8 漏掉 `ElevatedAwareReachability.test.ts` | 讀該檔：它**刻意灌一份謊報的 ground-only 快取**，靠閘門讓 fallback 獲勝 | 屬實，而且更嚴重 —— 閘門刪掉後那份謊報快取會被採信。**升格為獨立的 Task 8，它就是 BUG-109 的驗收測試** |
| Task 8 漏掉不傳 lookup 的呼叫端（13 處） | `ReadableGrid` 只有 `getCell`，**沒有 width/height/forEachCell**，建不出 lookup | 屬實。**legacy 不刪** —— 它不是遷移殘骸，是 `ReadableGrid` 呼叫端的契約。改名為 `roadDistanceToTargetsOnGrid` 永久保留，parity 測試也永久保留 |
| `fakeClient()` 不存在 | `grep` 確認全 repo 沒有 | 屬實，改用實際存在的建構方式 |
| 回退表 12 列寫成 11，且 3b/6a/7 無效 | 屬實 | 重寫，每一列都寫明「破壞什麼 → 哪一條轉紅」，並在 Task 內就地標注 |
| spec §260 仍寫 `weights Float32[edges]` | 屬實 | 隨本版一併改成 `Uint16` |
| `transposeRoadCellGraph` 語意與 CSR 實作、`layoutOf`、`result.size >= targets.size` 早退、`self` 防護、不用 LaneGraph 的理由 | Codex 確認正確 | 保留 |

### 四、我自己發現的一個問題：v2 每次查詢都重建整張圖

v2 的 Task 5 在 `roadDistanceToTargets` 裡直接 `buildRoadCellGraph(roadLookup)`。
那個函式**每個市民呼叫一次** —— 2436 人的城市裡一輪就是 2436 次建圖，
每次 O(路格數 × 4)。這會讓同步路徑比現在更慢，而變慢的正是我們要修的東西。

第 3 版：圖**每個道路世代只建一次**，由呼叫端持有並傳入（Task 6）。
`SimulationLoop` 本來就要為 worker 建圖與轉置，正向圖順手共用同一份。

---

## Global Constraints

- `src/core/` **禁止 import Three.js**。
- **TDD 強制**:先寫紅燈測試 → 跑到紅 → 實作 → 跑到綠 → **還原修正確認轉紅**。
  回退驗證若沒轉紅，**那是測試的問題,不是可以略過的步驟**。
- **成本是整數**。唯一來源 `src/core/road/roadCost.ts`：
  `roadTileCost = 1800 / (speedLimit × lanes/2)` → 9 ~ 60。
  權重存 `Uint16Array`，累積成本存 `Int32Array`（−1 = 未到達）。
  **不得引入任何浮點成本** —— 順序無關性是整份設計的地基。
- 期望值一律從獨立參考推導，**不手算**。這條在第 3 版加入，第 4 版又抓到一次
  違反（Task 3 的「道路格附掛自己」）—— 只要你發現自己在心算「那一格應該是
  多少」，就是該改成推導的訊號。
- **計畫裡引用的每一個外部名稱都要先 `grep` 確認存在**，不要照抄。前三版
  分別出現過 `fakeClient()`（不存在）、`state.commuteCache.roadGeneration`
  （位置錯）、`loop.getRoadLookup`（不存在）。
- `ZONE_ROAD_REACH = 2`（`src/core/grid/constants.ts`）。
- `DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget = 1080`。
- 格子 key:地面 `"x,y"`，高架 `"x,y,level"`（level 1–3）。
- 發現 Bug 必須寫入 `BUGS.md` 與 `TODO.md`。
- 每個 Task 結束時工作區乾淨、`npx tsc --noEmit` 0 錯、`npx vitest run` 全綠。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/core/road/RoadCellGraph.ts`（新） | 圖的型別、建圖、轉置、flood 核心、種子、附掛 |
| `src/core/road/RoadCellGraphBuffer.ts`（新） | 圖 ↔ ArrayBuffer。只有格式，沒有演算法 |
| `src/core/service/RoadCoverageFlood.ts`（改） | `roadDistanceToTargets` 走圖；無 lookup 時走 `roadDistanceToTargetsOnGrid`（永久保留） |
| `src/workers/workplace-distance.worker.ts`（改） | 刪自己的 MinHeap 與 flood，改用核心 + 轉置圖 |
| `src/core/workplace/WorkplaceDistanceTypes.ts`（改） | 請求加 `graphBuffer` |
| `src/core/workplace/WorkplaceDistanceClient.ts`（改） | `compute()` 加 `graphBuffer` |
| `src/core/workplace/WorkplaceDistanceCache.ts`（改） | `requestUpdate()` 加 `graphBuffer`；空圖回 false |
| `src/core/simulation/SimulationLoop.ts`（改） | 刪 `hasAnyElevatedRoad()` 閘門；每個道路世代建一次圖，正向給同步、轉置給 worker；新增 `getRoadLookup()` |
| `src/core/workplace/__tests__/ElevatedAwareReachability.test.ts`（**重寫**） | BUG-109 的驗收測試。從「閘門讓 fallback 獲勝」改成「快取本身是樓層感知的」 |
| `src/core/simulation/__tests__/ElevatedRoadInvalidatesGraph.test.ts`（新） | 釘住「高架 build/demolish 會 bump 道路世代」—— 圖以它為鍵，那條連動目前只是呼叫紀律 |

---

## 共用測試素材

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
 *   y=1   x 0..11  雙線道主幹（每格 36）
 *   y=3   x 2..8   鄉道支線（每格 60）
 *   x=2   y=2      鄉道，連接主幹與支線
 *   level 1, y=1, x 4..9  高速高架（每格 9），x=4 與 x=9 是匝道
 *
 * 路型混合是必要的 —— 全部同路型時正向與反向剛好相等，而那正好會讓反向
 * 對稱性的 bug 測不出來（BUG-237 就是這樣漏掉的）。
 *
 * 這個 fixture 的**拓撲細節不寫進斷言** —— 測試一律從 lookup 或獨立參考
 * 演算法推導期望值。手算過兩次，兩次都錯。
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

## Task 0: 先把 spec 與 plan 對齊

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-workplace-distance-graph-design.md`

計畫改了四版，spec 沒有跟上。**開工前先修，不要留著兩個版本的真相** ——
實作者讀到哪一份都不該被誤導。

- [ ] **Step 1: 逐條修正**

| # | spec 現況 | 應改為 |
|---|---|---|
| 1 | 每次 request 現建圖 | 按道路 generation 建一次，由 `SimulationLoop` 持有 |
| 2 | legacy 是暫時的、最終刪除 | 永久保留 `roadDistanceToTargetsOnGrid`（`ReadableGrid` 只有 `getCell`） |
| 3 | flood 回傳 `FloodResult { cost: Int32Array }` | 直接回傳 `Int32Array` |
| 4 | `RoadCellGraph` 介面缺 `nodeLevel` | 補上（wire layout 與 `seedNodesFor` 都需要） |
| 5 | 附掛函式叫 `attachBuildingCells` | 統一為 `attachAtSettledNode` |
| 6 | 「4 個直接 `roadDistanceToTargets` 呼叫點」 | `SimulationLoop` 實際是 3 個 |
| 7 | 承諾獨立的 ramp-axis 測試 | 說明改由「全域鄰接比對 + fixture 健全性檢查」涵蓋，並在 Task 1 補 CSR 去重斷言 |
| 8 | 資料流圖仍寫 request 時建圖 | 同 #1 |
| 9 | §2 非目標仍隱含成本模型不變 | 已加整數化修訂註記（第 3 版已做，複查即可） |

- [ ] **Step 2: 檢查沒有殘留**

```bash
grep -n "Float32\|Float64\|FloodResult\|attachBuildingCells\|每次 request" \
  docs/superpowers/specs/2026-08-10-workplace-distance-graph-design.md
```
Expected: 只剩下解釋「為什麼不用浮點」的敘述性文字。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-10-workplace-distance-graph-design.md
git commit -m "docs(spec): 與計畫第 4 版對齊 —— 圖的快取策略、legacy 去留、命名"
```

---

## Task 1: 建圖

**Files:**
- Create: `src/core/road/RoadCellGraph.ts`
- Test: `src/core/road/__tests__/RoadCellGraph.test.ts`

**Interfaces:**
- Consumes: `UnifiedRoadLookup.getAllCellKeys(): string[]`、
  `.getCompatibleNeighborKeys(sourceKey: string, nx: number, ny: number): string[]`、
  `.getCellByKey(key: string): { roadType: number; roadFlags: number } | null`、
  `.isRamp(key: string): boolean`；
  `roadTileCost(roadType: number): number`（`src/core/road/roadCost.ts`）
- Produces: `RoadCellGraph`、`buildRoadCellGraph(lookup): RoadCellGraph`、
  `levelOfKey(key: string): number`

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraph.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import { buildRoadCellGraph, levelOfKey } from '../RoadCellGraph';
import { roadTileCost } from '../roadCost';
import { parsePosKeyUnsafe, FOUR_NEIGHBORS } from '../../grid/GridHelpers';

/** 節點 key 的所有出邊，回傳 [目標 key, 權重]。 */
function outEdges(g: ReturnType<typeof buildRoadCellGraph>, key: string): [string, number][] {
  const i = g.indexOf.get(key);
  if (i === undefined) return [];
  const out: [string, number][] = [];
  for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
    out.push([g.nodeKeys[g.targets[k]!]!, g.weights[k]!]);
  }
  return out;
}

describe('buildRoadCellGraph', () => {
  it('should contain exactly the cells the lookup reports', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect([...g.nodeKeys].sort()).toEqual(lookup.getAllCellKeys().sort());
  });

  it('should contain exactly the edges the lookup permits, for every node', () => {
    // 全域比對，不是抽樣。期望值直接向 lookup 問 —— 不需要我心算哪一格連
    // 哪一格（手算過兩次，兩次都錯）。這一條同時涵蓋樓層規則、匝道軸向、
    // 邊界裁切，因為那些全都在 getCompatibleNeighborKeys 裡。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);

    for (const key of lookup.getAllCellKeys()) {
      const { x, y } = parsePosKeyUnsafe(key);
      const expected = new Set<string>();
      for (const [dx, dy] of FOUR_NEIGHBORS) {
        for (const nk of lookup.getCompatibleNeighborKeys(key, x + dx!, y + dy!)) {
          expected.add(nk);
        }
      }
      const actual = new Set(outEdges(g, key).map(([k]) => k));
      expect(actual, `${key} 的鄰接與 lookup 不符`).toEqual(expected);
    }
  });

  it('should charge the cost of the destination cell, for every edge', () => {
    // 同樣是全域的。每一條邊的權重都必須等於「走進去那一格」的路型成本。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    let checked = 0;
    for (const key of g.nodeKeys) {
      for (const [dstKey, w] of outEdges(g, key)) {
        const dst = lookup.getCellByKey(dstKey)!;
        expect(w, `${key} → ${dstKey} 付錯了價`).toBe(roadTileCost(dst.roadType));
        checked++;
      }
    }
    expect(checked, '一條邊都沒檢查到 —— 這條測試等於沒測').toBeGreaterThan(20);
  });

  it('should store integral weights that fit the Uint16 range', () => {
    // 整數是順序無關性的地基（見計畫開頭）。浮點權重會讓正反向 flood
    // 不可能位元相等。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(g.weights).toBeInstanceOf(Uint16Array);
    for (let k = 0; k < g.weights.length; k++) {
      expect(Number.isInteger(g.weights[k]!)).toBe(true);
      expect(g.weights[k]!).toBeGreaterThan(0);
    }
  });

  // ── fixture 健全性 ──────────────────────────────────────────────
  // 以下兩條不斷言座標，只斷言「這個 fixture 真的含有要測的東西」。
  // 算錯也只會讓測試更嚴格，不會讓正確實作紅燈。

  it('fixture sanity: the ground reaches the viaduct, and only at ramps', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const groundToAir: [string, string][] = [];
    for (const key of g.nodeKeys) {
      if (levelOfKey(key) !== 0) continue;
      for (const [dstKey] of outEdges(g, key)) {
        if (levelOfKey(dstKey) > 0) groundToAir.push([key, dstKey]);
      }
    }
    expect(groundToAir.length, 'fixture 裡沒有任何地面→高架的邊，高架等於沒測')
      .toBeGreaterThan(0);
    for (const [from, to] of groundToAir) {
      expect(lookup.isRamp(to), `${from} → ${to}：高架端不是匝道`).toBe(true);
    }
  });

  it('fixture sanity: it really mixes road tiers', () => {
    // 全部同路型時正反向剛好相等，BUG-237 就是這樣漏掉的。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(new Set(g.weights).size, 'fixture 只有一種路型，測不出方向性')
      .toBeGreaterThanOrEqual(3);
  });

  it('should keep CSR structurally consistent, with no duplicate edges', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(g.indexOf.size).toBe(g.nodeKeys.length);
    for (let i = 0; i < g.nodeKeys.length; i++) {
      expect(g.indexOf.get(g.nodeKeys[i]!)).toBe(i);
    }
    expect(g.offsets.length).toBe(g.nodeKeys.length + 1);
    expect(g.offsets[g.nodeKeys.length]).toBe(g.targets.length);
    expect(g.weights.length).toBe(g.targets.length);

    // 去重：上面「edges the lookup permits」用 Set 比對，重複的邊會被它藏起來。
    // 重複邊不影響最短路徑結果，但會讓 flood 白做工，而且是建圖邏輯出錯的訊號。
    for (let i = 0; i < g.nodeKeys.length; i++) {
      const seen = new Set<number>();
      for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
        expect(seen.has(g.targets[k]!), `${g.nodeKeys[i]} 有重複的出邊`).toBe(false);
        seen.add(g.targets[k]!);
      }
    }
  });
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraph.test.ts`
Expected: FAIL，`Cannot find module '../RoadCellGraph'`

- [ ] **Step 3: 實作**

建立 `src/core/road/RoadCellGraph.ts`：

```ts
import { parsePosKeyUnsafe, FOUR_NEIGHBORS, parseLevelFromKey } from '../grid/GridHelpers';
import { roadTileCost } from './roadCost';
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

/** 從 key 取樓層。地面沒有第三段。 */
export function levelOfKey(key: string): number {
  return parseLevelFromKey(key);
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
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraph.test.ts`
Expected: PASS（7 條）

- [ ] **Step 5: 回退驗證（四次）**

**(d)** 在 `targetList.push(j)` / `weightList.push(w)` 之前不做任何去重，
把整個 `for (const nk of ...)` 迴圈跑兩次（模擬重複加邊）。
Expected:「should keep CSR structurally consistent, with no duplicate edges」轉紅。改回。

**(a)** 把 `roadTileCost(info.roadType)` 改成
`roadTileCost(lookup.getCellByKey(key)!.roadType)`（改算來源那格）。
Expected:「should charge the cost of the destination cell」轉紅。改回。

**(b)** 把 `lookup.getCompatibleNeighborKeys(key, nx, ny)` 改成
`lookup.getAllKeysAtPosition(nx, ny)`（忽略樓層與匝道規則）。
Expected:「should contain exactly the edges the lookup permits」與
「fixture sanity: the ground reaches the viaduct, and only at ramps」都轉紅。改回。

**(c)** 把 `Uint16Array.from(weightList)` 改成 `Float32Array.from(weightList)`
（型別宣告一併改）。
Expected:「should store integral weights that fit the Uint16 range」轉紅。改回。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraph.ts src/core/road/__tests__/RoadCellGraph.test.ts
git commit -m "feat(road): 路網的格子層圖 —— 規則在建圖時消化，權重是整數"
```

---

## Task 2: flood 核心

**Files:**
- Modify: `src/core/road/RoadCellGraph.ts`
- Test: `src/core/road/__tests__/RoadCellGraphFlood.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces: `floodRoadCellGraph(graph, seedNodes: readonly number[], maxBudget: number, onSettle?: (node: number, cost: number) => boolean): Int32Array`
  （未到達為 `-1`；`onSettle` 回 true 表示提早結束）

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphFlood.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import { buildRoadCellGraph, floodRoadCellGraph, type RoadCellGraph } from '../RoadCellGraph';

/**
 * 獨立的參考實作：Bellman-Ford。
 *
 * 期望值不手算 —— 用一個**演算法完全不同**的最短路徑實作對照。Bellman-Ford
 * 不用堆、不靠 settle 順序、不做提早結束，所以 Dijkstra 這邊任何關於順序、
 * stale 判斷、relax 條件的錯誤，它都不會一起犯。
 *
 * 回傳每個節點的最短成本；不可達為 -1；超過 maxBudget 的路徑不採用。
 */
function bellmanFord(g: RoadCellGraph, seeds: readonly number[], maxBudget: number): Int32Array {
  const n = g.nodeKeys.length;
  const dist = new Int32Array(n).fill(-1);
  for (const s of seeds) if (s >= 0 && s < n) dist[s] = 0;

  for (let round = 0; round < n; round++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (dist[i]! < 0) continue;
      for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
        const j = g.targets[k]!;
        const nc = dist[i]! + g.weights[k]!;
        if (nc > maxBudget) continue;
        if (dist[j]! < 0 || nc < dist[j]!) { dist[j] = nc; changed = true; }
      }
    }
    if (!changed) break;
  }
  return dist;
}

const BIG = 1_000_000;

/**
 * 手工 CSR 圖，**入邊權重不同**。
 *
 * 為什麼需要它：路網圖的成本加在**目的地**那一格，所以進入節點 j 的每一條邊
 * 權重都相同，於是 `dist[j] = w_j + min(已 settle 的前驅)`。Dijkstra 依成本
 * 遞增 settle，第一個 settle 的前驅就是最小的那個 —— **第一次 relax 就已經
 * 最佳**。結果是「重新 relax 成更便宜的值」與「過期堆項」這兩條分支在路網圖
 * 上永遠走不到，用 testCity 去驗它們是空轉的（第三輪審核實算 26 個種子，
 * 零差異）。
 *
 * 這張圖讓那兩條分支真的被執行：
 *
 *   S ──1──▶ A ──100──▶ T
 *   └──10──▶ B ───1───▶ T
 *
 * settle S(0) → relax A=1, B=10；settle A(1) → relax T=101；
 * settle B(10) → **T 改寫成 11**，而堆裡那個 101 變成過期項。
 *
 * `floodRoadCellGraph` 是通用的加權圖 Dijkstra，契約本來就該對任何圖成立 ——
 * 而且哪天成本模型加上轉彎懲罰，入邊權重就不再一致了。
 */
function skewedGraph(): RoadCellGraph {
  const nodeKeys = ['S', 'A', 'B', 'T'];
  const indexOf = new Map(nodeKeys.map((k, i) => [k, i]));
  return {
    nodeKeys, indexOf,
    //        S:0..2   A:2..3   B:3..4   T:4..4
    offsets: Uint32Array.from([0, 2, 3, 4, 4]),
    targets: Uint32Array.from([1, 2, 3, 3]),   // S→A, S→B, A→T, B→T
    weights: Uint16Array.from([1, 10, 100, 1]),
    nodeX: Uint16Array.from([0, 1, 2, 3]),
    nodeY: new Uint16Array(4),
    nodeLevel: new Uint8Array(4),
  };
}

describe('floodRoadCellGraph on a graph with uneven incoming weights', () => {
  it('should improve a node when a cheaper route settles later', () => {
    const g = skewedGraph();
    const cost = floodRoadCellGraph(g, [0], BIG);
    expect([...cost], 'S/A/B/T 的最短成本').toEqual([0, 1, 10, 11]);
    expect([...cost]).toEqual([...bellmanFord(g, [0], BIG)]);
  });

  it('should settle each node exactly once despite the stale heap entry', () => {
    // T 先以 101 入堆、再以 11 入堆。少了過期過濾，T 會被 settle 兩次。
    const g = skewedGraph();
    const settled: number[] = [];
    floodRoadCellGraph(g, [0], BIG, (n) => { settled.push(n); return false; });
    expect(new Set(settled).size, '有節點被 settle 了兩次').toBe(settled.length);
    expect(settled.length).toBe(4);
  });

  it('fixture sanity: this graph really has uneven incoming weights', () => {
    // 若入邊權重一致，上面兩條就退化成空轉 —— 那正是 testCity 的情況。
    const g = skewedGraph();
    const intoT = new Set<number>();
    for (let i = 0; i < g.nodeKeys.length; i++) {
      for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
        if (g.targets[k] === 3) intoT.add(g.weights[k]!);
      }
    }
    expect(intoT.size, 'T 的入邊權重全部相同，測不出重新 relax').toBeGreaterThan(1);
  });
});

describe('floodRoadCellGraph', () => {
  it('should match an independent shortest-path implementation, node for node', () => {
    // 這是整個 flood 核心的主測試。全圖、每一個種子、精確相等。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    for (let seed = 0; seed < g.nodeKeys.length; seed++) {
      const mine = floodRoadCellGraph(g, [seed], BIG);
      const ref = bellmanFord(g, [seed], BIG);
      expect([...mine], `種子 ${g.nodeKeys[seed]} 的結果與參考實作不符`)
        .toEqual([...ref]);
    }
  });

  it('should match the reference at every budget, including tight ones', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const seed = g.indexOf.get('0,1')!;
    for (const budget of [0, 9, 36, 60, 100, 1080]) {
      expect([...floodRoadCellGraph(g, [seed], budget)], `預算 ${budget}`)
        .toEqual([...bellmanFord(g, [seed], budget)]);
    }
  });

  it('should take the cheapest of several seeds', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const a = g.indexOf.get('0,1')!, b = g.indexOf.get('8,3')!;
    expect([...floodRoadCellGraph(g, [a, b], BIG)]).toEqual([...bellmanFord(g, [a, b], BIG)]);
  });

  it('should return integers only, with -1 for unreached nodes', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const cost = floodRoadCellGraph(g, [g.indexOf.get('0,1')!], 36);
    expect(cost).toBeInstanceOf(Int32Array);
    let unreached = 0;
    for (const c of cost) {
      expect(Number.isInteger(c)).toBe(true);
      if (c === -1) unreached++;
    }
    expect(unreached, '這個預算下應該有到不了的節點，否則預算截斷沒被測到')
      .toBeGreaterThan(0);
  });

  it('should settle in non-decreasing cost order', () => {
    // BUG-102 的守門：附掛依賴「第一次 settle 就是最便宜的那條路」。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const seen: number[] = [];
    floodRoadCellGraph(g, [g.indexOf.get('2,1')!], BIG, (_n, c) => { seen.push(c); return false; });
    expect(seen.length, '只 settle 了種子，這條測試等於沒測').toBeGreaterThan(5);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!, `第 ${i} 次 settle 的成本比前一次低`).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it('should settle each node exactly once', () => {
    // 這一條擋的是「stale 判斷寫錯」：寫錯時同一個節點會被 settle 兩次，
    // 而附掛只認第一次，第二次就是白做工（或更糟，覆寫成較貴的值）。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const settled: number[] = [];
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], BIG, (n) => { settled.push(n); return false; });
    expect(new Set(settled).size, '有節點被 settle 了兩次').toBe(settled.length);
  });

  it('should stop early when onSettle asks it to', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    let count = 0;
    floodRoadCellGraph(g, [g.indexOf.get('0,1')!], BIG, () => { count++; return count >= 3; });
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
 *    精確；stale 判斷 `cost[node] < cur.cost` 不可能因捨入而誤判。這也是
 *    「worker 與同步逐格相等」能成立的唯一理由 —— 浮點加法沒有結合律，
 *    反向走同一組邊會算出不同的位元。
 *
 * `onSettle` 回傳 true 表示提早結束（同步查詢找齊目標之後就不必再走）。
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
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphFlood.test.ts`
Expected: PASS（10 條）

- [ ] **Step 5: 回退驗證（四次）**

**(a)** 把 `if (prev < 0 || nc < prev)` 改成 `if (prev < 0)`（不再改寫成更便宜的值）。
Expected:「should improve a node when a cheaper route settles later」轉紅
（T 會停在 101 而不是 11）。改回。

> **在 `testCity` 上這一條不會轉紅** —— 成本加在目的地，入邊權重一致，
> 第一次 relax 就已經最佳。這就是合成圖存在的理由。

**(b)** 把 `if (onSettle && onSettle(...)) return cost;` 從 pop 之後搬到 relax
迴圈裡（`cost[next] = nc;` 之後呼叫 `onSettle(next, nc)`）。
Expected:「should settle in non-decreasing cost order」轉紅（實算有 6 次下降）。改回。

> 「should settle each node exactly once」（testCity 那條）**不會**因為這個
> 變異轉紅 —— 同上，路網圖不產生重複 settle。合成圖那條會。

**(c)** 把 `if (nc > maxBudget) continue;` 拿掉。
Expected:「should match the reference at every budget」與
「should return integers only, with -1 for unreached nodes」都轉紅。改回。

**(d)** 把 `if (cost[cur.node]! < cur.cost) continue;` 拿掉（不濾過期堆項）。
Expected:「should settle each node exactly once despite the stale heap entry」
（合成圖那條）轉紅。改回。

> 同樣地，`testCity` 上的版本不會轉紅。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraph.ts src/core/road/__tests__/RoadCellGraphFlood.test.ts
git commit -m "feat(road): 圖上的 flood 核心 —— 整數成本，對照 Bellman-Ford 驗證"
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
  buildRoadCellGraph, floodRoadCellGraph, seedNodesFor, attachAtSettledNode, levelOfKey,
} from '../RoadCellGraph';
import { ZONE_ROAD_REACH } from '../../grid/constants';

const BIG = 1_000_000;

describe('seedNodesFor', () => {
  it('should return exactly the road nodes within Chebyshev reach, at every level', () => {
    // 期望值暴力算：掃全部節點，看誰在範圍內。不手算座標。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    for (const [cx, cy] of [[6, 0], [2, 4], [0, 5], [11, 5]] as const) {
      const expected = new Set<string>();
      for (let i = 0; i < g.nodeKeys.length; i++) {
        if (Math.max(Math.abs(g.nodeX[i]! - cx), Math.abs(g.nodeY[i]! - cy)) <= ZONE_ROAD_REACH) {
          expected.add(g.nodeKeys[i]!);
        }
      }
      const actual = new Set(seedNodesFor(g, cx, cy, ZONE_ROAD_REACH).map(i => g.nodeKeys[i]!));
      expect(actual, `(${cx},${cy}) 的種子集合不對`).toEqual(expected);
    }
  });

  it('fixture sanity: at least one probe really picks up an elevated cell', () => {
    // 否則「涵蓋所有樓層」是空轉的 —— 完全不處理高架的實作也會通過。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const keys = seedNodesFor(g, 6, 0, ZONE_ROAD_REACH).map(i => g.nodeKeys[i]!);
    expect(keys.some(k => levelOfKey(k) > 0), '探點旁邊沒有高架，高架等於沒測').toBe(true);
  });
});

describe('attachAtSettledNode', () => {
  /** 跑一次 flood，並在 settle 當下附掛。 */
  function floodAndAttach(startKey: string, accept: (x: number, y: number) => boolean) {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const out = new Map<string, number>();
    const cost = floodRoadCellGraph(g, [g.indexOf.get(startKey)!], BIG, (node, c) => {
      attachAtSettledNode(g, node, c, ZONE_ROAD_REACH, accept, out);
      return false;
    });
    return { g, out, cost };
  }

  /**
   * 獨立參考：一個格子應該拿到的成本 = reach 內所有**到得了的**路格中最便宜的。
   * 暴力掃全圖，不依賴 settle 順序，也不依賴 attachAtSettledNode 的邏輯。
   */
  function cheapestNearby(
    g: ReturnType<typeof buildRoadCellGraph>, cost: Int32Array, x: number, y: number,
  ): number | undefined {
    let best: number | undefined;
    for (let i = 0; i < g.nodeKeys.length; i++) {
      if (cost[i]! < 0) continue;
      if (Math.max(Math.abs(g.nodeX[i]! - x), Math.abs(g.nodeY[i]! - y)) > ZONE_ROAD_REACH) continue;
      if (best === undefined || cost[i]! < best) best = cost[i]!;
    }
    return best;
  }

  it('should give every accepted cell its cheapest reachable road cost', () => {
    // 全域比對。「(5,5) 應該掛在 (5,3) 上」這種手算的期望值連錯兩次，
    // 所以這裡對**每一個**格子比對暴力算出來的最小值。
    const { g, out, cost } = floodAndAttach('0,1', () => true);
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 6; y++) {
        const expected = cheapestNearby(g, cost, x, y);
        expect(out.get(`${x},${y}`), `(${x},${y}) 的附掛成本不是最便宜的`).toBe(expected);
      }
    }
  });

  it('fixture sanity: some cell is genuinely contested by roads of different cost', () => {
    // 若每個格子在 reach 內都只有一個路格，「取最便宜」就是空轉的。
    const { g, cost } = floodAndAttach('0,1', () => true);
    let contested = 0;
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 6; y++) {
        const costs = new Set<number>();
        for (let i = 0; i < g.nodeKeys.length; i++) {
          if (cost[i]! < 0) continue;
          if (Math.max(Math.abs(g.nodeX[i]! - x), Math.abs(g.nodeY[i]! - y)) <= ZONE_ROAD_REACH) {
            costs.add(cost[i]!);
          }
        }
        if (costs.size > 1) contested++;
      }
    }
    expect(contested, '沒有任何格子被多個不同成本的路格競爭，最小值邏輯沒被測到')
      .toBeGreaterThan(0);
  });

  it('should cover road cells too, not just buildings', () => {
    // 舊實作有一段「道路格本身也可能是目標」。dx/dy 包含 (0,0) 就涵蓋了，
    // 但那是實作細節 —— 這一條把「路格也會被收」釘成契約。
    //
    // **只斷言有被收，不斷言收到自己的成本。** 附掛取的是 reach 內最便宜的
    // 路格，而一個路格的鄰居可能更便宜（fixture 裡 26 個路格有 19 個如此，
    // 例如 1,1 構得到成本 0 的種子 0,1）。實際成本由上面那條全域比對負責。
    const { g, out, cost } = floodAndAttach('0,1', () => true);
    let checked = 0;
    for (let i = 0; i < g.nodeKeys.length; i++) {
      if (cost[i]! < 0 || levelOfKey(g.nodeKeys[i]!) !== 0) continue;
      const key = `${g.nodeX[i]},${g.nodeY[i]}`;
      expect(out.has(key), `道路格 ${key} 沒有被收`).toBe(true);
      checked++;
    }
    expect(checked, '一個地面路格都沒檢查到').toBeGreaterThan(5);
  });

  it('fixture sanity: some road cell is cheaper via a neighbour than on its own', () => {
    // 這一條把上面那段註解釘成可驗證的事實。若為 0，代表「只斷言有被收」是
    // 多餘的謹慎；若 > 0，代表當初那條「收到自己的成本」的斷言確實是錯的。
    const { g, out, cost } = floodAndAttach('0,1', () => true);
    let cheaperViaNeighbour = 0;
    for (let i = 0; i < g.nodeKeys.length; i++) {
      if (cost[i]! < 0 || levelOfKey(g.nodeKeys[i]!) !== 0) continue;
      const key = `${g.nodeX[i]},${g.nodeY[i]}`;
      if (out.get(key)! < cost[i]!) cheaperViaNeighbour++;
    }
    expect(cheaperViaNeighbour, '沒有任何路格靠鄰居拿到更便宜的成本')
      .toBeGreaterThan(0);
  });

  it('should ignore cells the accept predicate rejects', () => {
    expect(floodAndAttach('0,1', () => false).out.size).toBe(0);
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
Expected: PASS（7 條）

- [ ] **Step 5: 回退驗證（兩次）**

**(a)** 把 `seedNodesFor` 的內層樓層迴圈改成只看 `lv = 0`。
Expected:「should return exactly the road nodes within Chebyshev reach, at every level」
與「fixture sanity: at least one probe really picks up an elevated cell」都轉紅。改回。

**(b)** 把 `attachAtSettledNode` 的 `if (out.has(key)) continue;` 拿掉（永遠覆寫）。
Expected:「should give every accepted cell its cheapest reachable road cost」轉紅
（被較貴的後續值覆寫）。改回。

> 若 (b) 沒轉紅，代表 fixture 裡沒有任何格子被多個成本不同的路格競爭 ——
> 「fixture sanity: some cell is genuinely contested」那一條會先告訴你。
> 該條若為 0，先修 fixture，**不要跳過這次回退驗證**。

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
- Modify: `BUGS.md`、`TODO.md`

**Interfaces:**
- Consumes: Task 1–3
- Produces: `transposeRoadCellGraph(graph: RoadCellGraph): RoadCellGraph`

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphTranspose.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import {
  buildRoadCellGraph, transposeRoadCellGraph, floodRoadCellGraph, type RoadCellGraph,
} from '../RoadCellGraph';

const BIG = 1_000_000;

/** 圖裡所有的邊，正規化成可比對的字串集合。 */
function edgeSet(g: RoadCellGraph): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < g.nodeKeys.length; i++) {
    for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) {
      out.add(`${g.nodeKeys[i]}|${g.nodeKeys[g.targets[k]!]}|${g.weights[k]}`);
    }
  }
  return out;
}

/**
 * 成本加在**目的地**那一格，所以正向邊 A→B 的價格是 cost(B)。
 * 反向擴散必須讓權重跟著邊走 —— 直接在正向圖上從 B 往外走會付成 cost(A)。
 *
 * 現行的 `reverseFloodFromWorkplace` 就是後者（BUG-237）。既有測試沒抓到，
 * 因為它們只用單一路型 —— 全部一樣貴時正反向剛好相等。
 */
describe('transposeRoadCellGraph', () => {
  it('should be exactly the edge set with every arrow reversed', () => {
    // 全域比對，不抽樣。權重跟著邊走。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const t = transposeRoadCellGraph(g);
    const flipped = new Set(
      [...edgeSet(g)].map(s => { const [a, b, w] = s.split('|'); return `${b}|${a}|${w}`; }),
    );
    expect(edgeSet(t)).toEqual(flipped);
  });

  it('should give the same cost as a forward flood, for every pair', () => {
    // 這是轉置存在的唯一理由：在轉置圖上從工作往外跑一次，等於對每一個家
    // 各跑一次正向 flood。路型混合時才測得出來。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const t = transposeRoadCellGraph(g);

    for (const targetKey of ['8,3', '0,1', '6,1,1']) {
      const target = g.indexOf.get(targetKey)!;
      const reverse = floodRoadCellGraph(t, [target], BIG);
      for (let home = 0; home < g.nodeKeys.length; home++) {
        const forward = floodRoadCellGraph(g, [home], BIG)[target]!;
        expect(reverse[home]!, `${g.nodeKeys[home]} → ${targetKey} 的成本不一致`)
          .toBe(forward);
      }
    }
  });

  it('fixture sanity: the graph is genuinely asymmetric', () => {
    // 若正向圖本身就對稱（每條邊的反向邊權重相同），轉置等於沒做事，
    // 上一條測試就是空轉的。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(edgeSet(g), '圖是對稱的 —— 轉置測不出東西，fixture 的路型不夠混合')
      .not.toEqual(edgeSet(transposeRoadCellGraph(g)));
  });

  it('should preserve node identity and CSR shape', () => {
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const t = transposeRoadCellGraph(g);
    expect(t.nodeKeys).toEqual(g.nodeKeys);
    expect(t.targets.length).toBe(g.targets.length);
    expect(t.offsets.length).toBe(g.offsets.length);
    expect(t.offsets[g.nodeKeys.length]).toBe(g.targets.length);
    expect([...t.nodeX]).toEqual([...g.nodeX]);
    expect([...t.nodeLevel]).toEqual([...g.nodeLevel]);
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
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphTranspose.test.ts`
Expected: PASS（4 條）

- [ ] **Step 5: 回退驗證（兩次）**

**(a)** 把 `weights[at] = graph.weights[j]!;` 改成
`weights[at] = graph.weights[graph.offsets[dst]!]!;`（取端點的第一條邊，
模擬「權重跟著端點走」）。
Expected:「should be exactly the edge set with every arrow reversed」與
「should give the same cost as a forward flood」都轉紅。改回。

**(b)** 把 `targets[at] = i;` 改成 `targets[at] = dst;`（沒有真的反轉方向）。
Expected:「should be exactly the edge set with every arrow reversed」轉紅。改回。

- [ ] **Step 6: 記 BUG-237**

在 `BUGS.md` 末尾加上：

```markdown
## BUG-237 已修：反向 flood 付錯端點的成本

| ID | 位置 | 問題 | 嚴重度 |
|---|---|---|---|
| BUG-237 | workplace-distance.worker.ts:88-129 | 從工作地點反向擴散時付 `roadTileCost(鄰居)`，也就是來源那格的價格，而正向是付目的地那格 | Medium |

**發現方式：** 送 Codex 審核 BUG-109 的實作計畫時，它比對了同步與非同步兩條
路徑，指出現行 worker 的反向擴散與同步版本不一致。

成本加在**目的地**那一格。正向邊 A→B 的價格是 `cost(B)`；反向 Dijkstra 從 B
走回 A 應該仍用 `cost(B)`，但現行 worker 用的是 `cost(A)`：

```ts
const rt = getRoadType(nx, ny);            // 鄰居 = 反向的下一格 = 正向的來源
const newCost = cur.cost + roadTileCost(rt);
```

**既有測試為什麼沒抓到：** 它們只用單一路型（`WorkplaceDistanceWorker.test.ts`）。
所有格子一樣貴時，正向與反向剛好相等。路型混合的城市（高速 9、鄉道 60，
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

## Task 5: 序列化

**Files:**
- Create: `src/core/road/RoadCellGraphBuffer.ts`
- Test: `src/core/road/__tests__/RoadCellGraphBuffer.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces: `GRAPH_BUFFER_VERSION = 1`、
  `serializeRoadCellGraph(graph): ArrayBuffer`、
  `deserializeRoadCellGraph(buffer): RoadCellGraph`（版本不符丟 `Error`）、
  `graphBufferNodeCount(buffer): number`、
  `layoutOf(n, e)`（匯出僅供測試對齊性）

- [ ] **Step 1: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadCellGraphBuffer.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import { buildRoadCellGraph, levelOfKey } from '../RoadCellGraph';
import {
  serializeRoadCellGraph, deserializeRoadCellGraph, graphBufferNodeCount,
  GRAPH_BUFFER_VERSION, layoutOf,
} from '../RoadCellGraphBuffer';

describe('RoadCellGraph serialization', () => {
  it('should round-trip every field exactly', () => {
    // 位元組佈局錯位不會報錯 —— 它會把一段 Uint32 當 Uint16 讀出一堆看似
    // 合理的距離。所以每個欄位都要比。
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

  it('should align every section to its element size, for any n and e', () => {
    // 直接斷言佈局的對齊性，而不是「用某個 fixture 跑跑看會不會丟 RangeError」——
    // 那種驗證會因為 fixture 的節點數奇偶剛好對齊而靜默失效。
    // 這裡掃一大片 (n, e) 組合，任何一組沒對齊都會抓到。
    for (let n = 0; n < 40; n++) {
      for (let e = 0; e < 40; e++) {
        const L = layoutOf(n, e);
        expect(L.oNodeX % 2, `n=${n} e=${e} nodeX 沒對齊`).toBe(0);
        expect(L.oNodeY % 2, `n=${n} e=${e} nodeY 沒對齊`).toBe(0);
        expect(L.oOffsets % 4, `n=${n} e=${e} offsets 沒對齊`).toBe(0);
        expect(L.oTargets % 4, `n=${n} e=${e} targets 沒對齊`).toBe(0);
        expect(L.oWeights % 2, `n=${n} e=${e} weights 沒對齊`).toBe(0);
        expect(L.total, `n=${n} e=${e} 總長度不足`)
          .toBeGreaterThanOrEqual(L.oWeights + e * 2);
      }
    }
  });

  it('should rebuild elevated keys from coordinates', () => {
    // key 字串不序列化（省 structured clone），所以反序列化端必須組得回來 ——
    // 高架的 key 有第三段。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    const back = deserializeRoadCellGraph(serializeRoadCellGraph(g));
    expect(back.nodeKeys.some(k => levelOfKey(k) > 0), '高架的 key 沒有帶樓層').toBe(true);
    for (let i = 0; i < back.nodeKeys.length; i++) {
      expect(back.indexOf.get(back.nodeKeys[i]!)).toBe(i);
    }
  });

  it('should report the node count without deserializing', () => {
    // 空圖判斷要用這個 —— 空圖的 buffer 不是 0 bytes，它有 header。
    const { lookup } = testCity();
    const g = buildRoadCellGraph(lookup);
    expect(graphBufferNodeCount(serializeRoadCellGraph(g))).toBe(g.nodeKeys.length);
  });

  it('should round-trip an empty graph, and report zero nodes', () => {
    // 空圖的 buffer 有 header，byteLength 不是 0。任何「byteLength === 0」的
    // 判斷都擋不到它。
    const empty = { nodeKeys: [], indexOf: new Map(), offsets: new Uint32Array(1),
      targets: new Uint32Array(0), weights: new Uint16Array(0),
      nodeX: new Uint16Array(0), nodeY: new Uint16Array(0), nodeLevel: new Uint8Array(0) };
    const buf = serializeRoadCellGraph(empty);
    expect(buf.byteLength, '空圖的 buffer 不該是 0 bytes —— 它有 header')
      .toBeGreaterThan(0);
    expect(graphBufferNodeCount(buf)).toBe(0);
    expect(deserializeRoadCellGraph(buf).nodeKeys).toEqual([]);
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
 * 佈局（little-endian）：
 *
 *   Header 16 bytes: nodeCount u32 / edgeCount u32 / version u32 / reserved u32
 *   nodeX     Uint16[n]      （align 2）
 *   nodeY     Uint16[n]      （align 2）
 *   nodeLevel Uint8[n]
 *   offsets   Uint32[n+1]    （align 4）
 *   targets   Uint32[e]      （align 4）
 *   weights   Uint16[e]      （align 2）
 *
 * 權重是 `Uint16`（成本是整數，最大 60），所以不需要 8-byte 對齊 ——
 * 這是成本整數化順帶簡化掉的一段。
 *
 * **key 字串不序列化** —— 從座標與樓層現組，省下數百個字串的 structured clone。
 */
export const GRAPH_BUFFER_VERSION = 1;

const HEADER_BYTES = 16;
const align4 = (n: number) => (n + 3) & ~3;

/**
 * 各段的起始位移。序列化與反序列化共用，避免兩邊算式漂移。
 * 匯出僅供測試直接檢查對齊性。
 */
export function layoutOf(n: number, e: number) {
  const oNodeX = HEADER_BYTES;              // 16，已 align 4
  const oNodeY = oNodeX + n * 2;
  const oLevel = oNodeY + n * 2;            // Uint16 段長度必為偶數
  const oOffsets = align4(oLevel + n);      // Uint32 需要 align 4
  const oTargets = oOffsets + (n + 1) * 4;
  const oWeights = oTargets + e * 4;        // 已 align 4，Uint16 只需 align 2
  return { oNodeX, oNodeY, oLevel, oOffsets, oTargets, oWeights, total: oWeights + e * 2 };
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
  new Uint16Array(buf, L.oWeights, e).set(graph.weights);
  return buf;
}

/** 不反序列化就讀出節點數。空圖判斷用這個 —— 空圖的 buffer 有 header，不是 0 bytes。 */
export function graphBufferNodeCount(buffer: ArrayBuffer): number {
  if (buffer.byteLength < HEADER_BYTES) return 0;
  return new DataView(buffer).getUint32(0, true);
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
    weights: new Uint16Array(buffer, L.oWeights, e),
    nodeX, nodeY, nodeLevel,
  };
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadCellGraphBuffer.test.ts`
Expected: PASS（6 條）

- [ ] **Step 5: 回退驗證（三次）**

**(a)** 把 `layoutOf` 的 `align4(oLevel + n)` 改成 `oLevel + n`。
Expected:「should align every section to its element size, for any n and e」轉紅
（n 不是 4 的倍數時 `oOffsets % 4 !== 0`）。**這一條與 fixture 無關 ——
它掃 40×40 組 (n, e)，不可能剛好全部對齊。** 改回。

**(b)** 把版本檢查整段拿掉。
Expected:「should refuse a buffer with the wrong version」轉紅。改回。

**(c)** 把 `graphBufferNodeCount` 改成 `return buffer.byteLength === 0 ? 0 : 1;`
（模擬「用 byteLength 判斷空圖」的錯誤）。
Expected:「should round-trip an empty graph, and report zero nodes」與
「should report the node count without deserializing」都轉紅。改回。

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/core/road/RoadCellGraphBuffer.ts src/core/road/__tests__/RoadCellGraphBuffer.test.ts
git commit -m "feat(road): 路網圖的序列化 —— Uint16 權重，key 從座標現組"
```

---

## Task 6: 同步查詢改用核心（圖只建一次，對照舊實作逐格驗證）

**Files:**
- Modify: `src/core/service/RoadCoverageFlood.ts`
- Test: `src/core/road/__tests__/RoadDistanceParity.test.ts`

**Interfaces:**
- Consumes: Task 1–3
- Produces:
  - `roadDistanceToTargets(grid, home, targets, maxBudget, roadLookup?, graph?)` ——
    多一個**選用**的 `graph: RoadCellGraph`。既有五參數呼叫端一字不用改。
  - `roadDistanceToTargetsOnGrid(grid, home, targets, maxBudget)` ——
    舊的逐格實作，**永久保留**（見下）。

### 為什麼舊實作不刪

`roadDistanceToTargets` 的 `grid` 型別是 `ReadableGrid`，而 `ReadableGrid`
**只有 `getCell`** —— 沒有 `width`/`height`/`forEachCell`（`GridHelpers.ts:76-78`）。
`UnifiedRoadLookup` 建不出來，圖也就建不出來。全 repo 有 13 個呼叫端不傳
lookup（`RoadCoverageFlood.test.ts` 與 `RoadDistanceMinCost.test.ts`）。

所以「沒有 lookup」不是遷移殘骸，是這個 API 的一半契約。舊實作改名為
`roadDistanceToTargetsOnGrid` 保留，差異測試也永久保留 —— 它是唯一能持續
證明兩條路徑一致的東西。

### 為什麼圖要由呼叫端傳入

`roadDistanceToTargets` **每個市民呼叫一次**（`JobRelocation.ts:191`）。在圖裡
建一次是 O(路格數 × 4)；2436 人的城市一輪就是 2436 次建圖，比它省下的還多。
圖每個道路世代只變一次，所以由持有世代資訊的 `SimulationLoop` 建好傳入
（Task 8）。不傳時退化成自己建一張 —— 正確但慢，只給測試與零星呼叫用。

- [ ] **Step 1: 把舊實作改名**

在 `src/core/service/RoadCoverageFlood.ts`，把
`export function roadDistanceToTargets(` 改名為
`export function roadDistanceToTargetsOnGrid(`，**內容一字不動**，
刪掉它的 `roadLookup` 參數（它現在只服務沒有 lookup 的呼叫端，
函式體裡 `rl` 恆為 null 的分支保留、`rl` 為真的分支刪除），並在上方加：

```ts
/**
 * 家 → 一組目標的道路距離，**只看地面**。
 *
 * 給只有 `ReadableGrid` 的呼叫端 —— 那個介面只有 `getCell`，建不出
 * `UnifiedRoadLookup`，也就建不出路網圖。有 lookup 時請用
 * `roadDistanceToTargets`，它會走圖並且是樓層感知的。
 *
 * 兩者的一致性由 `RoadDistanceParity.test.ts` 持續守著。
 */
```

- [ ] **Step 2: 寫紅燈測試**

建立 `src/core/road/__tests__/RoadDistanceParity.test.ts`，貼上共用測試素材，再加：

```ts
import { describe, it, expect } from 'vitest';
import {
  roadDistanceToTargets, roadDistanceToTargetsOnGrid,
} from '../../service/RoadCoverageFlood';
import { buildRoadCellGraph } from '../RoadCellGraph';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { RoadType } from '../types';

/**
 * 重構的證明，而且是永久的。
 *
 * 新實作走圖，舊實作直接掃格子。**在沒有高架的世界裡**，同一組查詢兩者必須
 * 逐格精確相等 —— 用 toBe。成本是整數，所以「精確相等」是可達成的契約
 * （浮點下不是：加法沒有結合律）。
 *
 * 有高架的世界裡兩者本來就該不同 —— 那正是 BUG-109。那一半由
 * `WorkerGraphParity` 與 `ElevatedAwareReachability` 守。
 */
function flatCity() {
  const { grid } = testCity();
  // 同一個 grid，但不掛任何高架段。
  return { grid, lookup: new UnifiedRoadLookup(grid, new ElevationManager()) };
}

describe('roadDistanceToTargets parity with the ground-only implementation', () => {
  it('should match the ground-only result for every home, exactly', () => {
    const { grid, lookup } = flatCity();
    const cells = buildingCells(grid);
    const targets = new Set(cells);
    const graph = buildRoadCellGraph(lookup);

    for (const homeKey of cells) {
      const [hx, hy] = homeKey.split(',').map(Number);
      const home = { x: hx!, y: hy! };
      const a = roadDistanceToTargets(grid, home, targets, 1080, lookup, graph);
      const b = roadDistanceToTargetsOnGrid(grid, home, targets, 1080);

      expect([...a.keys()].sort(), `家 ${homeKey}：到得了的目標集合不同`)
        .toEqual([...b.keys()].sort());
      for (const [k, v] of b) {
        expect(a.get(k), `家 ${homeKey} → ${k}：成本不同`).toBe(v);
      }
    }
  });

  it('should agree at every budget', () => {
    const { grid, lookup } = flatCity();
    const targets = new Set(buildingCells(grid));
    const graph = buildRoadCellGraph(lookup);
    const home = { x: 0, y: 0 };
    for (const budget of [0, 9, 36, 60, 360, 1080]) {
      const a = roadDistanceToTargets(grid, home, targets, budget, lookup, graph);
      const b = roadDistanceToTargetsOnGrid(grid, home, targets, budget);
      expect([...a.keys()].sort(), `預算 ${budget}`).toEqual([...b.keys()].sort());
      for (const [k, v] of b) expect(a.get(k), `預算 ${budget} → ${k}`).toBe(v);
    }
  });

  it('should build its own graph when none is passed', () => {
    // 不傳圖也必須算得一樣 —— 只是慢。
    const { grid, lookup } = flatCity();
    const targets = new Set(buildingCells(grid));
    const home = { x: 0, y: 0 };
    expect(roadDistanceToTargets(grid, home, targets, 1080, lookup))
      .toEqual(roadDistanceToTargets(grid, home, targets, 1080, lookup,
        buildRoadCellGraph(lookup)));
  });

  it('should fall back to the ground-only path when there is no lookup', () => {
    const { grid } = flatCity();
    const targets = new Set(buildingCells(grid));
    const home = { x: 0, y: 0 };
    expect(roadDistanceToTargets(grid, home, targets, 1080, null))
      .toEqual(roadDistanceToTargetsOnGrid(grid, home, targets, 1080));
  });

  it('should differ from the ground-only path once a viaduct is the only link', () => {
    // 這一條證明走圖不是白工。testCity 有高架，地面版本看不到它。
    const { grid, lookup } = testCity();          // 含高架
    const targets = new Set(buildingCells(grid));
    const home = { x: 0, y: 0 };
    const withGraph = roadDistanceToTargets(grid, home, targets, 1080, lookup,
      buildRoadCellGraph(lookup));
    const groundOnly = roadDistanceToTargetsOnGrid(grid, home, targets, 1080);
    expect(withGraph, '有高架卻與地面版本完全相同 —— 高架沒有被走到')
      .not.toEqual(groundOnly);
  });
});
```

- [ ] **Step 3: 跑測試確認轉紅**

Run: `npx vitest run src/core/road/__tests__/RoadDistanceParity.test.ts`
Expected: FAIL，`roadDistanceToTargets is not a function`（已改名）

- [ ] **Step 4: 實作新版**

在 `src/core/service/RoadCoverageFlood.ts` 加上：

```ts
import {
  buildRoadCellGraph, floodRoadCellGraph, seedNodesFor, attachAtSettledNode,
  type RoadCellGraph,
} from '../road/RoadCellGraph';

/**
 * 家 → 一組目標的道路距離。
 *
 * 走 `RoadCellGraph`，與 workplace-distance worker **同一個 flood 核心** ——
 * 兩條路不可能給出不同的決策（BUG-109）。
 *
 * `graph` 傳進來時直接用。**應該要傳** —— 這個函式每個市民呼叫一次，而建圖
 * 是 O(路格數 × 4)；圖每個道路世代只變一次，由呼叫端持有才不會每次重建。
 * 不傳時自己建一張，正確但慢。
 *
 * 沒有 `roadLookup` 就沒有樓層資訊，退回只看地面的
 * `roadDistanceToTargetsOnGrid`（`ReadableGrid` 建不出 lookup）。
 *
 * 找齊目標就提早結束 —— 舊實作有這個早退，少了它同步路徑會永遠跑滿預算。
 */
export function roadDistanceToTargets(
  grid: ReadableGrid,
  home: { x: number; y: number },
  targets: Set<string>,
  maxBudget: number,
  roadLookup?: UnifiedRoadLookup | null,
  graph?: RoadCellGraph,
): Map<string, number> {
  if (!roadLookup) return roadDistanceToTargetsOnGrid(grid, home, targets, maxBudget);

  const result = new Map<string, number>();
  if (targets.size === 0) return result;

  const g = graph ?? buildRoadCellGraph(roadLookup);
  const seeds = seedNodesFor(g, home.x, home.y, ZONE_ROAD_REACH);
  if (seeds.length === 0) return result;

  floodRoadCellGraph(g, seeds, maxBudget, (node, cost) => {
    attachAtSettledNode(g, node, cost, ZONE_ROAD_REACH,
      (x, y) => targets.has(toPosKey(x, y)), result);
    return result.size >= targets.size;   // 找齊就停
  });
  return result;
}
```

- [ ] **Step 5: 跑測試確認轉綠**

Run: `npx vitest run src/core/road/__tests__/RoadDistanceParity.test.ts`
Expected: PASS（5 條）

**若不相等,不要改測試去遷就實作。** 逐項比對:種子範圍、附掛 reach、
預算截斷的比較方向（`>` vs `>=`）、`(0,0)` 有沒有被涵蓋。

- [ ] **Step 6: 跑完整測試套件**

Run: `npx vitest run`
Expected: 全綠。`JobRelocation.test.ts` 與 SimulationLoop 的相關測試都會經過
新的 `roadDistanceToTargets`。

- [ ] **Step 7: 回退驗證（兩次）**

**(a)** 把 `attachAtSettledNode` 的呼叫從 `onSettle` 內搬到 flood 之後
（用回傳的 cost 陣列依節點索引順序逐節點附掛）。
Expected:「should match the ground-only result for every home」轉紅
（附掛順序不再是成本遞增）。改回。

**(b)** 把 `if (!roadLookup) return roadDistanceToTargetsOnGrid(...)` 改成
`if (!roadLookup) return new Map();`。
Expected:「should fall back to the ground-only path when there is no lookup」轉紅。改回。

> **明講一個不會轉紅的：** 把 `return result.size >= targets.size;` 改成
> `return false;`（拿掉早退）**不會轉紅**，因為早退只影響效能不影響結果。
> 這是預期的 —— 正確性由結果相等保證，效能不寫測試（那會是脆弱的計時測試）。
> 不要為了讓它轉紅而加斷言。

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/core/service/RoadCoverageFlood.ts src/core/road/__tests__/RoadDistanceParity.test.ts
git commit -m "refactor(road): 同步的距離查詢改走路網圖，圖由呼叫端持有"
```

---

## Task 7: worker 改用轉置圖

**Files:**
- Modify: `src/workers/workplace-distance.worker.ts`
- Modify: `src/core/workplace/WorkplaceDistanceTypes.ts`
- Modify: `src/core/workplace/__tests__/WorkplaceDistanceWorker.test.ts`（遷移）
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

/**
 * 本設計的硬約束：**worker 算的必須等於同步查詢算的。**
 *
 * 兩者共用同一個 flood 核心，所以這條理應永遠綠 —— 它守的是「有人哪天為了
 * 效能在 worker 裡另外寫一份」。城市有高架、匝道，而且**路型混合** ——
 * 全部同路型時正反向剛好相等，BUG-237 就是這樣漏掉的。
 *
 * 用 `.toBe`：成本是整數，加法可交換，所以正向與反向必然位元相同。
 * （浮點下這條在數學上就不可能通過。）
 */
describe('worker result equals the synchronous query', () => {
  it('should agree on every home → workplace cost, exactly', () => {
    const { grid, lookup } = testCity();
    const forward = buildRoadCellGraph(lookup);
    const transposed = serializeRoadCellGraph(transposeRoadCellGraph(forward));
    const cells = buildingCells(grid);
    const isBuilding = (x: number, y: number) => {
      const c = grid.getCell(x, y);
      return c !== null && c.roadType === RoadType.NONE;
    };

    let compared = 0;
    for (const wpKey of cells) {
      const [wx, wy] = wpKey.split(',').map(Number);
      const fromWorker = reverseFloodFromGraph(
        transposed, { pos: wpKey, x: wx!, y: wy! }, 1080, isBuilding,
      );
      for (const homeKey of cells) {
        const [hx, hy] = homeKey.split(',').map(Number);
        const sync = roadDistanceToTargets(
          grid, { x: hx!, y: hy! }, new Set([wpKey]), 1080, lookup, forward,
        );
        const a = fromWorker[homeKey];
        const b = sync.get(wpKey);
        if (b === undefined) {
          expect(a, `${homeKey} → ${wpKey}：同步說到不了，worker 說到得了`).toBeUndefined();
        } else {
          expect(a, `${homeKey} → ${wpKey}：成本不同`).toBe(b);
        }
        compared++;
      }
    }
    expect(compared, '一組都沒比到').toBeGreaterThan(100);
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
      serializeRoadCellGraph(transposeRoadCellGraph(g)), wp, 1080, isBuilding);
    const withForward = reverseFloodFromGraph(serializeRoadCellGraph(g), wp, 1080, isBuilding);
    expect(withForward, '正向圖與轉置圖給出相同結果 —— fixture 的路型不夠混合')
      .not.toEqual(withTranspose);
  });
});
```

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/workplace/__tests__/WorkerGraphParity.test.ts`
Expected: FAIL，`reverseFloodFromGraph is not a function`

- [ ] **Step 3: 改寫 worker**

在 `src/workers/workplace-distance.worker.ts`：刪掉 `FOUR_DIRS`、`class MinHeap`、
`reverseFloodFromWorkplace`、`computeAllDistances`（`BYTES_PER_CELL` 留著，
訊息處理端還要用它判斷建築格），新增：

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

訊息處理端**保留現有的 `typeof self !== 'undefined'` 防護**，只改內容：

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

- [ ] **Step 4: 遷移 `WorkplaceDistanceWorker.test.ts`**

該檔目前 import 兩個已刪除的函式：

```ts
import { reverseFloodFromWorkplace, computeAllDistances } from '../../../workers/workplace-distance.worker';
```

**這個 fixture 沒有 Grid。** 它只有 `Map<string, RoadType>` 與手工組出來的
`ArrayBuffer`（`makeGridBuffer`），所以**不能**直接餵給
`UnifiedRoadLookup.fromGrid()` —— 那需要 `width` / `height` / `getCell` /
`forEachCell`。（第 3 版寫成「fixture 是完整的 Grid」，那是錯的。）

先在該檔加一個 adapter，把既有的 `roads` map 轉成 `fromGrid()` 收得下的形狀：

```ts
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../../road/RoadCellGraph';
import { serializeRoadCellGraph } from '../../road/RoadCellGraphBuffer';

/**
 * 把既有測試的 `roads` map 包成 `UnifiedRoadLookup` 收得下的 grid。
 *
 * 這些 fixture 從來沒有真的 `Grid` —— 只有一個 map 與手捏的 buffer。
 * `fromGrid()` 需要 width/height/getCell/forEachCell，所以在這裡補齊。
 */
function gridFromRoads(width: number, height: number, roads: Map<string, RoadType>) {
  return {
    width, height,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: roads.get(`${x},${y}`) ?? RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) fn(this.getCell(x, y)!, x, y);
    },
  };
}

/** 轉置並序列化 —— worker 要的就是這個。 */
function transposedBuffer(width: number, height: number, roads: Map<string, RoadType>): ArrayBuffer {
  const lookup = UnifiedRoadLookup.fromGrid(gridFromRoads(width, height, roads));
  return serializeRoadCellGraph(transposeRoadCellGraph(buildRoadCellGraph(lookup)));
}
```

然後每個
`reverseFloodFromWorkplace(view, w, h, wp, budget)` 改成：

```ts
const isBuilding = (x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  return view.getUint8((y * w + x) * BYTES_PER_CELL + 5) === 0;
};
reverseFloodFromGraph(transposedBuffer(w, h, roads), wp, budget, isBuilding);
```

`computeAllDistances` 的測試改成逐個工作地點呼叫 `reverseFloodFromGraph`。

**預算數字要一起換算。** 這個檔案把預算寫死成 `60`（舊尺度），成本整數化後
同樣的涵蓋範圍是 **1080**。逐一檢查每個 `, 60)`，別讓「涵蓋不到」被誤讀成迴歸。

**注意:這些測試原本只用單一路型,所以它們測不出 BUG-237。** 遷移時保持原樣
即可 —— 硬約束由 `WorkerGraphParity.test.ts` 守。

- [ ] **Step 5: 跑測試確認轉綠**

Run: `npx vitest run src/core/workplace/`
Expected: PASS（新的 2 條 + 遷移後的既有測試）

- [ ] **Step 6: 回退驗證（兩次）**

**(a)** 在 `WorkerGraphParity.test.ts` 裡把傳給 `reverseFloodFromGraph` 的
buffer 換成**正向**圖（`serializeRoadCellGraph(forward)`）。
Expected:「should agree on every home → workplace cost」轉紅。改回。

**(b)** 把 `reverseFloodFromGraph` 裡的 `seedNodesFor(graph, wp.x, wp.y, ZONE_ROAD_REACH)`
改成 `seedNodesFor(graph, wp.x, wp.y, 1)`（縮小 reach）。
Expected:「should agree on every home → workplace cost」轉紅
（同步用 2，worker 用 1，內圈的工作地點對不上）。改回。

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/workers/workplace-distance.worker.ts src/core/workplace/
git commit -m "refactor(worker): workplace 距離改走轉置圖，與同步查詢共用核心"
```

---

## Task 8: 接線、刪閘門、重寫 BUG-109 的驗收測試

**Files:**
- Modify: `src/core/workplace/WorkplaceDistanceClient.ts`
- Modify: `src/core/workplace/WorkplaceDistanceCache.ts`
- Modify: `src/core/simulation/SimulationLoop.ts`（刪閘門、圖快取、新增 `getRoadLookup()`）
- Rewrite: `src/core/workplace/__tests__/ElevatedAwareReachability.test.ts`
- Modify: `src/core/workplace/__tests__/WorkplaceDistanceCache.test.ts`
- Create: `src/core/simulation/__tests__/ElevatedRoadInvalidatesGraph.test.ts`
- Modify: `BUGS.md`、`TODO.md`

**Interfaces:**
- Consumes: Task 1–7
- Produces: 無新公開 API

### 為什麼 `ElevatedAwareReachability.test.ts` 必須重寫

那個檔案有**五個**案例（第 3 版寫成四個，漏了最後一個），其中四個測的是
**閘門**，不是行為：

| 案例 | 現在靠什麼通過 | 閘門刪掉後 | 處置 |
|---|---|---|---|
| employ someone whose only route is a viaduct | 灌一份**謊報的** ground-only 快取（`distances: {}`），閘門讓 fallback 獲勝 | 謊報的快取會被採信 → **轉紅** | 重寫成用真管線暖機 |
| leave the ready cache untouched | 閘門「拒用但不清除」 | 閘門不存在，語意消失 | 刪除 |
| still use the cache in a city with no elevated road | 沒有高架 → 閘門放行 → 採信謊報快取 → 沒人就業 | 仍然有效（快取一律採信） | **保留**，它是負向控制 |
| not disable the cache for an elevated RAIL line | 閘門的過度攔截（`hasAnySegment` 是裸的 `Map.size`） | 閘門不存在，語意消失 | 刪除 |
| **disable the cache for an elevated road** | 閘門的正向行為 | 閘門不存在，語意反轉 | 刪除，由新的驗收案例取代 |

重寫的方向：不再灌謊報的快取，而是**用真正的管線暖機** —— 建圖、轉置、
序列化，在 FakeWorker 裡同步跑 `reverseFloodFromGraph` 回填。然後斷言
高架另一端的工作真的有人做。**那才是 BUG-109 的驗收條件：快取本身變成
樓層感知的。**

刪掉的三條要在檔頭註解裡寫明理由，別讓後人以為是漏掉的。

- [ ] **Step 1: 先遷移 `WorkplaceDistanceCache.test.ts`（否則後面每一步都紅）**

`requestUpdate` 在 Step 3 會多一個 `graphBuffer` 參數。現有呼叫：

```ts
const result = cache.requestUpdate(10, 10, new ArrayBuffer(10), [], 60);
```

**這個檔案目前沒有 grid 也沒有 lookup**，所以要先建。在檔頭加：

```ts
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { buildRoadCellGraph } from '../../road/RoadCellGraph';
import { serializeRoadCellGraph } from '../../road/RoadCellGraphBuffer';

/** 一條直路就夠 —— 這個檔案測的是 cache 的狀態機，不是路網。 */
function roadGraphBuffer(): ArrayBuffer {
  const grid = new Grid(10, 10);
  for (let x = 0; x < 10; x++) grid.setCell(x, 5, { roadType: RoadType.TWO_LANE });
  return serializeRoadCellGraph(buildRoadCellGraph(UnifiedRoadLookup.fromGrid(grid)));
}
```

然後把呼叫改成：

```ts
const result = cache.requestUpdate(10, 10, new ArrayBuffer(10), roadGraphBuffer(), [], 1080);
```

**「沒有 client」那類測試也要傳有效的非空圖** —— 否則它可能只是因為空圖
提前 return false 而綠燈，根本沒驗到 no-client 的路徑（審核發現）。

並新增一條（空圖要回 false）：

```ts
it('should refuse to request an update with an empty graph', () => {
  // 空圖送出去，worker 會回一張空表，而空表會被標成 READY —— 全城變成
  // 互相到不了。寧可維持 EMPTY 走 fallback。
  //
  // 判斷要看 header 的 nodeCount，不是 byteLength：空圖的 buffer 有 header，
  // 長度是 20 bytes 而不是 0。
  const cache = new WorkplaceDistanceCache(
    new WorkplaceDistanceClient(new FakeWorker() as unknown as Worker),
  );
  const emptyGraph = serializeRoadCellGraph({
    nodeKeys: [], indexOf: new Map(), offsets: new Uint32Array(1),
    targets: new Uint32Array(0), weights: new Uint16Array(0),
    nodeX: new Uint16Array(0), nodeY: new Uint16Array(0), nodeLevel: new Uint8Array(0),
  });
  expect(emptyGraph.byteLength, '空圖的 buffer 應該有 header').toBeGreaterThan(0);
  expect(cache.requestUpdate(10, 10, new ArrayBuffer(10), emptyGraph, [], 1080)).toBe(false);
});
```

（`FakeWorker` 照抄 `ElevatedAwareReachability.test.ts` 裡那一個五方法的 stub。
repo 裡**沒有** `fakeClient()` 這個 helper。）

- [ ] **Step 2: 跑測試確認轉紅**

Run: `npx vitest run src/core/workplace/__tests__/WorkplaceDistanceCache.test.ts`
Expected: FAIL（新的空圖測試紅；`requestUpdate` 參數數量錯）

- [ ] **Step 3: client 與 cache 加上 graphBuffer**

`WorkplaceDistanceClient.compute()` 在 `gridBuffer` 之後加
`graphBuffer: ArrayBuffer`，放進 postMessage payload。

`WorkplaceDistanceCache.requestUpdate()` 同樣加參數，並在最前面加空圖判斷：

```ts
    // 空圖代表城市還沒有路。送出去只會拿回一張空表，而空表會被標成 READY ——
    // 全城互相到不了。寧可維持 EMPTY 走 fallback。
    //
    // 看 header 的 nodeCount，不是 byteLength —— 空圖的 buffer 有 header。
    if (graphBufferNodeCount(graphBuffer) === 0) return false;
```

- [ ] **Step 4: SimulationLoop 刪閘門、每個道路世代建一次圖**

刪掉兩處：

```ts
const canUseWpCache = !this._elevationManager || !this._elevationManager.hasAnyElevatedRoad();
```

以及所有 `canUseWpCache &&` 的用法。同時刪掉它們上方描述舊限制的註解
（「Correctness wins over speed…」與「It is currently unreachable…」）——
那些狀況已經不存在。

新增一個以道路世代為鍵的圖快取：

```ts
  /**
   * 路網圖，每個道路世代重建一次。
   *
   * 同步查詢每個市民呼叫一次 `roadDistanceToTargets`，而建圖是
   * O(路格數 × 4) —— 每次重建會比它省下的還多。圖只在路網改變時才變，
   * 所以在這裡持有，正向給同步查詢，轉置後序列化給 worker。
   */
  private _cellGraph: RoadCellGraph | null = null;
  private _cellGraphGeneration = -1;

  private getCellGraph(): RoadCellGraph | null {
    const lookup = this._roadLookup;
    if (!lookup) return null;
    const gen = this.commuteCache.roadGeneration;
    if (this._cellGraph === null || this._cellGraphGeneration !== gen) {
      this._cellGraph = buildRoadCellGraph(lookup);
      this._cellGraphGeneration = gen;
    }
    return this._cellGraph;
  }

  /**
   * 對稱於 `setRoadLookup`。BUG-109 的驗收測試需要拿同一份 lookup 自己建圖
   * 來比對快取的答案 —— 沒有 getter 的話它只能另外組一份，兩份不一致時
   * 測試會說謊。
   */
  getRoadLookup(): UnifiedRoadLookup | null {
    return this._roadLookup;
  }
```

> **`this.commuteCache.roadGeneration`，不是 `this.state.commuteCache`** ——
> `commuteCache` 是 `SimulationLoop` 自己的欄位（`SimulationLoop.ts:1451`
> 等處這樣用）。第 3 版寫錯了。
>
> `getRoadLookup()` 目前**不存在**，只有 `setRoadLookup` 與私有 `_roadLookup`
> （`SimulationLoop.ts:88, 191`）。這一步要新增它。

三處 `roadDistanceToTargets` 的呼叫（`SimulationLoop.ts` 約 1285、1369、1623 行）
都多傳一個 `this.getCellGraph() ?? undefined`。

`requestUpdate` 的呼叫改成（**不要在 `assignCitizenHousing()` 裡 `return`** ——
那會連同步指派一起跳過；只跳過快取請求）：

```ts
      const graph = this.getCellGraph();
      if (graph !== null) {
        const graphBuffer = serializeRoadCellGraph(transposeRoadCellGraph(graph));
        this.wpDistCache.requestUpdate(
          this.state.grid.width, this.state.grid.height,
          copy, graphBuffer, wpPositions,
          DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget,
        );
      }
      // graph 為 null（沒有 lookup）時不請求更新，這一輪照常走同步指派。
```

- [ ] **Step 5: 重寫 `ElevatedAwareReachability.test.ts`**

保留 `serviceBothSides`、`bridgedCity` 的骨架與 `useSeededRandom()`。改動：

1. **刪掉** `cache.populateSync([{ workplacePos: WORK, distances: {} }])` 那一行 ——
   不再灌謊報的快取。
2. **`bridgedCity` 混入不同路型。** 目前它全部是 `TWO_LANE`（15 節點 28 邊、
   權重全 36），邊集**完全對稱**，於是正向圖與轉置圖一模一樣 —— Step 7(b) 的
   回退驗證會空轉（審核實算確認）。把高架那一段改成 `RoadType.HIGHWAY`：
   既讓路型混合，也更符合「高架快速道路」的語意。

   ```ts
   // 高架段改用 HIGHWAY（每格 9），地面維持 TWO_LANE（每格 36）。
   // 路型必須混合，否則正向圖與轉置圖相同，BUG-237 那一類的錯誤就測不出來。
   ```

   改完後在同一檔加一條 fixture 健全性檢查，把這件事釘住：

   ```ts
   it('fixture sanity: bridgedCity really mixes road tiers', () => {
     const { loop } = bridgedCity();
     const g = buildRoadCellGraph(loop.getRoadLookup()!);
     expect(new Set(g.weights).size, 'bridgedCity 只有一種路型 —— 正反向圖無法區分')
       .toBeGreaterThan(1);
   });
   ```

3. `FakeWorker` 改成**真的算**：收到 `COMPUTE` 就同步跑 `reverseFloodFromGraph`
   並回呼 `onmessage`：

```ts
class ComputingFakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(req: WDWorkerRequest): void {
    if (req.type !== 'COMPUTE') return;
    const view = new DataView(req.gridBuffer as ArrayBuffer);
    const isBuilding = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= req.gridWidth || y >= req.gridHeight) return false;
      return view.getUint8((y * req.gridWidth + x) * 12 + 5) === 0;
    };
    const entries = req.workplaces.map(wp => ({
      workplacePos: wp.pos,
      distances: reverseFloodFromGraph(req.graphBuffer, wp, req.maxBudget, isBuilding),
    }));
    this.onmessage?.({ data: { type: 'RESULT', requestId: req.requestId, entries } });
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}
```

4. **測試必須是 `async`，而且要等一個 microtask。**

   `ComputingFakeWorker` 在 `postMessage()` 裡同步回呼，回覆不會遺失
   （`WorkplaceDistanceClient` 先登記 pending 再 `postMessage`），但
   `.then(applyResult)` 仍排在 **microtask**。審核用探針實測：

   ```
   postMessage 返回後立即：computing
   下一個 microtask     ：ready
   ```

   所以「連續 24 次 `tick()` 然後斷言 `isReady`」**在正確程式碼上會失敗**，
   而且那 24 次 tick 全發生在 READY 之前 —— 就業結果其實來自同步 fallback，
   什麼也沒證明。第 3 版就是這樣寫的。

5. 案例改成：

```ts
/** 讓已排入的 microtask 跑完。 */
const flush = () => new Promise<void>(r => setTimeout(r, 0));

it('should employ someone whose only route to work is a viaduct, from the cache', async () => {
  // BUG-109 的驗收條件。以前這裡靠「有高架就別用快取」的閘門；現在快取
  // 本身就是樓層感知的，所以要斷言的是**快取真的 READY、真的被讀、答案正確**。
  const { state, loop, cache } = bridgedCity();

  loop.tick();                 // 觸發 requestUpdate
  await flush();               // 讓 worker 回覆的 .then 跑完
  expect(cache.isReady, '快取沒有變成 READY —— 高架城市仍然沒在用快取').toBe(true);

  // READY 之後才開始觀察就業，否則看到的是同步 fallback 的結果。
  const spy = vi.spyOn(cache, 'getDistancesFromHome');
  for (let i = 0; i < 24; i++) { loop.tick(); await flush(); }

  expect(spy, '快取 READY 了卻沒有被讀 —— 這條測的是 fallback').toHaveBeenCalled();
  expect(state.citizens.getPopulation()).toBeGreaterThan(0);
  expect(anyoneEmployedAtShop(state), '高架另一端的工作沒有人做').toBe(true);
});

it('should give the cache the same answer as the synchronous query', async () => {
  // 兩條路一致才是治本。挑高架兩端的一對家與工作直接比。
  const { loop, cache, state } = bridgedCity();
  loop.tick();
  await flush();
  expect(cache.isReady).toBe(true);

  const lookup = loop.getRoadLookup()!;          // Step 4 新增的 getter
  const [hx, hy] = HOME.split(',').map(Number);
  const sync = roadDistanceToTargets(
    state.grid, { x: hx!, y: hy! }, new Set([WORK]),
    DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget, lookup, buildRoadCellGraph(lookup),
  );
  expect(sync.get(WORK), '同步查詢自己就到不了，這條測不出東西').toBeDefined();
  expect(cache.getDistance(HOME, WORK), '快取與同步查詢不一致')
    .toBe(sync.get(WORK));
});
```

> `cache.getDistance`、`cache.getDistancesFromHome`、`cache.isReady`、
> `cache.populateSync` 都**確認存在**（`WorkplaceDistanceCache.ts:96/110/119/84`）。
> `loop.getRoadLookup` 由 Step 4 新增。

6. **刪掉三條閘門測試**：「leave the ready cache untouched」、「not disable the
   cache for an elevated RAIL line」、「disable the cache for an elevated road」。
   閘門不存在了，前兩條語意消失，第三條語意反轉。在檔頭註解裡寫明刪除的
   理由，別讓後人以為是漏掉的。
7. **保留**「still use the cache in a city with no elevated road」—— 它現在的
   意思是「快取一律被採信」，仍然是有效的負向控制。**但它也要改成 async +
   flush**，理由同上。

- [ ] **Step 6: 釘住「高架變更會讓圖失效」**

圖以 `commuteCache.roadGeneration` 為鍵快取，所以**高架道路變更必須讓那個
世代遞增**，否則圖會陳舊 —— 玩家蓋了橋，市民卻還在用沒有橋的圖。

審核追過現行路徑，目前是對的：

```
Game 蓋/拆高架道路 → markLaneGraphDirty(...) → commuteCache.bumpGeneration()
                                            → workplaceDistanceCache.invalidate()
```

**但那是呼叫紀律，不是不變量** —— `ElevationManager` 自身沒有 generation 或
事件，直接呼叫 `set` / `delete` / `fromJSON` 不會連動。加一條整合回歸測試把
現行路徑釘住：

```ts
// src/core/simulation/__tests__/ElevatedRoadInvalidatesGraph.test.ts
it('should bump the road generation when an elevated road is built or demolished', () => {
  // 圖以 roadGeneration 為鍵。高架若不 bump，玩家蓋了橋而市民還在用舊圖。
  // ElevationManager 沒有事件機制，這條連動完全靠 Game 的呼叫順序 ——
  // 所以要測。
  const { game, loop } = gameWithRoads();          // 依實際 helper 調整
  const before = loop.commuteCache.roadGeneration;

  game.buildElevatedRoad(/* … */);
  expect(loop.commuteCache.roadGeneration, '蓋高架沒有讓道路世代遞增')
    .toBeGreaterThan(before);

  const afterBuild = loop.commuteCache.roadGeneration;
  game.demolishElevatedRoad(/* … */);
  expect(loop.commuteCache.roadGeneration, '拆高架沒有讓道路世代遞增')
    .toBeGreaterThan(afterBuild);
});
```

> `game.buildElevatedRoad` / `demolishElevatedRoad` 的實際名稱與簽章要先
> `grep` 確認（`ElevatedRoadBuilder.ts`、`Game.ts`）。`commuteCache` 若不是
> 公開欄位，改用既有的 accessor 或把斷言改成觀察
> `wpDistCache.getStatus()` 從 READY 變回 EMPTY。

- [ ] **Step 7: 跑完整測試套件**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全綠。

- [ ] **Step 8: 回退驗證（三次）**

**(a)** 把 `SimulationLoop` 裡剛刪掉的閘門加回去（`canUseWpCache`）。
Expected:「should employ someone whose only route to work is a viaduct,
from the cache」轉紅 —— 具體是 `expect(spy).toHaveBeenCalled()` 那一行，
因為快取雖然 READY 卻不被讀。

> 第 3 版預期的是「`cache.isReady` 仍為 true 但轉紅」，那個推理是錯的：
> 只看 `isReady` 的話閘門加回去它還是 true，測試不會紅。**spy 才是會紅的
> 那一項。** 改回。

**(b)** 把 `requestUpdate` 傳的 buffer 從轉置圖改成正向圖。
Expected:「should give the cache the same answer as the synchronous query」轉紅。

> 這一條**只有在 `bridgedCity` 混了路型之後才會紅**。全 `TWO_LANE` 時正向圖
> 與轉置圖完全相同（審核實算：15 節點 28 邊、權重全 36、邊集對稱）。
> Step 5 的 fixture 健全性檢查會先告訴你路型夠不夠混。改回。

**(c)** 把 `getCellGraph()` 的世代比對拿掉（`if (this._cellGraph === null)` 就好，
不再檢查 `_cellGraphGeneration !== gen`）。
Expected:「should bump the road generation when an elevated road is built or
demolished」不會紅（它測的是 generation 本身），但**高架蓋好後快取的答案會
停留在舊圖** —— 若 Step 6 的測試無法涵蓋這點，改成在該檔加一條「蓋橋之後
快取的距離要跟著改變」的案例。改回。

- [ ] **Step 9: 實機驗收**

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

Expected: `ready: true`（改之前在這份存檔上永遠是 false）。

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
**把實測數字寫進 BUGS.md，不要只寫「變快了」。**

- [ ] **Step 10: 更新文件並 Commit**

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
| §5.2 `floodRoadCellGraph` + 四個不變式 | 2 |
| §5.3 `attachAtSettledNode` | 3 |
| §5.4 `seedNodesFor` | 3 |
| §5.4b `transposeRoadCellGraph` / BUG-237 | 4 |
| §5.5 序列化 + 版本欄位 | 5 |
| §5.6 修改清單 | 6（RoadCoverageFlood）、7（worker）、8（其餘） |
| §7 版本不符 | 5 |
| §7 worker 例外 | 7 Step 3 的 try/catch |
| §7 座標超過 Uint16 | 1 Step 3 的 `RangeError` |
| §7 空圖回 false | 8 Step 1 與 Step 3 |
| §9 測試策略 | 1–8 分散覆蓋 |
| spec 與 plan 的 9 處矛盾 | 0 |

**回退驗證清單（共 22 次，逐列數過）:**

| # | 破壞什麼 | 預期轉紅 |
|---|---|---|
| 1a | 權重改算來源那格 | charge the cost of the destination cell |
| 1b | 忽略樓層/匝道規則 | edges the lookup permits ＋ ground reaches the viaduct only at ramps |
| 1c | 權重改 Float32Array | integral weights that fit the Uint16 range |
| 1d | 重複加邊 | CSR structurally consistent, with no duplicate edges |
| 2a | 不再 relax 成更便宜的值 | **improve a node when a cheaper route settles later（合成圖）** |
| 2b | onSettle 搬到 relax | settle in non-decreasing cost order |
| 2c | 拿掉 budget 截斷 | match the reference at every budget ＋ -1 for unreached nodes |
| 2d | 拿掉 stale 過濾 | **settle each node exactly once despite the stale heap entry（合成圖）** |
| 3a | seedNodesFor 只看地面 | road nodes within Chebyshev reach ＋ probe picks up an elevated cell |
| 3b | 拿掉 `out.has(key)` 早退 | cheapest reachable road cost |
| 4a | 轉置時權重取端點 | edge set with every arrow reversed ＋ same cost as forward flood |
| 4b | 轉置時方向沒反轉 | edge set with every arrow reversed |
| 5a | 拿掉 offsets 的 align4 | align every section（掃 40×40 組 n/e，與 fixture 無關） |
| 5b | 拿掉版本檢查 | refuse a buffer with the wrong version |
| 5c | 用 byteLength 判斷空圖 | round-trip an empty graph ＋ report the node count |
| 6a | 附掛搬到 flood 之後 | match the ground-only result |
| 6b | 無 lookup 時回空 Map | fall back to the ground-only path |
| 7a | 傳正向圖而非轉置 | agree on every home → workplace cost |
| 7b | worker 的 reach 改成 1 | agree on every home → workplace cost |
| 8a | 把閘門加回去 | employ someone… **的 `expect(spy).toHaveBeenCalled()` 那一行** |
| 8b | requestUpdate 傳正向圖 | cache 與同步查詢一致（**需要 bridgedCity 混路型**） |
| 8c | getCellGraph 不比對世代 | 蓋橋後快取的距離沒跟著改變 |

**第 3 版有三條是空轉的，這一版換掉了：**

| 原本 | 為什麼空轉 | 現在 |
|---|---|---|
| 2a | 成本加在目的地 → 入邊權重一致 → 第一次 relax 就最佳，重新 relax 的分支在路網圖上走不到 | 加合成 CSR 圖（入邊 100 vs 1） |
| 2d | 同上，永遠不產生 stale 堆項 | 同上，合成圖會產生 |
| 8b | `bridgedCity` 全 `TWO_LANE`，邊集對稱，正向圖 ≡ 轉置圖 | 高架段改 `HIGHWAY`，並加 fixture 健全性檢查 |

另外 2b 原本宣稱會讓兩條轉紅，實際只有 settle 順序那條會（審核實算：6 次
下降，但沒有重複 settle）。表格已改成只承諾會紅的那一項。

**明講兩個不會轉紅的：**

1. Task 6 拿掉早退（`return result.size >= targets.size` → `return false`）。
   早退只影響效能，正確性由結果相等保證。不寫計時測試 —— 那會是脆弱的。
2. 上表 2a / 2b / 2d 的變異在 **`testCity` 上不會轉紅**，只有合成圖那幾條會。
   這是結構性的，不是 fixture 沒調好 —— 見 Task 2 的 `skewedGraph` 註解。

**已知風險與處置:**

1. **Task 3(b) 的回退驗證可能空轉** —— 若 fixture 裡沒有格子被多個成本不同的
   路格競爭，「拿掉 `out.has` 早退」不會改變任何結果。
   *處置：* 同一個 describe 裡有 fixture 健全性測試會先告訴你 contested 的
   格子數；為 0 就先修 fixture。

2. **Task 8 的三個外部名稱已逐一驗證過，但 Step 6 的還沒。**
   已驗證：`cache.getDistance` / `getDistancesFromHome` / `isReady` /
   `populateSync` 存在；`this.commuteCache.roadGeneration` 正確（**不是**
   `this.state.commuteCache`）；`loop.getRoadLookup` **不存在**，由 Step 4 新增。
   *未驗證：* Step 6 的 `game.buildElevatedRoad` / `demolishElevatedRoad` 與
   `gameWithRoads()` helper —— 實作者第一步要 `grep`，不是照抄。

3. **`bridgedCity` 改路型可能動到其他案例的結果。** 它是就業行為的 fixture，
   把高架段從 `TWO_LANE` 換成 `HIGHWAY` 會讓通勤成本變便宜。
   *處置：* 改完先跑該檔全部案例；若「no elevated road」那條負向控制受影響，
   那是它本來就與高架無關，應該不受影響 —— 若受影響，代表 fixture 之間有
   意料外的耦合，要先查清楚再繼續。

4. **Task 8 的 `flush()` 用 `setTimeout(0)` 而不是 `await Promise.resolve()`。**
   前者跨 macrotask，能同時排空 microtask 佇列與任何 `queueMicrotask` 鏈；
   後者只讓出一層。若 client 內部有多層 `.then`，只讓一層會不夠。
   *處置：* 若測試仍在 `COMPUTING`，先確認 `flush` 的層數，不要直接把斷言
   改寬。
