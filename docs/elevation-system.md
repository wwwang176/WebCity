# 高架系統 (Elevation System)

高架系統允許玩家在地面道路之上建設多層高架道路與鐵路，實現立體交叉、跨水橋梁等城市基礎設施。

---

## 概述

WebCity 支援最多 3 層高架道路/鐵路（level 1-3），地面層為 level 0。高架路段可跨越地面道路、建築和水域，透過斜坡 (ramp) 在不同層級之間過渡。

| 功能 | 說明 |
|------|------|
| 高架道路 | 在 level 1-3 建設所有類型的道路 |
| 高架鐵路 | 在 level 1-3 建設標準鐵軌 |
| 橋梁 | 高架路段跨越水域時自動視為橋梁（造價更高） |
| 斜坡 | 自動產生 ramp 連接不同層級 |
| 立體交叉 | 不同層級的道路可在同一 (x, y) 位置交叉 |

相關常數：

```typescript
const MIN_ELEVATION_LEVEL = 1;
const MAX_ELEVATION_LEVEL = 3;
```

---

## 資料結構

### ElevationManager

`ElevationManager` 使用稀疏儲存 (sparse storage) 管理所有高架路段。地面層 (level 0) 的資料仍保留在 `Grid` / `CellData` 中。

| 屬性/方法 | 說明 |
|-----------|------|
| `layers` | `Map<string, ElevatedSegment>` — 主儲存結構 |
| `get(x, y, level)` | 取得指定位置與層級的路段資料 |
| `set(x, y, level, data)` | 寫入路段資料（會驗證 level 範圍） |
| `delete(x, y, level)` | 刪除指定路段 |
| `getAllLevels(x, y)` | 取得 (x, y) 所有層級的路段，按 level 升序 |
| `hasElevatedSegment(x, y)` | 檢查 (x, y) 是否有任何高架路段 |
| `getHighestLevel(x, y)` | 取得 (x, y) 最高的已佔用層級（無則回傳 0） |
| `hasRampAtLevel(x, y, level)` | 檢查 ramp 是否佔用指定層級（ramp 佔用高側與低側兩個 level） |
| `toJSON()` / `fromJSON()` | 序列化 / 反序列化 |
| `clear()` | 清空所有資料 |

### Key 格式

Map 的 key 格式為 `"x,y,level"`，例如 `"5,10,2"` 代表座標 (5, 10) 的第 2 層。

### ElevatedSegment

每個高架格子的資料結構：

```typescript
interface ElevatedSegment {
  roadType: number;              // 道路類型（RoadType 列舉）
  roadFlags: number;             // 道路方向位元遮罩
  railType: number;              // 鐵軌類型（RailType 列舉）
  railFlags: number;             // 鐵軌方向位元遮罩
  isRamp: boolean;               // 是否為斜坡
  rampAscendDirection: number;   // 斜坡上行方向（N/S/E/W 位元），非斜坡為 0
}
```

### ElevatedPosition

路線規劃時使用的位置標註：

```typescript
interface ElevatedPosition {
  x: number;
  y: number;
  level: number;           // 此格在 ElevationManager 中的層級
  targetLevel: number;     // ramp 的目標層級；非 ramp 時等於 level
  isRamp: boolean;
  rampDirection: 'up' | 'down' | null;
}
```

---

## 路線規劃 (ElevatedPath)

`getElevatedPath()` 是一個純函式，負責計算帶有自動 ramp 的 L 形高架路徑。

### 路徑佈局

```
[origin] [ramp...] [body...] [ramp...] [landing]
```

| 區段 | 說明 |
|------|------|
| origin | 起點格子，維持在 `startLevel`，非 ramp — 通常是玩家點擊的既有地面道路 |
| start ramps | 從第 2 格開始，逐格爬升/下降至 `targetLevel` |
| body | 主體段，全部在 `targetLevel` |
| end ramps | 從 `targetLevel` 下降/爬升至 `endLevel` |
| landing | 終點格子，維持在 `endLevel`，非 ramp |

