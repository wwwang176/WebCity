# Workplace 距離改走路網圖 —— 設計

**目標:** 讓 workplace 距離快取在有高架道路時也能用,消除 `runJobRelocation`
與 `assignCitizenHousing` 的逐戶 Dijkstra。這是 BUG-109 的治本。

---

## 1. 背景(全部是量出來的,不是推測)

使用者回報「每 5~10 秒卡一下、每次 0.3~0.5 秒」,附一份 2146 人的存檔。在
Chrome 裡實際載入該存檔量測:

```
慢的 tick        tick % 60 === 4 → 966 ~ 1184 ms（30 秒內持續變差）
單獨計時         runJobRelocation() = 1474 ms
CPU profile      主執行緒 46% 在 Dijkstra 那一串
                 （checkNeighborsForTargets / ElevationManager.get /
                   roadDistanceToTargets / parsePosKeyUnsafe）
save worker      99.8% 閒置 —— 自動存檔不是原因
```

執行期狀態:

```
hasAnyElevatedRoad   true    （60 格高架道路，全在 level 1，其中 2 格匝道）
wpDistCache.isReady  false
wpDistCache.isStale  true
```

`SimulationLoop` 的 `canUseWpCache` 在有**任何一格**高架道路時為 false,而同一個
條件也擋住 `requestUpdate` —— 快取不是「還沒算好」,是**不會去算**。341 個
工作年齡市民各跑一次 Dijkstra,每次約 4.3 ms。

原因是 worker 看不到高架:它拿到的是一張 `width × height`、每格 12 bytes 的
平面緩衝,只讀 offset+5 的 `roadType`,四方向擴散,**完全沒有樓層概念**。讓它
算,它會以為那 60 格橋不存在,答案是錯的。當初的選擇是「寧可慢也不要錯」。

已經先做的止痛(已合併,`dc2626d`):把那一輪切片,每 tick 最多 2 次距離查詢。
最慢的 tick 從 1184 ms 降到 49.2 ms,長影格歸零。**總工作量沒有變** —— 本設計
處理的是那個總量。

### 快取重建來得及嗎

先前的疑慮是「作廢比重建快,快取永遠到不了 READY,治本會白做」。量過,不成立:

```
作廢頻率   30 秒 10 次（0.33/s），間隔中位數 2704 ms、最短 302 ms
重建耗時   173 ms（101 個工作地點），而且在 worker 裡
```

重建比最短的作廢間隔還快。粗估快取約 94% 的時間會是 READY。

---

## 2. 非目標

- **不改成本模型的形狀。** `roadTileCost = 分子 / (speedLimit × lanes/2)`
  維持不變,道路之間的相對快慢也維持不變。

  > **已修訂（成本整數化，commit `95fdc5e`）。** 本節原本寫「分子 100 維持
  > 不變」。審核發現本設計的硬約束「worker 與同步逐格精確相等」在浮點下
  > **在數學上不可能成立** —— 加法沒有結合律，反向 Dijkstra 走同一組邊的
  > 相反順序，總和必然差到 1e-15。分子改成 1800（所有分母的最小公倍數）
  > 後每格成本都是整數（9 ~ 60），加法可交換，硬約束才成立。
  >
  > 這是純粹的單位換算：所有同尺度的量同步 ×18（九項服務預算、
  > `dijkstraMaxBudget` 1080、`COMMUTE_SCORE` 的距離門檻 180/720、
  > `FIRE.RESPONSE_SPEED` 36），涵蓋半徑、通勤評分、消防反應時間全部不變。
  > 見 `RoadCostInteger.test.ts`。
- **不動 `LaneGraph`。** 車輛尋路用的車道級圖維持原樣,見 §3 的取捨。
- **不處理高架鐵路。** 閘門用的是 `hasAnyElevatedRoad`,捷運與地面共用 layers
  但 `roadType` 為 NONE,對道路可達性沒有貢獻。
- **不改切片機制。** 切片(`JOB_RELOCATION_SLICE`)保留 —— 它保護的是快取
  重建視窗那 6% 的時間,與本設計互補。

---

## 3. 為什麼自建格子層的圖,而不是用現有的 LaneGraph

專案裡已經有一張分層的路網圖:`LaneGraph` 由 `UnifiedRoadLookup` 建成(含地面
與高架),`LaneGraphBuffer` 已經是給尋路 worker 用的 zero-copy SharedArrayBuffer。
直接用它很誘人,但:

