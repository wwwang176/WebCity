# 模擬迴圈 (Simulation Loop)

SimulationLoop 是遊戲的心臟，驅動所有遊戲邏輯的更新。

---

## 遊戲時鐘 (GameClock)

### 時間單位

- **Tick**: 最小時間單位
- **Day**: 24 ticks
- **Week**: 7 days
- **Month**: 30 days
- **Year**: 12 months

### 遊戲速度

| 速度 | 每 tick 間隔 (ms) |
|------|-------------------|
| 0 (暫停) | Infinity |
| 1× | 250 |
| 3× | 83 |
| 5× | 50 |
| 10× | 25 |

### 時段 (Time of Day)

24 tick 循環中的四個時段：

| 時段 | 小時範圍 | 影響 |
|------|---------|------|
| `night` | 22:00~5:00 | 低交通 |
| `morning_rush` | 6:00~9:00 | 早高峰通勤 |
| `midday` | 10:00~16:00 | 正常交通 |
| `evening_rush` | 17:00~21:00 | 晚高峰通勤 |

### 季節

每 12 個月循環：春(0~2月)、夏(3~5月)、秋(6~8月)、冬(9~11月)

---

## 遊戲狀態 (GameState)

GameState 集中管理所有遊戲子系統的狀態：

| 屬性 | 類型 | 說明 |
|------|------|------|
| `grid` | Grid | 世界網格 |
| `roadNetwork` | RoadNetwork | 道路圖 |
| `citizens` | CitizenManager | 市民管理 |
| `traffic` | TrafficSimulation | 交通模擬 |
| `trafficLights` | TrafficLightSystem | 紅綠燈系統 |
| `power` | PowerGrid | 電力系統 |
| `water` | WaterNetwork | 供水系統 |
| `clock` | GameClock | 遊戲時鐘 |
| `budget` | BudgetState | 預算狀態 |
| `taxRates` | TaxRates | 稅率設定 |
| `rciDemand` | RCIDemandValues | RCI 需求值 |
| `buildingGrowth` | BuildingGrowth | 建築成長 |
| `buildingUpgrade` | BuildingUpgrade | 建築升級 |
| `pollution` | PollutionManager | 污染管理 |
| `police` | PoliceService | 警察服務 |
| `fire` | FireService | 消防服務 |
| `health` | HealthService | 醫療服務 |
| `education` | EducationService | 教育服務 |
| `parks` | ParkService | 公園服務 |
| `garbage` | GarbageService | 垃圾處理 |
| `sewage` | SewageService | 污水處理 |
| `deathCare` | DeathCareService | 殯葬服務 |
| `districts` | DistrictManager | 區域管理 |
| `policies` | PolicyManager | 政策管理 |
| `citySpec` | CitySpecialization | 城市特化 |
| `globalMarket` | GlobalMarket | 全球市場 |
| `bus` | BusSystem | 公車系統 |
| `metro` | MetroSystem | 地鐵系統 |
| `rail` | RailSystem | 鐵路系統 |
| `ferry` | FerrySystem | 渡輪系統 |
| `airport` | AirportSystem | 機場系統 |
| `freight` | FreightSystem | 貨運系統 |
| `sidewalkGraph` | SidewalkGraph | 人行道圖 |
| `pedestrianManager` | PedestrianManager | 行人管理 |

### 初始狀態

- 地圖: 200×200
- 初始資金: $50,000
- 貸款利率: 5%
- 稅率: 全部 9%
- 初始 RCI 需求: 各 50

---

## Tick 頻率分層

不同系統以不同頻率更新，以平衡效能和精度：

| 頻率 | 間隔 | 更新內容 |
|------|------|---------|
| 每 tick | 1 tick | 交通車輛移動、大眾運輸、貨運 |
| 慢速 (Slow) | 6 ticks | RCI 需求、預算、服務覆蓋、建築成長/升級/廢棄、教育、幸福度、移民、住房分配、服務車輛 |
| 中速 (Medium) | 60 ticks | 污染、地價、搬遷、擁塞流量、鐵路外部連接 |
| 每日 (Daily) | 24 ticks | 年齡更新、死亡判定、公共運輸乘客統計 |
| 每月 (Monthly) | ~720 ticks | 自然出生 |

---

## Tick 執行順序