### 函式簽名

```typescript
function getElevatedPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  startLevel: number,      // 起點層級（通常 0 = 地面）
  targetLevel: number,     // 主體段高度（1-3）
  endLevel?: number,       // 終點層級（省略則不產生 end ramps）
): ElevatedPosition[] | null;
```

### 長度計算

路徑最短長度為：

```
minLength = 1 (origin)
           + |targetLevel - startLevel| (start ramps)
           + minBody (startRampCount > 0 ? 1 : 0)
           + |targetLevel - endLevel| (end ramps)
           + landingCount (endRampCount > 0 ? 1 : 0)
```

若基底 L 形路徑長度不足 `minLength`，回傳 `null`。

### 範例

從地面 (level 0) 到 level 2，路徑長度 8：

```
格子: [0] [1] [2] [3] [4] [5] [6] [7]
      origin ramp ramp body body ramp ramp landing
level:  0    0→1  1→2   2    2   2→1  1→0    0
```

---

## 路線驗證 (ElevatedPathValidation)

`validateElevatedPath()` 在建設前檢查路徑合法性，回傳 `null` 表示合法，否則回傳錯誤原因字串。

### 驗證規則

| 錯誤碼 | 觸發條件 |
|--------|---------|
| `OUT_OF_BOUNDS` | 格子超出地圖邊界 |
| `MOUNTAIN_TILE` | 格子位於山地（任何層級都不允許） |
| `WATER_TILE` | 水域格子在 level 0 且非 ramp |
| `RAMP_ON_WATER` | Ramp 不能建在水域上（ramp 需要地面支撐） |
| `WATER_CROSSING_NO_TURN` | 跨水路徑包含 L 形轉彎（跨水必須直線） |
| `LEVEL_OCCUPIED` | 同一 (x, y, level) 已有高架路段且涉及 ramp 衝突 |
| `RAMP_OVER_ROAD` | Ramp 低側為 level 0 時，下方已有地面道路 |
| `RAMP_OVER_ELEVATED` | Ramp 低側為 level > 0 時，下方已有高架路段 |

### Level 碰撞邏輯

- **平面 + 平面**：同一 level 的兩個平面路段允許合併（類似地面道路的 flags 合併）
- **涉及 ramp**：只要任一側是 ramp，同 level 即判定衝突
- **Ramp 佔用**：ramp 儲存在 `max(level, targetLevel)`，但同時佔用相鄰的低側 level

### 排除索引

`excludeCollisionIndices` 參數允許跳過特定格子的碰撞檢查（例如從既有路段延伸時排除起點）。

---

## 道路建設 (ElevatedRoadBuilder)

`ElevatedRoadBuilder` 負責建設高架道路，與地面道路的 `RoadBuilder` 分工。

### 建設流程

`buildElevatedRoad(from, to, roadType, funds, targetLevel)`:

1. **偵測出界邊緣**：處理 highway 外部連接（拖曳超出地圖邊界）
2. **判斷起點層級**：檢查 `from` 是否在地面道路或既有高架路段上
3. **判斷終點層級**：若 `to` 在地面道路上，自動設定 `endLevel = 0` 產生 ramp 降落
4. **產生路徑**：呼叫 `getElevatedPath()` 計算帶 ramp 的路徑
5. **驗證 ramp 方向**：若起點是既有 ramp，只允許沿 ascend 方向延伸
6. **驗證路徑**：呼叫 `validateElevatedPath()` 檢查合法性
7. **計算費用**：依區段類型套用不同乘數
8. **放置路段**：寫入 `ElevationManager`，計算 `roadFlags` 和 `rampAscendDirection`
9. **更新路網**：在 `RoadNetwork` 中新增 edge（含 ramp 到地面的連接）
10. **更新地面 flags**：在 origin / landing 格子新增指向 ramp 的方向旗標

### 造價乘數

