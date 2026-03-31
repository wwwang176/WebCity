# 市政服務系統 (Civic Services)

WebCity 提供 10 種市政服務，每種服務由對應的建築提供覆蓋和效果。

---

## 服務總覽

> 各設施的 Building ID、尺寸和造價完整表見[建築系統 — 基礎設施](building-system.md#基礎設施-infrastructure)。

| 服務 | 建築 | 尺寸 | 造價 | 維護/tick | 覆蓋方式 |
|------|------|------|------|---------|---------|
| 電力 | Power Plant | 2×2 | $1000 | $5 | BFS 路網擴散（預算耗盡制） |
| 供水 | Water Plant | 2×2 | $600 | $3 | BFS 路網擴散（預算耗盡制） |
| 警察 | Police Station | 2×2 | $800 | $4 | 道路距離覆蓋 |
| 消防 | Fire Station | 2×2 | $800 | $4 | 道路距離覆蓋 |
| 醫療 | Hospital | 2×3 | $1600 | $8 | 道路距離覆蓋 |
| 教育(小學) | Elementary School | 2×2 | $800 | $5 | 道路距離覆蓋 |
| 教育(高中) | High School | 2×3 | $1200 | $5 | 道路距離覆蓋 |
| 教育(大學) | University | 3×3 | $3000 | $5 | 道路距離覆蓋 |
| 垃圾處理 | Landfill | 2×2 | $800 | $3 | 道路距離覆蓋 |
| 污水處理 | Sewage Plant | 2×2 | $800 | $4 | 連接道路判定 |
| 殯葬 | Cemetery | 2×2 | $600 | $2 | 道路距離覆蓋 |
| 公園 | Park | 1×1 | $200 | $2 | 歐幾里得半徑 |

---

## 電力系統 (PowerGrid)

### 發電廠類型

支援 5 種發電方式：`wind`, `solar`, `coal`, `gas`, `nuclear`

### 電力需求

每棟建築的用電量 = base + perCapita × (居民數或工人數)

| 區域類型 | 基礎用電 | 每人用電 |
|---------|---------|---------|
| 住宅 | 0.25 | 0.025 |
| 商業 | 0.50 | 0.04 |
| 工業 | 1.00 | 0.06 |
| 辦公 | 0.50 | 0.025 |

基礎設施用電：

| 設施 | 用電量 |
|------|--------|
| 警局 | 5 |
| 消防局 | 5 |
| 醫院 | 9 |
| 小學 | 4 |
| 高中 | 6 |
| 大學 | 8 |
| 垃圾場 | 8 |
| 水廠 | 10 |
| 污水廠 | 8 |
| 公園 | 1.5 |
| 墓園 | 1.5 |

### 覆蓋機制

使用兩階段 BFS：

1. **完整覆蓋**: 從電廠出發，沿道路和建築無限 BFS 擴散 → 顯示網路可達範圍
2. **供電覆蓋**: 從電廠出發，每經過一個建築扣除其用電量 → 電廠輸出耗盡後停止

---

## 貨運系統 (FreightSystem)

### 架構概覽

貨運系統由三個模組協作：

| 模組 | 檔案 | 職責 |
|------|------|------|
| `FreightSystem` | `src/core/traffic/FreightSystem.ts` | 兩階段 BFS 供貨計算、SupplyStatus 管理、過剩/缺貨指標 |
| `FreightTradeCollector` | `src/core/traffic/FreightTradeCollector.ts` | 收集貿易基礎設施位置與吞吐量（SRP 拆分自 SimulationLoop） |
| `FreightPage` | `src/ui/modals/overview/FreightPage.tsx` | City Overview 貨運分頁 UI |

SimulationLoop 每 6 ticks（Slot 5）調用 `collectTradePositions()` 收集貿易設施，再呼叫 `FreightSystem.calculateSupply()` 執行 BFS。

### 生產與消耗速率

#### 工業生產量（`INDUSTRIAL_PRODUCTION`）

| 建築 | Building ID | 等級 | 產量/tick |
|------|-------------|------|----------|
| Small Factory | 13 | Lv1 | 3 |
| Medium Factory | 14 | Lv2 | 5 |
| Large Factory | 15 | Lv3 | 8 |

#### 商業消耗量（`COMMERCIAL_CONSUMPTION`）

| 建築 | Building ID | 密度 | 等級 | 消耗/tick |
|------|-------------|------|------|----------|
| Small Shop | 7 | 低密度 | Lv1 | 1 |
| Medium Shop | 8 | 低密度 | Lv2 | 2 |
| Large Shop | 9 | 低密度 | Lv3 | 3 |
| Small Mall | 10 | 高密度 | Lv1 | 8 |
| Medium Mall | 11 | 高密度 | Lv2 | 14 |
| Department Store | 12 | 高密度 | Lv3 | 20 |

可透過 `getProductionRate(buildingId)` / `getConsumptionRate(buildingId)` 查詢。

### 兩階段 BFS 供貨（`calculateSupply()`）

#### Phase 1：本地供應（Local BFS）

從所有工廠同時出發的 BFS，共享總產量作為 `localBudget`：

1. 掃描 Grid 收集所有工廠（`ZoneType.INDUSTRIAL` + `buildingId > 0`）為種子點
2. 彙總 `totalProduction`（全部工廠產量之和）與 `totalConsumption`（全部商業消耗之和）
3. BFS 沿道路與建築格擴散，遇到商業建築（`isCommercialZone`）時：
   - 計算 `supplied = min(demand, localBudget)`
   - 扣減 `localBudget -= supplied`
   - 寫入 `SupplyStatus { source: 'local', ratio: supplied / demand }`
4. **按比例供應**：budget 不足時給予部分 ratio（例如 budget=3, demand=8 → ratio=3/8=0.375）
5. BFS 不因供應不足而停止：遇到無法完全供應的建築會設定部分 ratio 後繼續擴散

#### Phase 2：貿易供應（Trade BFS）

從外部貿易設施出發的第二輪 BFS，處理進口與出口：

1. 種子點由 `FreightTradeCollector.collectTradePositions()` 提供（見下節）
2. BFS 使用 `importBudget`（= 總貿易吞吐量）沿道路擴散：
   - **進口**：遇到未滿供應或無供應的商業建築 → 計算 `remaining = demand - alreadySupplied`，用 `importBudget` 補足 → 標記 `source: 'imported'`
   - **出口標記**：遇到工廠（`ZoneType.INDUSTRIAL`）→ 加入 `exportableFactorySet`
3. 進口也支援按比例供應：`importBudget` 不足時部分供應
4. 出口計算：`exported = min(surplus, exportableProduction, exportCapacity)`
   - `surplus = totalProduction - totalConsumption`
   - `exportableProduction` = 僅計算 BFS 可達的工廠產能

### FreightTradeCollector

`collectTradePositions()` 從三種貿易基礎設施收集 BFS 種子點：

```typescript
interface TradePosition {
  x: number; y: number;
  throughput: number;
  tradeKey: string;  // 同一建築的多個道路入口共用 tradeKey
}
```

#### 收集來源

| 設施類型 | 來源 | 吞吐量欄位 |
|---------|------|-----------|
| 鐵路車站 | `RailNetwork` 提供有外部連接的車站 | `station.throughput` |
| 機場 | `AirportSystem.getAirports()` | `airport.cargoPerTick` |
| 高速公路邊緣格 | `HighwayConnection.getEdgeHighwayCells()` | `HighwayConnection.getThroughput()` 平分至各格 |

#### 道路鄰接收集（`collectAdjacentRoadCells()`）

鐵路車站與機場是多格建築（2x2 或更大），`collectAdjacentRoadCells()` 會：
1. 查詢 `InfraConfig` 取得建築尺寸（`width × height`）
2. 遍歷建築所有格的四方向鄰居
3. 找出所有相鄰道路格作為 BFS 種子點
4. 同一建築的所有道路入口共用相同 `tradeKey`，避免重複計算吞吐量

若建築周圍無道路，退化為建築本身位置作為種子點。

### 供貨狀態（SupplyStatus）

每棟商業建築持有一個 `SupplyStatus`：

```typescript
interface SupplyStatus {
  source: 'local' | 'imported' | 'none';
  ratio: number;  // 0~1: 需求被滿足的比例
}
```

| source | ratio | 說明 |
|--------|-------|------|
| `local` | 0~1 | 完全由本地工廠 BFS 供應（Phase 1） |
| `imported` | 0~1 | 有進口貨物參與補足（Phase 2 介入） |
| `none` | 0 | 兩階段 BFS 皆未到達 |

查詢 API：
- `getSupplyStatus(x, y)` → `SupplyStatus`（未計算過則預設 `{ source: 'local', ratio: 1 }`）
- `isSupplied(x, y)` → `boolean`（ratio > 0 即為 true，向下相容）
- `getSuppliedCount()` / `getLocalSuppliedCount()` / `getImportedCount()` → 各狀態的商業建築數量

### 進出口貿易（Import / Export）

#### 貿易設施前提條件

| 設施 | 連接條件 |
|------|---------|
| 鐵路車站 | 車站必須透過鐵軌 BFS 連通到地圖邊緣（閉環鐵路不算） |
| 機場 | 有機場建築即可（不需外部連接） |
| 高速公路 | 高速公路格位於地圖邊緣且方向朝內（`hasExternalConnection`） |

#### 吞吐量

| 設施 | 吞吐量/tick | 常數 |
|------|-----------|------|
| 每座外部鐵路車站 | 50 | `TRADE.RAIL_THROUGHPUT_PER_STATION` |
| 機場 (SMALL) | 20 | `AIRPORT_SIZE_CONFIG.SMALL.cargo` |
| 機場 (MEDIUM) | 100 | `AIRPORT_SIZE_CONFIG.MEDIUM.cargo` |
| 機場 (LARGE) | 300 | `AIRPORT_SIZE_CONFIG.LARGE.cargo` |
| 每個高速公路邊緣格 | 30 | `HIGHWAY_EXTERNAL.THROUGHPUT_PER_CONNECTION` |

多設施吞吐量疊加。進出口共用吞吐量上限（`importCapacity = exportCapacity = totalThroughput`）。

#### 收入倍率

| 供貨來源 | 收入倍率 | 說明 |
|---------|---------|------|
| 本地供應 (`local`) | × 1.0 | 無懲罰 |
| 進口供應 (`imported`) | × 0.7 | `TRADE.IMPORT_INCOME_MULTIPLIER` |
| 出口收入 | × 0.5 | `TRADE.EXPORT_INCOME_MULTIPLIER` |
| 無供應 (`none`) | × 0.5 | 最低收入 |

實際收入計算結合 ratio：
- 本地：`× (0.5 + 0.5 × ratio)`
- 進口：`× 0.7 × ratio + 0.5 × (1 - ratio)`

#### 進口流程（Supply Rate < 100%）

- Phase 2 BFS 從貿易設施出發，供應 Phase 1 未覆蓋或部分覆蓋的商業
- 離貿易設施遠的商業拿不到進口（BFS 可達性限制）
- 已有 local 部分供應的建築會被「補足」（ratio 提升），source 改為 `imported`

#### 出口流程（Supply Rate > 100%）

- Phase 2 BFS 標記可達的工廠加入 `exportableFactorySet`
- 出口量 = `min(surplus, exportableProduction, exportCapacity)`
- 離貿易設施遠的工廠無法出口（`isFactoryExporting(x, y)` 判定）
- 出口降低有效 surplusRatio

#### 貿易設施位置策略

- 蓋在商業區旁 → 有效進口
- 蓋在工業區旁 → 有效出口
- 蓋在中間 → 兩邊都能顧到

### 過剩計算（`getSurplusRatio()`）

```
surplus = production - consumption
effectiveSurplus = max(0, surplus - exported)
surplusRatio = min(1, effectiveSurplus / consumption)
```

出口會降低有效過剩。`consumption = 0` 或 `production <= consumption` 時 surplusRatio = 0。

### 供貨對廢棄壓力的影響

- 商業缺貨：`(1 - ratio) × 6`（完全供應 = 0 壓力，完全缺貨 = +6）
- 工業過剩：`surplusRatio × 6`

### RCI 需求回饋

- 缺貨 → 商業需求降低（`shortageRatio × 10`）
- 過剩 → 工業需求降低（`surplusRatio × 10`）
- 系統自動趨向供需平衡

### Supply Rate 計算

```
effectiveProduction = production - exported + imported
Supply Rate = effectiveProduction / consumption
```

| Supply Rate | 顏色 | 意義 |
|-------------|------|------|
| < 50% | 紅 | 嚴重缺貨 |
| 50~80% | 黃 | 輕微缺貨 |
| 80~120% | 綠 | 平衡 |
| 120~150% | 黃 | 輕微過剩 |
| > 150% | 紅 | 嚴重過剩 |

### FreightPage UI（City Overview 貨運分頁）

`FreightPage` 元件（`src/ui/modals/overview/FreightPage.tsx`）提供即時貨運監控儀表板，分為四個區塊：

#### 1. Supply Overview

- Supply Rate 百分比進度條（含色彩指示：綠/黃/紅）
- Production/tick 與 Consumption/tick 數值卡片

#### 2. Commercial Supply 表格

| 欄位 | 說明 |
|------|------|
| Local Supply | `getLocalSuppliedCount()` — Phase 1 BFS 覆蓋的商業數 |
| Imported | `getImportedCount()` — Phase 2 BFS 進口補足的商業數 |
| Unsupplied | `totalCommercial - suppliedCount` — 完全無供應的商業數 |
| Total | 所有商業建築總數（Grid 掃描） |

#### 3. Trade 區塊

- Import/Export 即時流量（units/tick）
- Trade Facilities 表格：列出鐵路（外部連接車站數/總車站數）、高速公路（連接數）、機場（各機場大小與 cargo），以及 Total Capacity
- 無外部連接的設施顯示紅色警告「(no edge connection)」

#### 4. Income Impact

顯示四種供貨狀態的收入倍率說明：
- Local supply: ×1.0
- Imported goods: ×0.7
- Exported goods: ×0.5
- Unsupplied: ×0.5 + abandonment stress

---

### 供電比

```
供電比 = 總發電量 / 總需求量
```
供電比 < 1 時，部分建築將無電可用。

### BFS 中繼與終點

電力/供水的 BFS 將格子分為三種：

1. **中繼格** — 接收並傳播電力/水，BFS 繼續擴散：
   - 有道路 (`roadType != NONE`)
   - 有建築 (`buildingId != 0`)
   - 是基礎設施位置

2. **終點格** — 只接收，不傳播（不加入 BFS queue）：
   - 有分區規劃但無建築的空格（`zoneType != NONE && buildingId == 0`）
   - 例如：道路旁的空工業區格可以接電，但不會把電傳到更遠的格子

3. **不可達格** — 完全跳過：
   - 無道路、無建築、無分區的空地

這表示空的分區格子只要鄰接有電的道路或建築就會有電，但一旦建築蓋起來（`buildingId > 0`），該格子就會升級為中繼格，可以將電力傳給更遠的鄰居。

---

## 服務調度 (Service Dispatch)

服務車輛（消防車、救護車、垃圾車、靈車）通過道路網路調度。巡邏車輛的渲染與交通規則詳見[交通系統 — 服務車輛](traffic-system.md#服務車輛-service-vehicle-manager)。

### 服務車輛速度

| 車輛類型 | 基礎速度 (格/tick) |
|---------|-------------------|
| 消防車 | 3 |
| 救護車 | 3 |
| 垃圾車 | 2 |
| 靈車 | 2 |

### 行程估計

```
行程時間 = ceil((路徑長度 / 速度) × (1 + 壅塞率))
```

壅塞率基於路徑上的壅塞路段和全局車輛密度估算。

### 設施分區

設施可以被分配到特定行政區，僅回應該區域的事件。未分配的設施回應所有區域。

---

## 供水系統 (WaterNetwork)

### 用水需求

| 區域類型 | 基礎用水 | 每人用水 | 說明 |
|---------|---------|---------|------|
| 住宅 | 0.375 | 0.0375 | 高（洗澡/沖廁/洗衣） |
| 商業 | 0.20 | 0.016 | 低（廁所/清潔） |
| 工業 | 0.80 | 0.048 | 中（製程用水） |
| 辦公 | 0.15 | 0.0075 | 最低（廁所/飲用） |

覆蓋機制與電力相同（BFS 路網擴散 + 預算耗盡制）。

水廠需要放置在有地下水的位置（靠近河流）。

---

## 警察服務 (PoliceService)

### 犯罪減少

- 每個覆蓋該格的警局: 犯罪率 -30
- 上限: 犯罪率最多減少 -60

### 犯罪率計算（SimulationLoop）

```
基礎犯罪率 = min(50, 人口 × 0.02)
每格犯罪率 = 基礎犯罪率 + 警察犯罪減少值
```

---

## 消防服務 (FireService)

### 火災機制

#### 起火概率

```
基礎起火概率 = min(0.02, 0.001 + 人口 × 0.000005)
每 tick 以此概率嘗試起火
```

起火時隨機取樣 10 個格子，找到有區域建築的格子即起火。

#### 火災過程

1. 起火 → 建立 ActiveFire（持續 3 ticks）
2. 每 tick 倒數
3. 完成後結算損害：
   - **有消防覆蓋**: damage = 10%
   - **無消防覆蓋**: damage = 80%

#### 焦黑判定

```
若 damage ≥ 0.5 → 建築變為焦黑 (reserved = BURNED)
```

焦黑建築：
- 渲染為深灰色，無燈光
- 不產生收入
- 不計入容量
- 2% 機率/成長 tick 被建商自動清除

#### 火災風險

基於道路距離：
- 無消防局: 風險 = 1.0
- 覆蓋範圍外: 風險 = 0.8
- 覆蓋範圍內: 風險 = (道路距離 / 預算) × 0.5

---

## 醫療服務 (HealthService)

### 健康加成

- 每個覆蓋該格的醫院: +20 健康值
- 上限: +35

### 對死亡率的影響

有醫療覆蓋的市民死亡率降低 70%（乘以 0.3）。完整死亡率計算詳見[市民系統 — 死亡系統](citizen-system.md#死亡系統)。

---

## 教育服務 (EducationService)

### 學校類型

| 學校 | 預設半徑 | 預設容量 | 覆蓋預算 |
|------|---------|---------|---------|
| 小學 | 10 | 200 | ELEMENTARY_BUDGET |
| 高中 | 12 | 300 | HIGHSCHOOL_BUDGET |
| 大學 | 15 | 500 | UNIVERSITY_BUDGET |

### 教育等級判定

在某位置取得最高可用教育等級：
```
有大學覆蓋 → university
有高中覆蓋 → highschool
有小學覆蓋 → elementary
無覆蓋 → none
```

---

## 垃圾處理 (GarbageService)

### 垃圾產生

```
每 tick 垃圾量 = floor(人口 / 100)
```

### 處理流程

1. 焚化：每設施每 tick 燒掉 5% 的現有垃圾
2. 分配新垃圾到有空間的設施
3. 超出容量 → 溢出垃圾

### 溢出影響

```
污染懲罰 = min(100, 溢出量 × 2)
```

### 設施污染

負載率 > 50% 的設施會產生地面污染：
```
污染量 = round(負載率 × 40)
```

---

## 污水處理 (SewageService)

### 污水產生

```
每 tick 污水量 = floor(人口 / 100)
```

### 處理能力

只有連接道路的處理廠才能運作。未處理污水 = max(0, 產生量 - 連接處理能力)。

### 水源污染

```
水源污染 = 未處理污水 × 5
```
每個排放口最多排放 80 污染。

---

## 殯葬服務 (DeathCareService)

### 運作流程

每 tick：
1. 直接火化待處理屍體（每墓園每 tick 處理 5 具）
2. 火化儲存中的屍體
3. 儲存未處理的屍體（直到容量上限 500）

未處理的屍體會造成 -20 幸福度懲罰。

### 統計

使用 30 天環形緩衝區追蹤每日火化數量。

---

## 公園服務 (ParkService)

### 覆蓋方式

使用歐幾里得距離（預設半徑 5 格）。只有連接道路的公園才有效。

### 效果

| 效果 | 每公園 | 上限 |
|------|--------|------|
| 地價加成 | +15 | +30 |
| 污染減少 | -20 | -40 |
| 幸福度加成 | +5 | +10 |

---

## 覆蓋方式比較

| 方式 | 使用服務 | 說明 |
|------|---------|------|
| BFS 路網擴散（預算耗盡制） | 電力、供水 | 沿道路/建築 BFS 中繼擴散，分區空格為終點（接收但不中繼），每經過建築扣除需求量直到預算耗盡 |
| 道路距離覆蓋 | 警察、消防、醫療、教育、垃圾、殯葬 | 從設施出發沿道路 BFS，在道路距離預算內的格子視為覆蓋 |
| 連接道路判定 | 污水 | 只判斷設施是否鄰接道路 |
| 歐幾里得半徑 | 公園 | 直線距離內覆蓋 |

---

## 道路距離覆蓋演算法 (Road Coverage Flood)

大多數市政服務使用 Dijkstra 道路距離覆蓋，而非簡單的歐幾里得半徑。

### 道路格通過成本

```
成本 = BASE_COST / (speedLimit × laneFactor)
```

- `BASE_COST` = 100
- `laneFactor` = 車道數 / 2（雙車道 = 1×）
- 更快更寬的道路 → 成本更低 → 覆蓋更遠

### 各服務的覆蓋預算

| 服務 | 預算 |
|------|------|
| 警察 | 30 |
| 消防 | 30 |
| 殯葬 | 35 |
| 醫療 | 40 |
| 垃圾 | 80 |
| 小學 | 20 |
| 高中 | 30 |
| 大學 | 45 |

從設施出發沿道路 Dijkstra 擴散，累積成本 ≤ 預算的格子視為覆蓋。

---

## 服務覆蓋分數

### 單格服務分數

每個格子的服務分數（0~10）：

| 服務 | 有覆蓋時的分數 |
|------|--------------|
| 電力 | +2 |
| 供水 | +2 |
| 警察 | +1 |
| 消防 | +1 |
| 垃圾 | +1 |
| 醫療 | +1 |
| 教育 | +1 |
| 殯葬 | +1 |

### 城市服務覆蓋率

`getResidentialServiceRatios()` 計算所有住宅建築的各服務覆蓋比率（0.0~1.0），用於城市層級的幸福度和吸引力計算。

### 城市服務覆蓋分數

```
分數 = 電力覆蓋率 × 2 + 供水覆蓋率 × 2
     + 警察覆蓋率 + 消防覆蓋率 + 垃圾覆蓋率
     + 醫療覆蓋率 + 教育覆蓋率 + 殯葬覆蓋率
     + (平均污染 < 10 ? 1 : 0)
```
