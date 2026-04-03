# 多模式轉乘系統 (Multi-Modal Transfer System)

市民可搭乘最多 3 段不同大眾運輸（最多 7 條腿：步行+乘車交替），在不同路線之間轉乘到達目的地。

---

## 系統架構

```
MultiModalRouter          TransferTracker          TransferOverlayPanel
  ├─ buildTransferGraph()   ├─ recordTransfer()      ├─ 路線列表 UI
  ├─ buildStopRouteCache()  ├─ recordBuilding()      ├─ 建築高亮
  └─ findMultiModalRoutes() └─ rolloverDay()         └─ 路線線條繪製
        ↓                          ↓
   ModeChoice                 SimulationLoop
  chooseModeMultiModal()      spawnCommuteVehicles()
```

**檔案位置**:
- `src/core/transport/MultiModalRouter.ts` — 路線搜尋引擎
- `src/core/transport/TransferTracker.ts` — 使用統計追蹤
- `src/core/transport/ModeChoice.ts` — 交通模式選擇
- `src/ui/components/TransferOverlayPanel.tsx` — UI 面板
- `src/Game.ts` — 3D 視覺化整合

---

## 轉乘圖 (TransferGraph)

`MultiModalRouter.buildTransferGraph()` 在不同路線的站點之間建立雙向邊：

- 只連接**不同路線**的站點（防止同路線轉乘）
- 連接條件：曼哈頓距離 ≤ `transferRange`
- 回傳 `TransferGraph { byStop: Map<stopKey, TransferEdge[]> }`

### 圖的重建時機

SimulationLoop 維護 `transferGraphDirty` 旗標，當大眾運輸路線變更時重建轉乘圖、扁平化路線快取 (`flatRoutes`)、以及站對站路線快取。

---

## 站對站路線快取 (Stop-to-Stop Route Cache)

`buildStopRouteCache()` 預計算所有可達的（入站、出站）站點對之間的最佳多模式路線：

- 使用**深度優先搜尋 (DFS)** 探索轉乘鏈
- 最大乘車段數: `maxRides = (maxLegs - 1) / 2`（預設 3 段）
- 避免重複使用同一路線
- 跳過滿載路線（容量檢查）
- 快取格式: `"entryRI:entrySI>exitRI:exitSI"` → `StopToStopRoute`

### 扁平路線 (FlatRoute)

路線被扁平化為 `FlatRoute[]`，包含：
- `segDists`: 段距離陣列，用於距離插值
- `frequency`: 發車頻率，用於等待時間計算

---

## 多模式路線搜尋

`findMultiModalRoutes(origin, destination, walkRange)` — 每位市民的查詢（O(n²) 站點 × 快取查詢）：

1. 找出起點附近（步行距離 ≤ `walkRange`）的所有入站站點
2. 找出終點附近的所有出站站點
3. 對每個（入站、出站）組合查詢預計算快取
4. 回傳最多 20 條結果，按 `totalTime` 升序排序

---

## 路線腿 (TransitLeg)

每條多模式路線由多段腿組成：

| 類型 | 說明 | 時間估算 |
|------|------|---------|
| `walk` | 步行段（起點→站點 或 站點→站點） | 距離 / WALK_SPEED |
| `ride` | 乘車段 | 等待時間 + 搭乘時間 |

乘車段包含：`transitType`（運輸類型）、`routeIdx`（路線索引）、`boardStopIdx`（上車站）、`alightStopIdx`（下車站）。

等待時間 = `frequency × AVERAGE_WAIT_FACTOR (0.5)`

---

## 交通模式選擇整合

`chooseModeMultiModal()` 擴展原有模式選擇，加入多模式轉乘比較：

```
1. 曼哈頓距離 ≤ 3 → 步行 (WALK)
2. 計算開車時間 = 距離 × (1 + 壅塞率)
3. 門檻 = 開車時間 × 1.5
4. 評估單一大眾運輸選項: estimatedTime < 門檻
5. 評估多模式轉乘選項: multiModalRoutes[0].totalTime < 門檻
6. 選擇最佳選項（最短時間）：多模式 > 單一運輸 > 開車
7. 回傳 { mode, multiLeg: MultiLegRoute | null }
```

**選擇多模式的條件**: 轉乘時間優於最佳單一運輸，且仍在開車門檻內。

---

## 轉乘使用追蹤 (TransferTracker)

從 SimulationLoop 抽取為獨立模組（SRP），追蹤轉乘使用統計。

**檔案**: `src/core/transport/TransferTracker.ts`

### 資料結構