所有費用基於 `ROAD_CONFIGS[roadType].cost`（地面道路造價）：

| 區段類型 | 乘數 | 說明 |
|---------|------|------|
| 高架 (Elevated) | 2x | 一般高架路段 |
| 橋梁 (Bridge) | 3x | 跨越水域的高架路段 |
| 斜坡 (Ramp) | 1.5x | 層級過渡路段 |
| 地面 (Ground) | 0 | origin / landing 格子不收費 |

### 拆除

`removeElevated(x, y)` 移除 (x, y) 最高層級的高架路段：

1. 從 `ElevationManager` 刪除資料
2. 從 `RoadNetwork` 移除節點
3. 更新鄰近高架路段的 `roadFlags`（清除指向已刪除格子的方向）
4. 若刪除的是 ramp，清除地面道路指向 ramp 的 flags

### 路網節點 ID

高架路段在 `RoadNetwork` 中使用 `"x,y,level"` 作為節點 ID（level > 0），地面層使用 `"x,y"` 格式，確保不同層級的路段在路網圖中各自獨立。

---

## 鐵路建設 (ElevatedRailBuilder)

`ElevatedRailBuilder` 與 `ElevatedRoadBuilder` 結構類似，用於建設高架鐵軌。

### 差異比較

| 項目 | ElevatedRoadBuilder | ElevatedRailBuilder |
|------|-------------------|-------------------|
| 建設方法 | `buildElevatedRoad()` | `buildElevatedTrack()` |
| 基礎造價 | `ROAD_CONFIGS[roadType].cost` | `RAIL.COST_PER_CELL` |
| 起點判斷 | 必須在地面道路或高架道路上 | 可從地面鐵軌或地面道路起始 |
| 路網 | `RoadNetwork` | `RailNetwork` |
| 寫入欄位 | `roadType`, `roadFlags` | `railType`, `railFlags` |
| 保留欄位 | 保留既有的 `railType/railFlags` | 保留既有的 `roadType/roadFlags` |
| 拆除行為 | 更新鄰居 flags + 清除地面 flags | 僅刪除路段 + 移除路網節點 |

造價乘數與道路建設相同（Elevated 2x, Bridge 3x, Ramp 1.5x）。

---

## 統一道路查詢 (UnifiedRoadLookup)

`UnifiedRoadLookup` 是一個抽象層，將地面道路 (level 0) 與高架道路 (level 1-3) 統一為單一查詢介面。所有需要走訪路網的子系統（BFS 洪氾、尋路、購物可及性等）透過此介面實現層級感知。

### 主要方法

| 方法 | 說明 |
|------|------|
| `getCellByKey(key)` | 按 key 查詢道路資料。`"x,y"` 查 Grid，`"x,y,level"` 查 ElevationManager |
| `isRamp(key)` | 檢查 key 是否為 ramp |
| `getCompatibleNeighborKeys(sourceKey, nx, ny)` | 取得鄰居位置所有與 source 相容的 cell key |
| `getAllKeysAtPosition(x, y)` | 取得 (x, y) 所有層級的道路 cell key |
| `getAllCellKeys()` | 取得全域所有道路 cell key（地面 + 高架） |

### 層級相容性規則

`isCompatible(srcLevel, srcIsRamp, dstLevel, dstIsRamp)`:

| 來源 level | 目標 level | 條件 | 結果 |
|-----------|-----------|------|------|
| N | N | 同層級 | 相容 |
| N | N+1 | 任一側為 ramp | 相容 |
| N | N+1 | 雙方皆非 ramp | 不相容 |
| N | N+2 以上 | 任何情況 | 不相容 |

### Ramp 方向限制

`isAlongRampAxis(rampAscendDir, sx, sy, nx, ny)`:

Ramp 只允許沿其軸向方向連接：

- `rampAscendDirection` 為 EAST/WEST → 只允許水平方向 (`dx !== 0`) 通過
- `rampAscendDirection` 為 NORTH/SOUTH → 只允許垂直方向 (`dy !== 0`) 通過

