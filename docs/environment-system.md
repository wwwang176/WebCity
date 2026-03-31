# 環境系統 (Environment System)

WebCity 模擬三種污染和天然資源的管理。

---

## 污染 (Pollution)

### 污染類型

| 類型 | 說明 | 影響 |
|------|------|------|
| `ground` (地面污染) | 工業/垃圾/電廠產生 | 降低地價、幸福度 |
| `water` (水源污染) | 未處理污水排放 | 降低水質 |
| `noise` (噪音) | 交通/機場/工業產生 | 降低幸福度 |

### 污染擴散

從污染源以曼哈頓距離擴散：

```
某點污染值 = max(0, 源頭污染量 - 曼哈頓距離 × 30)
```

- 衰減率: `DECAY_PER_CELL = 30` 每格
- 擴散範圍: `ceil(污染量 / 30)` 格

多個源的污染值**累加**。

### 公園淨化效果

公園在歐幾里得半徑內減少地面和噪音污染：

```
reduction = min(20, 現有值)
```

---

## 污染來源

### 工業區（半徑漸衰模型）

每個工業建築產生兩種污染，採用**半徑漸衰**模型（`PollutionSource.radius`），污染在指定半徑內逐漸衰減至 0，取代過去的固定值模式：

- **地面污染**: 60 (`INDUSTRIAL_GROUND`)，半徑 4 格 (`INDUSTRIAL_GROUND_RADIUS`)
- **噪音污染**: 40 (`INDUSTRIAL_NOISE`)，半徑 3 格 (`INDUSTRIAL_NOISE_RADIUS`)

當 `PollutionSource` 設定 `radius` 時，擴散衰減率會自動調整使污染在該距離歸零。

SimulationLoop 中以 0.2 的係數衰減工業污染。

### 交通密度同步（SyncTrafficDensity）

`syncTrafficDensityToGrid()` 負責將 TrafficSimulation 的流量資料寫入 Grid 的 `trafficDensity` 欄位，供噪音污染計算使用。

**流程：**

1. **地面道路**：遍歷所有 `roadType !== 0` 的格子，透過 `TrafficSimulation.getSegmentDensity(segmentKey)` 取得流量。
2. **高架道路**：從 ElevationManager 取得所有高架路段，呼叫 `getSegmentDensity("x,y,level")` 取得流量，**投射至地面格子**（取 max，即同一地面格取高架與地面的較大值）。
3. **對數縮放**：將原始流量轉為 `Math.min(10, Math.round(Math.log2(1 + flow)))` 的離散值（0~10），避免極高流量壓縮梯度。
4. **寫入 Grid**：僅在值改變時呼叫 `grid.setField(x, y, 'trafficDensity', scaled)`。

**GC 友好設計：** 呼叫者傳入 `reusableFlowMap: Map<string, number>`，函式在開頭與結尾皆 `.clear()`，避免每 tick 重新分配 Map。

檔案位置：`src/core/environment/SyncTrafficDensity.ts`

### 道路交通噪音

道路交通噪音使用**速度因子**與**對數縮放**產生有意義的梯度。

噪音計算公式：
```
噪音 = round(trafficDensity × TRAFFIC_NOISE_MULTIPLIER × speedFactor)
```

**速度因子（`ROAD_SPEED_FACTOR`）：**

| 道路類型 | 速度因子 |
|----------|----------|
| RURAL | 0.8 |
| TWO_LANE | 1.0 |
| FOUR_LANE | 1.5 |
| SIX_LANE | 1.8 |
| HIGHWAY | 2.0 |
| ONE_WAY | 1.2 |

- `TRAFFIC_NOISE_MULTIPLIER = 3`
- `TRAFFIC_NOISE_RADIUS = 2`（噪音擴散半徑）
- 高架道路的流量已在 SyncTrafficDensity 階段投射至地面格子，因此噪音同樣影響地面

由於 `trafficDensity` 本身已經過對數縮放（0~10），最終噪音值範圍約為 0~60（10 × 3 × 2.0）。

### 電廠

燃煤電廠的 `pollution` 屬性值（預設 10）作為地面污染源。

### 垃圾場（2×2 多格發射）

