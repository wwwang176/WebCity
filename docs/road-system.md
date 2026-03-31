# 道路系統 (Road System)

道路是 WebCity 最基礎的基礎設施，連接所有區域並承載交通。

---

## 道路類型

遊戲提供 6 種道路類型（加上 NONE 共 7 種列舉值）：

| 類型 | 車道數 | 速限 | 容量 | 造價/格 | 允許密度 |
|------|--------|------|------|---------|---------|
| RURAL (鄉村道路) | 2 | 30 | 50 | $100 | 低密度 |
| TWO_LANE (雙車道) | 2 | 50 | 100 | $200 | 低密度 |
| FOUR_LANE (四車道) | 4 | 50 | 200 | $400 | 高密度 |
| SIX_LANE (六車道) | 6 | 60 | 300 | $600 | 高密度 |
| HIGHWAY (高速公路) | 4 | 100 | 400 | $800 | 無 (不可規劃區域) |
| ONE_WAY (單行道) | 2 | 50 | 150 | $250 | 低密度 |

### 密度限制

- `maxDensity: 'LOW'` — 沿路只能規劃低密度住宅/商業
- `maxDensity: 'HIGH'` — 沿路可規劃高密度住宅/商業
- `maxDensity: 'NONE'` — 不支援區域規劃（如高速公路）

---

## 道路方向旗標

