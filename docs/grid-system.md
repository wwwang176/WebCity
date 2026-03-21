# 網格系統 (Grid System)

WebCity 的世界由一個二維正方形網格構成，每個格子（Cell）儲存該位置的所有遊戲狀態。

---

## 網格結構

### Grid 類別

`Grid` 是遊戲世界的核心資料結構，管理一個 `width × height` 的二維網格。

- **建構**: `new Grid(width, height)`
- **記憶體布局**: 使用 `ArrayBuffer` + `DataView` 的二進制結構，每格佔 12 bytes (`BYTES_PER_CELL = 12`)
- **索引計算**: `offset = (y * width + x) * BYTES_PER_CELL`（row-major 排列）

### 額外資料陣列

除了主要的二進制 buffer 外，Grid 還維護四個 `Uint8Array` 側邊陣列：

| 陣列 | 用途 |
|------|------|
| `naturalResources` | 天然資源類型（礦石、石油、肥沃土地、森林） |
| `reservedData` | 保留標記（如焦黑建築 BURNED、多格建築佔位等） |
| `railTypeData` | 鐵軌類型 |
| `railFlagsData` | 鐵軌方向旗標 |

---

## 格子資料 (CellData)

每個格子包含以下欄位，共 14 個屬性：

| 欄位 | 型別 | Byte 偏移 | 說明 |
|------|------|-----------|------|
| `terrainType` | Uint8 | +0 | 地形類型 |
| `zoneType` | Uint8 | +1 | 區域規劃類型 |
| `buildingId` | Uint16 | +2 | 建築物 ID（0 = 無建築） |
| `roadFlags` | Uint8 | +4 | 道路方向旗標（位元遮罩） |
| `roadType` | Uint8 | +5 | 道路類型 |
| `trafficDensity` | Uint8 | +6 | 交通密度 |
| `landValue` | Uint8 | +7 | 地價 (0-255) |
| `pollution` | Uint8 | +8 | 污染程度 (0-255) |
| `noiseLevel` | Uint8 | +9 | 噪音等級 (0-255) |
| `serviceCoverage` | Uint8 | +10 | 服務覆蓋度 (0-255) |
| `elevation` | Int8 | +11 | 海拔高度（有符號） |
| `reserved` | Uint8 | 側邊陣列 | 保留欄位 |
| `railType` | Uint8 | 側邊陣列 | 鐵軌類型 |
| `railFlags` | Uint8 | 側邊陣列 | 鐵軌方向旗標 |

> 主 buffer 儲存前 12 bytes（offset +0 ~ +11），`reserved`、`railType`、`railFlags` 儲存在獨立的 Uint8Array 中。

---

## 地形類型 (TerrainType)

```
PLAIN    = 0   平原（可建設）
WATER    = 1   水域（不可建設，河流/湖泊）
MOUNTAIN = 2   山地（不可建設，有海拔）
FOREST   = 3   森林（可建設）
```

### 建設規則

- 只有 `PLAIN` 和 `FOREST` 地形可以建設
- `WATER` 和 `MOUNTAIN` 地形禁止建設任何道路、建築或鐵軌
- 碼頭（Ferry Dock）必須緊鄰水域

---

## 區域規劃 (ZoneType)

```
NONE              = 0   未規劃
RESIDENTIAL_LOW   = 1   低密度住宅
RESIDENTIAL_HIGH  = 2   高密度住宅
COMMERCIAL_LOW    = 3   低密度商業
COMMERCIAL_HIGH   = 4   高密度商業
INDUSTRIAL        = 5   工業
OFFICE            = 6   辦公
```

### RCI 分類

區域被分為三大需求類別：

| 分類 | 包含區域 |
|------|---------|
| Residential（住宅） | RESIDENTIAL_LOW, RESIDENTIAL_HIGH |
| Commercial（商業） | COMMERCIAL_LOW, COMMERCIAL_HIGH |
| Industrial（工業） | INDUSTRIAL, OFFICE |

輔助函式：
- `isResidentialZone(z)` — 判斷是否為住宅區
- `isCommercialZone(z)` — 判斷是否為商業區
- `isWorkplaceZone(z)` — 判斷是否為工作場所（商業 + 工業 + 辦公）
- `zoneToRCI(z)` — 將區域類型映射到 RCI 類別

---

## 天然資源 (NaturalResource)

```
NONE    = 0   無資源
ORE     = 1   礦石
OIL     = 2   石油
FERTILE = 3   肥沃土地
FOREST  = 4   森林資源
```

天然資源儲存在 `grid.naturalResources` 陣列中，獨立於主 buffer。

---

## 地形生成 (Terrain Generation)

新地圖自動生成三種地形特徵：

### 1. 河流

- **位置**: 地圖寬度的 70% 處 (`RIVER_POSITION_RATIO = 0.7`)
- **蜿蜒**: 使用正弦波模擬河流彎曲
  - 頻率: `0.1`
  - 振幅: `3` 格
- **寬度**: 中心 ±1 格（共 3 格寬）
- 河流從地圖頂部到底部貫穿

### 2. 森林斑塊

- **數量**: 8 個隨機森林區域
- **半徑**: 每個區域 3 格
- **填充率**: 70% 機率 (`FOREST_FILL_CHANCE = 0.7`)
- 只覆蓋原本是 PLAIN 的格子
- 不會覆蓋水域

### 3. 山脈

- **位置**: 地圖左下方（X: 15%, Y: 85%）
- **半徑**: 4 格（圓形區域）
- **海拔**: 中心高度 3，向外衰減（衰減率 0.5/格距離）

---

## 共享 Buffer (GridBuffer)