| | 自建格子圖 | 用 LaneGraph |
|---|---|---|
| 節點數 | 344 | 約 2700+（每格多個進出點 × 車道 × 方向） |
| 成本模型 | 現行 `roadTileCost`，與同步 fallback 相同 | 幾何長度 + 速限，**不同數量級** |
| 常數 | 不變 | `dijkstraMaxBudget` 等一整套要重調 |
| **拓撲** | 四鄰位 + 樓層相容，**忽略 `roadFlags`** | 依 `roadFlags` 建**有向**車道邊 |
| 精度 | 剛好夠（排序用） | 貝茲轉彎、換道懲罰 —— 付了錢又丟掉 |

**決定性的是拓撲那一列,不是成本。**（審核修正:原本只寫「成本尺度不同」，
那個理由不完整 —— `LaneGraphBuffer` 其實有存 `speedLimit` 與 `laneCount`
（`LaneGraphBuffer.ts:24-36`），理論上可以另算成本。）真正的阻礙有兩個:

1. **可達性會變。** 通勤的 flood 只看四鄰位與樓層相容，完全忽略 `roadFlags`
   （`RoadCoverageFlood.ts:533-567`）；LaneGraph 依 `roadFlags` 建有向邊
   （`LaneGraph.ts:257-350`）。直接換過去，單行道會讓一批市民突然「走不到」
   原本的工作。
2. **buffer 缺少 cell metadata。** LaneGraph 有跨路口、跳過中間 intersection
   cell 的邊，原物件用 `viaCellKey` 記錄（`LaneGraph.ts:352-430`），但
   `LaneGraphBuffer` 的 edge 只存 from / to / length / type
   （`LaneGraphBuffer.ts:39-47`）—— 沒有 `viaCellKey`，也沒有那一格的 roadType。
   所以**收不到被跳過那格的 `roadTileCost`**。

若要擴充 buffer 補上 cell / via / roadType，再另建 cell-level adjacency，
那實質上就是在建一張 `RoadCellGraph`，並不更簡單。

換成本模型仍然是次要但真實的代價:`dijkstraMaxBudget` 等調過的常數要重算。
（成本整數化已經做過一次這種換算 —— 那次是純粹的 ×18 單位縮放，所有比值
不變；改成車道級的通行時間模型不是，它會改變道路之間的相對快慢。）

---

## 4. 架構

```
UnifiedRoadLookup ──getAllCellKeys()───────────┐
（樓層與匝道規則的唯一來源）                    │
                    getCompatibleNeighborKeys() │
                                                ▼
                                        RoadCellGraph
                                （節點 = 路格 key，邊 = 合法鄰接，
                                  權重 = 目的地那格的 roadTileCost）
                                          │           │
                              ┌───────────┘           └──────────┐
                              ▼                                  ▼
                    序列化成 typed array                 主執行緒直接持有
                              │                                  │
                              ▼                                  ▼
              workplace-distance worker             roadDistanceToTargets
            （**轉置圖**上 flood × 101）              （正向圖上 flood）
                              │                                  │
                              └────── 同一個 flood 核心 ──────────┘
```

樓層與匝道規則在**建圖時**就被消化掉。worker 拿到的圖裡沒有樓層概念,只有
節點與邊 —— 它不需要、也不能重新解讀規則。

---

## 5. 元件

### 5.1 `RoadCellGraph`（新，`src/core/road/RoadCellGraph.ts`）

純邏輯,不 import Three.js。

```ts
export interface RoadCellGraph {
  /** 節點 i 的格子 key（"x,y" 或 "x,y,level"）。 */
  readonly nodeKeys: readonly string[];
  /** key → 節點索引。 */
  readonly indexOf: ReadonlyMap<string, number>;
  /** CSR：節點 i 的鄰接範圍是 [offsets[i], offsets[i+1])。長度 n+1。 */
  readonly offsets: Uint32Array;
  /** 鄰接的節點索引。 */
  readonly targets: Uint32Array;
  /**
   * 走到 targets[j] 那一格要付的成本。
   *
   * **整數**（成本整數化後每格是 9 ~ 60，見 `core/road/roadCost.ts`）。
   * 這是硬約束「worker 與同步逐格精確相等」能成立的唯一理由 —— 浮點加法
   * 沒有結合律，反向 Dijkstra 走同一組邊的相反順序，總和必然不同；換
   * Float64 也一樣，那與精度無關。整數加法可交換，兩個方向必然位元相同。
   *
   * 順帶消掉了 Float32 的捨入陷阱：成本存進窄型別、heap 卻拿著未捨入的值時，
   * `cost[n] < cur.cost` 會誤判成過期，flood 就地靜默停止。整數沒有這回事。
   */
  readonly weights: Uint16Array;
  /** 節點 i 的格子座標（附掛建築時要用）。 */
  readonly nodeX: Uint16Array;
  readonly nodeY: Uint16Array;
}

export function buildRoadCellGraph(lookup: UnifiedRoadLookup): RoadCellGraph;
```