每個 tick 依序執行以下步驟：

### 1. RCI 需求計算 (每 6 ticks)
計算住宅/商業/工業需求，套用商業稅懲罰。

### 2. 預算更新 (每 6 ticks)
根據收支更新現金。

### 3. 服務覆蓋 (每 6 ticks)
- 計算電力供需和覆蓋範圍
- 計算供水供需和覆蓋範圍
- 所有市政服務 tick（警察/消防/醫療/教育/垃圾/污水/殯葬/公園）
- 殯葬 tick：超時屍體自然分解 → 加權隨機收集（collectPending, COLLECTION_RATE=3）→ 火化（CREMATION_RATE=1）
- 處理火災事件

### 3.5. 污染與地價 (每 60 ticks)
更新所有格子的污染和地價。

### 4. 建築系統 (每 6 ticks)
- **成長**: 每 tick 隨機取樣 20 格嘗試成長
- **升級/降級**: 根據地價或教育水平調整建築等級
- **廢棄壓力**: 計算和累積廢棄壓力
- **焦黑清除**: 2% 機率自動清除焦黑建築（同時清除該位置待收屍體）
- **廢棄重建**: 條件滿足時清除廢棄建築並重建（同時清除該位置待收屍體）

### 4.5. 教育 (每 6 ticks)
推進學生學習進度，招收新學生。

### 5. 市民生命週期 (每日/每月)
- **每日**: 年齡更新 + 死亡判定 → `reportDeath(x, y)` 加入殯葬佇列
- **每月**: 自然出生
- 同步住宅容量上限

### 5.5. 幸福度與健康 (每 6 ticks)
更新所有市民的幸福度和健康值。含殯葬懲罰：預建 pendingDeathCounts map，per-citizen 查住所屍體數。

### 6. 移民 (每 6 ticks)
家庭移入和不滿市民移出。

### 6.5. 住房/就業分配 (每 6 ticks)
為無家可歸和失業的市民分配住所和工作。

### 6.6~6.7. 搬遷 (每 60~120 ticks)
不滿意住所的市民搬家，通勤路徑失敗的市民換工作。

### 7. 交通 (每 tick)
- 重建車道圖（若道路變更）
- 重建人行道圖（若道路變更）
- 產生通勤車輛
- 服務車輛巡邏

兩張圖都是**增量**重建：知道動了哪幾格就只重算那一圈，只有「不知道動了哪裡」
（存檔載入、初次建圖）才整張重來。兩者用各自的髒格集合 —— 車道圖跑完會把自己那份
清掉，共用的話人行道圖永遠只看到空集合。

蓋建築與蓋交通設施不走這條路（它們不改變路網，拖著通勤快取一起重算太貴），改由
`applyBuildingChange` 把那幾格折進人行道圖。漏掉的話新蓋的站牌在圖裡沒有門節點，
行人走不進去。

### 8. 大眾運輸 (每 tick)
- 公車、地鐵、鐵路、渡輪、機場系統 tick
- 貨運 tick
- 鐵路貨運加成
- 機場貨運加成
- 鐵路外部連接（每 60 ticks）

### 9. 收入計算 (每 6 ticks)
計算各區域稅收，全球市場 tick。

### 10. 擁塞流量預測 (每 60 ticks)
計算預測的交通流量分佈。

---

## 模擬常數

| 常數 | 值 | 說明 |
|------|-----|------|
| SLOW_TICK_INTERVAL | 6 | 慢速 tick 間隔 |
| MEDIUM_TICK_INTERVAL | 60 | 中速 tick 間隔 |
| GROWTH_ATTEMPTS | 20 | 每 tick 成長取樣數 |
| BURNED_CLEARANCE_CHANCE | 2% | 焦黑建築自動清除機率 |
| CRIME_BASE_MAX | 50 | 最大基礎犯罪率 |
| CRIME_POP_FACTOR | 0.02 | 人口犯罪因子 |
| CRIME_COVERAGE_PER_STATION | 0.15 | 每警局覆蓋減少犯罪 15% |
| CRIME_MAX_REDUCTION | 0.6 | 警察最大犯罪減少 60% |
| VEHICLE_CAP_MAX | 2000 | 道路車輛上限 |
| VEHICLE_CAP_BASE | 20 | 基礎車輛數 |
| VEHICLE_CAP_POP_RATIO | 0.3 | 人口車輛比 |