`GridBuffer` 使用 `SharedArrayBuffer` 實作，用於 Web Worker 之間的零拷貝資料共享。

- 提供與 `Grid` 相同的欄位存取介面
- 使用 `SharedArrayBuffer` 而非 `ArrayBuffer`
- 支援多執行緒同時讀取

---

## 格子存取 API

### 讀取

| 方法 | 說明 |
|------|------|
| `getCell(x, y)` | 取得完整格子資料（分配新物件），超出範圍返回 `null` |
| `getField(x, y, field)` | 取得單一欄位值（零分配），超出範圍返回 `-1` |
| `fillCell(x, y, out)` | 填入預分配的 CellData 物件（零分配，高效能迴圈用） |
| `getCellsInRect(from, to)` | 取得矩形區域內所有格子 |
| `getNeighbors(x, y)` | 取得 4 方向鄰居 |
| `getNeighbors8(x, y)` | 取得 8 方向鄰居（含對角線） |

### 寫入

| 方法 | 說明 |
|------|------|
| `setCell(x, y, data)` | 部分更新格子（只更新傳入的欄位） |
| `setField(x, y, field, value)` | 設定單一欄位值（零分配） |

### 迭代

| 方法 | 說明 |
|------|------|
| `forEachCell(fn)` | 迭代所有格子（row-major 順序），使用重複使用的 CellData 物件避免 GC |

> **注意**: `forEachCell` 的回調收到的 `cell` 物件是共享的，不可儲存其參照。

---

## 網格輔助工具 (GridHelpers)

### 位置鍵

- `toPosKey(x, y)` → `"x,y"` 字串鍵
- `parsePosKey(key)` → `{x, y}` 或 `null`
- `parsePosKeyUnsafe(key)` → `{x, y}`（假設輸入有效）

### 鄰接檢查

- `isAdjacentToRoad(grid, x, y)` — 四方向是否有道路鄰居
- `isFootprintAdjacentToRoad(grid, x, y, w, h)` — 多格建築是否鄰接道路
- `findAdjacentRoad(grid, x, y)` — 找到自身或鄰近的道路格

### 距離計算

- `euclideanDistance(x1, y1, x2, y2)` — 歐幾里得距離
- `manhattanDistance(x1, y1, x2, y2)` — 曼哈頓距離
- `isWithinEuclideanRadius(cx, cy, x, y, r)` — 是否在歐幾里得半徑內
- `forEachCellInRadius(cx, cy, r, callback)` — 迭代半徑內所有格子

### 方向系統

四個基本方向使用位元旗標表示：

```
NORTH = 0b0001 (1)
SOUTH = 0b0010 (2)
WEST  = 0b0100 (4)
EAST  = 0b1000 (8)
```

此旗標系統同時用於道路（`RoadDirection`）和鐵軌（`TrackDirection`）。

### 路徑工具

- `getLShapedPath(from, to)` — 產生 L 形路徑（先水平再垂直）
- `countRoadTiles(grid)` — 計算地圖上的道路格數
- `normalizeRect(x1, y1, x2, y2)` — 正規化矩形座標

---

## 地形查詢

| 函式 | 說明 |
|------|------|
| `isWater(grid, x, y)` | 是否為水域 |
| `canBuild(grid, x, y)` | 是否可建設（非水域且非山地） |
| `getElevation(grid, x, y)` | 取得海拔 |
| `isShorePosition(grid, x, y)` | 是否為岸邊（陸地且鄰接水域） |
| `getGroundwaterLevel(grid, x, y)` | 地下水位 (0-100)，基於到最近水域的曼哈頓距離（最大範圍 3 格） |
| `getNaturalResource(grid, x, y)` | 取得天然資源類型 |
| `setNaturalResource(grid, x, y, resource)` | 設定天然資源 |

### 地下水規則

- 搜索範圍: 曼哈頓距離 3 格內
- 距離 1: 100%
- 距離 2: 67%
- 距離 3: 33%
- 距離 > 3: 0%
- 水井（Water Pump）需要地下水位才能放置

---

## 地面渲染

`isStoneGround(cell)` 判斷格子是否應渲染為石質地面（灰色），條件為有建築物或有道路。

---

## 建設驗證

### 路徑地形驗證 (`validatePathTerrain`)

道路和鐵軌共用的地形驗證邏輯：

```
遍歷路徑上的每個格子：
  - 超出邊界 → 'OUT_OF_BOUNDS'
  - 水域 → 'WATER_TILE'
  - 山地 → 'MOUNTAIN_TILE'
  - 已有基礎設施 → 'INFRASTRUCTURE_EXISTS'
  - 全部通過 → null（有效）
```

### 建設失敗訊息

系統定義了統一的人類可讀錯誤訊息：

| 原因 | 訊息 |
|------|------|
| `WATER_TILE` | Cannot build on water |
| `MOUNTAIN_TILE` | mountain in the way |
| `BUILDING_EXISTS` | building in the way |
| `INFRASTRUCTURE_EXISTS` | infrastructure in the way |
| `OUT_OF_BOUNDS` | Out of bounds |
| `INSUFFICIENT_FUNDS` | insufficient funds |
| `NO_GROUNDWATER` | No groundwater here — build near rivers |
| `NEED_RAIL_TRACK` | Train station must be built on rail track |
| `NEED_ADJACENT_WATER` | Ferry dock must be built next to water |
| `AIRPORT_OUT_OF_BOUNDS` | Airport area is out of bounds |
| `AIRPORT_AREA_OCCUPIED` | Airport area is not fully clear |
| `NOT_ADJACENT_TO_ROAD` | Must be built adjacent to a road |