`buildRoadCellGraph` 對每個 `getAllCellKeys()` 的 key,取四個鄰位的
`getCompatibleNeighborKeys()`,權重取 `roadTileCost(getCellByKey(鄰居).roadType)`。

### 5.2 `floodRoadCellGraph`（新，同檔）

兩條路共用的核心。

```ts
export interface FloodResult {
  /** 每個節點的成本；未到達為 -1。**整數** —— 見 `weights` 的說明。 */
  readonly cost: Int32Array;
}

export function floodRoadCellGraph(
  graph: RoadCellGraph,
  seedNodes: readonly number[],
  maxBudget: number,
  /** 每 settle 一個節點呼叫一次。回傳 true 表示提早結束。 */
  onSettle?: (node: number, cost: number) => boolean,
): FloodResult;
```

**必須保住的三個不變式**(都是踩過坑才有的):

1. **成本加在目的地那一格** —— `newCost = cur + weights[j]`。
2. **`onSettle` 在 pop 時呼叫,不是 relax 時。** BUG-102:路型差到 6.7 倍
   (鄉道 3.33 vs 高速 0.5),relax 時記錄會讓「門口一條鄉道」贏過「兩格外的
   高速公路」,JobRelocation 就用錯誤的數字評分。
3. **超過 `maxBudget` 的鄰居不入堆。**

### 5.3 `attachBuildingCells`（新，同檔）

家與工作都不是路格,要附掛到附近的路。

```ts
/** 一個節點 settle 時附掛它周圍的建築格。回傳目前為止收了幾格。 */
export function attachAtSettledNode(
  graph: RoadCellGraph,
  node: number,
  cost: number,
  reach: number,
  /** 這一格要不要收。同步路徑問「在不在目標集合裡」，worker 問「是不是非道路格」。 */
  accept: (x: number, y: number) => boolean,
  out: Map<string, number>,
): void;
```

**在 settle 當下逐節點附掛**，不是先收集整串再處理。這樣同步路徑才能在找齊
目標時提早結束 —— 舊實作有這個早退（`RoadCoverageFlood.ts:506-531`），
先收集再附掛就等於永遠跑滿預算，同步路徑的效能會變差（審核發現）。

語意上仍是依,把 Chebyshev(`reach`) 內、`accept` 回 true 的
格子以該節點的成本記入 `out`,只記第一次 —— settle 順序即成本遞增順序,所以
第一次就是最便宜的那一條路(這正是 BUG-102 的語意)。`reach` 傳
`ZONE_ROAD_REACH`。`dx`/`dy` 包含 `(0, 0)`，所以道路格自身也會被檢查 ——
舊實作那段「道路格本身也可能是目標」因此被涵蓋。

**兩個呼叫端的 `accept` 不同**,這是它成為參數而不是寫死的理由:

| 呼叫端 | `accept` | 需要什麼資料 |
|---|---|---|
| 同步 fallback | `(x, y) => targets.has(toPosKey(x, y))` | 目標集合（呼叫端已有） |
| worker | `(x, y) => 該格不是道路` | **格子緩衝** |

### 5.4 `seedNodesFor`（新，同檔）

```ts
export function seedNodesFor(
  graph: RoadCellGraph, x: number, y: number, reach: number,
): number[];
```

回傳 Chebyshev(`reach`) 內**所有樓層**的路格節點。對應現行的
`getAllKeysAtPosition()` 迴圈。

### 5.4b `transposeRoadCellGraph`（新，同檔）—— 反向查詢的正解

```ts
export function transposeRoadCellGraph(graph: RoadCellGraph): RoadCellGraph;
```

worker 是**從工作地點往外**擴散，一次算出「所有家 → 這個工作」。但成本是加在
**目的地那一格**的，所以正向邊 `A→B` 的價格是 `cost(B)` —— 直接拿正向圖從 B
往外走，會付成 `cost(A)`，答案就不是同一件事。