---

## SimulationConstants 模組

原本散落在 `SimulationLoop.ts` 內部的魔術數字和調校常數，已統一抽取至獨立模組：

```
src/core/simulation/SimulationConstants.ts
```

抽取的主要動機是**打破循環依賴**——`CityHappinessContext` 與 `CityMetrics` 原先需要 import SimulationLoop 才能取得常數值，造成 `SimulationLoop → CityHappinessContext → SimulationLoop` 的循環。將常數獨立後，所有模組均可直接 `import { SIMULATION } from './SimulationConstants'`。

### 常數物件結構

所有常數收斂在單一 `SIMULATION` const object 中（帶 `as const` 確保型別為 literal），依功能分為以下群組：

| 群組 | 主要常數 | 說明 |
|------|---------|------|
| Tick 頻率 | `SLOW_TICK_INTERVAL`, `MEDIUM_TICK_INTERVAL`, `JOB_RELOCATION_INTERVAL` | 各子系統更新間隔 |
| 建築成長 | `GROWTH_ATTEMPTS`, `UPGRADE_ATTEMPTS`, `BURNED_CLEARANCE_CHANCE` | 每 tick 取樣數與焦黑清除機率 |
| 犯罪 | `CRIME_BASE_MAX`, `CRIME_POP_FACTOR`, `CRIME_COVERAGE_PER_STATION`, `CRIME_MAX_REDUCTION` | 犯罪率計算參數 |
| 通勤 | `COMMUTE_MAX`, `COMMUTE_BASE`, `COMMUTE_SPREAD_FACTOR`, `COMMUTE_JITTER`, `MANHATTAN_DISTANCE_THRESHOLD` | 通勤距離估算與最短曼哈頓距離門檻 |
| 車輛 | `VEHICLE_CAP_MAX`, `VEHICLE_CAP_BASE`, `VEHICLE_CAP_POP_RATIO`, `SPAWN_SPREAD_TICKS`, `MIN_SPAWN_PER_TICK` | 道路車輛上限與每 tick 生成量 |
| 取樣 | `SAMPLE_COUNT_MIN`, `SAMPLE_COUNT_MAX`, `SAMPLE_DIVISOR` | Monte Carlo 擁塞取樣參數 |
| 服務覆蓋 | `SERVICE_POWER_WEIGHT`, `SERVICE_WATER_WEIGHT`, `LOW_POLLUTION_THRESHOLD` | 幸福度/服務覆蓋權重 |
| 稅率 | `BUSINESS_TAX_BASELINE`, `BUSINESS_TAX_PENALTY_PER_POINT` | 商業稅懲罰閾值 |
| 貨運 | `FREIGHT_CAP_RATIO`, `FREIGHT_TRUCKS_PER_THROUGHPUT` | 貨運車輛配額與吞吐量比 |
| 廢棄壓力 | `SERVICE_MAX_RES`, `SERVICE_MAX_NON_RES` | 住宅/非住宅的服務正規化最大值 |
| 其他 | `DEFAULT_HAPPINESS`, `CELL_VALUE_MAX`, `WALK_KMH`/`DRIVE_REFERENCE_KMH`, `INDUSTRIAL_POLLUTION_FACTOR`, `EXPORT_DEMAND`, `FALLBACK_RESIDENTS`, `SHOPPING_POP_THRESHOLD` | 預設幸福度、格子值上限、步行速度等（步行到站的上限已依運具分開，見 `core/transport/WalkRange`） |

### 使用方式

```ts
import { SIMULATION } from '../simulation/SimulationConstants';

// 直接存取
if (tick % SIMULATION.SLOW_TICK_INTERVAL === 0) { … }
const cap = Math.min(SIMULATION.VEHICLE_CAP_MAX, …);
```

目前引用此模組的檔案包括：`SimulationLoop.ts`、`CityHappinessContext.ts`、`CityMetrics.ts`、`CongestionFlowPredictor.ts` 以及對應的測試檔。

---

## SRP 重構（單一職責抽取）

SimulationLoop 原本包含大量內聯邏輯，隨功能增長已超過合理的行數上限。依據**單一職責原則 (Single Responsibility Principle)**，以下三個子系統被抽取為獨立模組，SimulationLoop 僅負責在正確的 tick 時機呼叫它們。