垃圾設施為 2×2 建築，污染從**所有佔用格子**發射（非僅左上角），擴散半徑統一為 `POLLUTION_RADIUS = 5`。

**三層污染模型：**

1. **基礎污染**：每個設施的每個格子始終發射 `BASE_POLLUTION = 20` 地面污染。
2. **超載污染**：負載率 > 50% (`POLLUTION_LOAD_THRESHOLD`) 時，每格額外發射 `round(負載率 × POLLUTION_AMOUNT_SCALE)` 地面污染（`POLLUTION_AMOUNT_SCALE = 40`）。
3. **溢出污染**：垃圾溢出時，`getPollutionPenalty()` 的值平均分配至各設施的每個格子。

### 污水排放

- 未處理污水通過排放口產生水源污染
- 每單位未處理污水 = 5 水源污染
- 每個排放口最多 80 污染

### 機場

產生噪音污染（按規模）：SMALL=10, MEDIUM=25, LARGE=50

### 污染源收集（PollutionSourceRegistry）

`PollutionSourceRegistry` 是集中式的污染源註冊中心，使用 DIP（依賴反轉原則）收集所有實現 `PollutionSourceProvider` 介面的模組的污染源，統一匯總後計算擴散。

**介面定義：**
```typescript
interface PollutionSourceProvider {
  getPollutionSources(): PollutionSource[];
}
```

**兩種收集方式：**

1. **`collectAllPollutionSources(providers)`**：接收 `PollutionSourceProvider[]`，回傳所有來源的合併陣列。
2. **`forEachServicePollutionSource(state, emit)`**：GC 友好版本，透過回呼逐一發射來源，不產生中間陣列。從 GameState 按 key 查找服務。

**已註冊的服務 key（`POLLUTION_PROVIDER_KEYS`）：**
- `garbage` — 垃圾設施
- `sewage` — 污水排放
- `airport` — 機場噪音

新增污染來源只需實作 `PollutionSourceProvider` 並將 key 加入 `POLLUTION_PROVIDER_KEYS` 即可（OCP，開放封閉原則）。

另外，Grid 層級的污染（工業 + 道路噪音）由獨立的 `GridPollutionSources` 模組提供，透過 `forEachGridPollutionSource()` 收集。

檔案位置：`src/core/environment/PollutionSourceRegistry.ts`、`src/core/environment/GridPollutionSources.ts`

### 犯罪率計算

```
基礎犯罪率 = min(50, 人口 × 0.02)
警察覆蓋率 = min(1, 警局數 × 0.15)
犯罪率 = 基礎犯罪率 × (1 - 覆蓋率 × 0.6)
```

最大警察犯罪減少: 60%

---

## 水流系統 (WaterFlow)

### 概念

水流系統模擬水體中污染物的擴散方向。

### 流向

每個水域格子有一個流向：N、S、E、W 或空（靜止）。

### 水污染擴散

從污染源沿水流方向擴散：
1. 設定源頭污染值
2. 沿流向前進
3. 每格衰減 30
4. 到達邊界或衰減至 0 時停止

---

## 天然資源 (Natural Resources)

### 資源類型

| 類型 | 列舉值 |
|------|--------|
| NONE | 0 |
| ORE (礦石) | 1 |
| OIL (石油) | 2 |
| FERTILE (肥沃土地) | 3 |
| FOREST (森林) | 4 |

### 資源生成

使用確定性偽隨機數產生器（種子 42）：

- **生成機率**: 30% (`SPAWN_CHANCE`)
- **數量範圍**: 100~600 (`MIN_AMOUNT ~ MAX_AMOUNT`)
- 4 種資源類型均勻分佈

### 開採

```
extract(x, y, amount) → 實際開採量 = min(amount, 剩餘量)
```

資源會被消耗，`isExhausted()` 檢查是否已耗盡。

---

## 城市環境指標 (CityMetrics)

SimulationLoop 使用以下函式計算城市級環境指標：

- `getAvgResidentialPollution()` — 住宅區平均污染
- `getAvgResidentialNoise()` — 住宅區平均噪音
- `calculateCrimeRate()` — 城市犯罪率