轉置的定義很簡單:原本每條邊 `(i → j, w)` 產生一條 `(j → i, w)`。**權重跟著邊
走，不跟著端點走**，所以從工作地點在轉置圖上跑 Dijkstra，得到的正是每個家
沿正向走到該工作的成本。

**這同時修掉一個既有 bug（BUG-237）。** 現行的
`reverseFloodFromWorkplace`（`workplace-distance.worker.ts:88-129`）就是直接
反向擴散並付 `roadTileCost(鄰居)`，也就是付了來源那格的價格。現有測試沒抓到，
因為它們**只用單一路型**（`WorkplaceDistanceWorker.test.ts:32-72`）—— 所有格子
一樣貴時，正反向剛好相等。路型混合的城市就會不一致，而這正是本設計的硬約束
要守的東西。

### 5.5 序列化（新，`src/core/road/RoadCellGraphBuffer.ts`）

```
Header (16 bytes)
  0  nodeCount   Uint32
  4  edgeCount   Uint32
  8  version     Uint32   （格式版本，目前 1）
 12  reserved    Uint32

Nodes    nodeX Uint16[n], nodeY Uint16[n], nodeLevel Uint8[n]
CSR      offsets Uint32[n+1], targets Uint32[edges], weights Uint16[edges]
```

`offsets` 之前要補對齊（`Uint32` 需要 4-byte 對齊，而 `nodeLevel` 的長度是 n，
不保證是 4 的倍數）。`weights` 是 `Uint16`，只需要 2-byte 對齊，接在 `Uint32`
段之後自然滿足 —— 這是成本整數化順帶簡化掉的一段：權重若是 `Float64` 就得
另外補到 8 的倍數。

`nodeKeys` **不序列化** —— worker 只在產出結果時需要 `"x,y"` 字串,而那可以從
`nodeX/nodeY` 現組。省下 344 個字串的 structured clone。

格子緩衝(43 KB)仍然一起送:worker 用它判斷附掛時哪些格子該收(§5.3)。圖與
格子緩衝是兩件事 —— 圖是**怎麼走**,格子是**格子上有什麼**。

版本欄位存在的理由:格式改了但 worker 沒更新時要**明確報錯**,而不是把
`Uint32` 當 `Uint16` 讀出一堆看似合理的距離。

**空圖的 buffer 不是 0 bytes** —— 它有 16 bytes 的 header 加上一個
`offsets[0]`。判斷「圖是空的」要讀 header 的 `nodeCount`，用 `byteLength === 0`
永遠擋不到（審核發現）。

### 5.6 修改的地方

| 檔案 | 改什麼 |
|---|---|
| `src/workers/workplace-distance.worker.ts` | 刪掉自己的 MinHeap 與 `reverseFloodFromWorkplace`,改用 `floodRoadCellGraph` + `attachBuildingCells` |
| `src/core/workplace/WorkplaceDistanceTypes.ts` | `WDWorkerRequest` **加上**圖的緩衝。`gridBuffer` / `gridWidth` / `gridHeight` **保留** —— worker 仍需要它判斷「哪些格子是建築」（見 §5.3）。圖取代的是**走訪**，不是格子的中繼資料 |
| `src/core/service/RoadCoverageFlood.ts` | `roadDistanceToTargets` 改用同一個核心 |
| `src/core/simulation/SimulationLoop.ts` | 刪掉兩處 `canUseWpCache` 的 `hasAnyElevatedRoad()` 判斷;`requestUpdate` 改傳圖 |

`roadDistanceToTargets` 有 4 個呼叫點,全都是「家 → 工作／住宅」這一族,沒有
外溢到服務覆蓋。`RoadCoverageFlood.ts` 裡其他的 flood(`roadFlood`、
`recalculate`、`preview`)**不動** —— 它們服務的是設施覆蓋,不是通勤。

---

## 6. 資料流

```
道路變動 → laneGraphDirty（既有機制）
                │
                ▼
   requestUpdate 時：buildRoadCellGraph(lookup)   ← O(344)，可忽略
                │  serialize 圖 → ArrayBuffer（約 8 KB）
                │  + 既有的格子緩衝 copy（43 KB，判斷建築用）
                ▼
   worker：反序列化 → 每個工作地點一次 flood → entries
                │
                ▼
   applyResult → status = READY
```

