# 建築系統 (Building System)

WebCity 的建築分為兩大類：**區域建築**（由建商自動蓋的）和**基礎設施**（玩家手動放置的）。

---

## 區域建築 (Zone Buildings)

### 建築類型表

#### 低密度住宅 (RESIDENTIAL_LOW)

| ID | 名稱 | 等級 | 居民數 |
|----|------|------|--------|
| 1 | Small House | 1 | 4 |
| 2 | Medium House | 2 | 6 |
| 3 | Large House | 3 | 8 |

#### 高密度住宅 (RESIDENTIAL_HIGH)

| ID | 名稱 | 等級 | 居民數 |
|----|------|------|--------|
| 4 | Small Apartment | 1 | 80 |
| 5 | Medium Apartment | 2 | 160 |
| 6 | High Rise | 3 | 320 |

#### 低密度商業 (COMMERCIAL_LOW)

| ID | 名稱 | 等級 | 工人數 | 營收基數 |
|----|------|------|--------|---------|
| 7 | Small Shop | 1 | 4 | 10 |
| 8 | Medium Shop | 2 | 8 | 15 |
| 9 | Large Shop | 3 | 12 | 20 |

#### 高密度商業 (COMMERCIAL_HIGH)

| ID | 名稱 | 等級 | 工人數 | 營收基數 |
|----|------|------|--------|---------|
| 10 | Small Mall | 1 | 80 | 40 |
| 11 | Medium Mall | 2 | 160 | 60 |
| 12 | Department Store | 3 | 320 | 80 |

#### 工業 (INDUSTRIAL)

| ID | 名稱 | 等級 | 工人數 | 營收基數 |
|----|------|------|--------|---------|
| 13 | Small Factory | 1 | 10 | 15 |
| 14 | Medium Factory | 2 | 20 | 22 |
| 15 | Large Factory | 3 | 40 | 30 |

#### 低密度辦公 (OFFICE LOW)

| ID | 名稱 | 等級 | 工人數 | 營收基數 |
|----|------|------|--------|---------|
| 16 | Small Office | 1 | 15 | 20 |
| 17 | Medium Office | 2 | 30 | 30 |
| 18 | Large Office | 3 | 50 | 40 |

#### 高密度辦公 (OFFICE HIGH)

| ID | 名稱 | 等級 | 工人數 | 營收基數 |
|----|------|------|--------|---------|
| 19 | Office Building | 1 | 160 | 60 |
| 20 | Office Complex | 2 | 320 | 90 |
| 21 | Office Tower | 3 | 600 | 120 |

### 建築狀態

```
NORMAL            = 0   正常
ABANDONED         = 1   廢棄
UNDER_CONSTRUCTION = 2   建造中
BURNED            = 3   焦黑（火災後）
```

---

## 建築成長 (Building Growth)

區域建築在滿足條件時會自動在已規劃的空地上成長。

### 成長條件

所有條件必須**同時**滿足：