- **7 天環形緩衝區**: 每條路線標籤（如「🚌→🚇」、「🚇→🚂」）的每日使用次數
- **今日計數**: 當日尚未滾動的計數
- **建築追蹤**: 記錄使用各轉乘路線的住家 ID 和工作場所 ID

### API

| 方法 | 說明 |
|------|------|
| `recordTransfer(label)` | 記錄一次轉乘使用 |
| `recordBuilding(label, homeId, workplaceId)` | 記錄使用轉乘的建築 |
| `clearBuildings()` | 轉乘圖重建時清除建築追蹤 |
| `rolloverDay(activePedCount)` | 每日滾動，推入緩衝區，記錄行人快照 |
| `getWeeklyTotal(label)` | 取得某路線的 7 天使用總計 |
| `getAllWeeklyTotals()` | 取得所有路線的週使用量 Map |
| `getBuildings(label)` | 取得使用某路線的建築 |
| `getHistory()` / `setHistory()` | 存檔持久化 |

### 每日滾動機制

SimulationLoop 在每日切換時呼叫 `rolloverDay()`：
1. 將今日計數推入環形緩衝區
2. 重設今日計數
3. 記錄活躍行人快照
4. 觸發 `onDataChanged` 回調（刷新 UI）

### 持久化

`lastTransferDay` 和環形緩衝區資料隨存檔持久化，載入時恢復完整歷史。

---

## SimulationLoop 整合

### 轉乘圖管理

SimulationLoop 管理以下欄位：
- `transferGraph: TransferGraph` — 轉乘圖（路線變更時重建）
- `transferGraphDirty: boolean` — 髒旗標
- `flatRoutes: FlatRoute[]` — 扁平化路線快取
- `stopRouteCache: Map<key, StopToStopRoute>` — 站對站路線快取

### 通勤車輛產生整合

在 `spawnCommuteVehicles()` 中：
1. 對每位取樣市民呼叫 `findMultiModalRoutes()`
2. 呼叫 `chooseModeMultiModal()` 比較所有選項
3. 若選擇非開車模式：
   - 記錄步行行程到 `walkingTripPool`（供行人渲染）
   - 若為多模式路線，透過 `transferTracker` 記錄轉乘和建築
4. 轉乘標籤使用 emoji 格式：`"🚌→🚇"`、`"🚇→🚂"` 等

### 轉乘統計 API

`getTransferStats()` 回傳：

| 欄位 | 說明 |
|------|------|
| `activeTransferPeds` | 昨日行人快照 |
| `totalActivePeds` | 所有活躍行人 |
| `transferTrips` | 行走中的步行行程 |
| `cachedRoutes` | 預計算路線總數 |
| `multiRideRoutes` | 2+ 段乘車的路線數 |
| `transferEdges` | 有轉乘選項的站點數 |
| `routeBreakdown[]` | 按標籤分組的細目（rides、count、avgTime、weeklyUse） |

---

## 轉乘路線覆蓋 UI

### TransferOverlayPanel

側邊面板顯示活躍轉乘路線列表：

- **顯示條件**: `selectedTransferRoute !== null`
- **過濾**: 只顯示乘車 ≥ 2 段且每週使用 > 0 的路線
- **排序**: 按每週使用量降序
- **互動**: 點擊路線 → 選擇/取消選擇
- **樣式**: 深藍玻璃擬態背景，最小寬度 220px

### 地圖視覺化

選擇轉乘路線後 (`Game.selectTransferRoute(label)`)：

1. **建築高亮**: 使用該路線的住家和工作場所以白色高亮
2. **站點高亮**: 路線經過的所有轉乘站點高亮
3. **路線線條**:
   - 藍色實線 — 乘車段
   - 白色虛線（dash 0.2 / gap 0.15）— 步行段
   - Y 高度: 0.2（地面以上）
   - Render order: 10（高優先級）

### 左側面板堆疊 (Left Panel Stack)

TransferOverlayPanel 作為左側面板堆疊的一員，與 BuildingPanel 和 CitizenDetailPanel 並存：

- 面板以開啟順序排列（CSS `order` 屬性）
- 最新開啟的面板出現在最右側
- 多個面板可同時顯示
- 使用 `nextOrder` 計數器分配順序

---

## 配置常數

| 常數 | 值 | 說明 |
|------|-----|------|
| `WALK_TO_STOP_RANGE` | 5 | 步行到站的最大距離 |
| `WALK_SPEED` | 1 | 步行速度（單位/tick） |
| `AVERAGE_WAIT_FACTOR` | 0.5 | 等待時間 = frequency × factor |
| `MAX_TRIP_LEGS` | 7 | 最大路線腿數（3 段乘車） |
| `transferRange` | 5 | 轉乘圖的站點連接距離 |