### CongestionFlowPredictor

```
src/core/traffic/CongestionFlowPredictor.ts
```

**職責**：預測交通擁塞流量分佈，供 SimulationLoop 在每 60 ticks（MEDIUM_TICK_INTERVAL）時呼叫。

提供兩個函式：

1. **`computeCongestionFlow(commuteCache, flowCellSet, getLaneCount)`**
   - 從 `CommuteCache` 的 routeIndex 讀取已快取的通勤路徑與引用計數
   - 以 `collectEdgeCells()` 展開路徑上的所有格子，累加流量
   - 最後依車道數正規化（多車道道路分攤流量）
   - 回傳 `flowMap`（cellKey → 正規化流量）與 `totalRefCount`（已覆蓋的市民數）

2. **`computeCongestionFlowMonteCarlo(deps, sampleCountMin, sampleCountMax, sampleDivisor)`**
   - 當快取覆蓋率不足時啟用的**蒙地卡羅回退**策略
   - 透過 `buildODPools()` 建立加權 OD 池，隨機取樣 origin-destination 配對
   - 濾除曼哈頓距離 ≤ `SIMULATION.MANHATTAN_DISTANCE_THRESHOLD` 的短程、非自駕模式的旅次
   - 對取樣結果按實際通勤者總量做比例放大（scale factor = totalResWeight / sampleCount）

**依賴反轉 (DIP)**：透過 `CongestionFlowDeps` 介面注入所需依賴（市民列表、路徑搜尋、運輸模式選擇），與 SimulationLoop 的具體狀態完全解耦。

### FreightTradeCollector

```
src/core/traffic/FreightTradeCollector.ts
```

**職責**：收集貨運貿易基礎設施的位置資訊，供貨運車輛生成使用。

**主要函式**：

- **`collectTradePositions(grid, infra, infraConfigLookup)`**
  - 遍歷三類貿易基礎設施：鐵路車站 (`railStations`)、機場 (`airports`)、高速公路邊緣 (`highwayCells`)
  - 對鐵路車站與機場，呼叫 `collectAdjacentRoadCells()` 尋找建築物周圍的道路格子作為貨車出發點
  - 高速公路邊緣直接加入位置清單
  - 回傳 `TradeCollectionResult`：所有 `TradePosition[]` 與合計 `totalThroughput`

- **`collectAdjacentRoadCells(grid, bx, by, throughput, out, infraConfigLookup)`**
  - 支援多格建築物（透過 `infraConfigLookup` 查詢 width/height）
  - 以四方向鄰居搜尋找到所有相鄰道路格子
  - 同一建築的所有道路格子共用相同的 `tradeKey`，確保貨運 A-limit 將其視為同一貿易節點
  - 若完全找不到相鄰道路，以建築物座標作為 fallback

**型別定義**：匯出 `TradePosition`、`TradeInfrastructure`、`TradeCollectionResult` 介面，讓呼叫端無需依賴具體的 RailSystem / AirportSystem 型別。

### SyncTrafficDensity

```
src/core/environment/SyncTrafficDensity.ts
```

**職責**：將交通模擬的車流數據同步至 Grid 的 `trafficDensity` 欄位，供噪音污染計算使用。此模組是交通子系統與環境子系統之間的橋梁。

**主要函式**：

- **`syncTrafficDensityToGrid(grid, traffic, elevationManager, reusableFlowMap)`**
  - 掃描所有地面道路格子，透過 `traffic.getSegmentDensity()` 取得車流量
  - 若存在高架道路，將高架層的車流**投影至地面格子**（取最大值）
  - 以對數刻度 `Math.min(10, Math.round(Math.log2(1 + flow)))` 轉換為 0~10 的噪音等級
  - 僅在值變更時才寫入 Grid（避免不必要的 dirty flag 觸發）

**GC 優化**：`reusableFlowMap` 參數由呼叫端（SimulationLoop）持有並跨 tick 重複使用，函式在進入和離開時都呼叫 `.clear()`，避免每次分配新 Map。

### 整體架構示意