此限制確保車輛只能從 ramp 的縱向兩端進出，不能從側面穿越。鄰居搜尋時，**雙方**的 ramp 方向都必須檢查：source 是 ramp 時檢查 source 的方向，neighbor 是 ramp 時檢查 neighbor 的方向。

---

## 區域限制 (ElevationZoneBlock)

`isBlockedByElevation(em, x, y)` 檢查地面格子是否被高架路段遮擋，禁止在該處規劃區域。

### 規則

- 只要 `em.hasElevatedSegment(x, y)` 回傳 `true`，該格子即禁止區域規劃
- `ZoneManager.setZone()` 在設定區域前會檢查此函式
- 回傳 `BLOCKED_BY_ELEVATION` 錯誤訊息

### 設計理由

高架道路下方的地面空間被柱子佔用，不適合建設區域建築。

---

## 維護成本 (ElevationMaintenance)

`calculateElevatedMaintenance(em)` 計算所有高架路段的每 tick 維護費用。

### 計算公式

對每個高架路段：

```
道路維護 = ROAD_CONFIGS[roadType].cost × MAINTENANCE_RATE × ELEVATION_COST.MAINTENANCE
鐵軌維護 = RAIL.COST_PER_CELL × MAINTENANCE_RATE × ELEVATION_COST.MAINTENANCE
```

| 常數 | 值 | 說明 |
|------|-----|------|
| `MAINTENANCE_RATE` | 0.01 | 每 tick 維護費佔建設成本的比例 |
| `ELEVATION_COST.MAINTENANCE` | 2 | 高架路段的維護乘數（比地面道路貴 2 倍） |

若一個路段同時有道路和鐵軌，兩者的維護費會分別計算並累加。

### 整合

`SimulationLoop` 在收入計算時呼叫此函式，將結果納入 `calculateTotalExpenses()` 的 `elevatedMaintenance` 項目。

---

## 渲染 (ElevatedRoadRenderer)

`ElevatedRoadRenderer` 使用 Three.js InstancedMesh 技術渲染高架路段，支援逐格增量更新。

### 架構

每個層級 (level) 擁有獨立的 `LevelData`，包含：

| 元件 | InstancedMesh 數量上限 | 說明 |
|------|---------------------|------|
| Road surface | `MAX_PER_LEVEL × 3` | 道路表面 |
| Sidewalk | `MAX_PER_LEVEL × 4` | 人行道 |
| Lane marking | `MAX_PER_LEVEL × 14` | 車道標線 |
| Center line | `MAX_PER_LEVEL × 2` | 中央分隔線 |
| Curved center line | `MAX_PER_LEVEL × 1` | L 形彎道弧形中線 |
| Street lamp | `MAX_PER_LEVEL × 4` | 路燈 |
| Lamp glow | `MAX_PER_LEVEL × 4` | 路燈光暈（夜間） |

其中 `MAX_PER_LEVEL = 500`。

### 常數

| 常數 | 值 | 說明 |
|------|-----|------|
| `LEVEL_HEIGHT` | 0.6 | 每層高度（world units） |
| `PILLAR_W` | 0.08 | 柱子寬度 |
| `RAMP_ANGLE` | `atan2(0.6, 1.0)` | Ramp 傾斜角度 |
| `RAMP_LENGTH` | `sqrt(1 + 0.36)` | Ramp 表面長度（斜邊） |

### 平面路段渲染

平面高架路段使用與地面道路相同的 strip builder 系統（`buildRoadStrips`, `buildSidewalkStrips`, `buildLaneMarkingData`, `buildCenterLineData`），僅在 Y 軸上偏移至對應層級高度：

```
baseY = level × LEVEL_HEIGHT
```

### Ramp 渲染

Ramp 路段需要額外的旋轉矩陣來呈現傾斜效果：