1. **有區域規劃**: `zoneType` 不為 NONE
2. **空地**: `buildingId` 為 0
3. **道路連接**: 至少一個 4 方向鄰居有道路
4. **有電力**: `hasPower = true`（分區空格只要鄰接有電的道路/建築即視為有電，見[服務系統 — BFS 中繼與終點](services-system.md#bfs-中繼與終點)）
5. **有供水**: `hasWater = true`（同上）
6. **RCI 需求**: 對應的住宅/商業/工業需求 > 0

### 成長流程

```
canGrow() 檢查所有條件
  ↓ 通過
getMaxDensity() 根據鄰接道路判斷密度等級
  ↓ LOW 或 HIGH
決定查詢密度（工業區固定用 LOW，其他用道路密度）
  ↓
getBuildingsForZone(zoneType, density, level=1) 取得候選建築
  ↓ 有候選者
randomElement(candidates) 隨機選擇一個 level 1 建築
  ↓
grid.setCell(x, y, { buildingId: building.id })
```

新成長的建築一律為 Level 1。

**工業區密度**: 工業建築只有 LOW 密度，不受道路密度限制。任何道路（RURAL/TWO_LANE/FOUR_LANE/SIX_LANE/ONE_WAY）旁的工業區都可以成長。

### 區域政策限制

建築成長會檢查區域政策：
- `NO_HEAVY_INDUSTRY` 政策啟用時 → 工業區不會成長
- `HIGH_DENSITY_BAN` 政策啟用時 → 高密度住宅/商業不會成長

### 焦黑建築清除

焦黑建築 (`reserved = BURNED`) 在成長 tick 中有 2% 機率被建商自動清除（拆除），變為空地。火災如何產生焦黑建築詳見[市政服務 — 消防服務](services-system.md#消防服務-fireservice)。

### 廢棄建築重建

廢棄建築 (`reserved = ABANDONED`) 的重建流程：
1. 檢查電力、供水、RCI 需求是否滿足
2. 檢查區域政策是否允許
3. 條件全部滿足 → 拆除廢棄建築 → 重建新建築
4. 清除壓力值 (`abandonmentStress`)

### 成長取樣

每個慢速 tick 隨機取樣 20 個格子嘗試成長（`GROWTH_ATTEMPTS = 20`）。這意味著不是所有空地都會同時成長，而是逐步填充。

---

## 建築升級 (Building Upgrade)

已存在的建築可以在條件改善時自動升級。

### 升級門檻

不同區域類型使用不同的升級指標：

- **住宅/商業**: 由 `landValue`（地價）驅動
- **工業/辦公**: 由 `avgEducation`（平均教育水平）驅動

| 目標等級 | 最低地價 | 最低平均教育 |
|---------|---------|-------------|
| Level 2 | 50 | 1.0 (小學) |
| Level 3 | 80 | 2.0 (高中) |

### 降級門檻

使用比升級更低的門檻，形成遲滯效應避免建築在門檻邊緣反覆升降：

| 維持等級 | 最低地價 | 最低平均教育 |
|---------|---------|-------------|
| Level 2 | 35 | 0.5 |
| Level 3 | 60 | 1.5 |

### 教育分數

教育等級與分數對應詳見[市民系統 — 教育系統](citizen-system.md#教育系統)（NONE=0, ELEMENTARY=1, HIGH_SCHOOL=2, UNIVERSITY=3）。

升級指標 `avgEducation` = 建築工人教育分數的平均值。

---

## 建築廢棄 (Building Abandonment)

建築承受壓力到達臨界值時會被廢棄。

### 壓力因子

| 因子 | 觸發條件 | 基礎壓力增量 |
|------|---------|-------------|
| 稅率(住宅) | 住宅稅率 > 12% | (稅率 - 12) × 1.0 × 區域敏感度 × 等級敏感度 |
| 稅率(商業) | 商業稅率 > 9% | (稅率 - 9) × 1.5 × 區域敏感度 × 等級敏感度 |
| 無電力 | isPowered = false | +8 |
| 無供水 | isWatered = false | +6 |
| 缺貨 | 商業貨運供應不足 | (1 - freightRatio) × 6（按比例） |
| 過剩 | 工業產能超過消耗 | surplusRatio × 6（出口可降低） |
| 犯罪 | crimeRate > 30 | (犯罪率 - 30) × 0.15 × 區域敏感度 |
| 污染 | pollution > 40 | (污染 - 40) × 0.1 × 區域敏感度 |

### 區域敏感度

| 區域類型 | 稅率 | 污染 | 犯罪 |
|---------|------|------|------|
| 住宅 | 0.7 | 1.2 | 1.2 |
| 商業 | 1.5 | 1.0 | 1.3 |
| 工業 | 1.0 | 0 (免疫) | 0.5 |
| 辦公 | 1.3 | 1.2 | 1.0 |

### 建築等級稅率敏感度

| 等級 | 倍率 |
|------|------|
| Level 1 | 1.0× |
| Level 2 | 1.3× |
| Level 3 | 1.6× |

### 壓力計算

```
壓力增量 = (稅率壓力 + 電力壓力 + 供水壓力 + 犯罪壓力 + 污染壓力)
           - (服務分數 × 1.5)

如果 壓力增量 > 0: 累積壓力 += 壓力增量
如果 壓力增量 ≤ 0: 累積壓力 -= 2（恢復速率）

當 累積壓力 ≥ 100: 建築廢棄
```

### 服務抵消

`serviceScore`（0~10 分）可以抵消壓力。每分抵消 1.5 壓力，最高 15 壓力。

### 服務分數計算（廢棄用）

與幸福度用的服務分數不同，廢棄壓力使用**連續**的服務分數（基於道路距離比率而非布林覆蓋）：

- 住宅區: 所有 8 種服務都計入，原始分數 0~10
- 非住宅區: 只計入電力/供水/警察/消防 4 種，原始分數 0~6 → 正規化到 0~10

每種服務貢獻 `1 - costRatio`（越近分數越高）。電力和供水各 2 分。

### 建築韌性 (Resilience)

每棟建築有一個**確定性韌性倍率**（0.5~1.5），基於建築位置的雜湊值計算：

```
resilience = 0.5 + ((x × 7919 + y × 104729) % 1000) / 1000
```

- 高韌性 (1.5): 壓力增量除以 1.5，更不容易廢棄
- 低韌性 (0.5): 壓力增量除以 0.5（加倍），很容易廢棄
- 恢復速率不受韌性影響

這使得相同條件下的建築不會同時廢棄，而是逐步散佈。

### 廢棄後果

壓力 ≥ 100 時：
1. 建築標記為 `ABANDONED`（`reserved = 1`）
2. 所有住戶被驅逐（`evictBuilding`），記錄無家可歸時間
3. 建築不再產生收入
4. 需要成長條件重新滿足後才能重建

---

## 基礎設施 (Infrastructure)

### 基礎設施列表

| 類型 | Building ID | 名稱 | 尺寸 | 造價 |
|------|------------|------|------|------|
| park | 248 | Park | 1×1 | $200 |
| police | 252 | Police Station | 2×2 | $800 |
| fire | 251 | Fire Station | 2×2 | $800 |
| school | 249 | Elementary School | 2×2 | $800 |
| power | 254 | Power Plant | 2×2 | $1000 |
| water | 253 | Water Plant | 2×2 | $600 |
| garbage | 247 | Landfill | 2×2 | $800 |
| sewage | 246 | Sewage Plant | 2×2 | $800 |
| cemetery | 245 | Cemetery | 2×2 | $600 |
| hospital | 250 | Hospital | 2×3 | $1600 |
| school_high | 244 | High School | 2×3 | $1200 |
| school_univ | 243 | University | 3×3 | $3000 |
| airport | 237 | Airport | 4×4 | $5000 |
| bus_stop | 242 | Bus Stop | 1×1 | $100 |
| metro_station | 241 | Metro Station | 1×1 | $3000 |
| train_station | 239 | Train Station | 1×1 | $2000 |
| ferry_dock | 238 | Ferry Dock | 1×1 | $1500 |

### 放置規則

所有基礎設施共通：
1. 佔地範圍內所有格子必須在地圖內
2. 不可放在水域
3. 不可放在有道路的格子
4. 不可放在已有其他基礎設施的格子
5. 佔地範圍必須至少有一邊鄰接道路
6. 已存在的區域建築會被自動拆除

特殊規則：
- **Water Plant (水廠)**: 佔地範圍至少有一格有地下水（需靠近河流）
- **Train Station (火車站)**: 必須建在有鐵軌的格子上
- **Ferry Dock (碼頭)**: 必須緊鄰水域

### 多格建築

大於 1×1 的基礎設施使用多格系統：
- **主格 (Primary Cell)**: 左上角，`reserved` 編碼旋轉角度
  - 0° → reserved = 0
  - 90° → reserved = 5
  - 180° → reserved = 6
  - 270° → reserved = 7
- **次格 (Secondary Cell)**: 其餘格子，`reserved = 4` (MULTI_CELL_OCCUPIED)
- 所有格子共享相同的 `buildingId`

### 旋轉

基礎設施支援 4 個旋轉角度：0°、90°、180°、270°。旋轉會交換寬度和高度（90° 和 270°）。

---

## 拆除系統

拆除操作根據建築類型分為不同處理流程：

| 類型 | 處理方式 |
|------|---------|
| `airport` | 特殊處理（自訂佔地清除） |
| `multi_cell_infra` | 找到主格 → 計算中心 → 移除服務註冊 → 清除所有格子 |
| `single_cell_infra` | 移除服務註冊 → 清除格子 |
| `regular` | 清除 buildingId 和 zoneType，保留鐵軌 |

---

## 建築分類

`classifyBuilding(buildingId)` 將建築 ID 分類為：

1. **zone** — 區域建築（住宅/商業/工業/辦公）
2. **transport** — 交通站點（公車站/地鐵站/火車站/碼頭）
3. **infra** — 基礎設施（電廠/水廠/警局等）
4. **unknown** — 未知

---

## 建築等級 (Building Level)

建築等級範圍 1~3，由服務覆蓋度決定初始等級：

```
level = clamp(ceil(serviceCoverage / 3), 1, 3)
```

| 服務覆蓋度 | 等級 |
|-----------|------|
| 0~3 | 1 |
| 4~6 | 2 |
| 7~9 | 3 |

---

## 基礎設施面板（Per-Type Infra Panels）

基礎設施的建築面板根據設施類型顯示不同資訊：

| 面板類型 | 適用設施 | 顯示內容 |
|---------|---------|---------|
| NeedCapacityPanel | 警局、消防局、醫院、污水廠 | Need/Capacity/Radius/負載率，過載警告 |
| SchoolPanel | 小學、高中、大學 | Type/Need/Students/Radius，超額警告 |
| GarbagePanel | 垃圾場 | Load/Burned per wk/Produced per wk，等待收集警告 |
| CemeteryPanel | 墓園 | Bodies/Deaths per wk/Cremated per wk |
| UtilityPlantPanel | 電廠、水廠、機場 | Output/Supply/Demand |
| ParkPanel | 公園 | Radius |

所有設施面板顯示電力/水力狀態指示器（紅色=無/綠色=有）。

---

## 玻璃鏡面反射 (Glass Specular Reflection)

商業高密度和辦公建築的玻璃帷幕具有太陽鏡面反射效果：

### 反射計算

- **Phong 模型**: `pow(max(dot(normal, halfDir), 0.0), 24.0)`（指數 24，銳利高光）
- **半向量**: `halfDir = normalize(sunDir + viewDir)`（僅水平面計算）
- **朝陽判定**: `facingSun = max(dot(normal, sunDir), 0.0)` — 只有朝向太陽的表面反射
- **強度**: `spec × sunColor × 0.8`（80% 太陽色強度）
- **陰影感知**: 反射乘以 `rawShadow` — 陰影中無反射

### 日夜轉換

- **白天**: 藍白色玻璃反射 `(0.6, 0.72, 0.82)`，隨太陽強度淡入
- **夜晚**: 暖黃色窗戶發光 `(0.95, 0.85, 0.5)`
- **每棟建築隨機偏移**: 燈光不會同時開關，使用位置雜湊產生 0.3 的太陽強度偏移

---

## 增量建築渲染（Incremental Building Renderer）

傳統做法是每當玩家放置道路或建築時，重建整個場景的所有 mesh。增量渲染改為**逐格新增/移除**（per-cell add/remove），避免全場景重建的高成本操作。

### 核心機制

- `BuildingRenderer` 以 per-cell 為單位管理建築 mesh，玩家操作時只新增或移除受影響的格子，而非重建整個場景。
- `dirty.buildings` setter 被觸發時，會自動將 `dirty.terrain` 一併設為 `true`，確保地形與建築始終同步。
- `lightSpotMesh`（建築燈光光點）隨增量建築的新增/移除同步更新，無需額外的全量重建。

### 效能改善

透過增量渲染，每次玩家操作（放置道路、規劃區域、建造基礎設施）不再觸發昂貴的全場景 mesh 重建，大幅降低主執行緒的運算負擔，提升操作流暢度。