```
SimulationLoop.tick()
  ├── (每 60 ticks) computeCongestionFlow() + computeCongestionFlowMonteCarlo()
  │     └── CongestionFlowPredictor.ts  ← traffic/
  ├── (每 60 ticks) syncTrafficDensityToGrid()
  │     └── SyncTrafficDensity.ts       ← environment/
  └── (貨運 tick) collectTradePositions()
        └── FreightTradeCollector.ts    ← traffic/
```

此重構使 SimulationLoop 回歸純粹的**排程與編排**角色，各子系統的業務邏輯可獨立測試與演進。

### TransferTracker

```
src/core/transport/TransferTracker.ts
```

**職責**：追蹤多模式轉乘的使用統計，從 SimulationLoop 抽取為獨立模組。

- 7 天環形緩衝區追蹤每條轉乘路線（如「🚌→🚇」）的使用次數
- 記錄使用各轉乘路線的住家和工作場所建築
- 每日滾動時觸發 `onDataChanged` 回調更新 UI
- 支援存檔持久化（`getHistory()` / `setHistory()`）

SimulationLoop 在 `spawnCommuteVehicles()` 中呼叫 `transferTracker.recordTransfer()` 和 `recordBuilding()`。

### PoliceFireLoadCalculator

```
src/core/service/PoliceFireLoadCalculator.ts
```

**職責**：計算警察和消防的加權需求。

- 將住宅居民和工作場所工人的需求乘以加權乘數（教育程度、區域類型、入住率）
- 分配需求到最近的設施（歐幾里得距離）
- 提供每設施負載和全市負載率

### GarbageSewageProduction

```
src/core/service/GarbageSewageProduction.ts
```

**職責**：計算分區制的垃圾和污水產量。

- 垃圾產量：`calculateZoneDemand(GARBAGE_PRODUCTION, zone, actualResidents, actualWorkers)` — 使用實際入住人口
- 污水產量：`calculateZoneDemand(WATER_CONSUMPTION, zone, bt.residents, bt.workers)` × SEWAGE_RATE — 使用建築容量
- 垃圾透過 `reportGarbage(x, y, amount)` 逐建築報告，累積到 ≥1 袋時進入 PendingGarbage 佇列
- 實際入住人口由 `tickAllCivicServices` 從 CitizenManager 預建 occupancy map 提供

### UtilityCellDemand（DRY 重構）

```
src/core/service/UtilityCellDemand.ts
```

**職責**：PowerGrid 和 WaterNetwork 共用的單格需求計算。

- 消除兩個系統中重複的 `getCellDemand` 邏輯
- 統一處理三類建築：區域建築（依 zoneConsumption 表）、排除的工廠本身（產出不消耗）、基礎設施（依 infraConsumption 查找表）

### calculateBuildingIncome（DRY 重構）

```
src/core/economy/IncomeCalculator.ts
```

**職責**：從 SimulationLoop 抽取的建築收入計算共用函式。

- 處理住宅稅收（居民 × 教育倍率 × 等級倍率 × 稅率）
- 處理營業稅收（companyIncome × 等級倍率 × 稅率 × 勞動力比率）
- 統一無收入判定（焦黑、廢棄、無電力、多格次格）

---

## 遊戲載入暖機 (Game Load Warmup)

載入存檔時，遊戲執行非同步暖機流程以預計算狀態並產生初始車輛：

### 暖機流程

`SimulationLoop.warmup(spawnRatio, onProgress)`:

1. 遍歷所有有住所和工作場所的市民
2. 計算早晨和傍晚的通勤路徑（使用 `findLanePathVariants`）
3. 快取路徑到 CommuteCache
4. 對 20% 的市民產生初始車輛（隨機選早晨或傍晚路徑）
5. 每 100 位市民回報進度（0~1）並 yield 執行緒

### 載入畫面 (Loading Screen)

遊戲啟動和存檔載入時顯示分階段載入畫面：

| 階段 | 標籤 | 內容 |
|------|------|------|
| 1 | Setting up roads... | 重建鐵路網路 |
| 2 | Preparing city services... | 重算道路覆蓋 |
| 3 | Connecting utilities... | 計算電力/水力覆蓋 |
| 4 | Planning traffic routes... | 暖機（預計算路徑+產生車輛） |
| 5 | Preparing graphics... | 初始化渲染器 |

載入畫面顯示：
- 百分比數字（0-100%）
- 藍色進度條
- 目前步驟標籤
- 完成後停留 300ms 再移除