- 根據 `rampAscendDirection` 計算 X 軸或 Z 軸的傾斜角
- 路面寬度沿 ramp 方向拉伸 `RAMP_LENGTH` 倍
- Y 位置設定為 `(level - 0.5) × LEVEL_HEIGHT`（ramp 中點）

### 柱子 (Pillars)

- 僅平面路段有柱子（ramp 無柱子）
- 柱子高度 = `level × LEVEL_HEIGHT - bottomY`
- 橋梁的 `bottomY = -0.15`（延伸到水下），一般為 `0`
- 使用獨立 Mesh（非 InstancedMesh），因為每根柱子的高度可能不同

### 鐵軌渲染

高架鐵軌使用獨立的 Mesh，放置在 `baseY + ROAD_Y` 高度。

### 增量更新

`updateCells(scene, grid, em, cellKeys)`:

1. **擴展 dirty set**：將變更格子及其 1 格鄰居加入 dirty set
2. **確定受影響層級**：檢查 dirty set 內的格子涉及哪些 level
3. **移除舊 instance**：從受影響層級的所有 tracker 中移除 dirty 格子
4. **重新產生**：只對仍存在的 dirty 格子重新呼叫 `populateLevelCells()`

### 日夜循環

`update(sunIntensity)` 根據太陽強度調整路燈光暈透明度：

```
opacity = max(0, 0.75 × (1 - sunIntensity / 0.45))
```

### 共享幾何體

所有 level 共享同一組幾何模板 (`_sharedGeo`)，包括 road, sidewalk, marking, centerLine, pillar, rail 等，在首次使用時建立，避免重複分配記憶體。`dispose()` 時會檢查是否為共享幾何體以避免錯誤釋放。

---

## 系統整合

### LaneGraph / 尋路

- `LaneGraphPathfinder.findLanePath()` 接受 `UnifiedRoadLookup` 參數
- `findBuildingConnections()` 透過 `UnifiedRoadLookup` 搜尋建築鄰近的所有層級道路
- 尋路時 `getCompatibleNeighborKeys()` 確保只走合法的層級轉換路徑

### BFS 服務覆蓋

- `RoadCoverageFlood`：civic 服務（消防、警察、醫療等）的 Dijkstra 洪氾使用 `UnifiedRoadLookup` 走訪路網
- `NetworkCoverage`：電力、水力供應 BFS 使用 `UnifiedRoadLookup` 確保層級感知
- 透過 `setRoadCoverageRoadLookup()` / `setNetworkRoadLookup()` 注入模組層級的 lookup 實例

### ShoppingAccess

- 購物可及性 BFS 使用 `UnifiedRoadLookup` 發現商業建築的連通範圍
- 透過 `setShoppingRoadLookup()` 注入

### HighwayConnection

- `HighwayConnection` 持有 `ElevationManager` 引用
- 檢查高架層級的 highway 外部連接（地圖邊緣的高速公路入口）
- 透過 `setElevationManager()` 注入

### ServiceVehicleManager

- 服務車輛（消防車、垃圾車等）尋路時使用 `UnifiedRoadLookup`
- 確保車輛能透過 ramp 到達高架道路上的目的地

### 存檔 / 讀檔

- **存檔**：`Serializer.snapshotGameState()` 呼叫 `elevationManager.toJSON()` 序列化為陣列
- **讀檔**：`deserializeGameState()` 解析 `elevation` 欄位後，由 `Game.ts` 呼叫 `elevationManager.fromJSON()` 還原
- 序列化格式：`Array<{ x, y, level, data: ElevatedSegment }>`

### SimulationLoop

- `setElevationManager(em)` 注入 ElevationManager
- 收入計算時呼叫 `calculateElevatedMaintenance()` 加入支出
- 交通密度同步時傳入 ElevationManager（`syncTrafficDensityToGrid`）

### ZoneManager

- `setElevationManager(em)` 注入 ElevationManager
- `setZone()` 前呼叫 `isBlockedByElevation()` 檢查是否被高架路段遮擋