每個道路格子使用位元遮罩記錄連接方向（詳見[網格系統 — 方向系統](grid-system.md#方向系統)）。

一個格子可同時連接多個方向。例如一個十字路口的 `roadFlags` = `0b1111 (15)`。

---

## 道路建設 (RoadBuilder)

### 建路流程

1. **路徑計算**: 從起點到終點產生 L 形路徑（先水平後垂直）
2. **驗證**: 檢查路徑上每個格子的合法性
3. **計算費用**: 差價計價（升級已有道路只收差額）
4. **清除衝突**: 移除路徑上的區域建築和規劃（但保留基礎設施）
5. **設定格子**: 寫入 `roadType` 和 `roadFlags`
6. **更新路網**: 在 `RoadNetwork` 圖中新增邊

### 建路驗證規則

依序檢查（共用 `validatePathTerrain` + 道路專屬規則）：

1. **地形限制**: 不可建在水域或山地
2. **基礎設施衝突**: 不可建在已有基礎設施的格子
3. **平行鐵軌衝突**: 道路不能與同格的鐵軌平行
   - 垂直道路 + 垂直鐵軌 = 衝突
   - 水平道路 + 水平鐵軌 = 衝突
   - 垂直道路 + 水平鐵軌 = 允許（形成平交道）
4. **資金不足**: 造價超過可用資金

### 費用計算

- **新建**: 按道路類型的造價全額收費
- **升級**: 只收差價（新道路造價 - 舊道路造價）
- 差額為 0 或負值時不收費

### 建路結果 (BuildRoadResult)

```typescript
{
  success: boolean;       // 是否成功
  reason?: string;        // 失敗原因
  cost?: number;          // 實際花費
  affectedCells?: string[];   // 受影響的格子鍵
  demolishedCells?: string[]; // 被拆除的區域建築鍵
}
```

### 拆路

`removeRoad(x, y)`:
1. 從 `RoadNetwork` 移除節點
2. 清除該格的 `roadType` 和 `roadFlags`
3. 更新鄰居的 `roadFlags`（移除指向已拆除格子的方向旗標）

---

## 道路升級 (RoadUpgrade)

### 規則

- 只能升級，不能降級（`CANNOT_DOWNGRADE`）
- 費用 = 新類型造價 - 舊類型造價
- 保留原有的 `roadFlags`（方向連接不變）
- 原地升級，不影響路網拓撲

---

## 路口 (Intersection)

### 路口類型判定

根據道路方向旗標中的方向數量判定：

| 方向數 | 類型 |
|--------|------|
| ≥ 4 | CROSS（十字路口） |
| 3 | T_JUNCTION（T 字路口） |
| ≤ 2 | NONE（非路口） |

### 交通控制

每個路口可以設定交通控制方式：

| 控制方式 | 說明 |
|---------|------|
| NONE | 無控制 |
| TRAFFIC_LIGHT | 紅綠燈（預設） |
| ROUNDABOUT | 圓環 |

路口預設使用紅綠燈。玩家可以手動改為圓環。

---

## 路網圖 (RoadNetwork / GraphNetwork)

`RoadNetwork` 繼承自 `GraphNetwork`，是一個無向圖：

### 資料結構

- **鄰接表**: `Map<string, Set<string>>`
- **節點 ID**: 使用 `"x,y"` 格式的位置鍵

### 操作

| 方法 | 說明 |
|------|------|
| `addNode(id)` | 新增節點 |
| `addEdge(a, b)` | 新增無向邊（自動建立節點） |
| `removeNode(id)` | 移除節點及其所有邊 |
| `removeEdge(a, b)` | 移除邊 |
| `isConnected(a, b)` | BFS 判斷兩節點是否連通 |
| `getNeighbors(id)` | 取得鄰居列表 |
| `getNodeCount()` | 節點數 |
| `getEdgeCount()` | 邊數（無向，計算一次） |

### 連通性

使用 BFS（廣度優先搜尋）判斷兩個位置是否在同一路網中。這影響：
- 服務車輛是否能到達目的地
- 公車路線的有效性
- 通勤路徑是否存在

---

## 統一道路查詢（UnifiedRoadLookup）

`UnifiedRoadLookup` 是一個抽象層，將地面道路（level 0）與高架道路（levels 1-3）整合為統一的查詢介面，供路徑規劃與服務覆蓋等子系統使用。

**原始碼**: `src/core/road/UnifiedRoadLookup.ts`

### 核心 API

| 方法 | 說明 |
|------|------|
| `getCellByKey(key)` | 依 key 查詢道路資料。level 0 路由到 `Grid`，level 1-3 路由到 `ElevationManager` |
| `getAllKeysAtPosition(x, y)` | 回傳指定座標上所有層級的道路 key（地面 + 高架） |
| `getCompatibleNeighborKeys(sourceKey, nx, ny)` | 回傳鄰居座標上與 source 相容的所有道路 key |
| `getAllCellKeys()` | 回傳整張地圖所有道路 cell key（地面 + 高架） |
| `isRamp(key)` | 判斷該 key 是否為坡道 |

### Key 格式

- **地面道路**: `"x,y"`（兩段式，由 `toPosKey` 產生）
- **高架道路**: `"x,y,level"`（三段式，level 為 1-3）

level 值透過 `parseLevelFromKey` 解析：兩段式 key 回傳 0，三段式 key 回傳第三段數字。

### 層級相容性規則

`getCompatibleNeighborKeys` 使用以下規則判定兩個道路格子是否可互相通行：

1. **同一層級** → 永遠相容
2. **不同層級** → 必須同時滿足：
   - 層級差 `|diff|` = 1（不可跨越兩層以上）
   - 至少一方是坡道（`isRamp = true`）
3. **坡道方向限制** → 坡道的上升方向（`rampAscendDirection`）必須與行進方向對齊：
   - 上升方向為 EAST/WEST 時，只允許水平方向（dx ≠ 0）通行
   - 上升方向為 NORTH/SOUTH 時，只允許垂直方向（dy ≠ 0）通行
   - 來源為坡道時檢查來源方向，鄰居為坡道時檢查鄰居方向（雙向皆檢查）

### 使用場景

| 使用者 | 用途 |
|--------|------|
| `LaneGraphPathfinder` | 跨層級路徑搜尋 |
| `ShoppingAccess` | 商業可及性判定 |
| `RoadCoverageFlood` / `NetworkCoverage` | 服務覆蓋 BFS 搜尋 |
| `ServiceVehicleManager` | 服務車輛路徑計算 |
| `SimulationLoop` | 建立並注入 lookup 實例 |

---

## 增量道路渲染（Incremental Road Renderer）

傳統做法是每次道路變更時重建整個 instanced mesh，但這在大型地圖上會造成明顯卡頓。增量渲染系統改為逐格新增/移除，大幅降低每次操作的開銷。

### RoadInstanceTracker

**原始碼**: `src/renderer/RoadInstanceTracker.ts`

`RoadInstanceTracker` 管理 `THREE.InstancedMesh` 中的實例插槽，採用 **swap-with-last** 策略實現 O(1) 的新增與移除。每個道路格子可擁有多個實例（例如 1-3 條路面條帶、0-4 條人行道、0-12 條車道標線）。

#### 資料結構

| 結構 | 說明 |
|------|------|
| `cellToIndices: Map<string, number[]>` | cell key → 該格擁有的所有實例索引 |
| `idxToCell: string[]` | 實例索引 → cell key（密集陣列，長度 = usedCount） |
| `usedCount` | 目前使用中的實例數 |

#### 核心操作

| 方法 | 複雜度 | 說明 |
|------|--------|------|
| `addCell(cellKey, count)` | O(count) | 在已用區域尾端保留 `count` 個插槽，回傳起始索引供呼叫者寫入矩陣/顏色資料 |
| `removeCell(cellKey)` | O(n) | 移除該格的所有實例。每個實例以尾端實例覆蓋，然後縮減 `usedCount` |
| `clear()` | O(1) | 重置所有追蹤狀態（用於完整重建） |

#### swap-with-last 移除流程

1. 取得要移除的實例索引列表，按降序排列（避免先移除低索引導致高索引失效）
2. 對每個要移除的索引 `removeIdx`：
   - 將尾端實例（`lastIdx`）的矩陣、顏色、highlight 屬性複製到 `removeIdx`
   - 更新被搬移實例的 cell key 索引映射
   - 遞減 `usedCount`
3. 更新 `mesh.count` 並標記各屬性 `needsUpdate = true`

### RoadRenderer 整合

**原始碼**: `src/renderer/RoadRenderer.ts`

`RoadRenderer` 為每種視覺元素維護獨立的 tracker：

| Tracker | 管理對象 |
|---------|---------|
| `roadTracker` | 路面條帶 |
| `sidewalkTracker` | 人行道 |
| `markingTracker` | 車道標線 |
| `centerLineTracker` | 中央分隔線 |
| `curvedCLTracker` | 彎道分隔線 |
| `crosswalkTracker` | 行人穿越道 |
| `stopLineTracker` | 停止線 |
| `lampTracker` | 路燈 |
| `lampGlowTracker` | 路燈光暈 |

每種 mesh 的容量以 `CAP` 倍數預分配（例如路面 3 倍、標線 14 倍），確保有足夠空間容納單格的最大實例數。

### 效能優勢

- **玩家建路/拆路時**：僅操作受影響格子的實例，不觸發全網格重建
- **地面道路變更不觸發高架重建**：兩者各自獨立追蹤
- **記憶體穩定**：預分配容量，避免重複的 geometry 建立與銷毀

---

## 地圖邊界延伸（Road Edge Extension）

當玩家拖曳道路路徑超出地圖邊界時，系統會建立外部連接並產生視覺延伸效果。

### 邊界偵測（EdgeUtils）

**原始碼**: `src/core/grid/EdgeUtils.ts`

`extractOutOfBoundsEdge(path, mapWidth, mapHeight)` 檢查路徑的最後一個格子是否超出地圖範圍：

1. 若最後一格在地圖內 → 回傳 `null`
2. 若最後一格超出邊界 → 計算從倒數第二格到最後一格的方向，回傳 `{ outwardFlag, truncatedLength }`
3. `outwardFlag` 為方向位元遮罩（NORTH/SOUTH/EAST/WEST），表示道路延伸出地圖的方向

### 道路類型限制

只有 **HIGHWAY（高速公路）** 類型可以建立外部連接。其他道路類型即使拖曳超出邊界，也會忽略超出部分：

```typescript
const rawOob = extractOutOfBoundsEdge(fullPath, grid.width, grid.height);
const oob = rawOob && roadType === RoadType.HIGHWAY ? rawOob : null;
const cells = rawOob ? fullPath.slice(0, rawOob.truncatedLength) : fullPath;
```

邊界格子的 `roadFlags` 會加上 `outwardFlag`，使該格具備指向地圖外的方向旗標。

### 外部連接判定（HighwayConnection）

**原始碼**: `src/core/traffic/HighwayConnection.ts`

`HighwayConnection` 每 60 tick 掃描地圖邊緣，使用 `hasInwardFlag` 判定哪些邊界格子具有指向地圖內部的高速公路連接。每個有效的邊界高速公路格子提供固定吞吐量（`THROUGHPUT_PER_CONNECTION = 30`），影響外部人口流入與貨物進出。

### 視覺延伸（RoadStripBuilder）

**原始碼**: `src/renderer/RoadStripBuilder.ts`

`buildRoadStrips` 接受 `edgeExtend` 參數（預設為 0.5 格），在邊界格子的外側方向額外產生一條路面條帶：

- 北邊界（`y = 0`）且具 NORTH 旗標 → 向北延伸 0.5 格
- 南邊界（`y = mapH - 1`）且具 SOUTH 旗標 → 向南延伸 0.5 格
- 西邊界（`x = 0`）且具 WEST 旗標 → 向西延伸 0.5 格
- 東邊界（`x = mapW - 1`）且具 EAST 旗標 → 向東延伸 0.5 格

這使得道路在視覺上自然延伸至地圖邊界之外，暗示與外部城市的連接。