同步 fallback 走同一個 `floodRoadCellGraph`,但圖是主執行緒即時建的
(或快取住;見 §8)。

---

## 7. 錯誤處理

- **worker 丟出例外** → 現行行為維持:`status = EMPTY`,下一輪重試。切片化之後
  fallback 不會造成卡頓,所以重試是安全的。
- **格式版本不符** → worker 回 `ERROR`,主執行緒記錄並維持 EMPTY。**不可以**
  嘗試沿用舊格式解讀。
- **圖是空的**(城市還沒有路) → `requestUpdate` 回 false,不發請求。
- **節點數超過 Uint16 能表示的座標範圍**(地圖 > 65535 格寬) → 建圖時丟
  `RangeError`。目前地圖 60×60,200×200 也遠低於上限;這條是防止格式被默默
  誤用。

---

## 8. 效能預期

```
建圖          O(路格數) = 344，每次 requestUpdate 一次
序列化        圖約 8 KB，外加既有的 43 KB 格子緩衝（總量略增，仍可忽略）
worker flood  344 節點 × 101 次（現行是 3600 格 × 101 次）
```

現行重建 173 ms,節點數少一個數量級,預期會更快。**不預期需要把圖快取住** ——
344 次迴圈遠小於一次 flood。若實測顯示建圖有感,再加快取,不要預先做。

同步 fallback 的每次呼叫也會變快(圖小十倍),但它的主要保護仍是切片。

---

## 9. 測試策略

硬約束是**worker 算的必須等於同步 fallback 算的**。用差異測試釘死,而且必須在
**有高架、有匝道**的固定城市上跑。

| 測什麼 | 擋住什麼 |
|---|---|
| 對固定城市,worker 結果與同步結果**逐格精確相等**,跑遍所有 (家, 工作) 組合 | 唯一的硬約束。不抽樣 —— 344 節點跑得完 |
| 圖的節點集合 == `lookup.getAllCellKeys()` | 建圖漏格 = 靜默的不可達 |
| 沒有匝道時,相鄰兩層**不得**相連 | 規則消化錯了會讓市民「飛」上高架 |
| 有匝道時,依 `rampAscendDirection` 只在正確方向相連 | 匝道方向錯了會產生單向可達的假路 |
| 門口鄉道 vs 兩格外高速:成本必須取高速那條 | BUG-102 的回歸 |
| 超過 `maxBudget` 的格子不出現在結果 | 預算截斷 |
| 序列化 → 反序列化後,圖與原圖逐欄位相等 | 格式錯位（把 Uint32 當 Uint16 讀） |
| 版本不符時 worker 回 ERROR 而不是亂算 | §7 |

所有測試遵循專案的 TDD 規範:先寫紅燈測試,修好後還原修正確認轉紅。

**驗收(實機):** 載入同一份存檔,`wpDistCache.isReady` 必須在數百毫秒內變成
true 並維持;`runJobRelocation` 的每 tick 成本應降到接近 0(查表是 O(1))。

---

## 10. 風險

| 風險 | 處置 |
|---|---|
| 同步與非同步兩條路仍可能漂移 | 共用 `floodRoadCellGraph`,差異測試逐格比對。這是本設計的核心決定 |
| BUG-102 的 settle 語意被重構掉 | 寫成 `floodRoadCellGraph` 的明確不變式 + 專門的回歸測試 |
| 建圖本身有 bug → 兩條路一起錯 | 節點集合與 `getAllCellKeys()` 比對;匝道規則獨立測試 |
| 高架資料在 worker 與主執行緒不同步 | 圖在 `requestUpdate` 當下從 live lookup 建,不快取跨幀 |

---

## 11. 分階段

| 階段 | 內容 | 可獨立出貨 |
|---|---|---|
| 1 | `RoadCellGraph` + `floodRoadCellGraph` + `attachBuildingCells`（純邏輯，含全部測試） | 是（尚未接線） |
| 2 | `roadDistanceToTargets` 改用核心，差異測試對照舊實作 | 是（同步路徑先受益） |
| 3 | 序列化 + worker 改寫 + 刪掉 `hasAnyElevatedRoad` 閘門 | 是（本設計的目標） |

階段 2 的差異測試對照的是**改動前的舊實作**(暫時保留成 `roadDistanceToTargetsLegacy`,
階段 3 結束後刪除)—— 那是唯一能證明重構沒有改變行為的方式。
