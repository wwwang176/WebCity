# 行人系統規劃書 (Pedestrian System Plan)

## 目標

在既有的道路與交通系統之上，新增可見的行人代理 (pedestrian agent)，讓市民在步行通勤時以小人模型沿人行道移動、走斑馬線過馬路，並配合紅綠燈等待。

---

## 1. 現有基礎設施盤點

### 1.1 已存在（可直接利用）

| 項目 | 位置 | 說明 |
|------|------|------|
| 人行道渲染 | `RoadRenderer.ts:149-211` | 灰色條狀 (`0x707070`)，寬 `SIDEWALK_WIDTH=0.14`，高 `SIDEWALK_Y=0.028`，在道路外緣沒有鄰接道路的那一側繪製 |
| 斑馬線渲染 | `RoadRenderer.ts:304-384` | 12 條白灰色條紋 (`0xbbbbbb`)，在 ≥3 路交叉口的鄰接格子上，距交叉口中心 `cwOffset=0.35` |
| 停車線 | `RoadRenderer.ts:386-457` | 在斑馬線內側 (`stopOffset=0.25`)，僅佔來車車道一半寬 |
| 紅綠燈系統 | `TrafficLights.ts` | 雙相位：phase 0 = NS 綠 / EW 紅，phase 1 = NS 紅 / EW 綠，每相位 `PHASE_DURATION=8` ticks |
| 平交道系統 | `LevelCrossingSystem.ts` | 火車靠近（Manhattan ≤ 2.5 格）時 `state=ACTIVE`，離開後 1.5 秒冷卻；`isCrossingBlocked(x,y)` 查詢是否封鎖 |
| 平交道渲染 | `LevelCrossingRenderer.ts` | 柵欄降下 + 紅燈閃爍動畫，已完整實作 |
| 步行模式判定 | `ModeChoice.ts` | Manhattan 距離 ≤ `WALK_MAX_DISTANCE=3` 時選擇步行（但目前不產生視覺效果） |
| 市民資料 | `CitizenManager.ts` | 有 `homeId` / `workplaceId`（格子座標 `"x,y"`），但無位置/朝向/速度 |
| 車輛渲染模式 | `VehicleRenderer.ts` | InstancedMesh + 每幀更新 matrix，可作為行人渲染的範本 |
| 車輛幾何範本 | `src/renderer/geometry/car.ts` 等 | BoxGeometry 組合 + `setVertexColors` + `mergeGeometries` 模式 |

### 1.2 不存在（需新建）

| 項目 | 說明 |
|------|------|
| 人行道路網圖 (SidewalkGraph) | 人行道節點 + 斑馬線邊 + 建築入口邊 |
| 行人代理 (PedestrianAgent) | 位置、朝向、路徑、沿路徑距離 |
| 行人管理器 (PedestrianManager) | 生成/消滅/每 tick 更新行人位置 |
| 人物幾何模型 (person.ts) | Low-poly 小人模型 |
| 行人渲染器 (PedestrianRenderer) | InstancedMesh 行人渲染 |

---

## 2. 架構總覽

```
┌──────────────────────────────────────────────────────────┐
│                      Core Layer                           │
│                                                          │
│  SidewalkGraph ←── 從 Grid 生成人行道路網                  │
│    ├─ 人行道節點 + 斑馬線邊 + 建築入口邊                    │
│    └─ 公車站/火車站入口邊（複用 building_access 邏輯）       │
│       ↓                                                  │
│  PedestrianManager                                       │
│    ├─ spawnPedestrian(origin, dest, citizenId, tripType)  │
│    ├─ tick(dt) → 更新所有行人位置                          │
│    ├─ getPedestrians() → PedestrianAgent[]                │
│    ├─ spawnDecorativeBatch() → 補充裝飾行人                │
│    └─ despawn arrived agents                             │
│                                                          │
│  SimulationLoop 通勤 tick：                                │
│    ModeChoice → 收集所有步行路線 → WalkingTripPool          │
│    每 tick 從路線池加權隨機抽樣 → spawn 行人                 │
│    路線比例自動反映通勤模式分布                               │
│                                                          │
│  TrafficLights ──→ canPass() ──→ 斑馬線等待               │
│  LevelCrossingSystem ──→ isCrossingBlocked() ──→ 平交道   │
└──────────────────────────────────────────────────────────┘
        ↓ 每幀收集 PedestrianAgent[] 位置
┌──────────────────────────────────────────────────────────┐
│                     Render Layer                          │
│                                                          │
│  Game.ts:                                                │
│    pedestrians = pedManager.getPedestrians()              │
│    visiblePeds = cullPedestrians(pedestrians, camera)     │
│    pedRenderer.update(visiblePeds)                        │
│                                                          │
│  PedestrianRenderer:                                     │
│    InstancedMesh(maxCount=2000) + person geometry         │
│    per-instance position/rotation/color                   │
│    視距剔除：鏡頭半徑 15 格內才渲染                          │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Core Layer 詳細設計

### 3.1 SidewalkGraph — 人行道路網圖

**檔案**: `src/core/traffic/SidewalkGraph.ts`

#### 3.1.1 資料結構

```typescript
export interface SidewalkNode {
  id: string;          // 例如 "5,3:NW" 或 "5,3:building" 或 "5,3:stop_bus"
  position: { x: number; y: number };  // 世界座標（與渲染對齊）
  cellKey: string;     // 所屬格子 "x,y"
  type: 'sidewalk' | 'crosswalk_wait' | 'building_entrance' | 'transit_stop';
}

export interface SidewalkEdge {
  id: string;
  from: SidewalkNode;
  to: SidewalkNode;
  length: number;      // 歐幾里得距離
  type: 'sidewalk' | 'crosswalk' | 'level_crossing' | 'building_access';
}
```

#### 3.1.2 每格節點佈局

每個道路格子根據其人行道位置，在**道路外緣**生成節點。人行道渲染在沒有鄰接道路的邊上 (`RoadRenderer.ts:183-186`)，因此人行道節點也只在這些邊上產生。

以一條東西向直路為例（北側和南側有人行道）：

```
      SW_NW ────────── SW_NE
        │    ╔════════╗   │
        │    ║  道 路  ║   │
        │    ╚════════╝   │
      SW_SW ────────── SW_SE

  節點位置（世界座標）：
  SW_NW = (x - 0.4, y - halfWidth - SIDEWALK_WIDTH/2)
  SW_NE = (x + 0.4, y - halfWidth - SIDEWALK_WIDTH/2)
  SW_SW = (x - 0.4, y + halfWidth + SIDEWALK_WIDTH/2)
  SW_SE = (x + 0.4, y + halfWidth + SIDEWALK_WIDTH/2)

  其中 halfWidth 取決於道路類型的車道數
  SIDEWALK_WIDTH = 0.14（來自 RoadRenderer）
```

**座標計算依據**：
- 人行道的 Y 位置 = `roadCenter ± (roadHalfWidth + SIDEWALK_WIDTH/2)`
- 格子內節點的 X 偏移用 ±0.4（接近格子邊緣），與 LaneGraph 的 `entry=0.4` / `exit=0.5` 一致

#### 3.1.3 邊的類型

**Type 1: 沿路人行道邊 (`sidewalk`)**

同一格子同一側的兩個節點之間：
```
SW_NW ←──sidewalk──→ SW_NE   （北側人行道，東西行走）
SW_SW ←──sidewalk──→ SW_SE   （南側人行道，東西行走）
```

**Type 2: 跨格子人行道邊 (`sidewalk`)**

相鄰格子之間的人行道連接：
```
格子(5,3)的 SW_NE ←──sidewalk──→ 格子(6,3)的 SW_NW
```

條件：兩格子都有該側的人行道。

**Type 3: 斑馬線邊 (`crosswalk`)**

僅在 ≥3 路交叉口。連接交叉口相對兩側的人行道節點：

```
格子(5,2)南側          格子(5,4)北側
  SW_SE ──crosswalk──→ SW_NE

斑馬線邊的位置對齊 RoadRenderer 的 cwOffset=0.35：
  行人在此邊上移動時，世界座標會落在已渲染的斑馬線條紋上
```

具體對齊方式：
- 交叉口在 `(ix, iy)`，北側鄰格在 `(ix, iy-1)`
- 斑馬線渲染位置：`z = (iy-1) + 1 * cwOffset = (iy-1) + 0.35`
- crosswalk_wait 節點的 y 座標設為相同值，確保行人視覺上站在斑馬線起點

**Type 4: 建築入口邊 (`building_access`)**

將建築連接到最近的人行道節點：

```
建築(4,3) → building_entrance 節點 → 最近的 SW 節點（例如 "5,3:SW_SW"）
```

建築入口判定：
- 使用 `isAdjacentToRoad(grid, bx, by)` 確認建築鄰接道路
- 建築入口節點位置 = 建築格子中心偏向道路側

**Type 5: 公車站/火車站入口邊 (`transit_access`)**

將公車站和火車站連接到最近的人行道節點，與 building_access 邏輯相同：

```
公車站(6,3) → transit_stop 節點 → 最近的 SW 節點（例如 "6,3:SW_NE"）
火車站(8,5) → transit_stop 節點 → 最近的 SW 節點
```

公車站位於道路旁，本身就在人行道上或緊鄰人行道，因此 transit_access 邊通常很短。
火車站是建築物，處理方式與 building_access 相同。

**Type 6: 平交道邊 (`level_crossing`)**

鐵路與道路交叉的格子（`railType !== NONE && roadType !== NONE`），行人穿越鐵軌：

```
       人行道
  ──────┤    ├──────
  ══════╪════╪══════  ← 鐵軌
  ──────┤    ├──────
       人行道

  左側 SW 節點 ──level_crossing──→ 右側 SW 節點
```

判定方式：
- `LevelCrossingSystem.rebuildFromGrid()` 已掃描所有 rail+road 共存格
- 在這些格子上，人行道跨越鐵軌的邊標記為 `level_crossing` 類型
- 行人走到此邊時，檢查 `LevelCrossingSystem.isCrossingBlocked(x, y)`
- 柵欄放下（`ACTIVE`）→ 行人等待；柵欄升起（`CLEAR`）→ 行人通行

#### 3.1.4 SidewalkGraph API

```typescript
export class SidewalkGraph {
  // 從 Grid 建構整張人行道路網
  buildFromGrid(grid: GridLookup, roadCellKeys: string[]): void;

  // 道路變更時局部更新（類似 LaneGraph.updateCells）
  updateCells(grid: GridLookup, affectedCellKeys: string[]): void;

  // A* 尋路：從起點節點到終點節點
  findPath(fromNodeId: string, toNodeId: string): SidewalkEdge[] | null;

  // 查詢：找到離某建築最近的人行道節點
  findNearestNode(buildingX: number, buildingY: number): SidewalkNode | null;

  // 查詢
  getNode(nodeId: string): SidewalkNode | undefined;
  getEdgesFrom(nodeId: string): SidewalkEdge[];
  getNodesInCell(cellKey: string): SidewalkNode[];
}
```

#### 3.1.5 A* 尋路實作

行人只需要 **單階段 A***，不需要像車輛一樣做兩階段（格子級 + 車道細化）。

```typescript
findPath(fromNodeId: string, toNodeId: string): SidewalkEdge[] | null {
  // 標準 A*
  // heuristic: 歐幾里得距離（節點有精確世界座標）
  // 移動成本: edge.length（歐幾里得距離）
  // 額外成本: crosswalk 邊可加上等待紅綠燈的預估成本
  //           例如 +0.5 * PHASE_DURATION（平均等待半個週期）
}
```

**與車輛路徑規劃的關鍵差異**：

| | 車輛 | 行人 |
|-|------|------|
| 階段 | 兩階段（gridAStar → refineLanePath） | 一階段（sidewalk A*） |
| 圖的節點 | 格子 + ConnectionPoint | SidewalkNode |
| 車道 | 多車道切換 | 無車道概念 |
| 曲線 | Bezier 控制點 | 直線段即可 |
| 圖的規模 | ~4-8 點/格 × 車道數 | ~2-4 點/格 |

---

### 3.2 PedestrianAgent — 行人代理

**檔案**: `src/core/traffic/PedestrianAgent.ts`

```typescript
export enum PedestrianTripType {
  FULL_WALK = 0,    // WALK 模式：home → workplace（全程步行）
  FIRST_MILE = 1,   // 公車/火車：home → 站點（首段步行）
  LAST_MILE = 2,    // 公車/火車：站點 → workplace（末段步行）
  DECORATIVE = 3,   // 裝飾行人：沿人行道隨意走動
}

export interface PedestrianAgent {
  id: number;
  citizenId: number;          // 對應 Citizen.id，裝飾行人 = -1

  // 行程類型
  tripType: PedestrianTripType;

  // 路徑狀態
  edgePath: SidewalkEdge[];   // 完整路徑（SidewalkEdge 序列）
  edgeIndex: number;          // 當前所在邊的索引
  edgeProgress: number;       // 沿當前邊已走的距離

  // 即時位置（每 tick 計算）
  position: { x: number; y: number };
  heading: number;            // 朝向（弧度），0 = 東（+x）

  // 狀態
  state: PedestrianState;
  waitTimer: number;          // 等紅燈的剩餘 tick 數

  // 視覺
  colorIndex: number;         // 衣服顏色索引（生成時隨機）
}

export enum PedestrianState {
  WALKING = 0,
  WAITING_SIGNAL = 1,         // 等紅燈
  WAITING_CROSSING = 2,       // 等平交道柵欄升起
  ARRIVED = 3,
}
```

---

### 3.3 PedestrianManager — 行人管理器

**檔案**: `src/core/traffic/PedestrianManager.ts`

#### 3.3.1 職責

1. 接收「步行通勤」請求，生成行人代理
2. 每 tick 更新所有行人位置
3. 行人到達目的地後移除
4. 控制同時存在的行人數量上限

#### 3.3.2 API

```typescript
export class PedestrianManager {
  constructor(
    sidewalkGraph: SidewalkGraph,
    trafficLights: TrafficLights,
    levelCrossings: LevelCrossingSystem,
  );

  // 生成行人：從 origin 步行到 destination
  spawnPedestrian(
    originX: number, originY: number,
    destX: number, destY: number,
    citizenId: number,       // -1 = 匿名（機率抽樣生成）
    tripType: PedestrianTripType,
  ): number | null;  // 返回 pedestrian id，若無法尋路或超過上限則返回 null

  // 每 tick 呼叫：更新所有行人位置
  tick(dt: number): void;

  // 取得所有活躍行人（供渲染層收集）
  getPedestrians(): ReadonlyArray<PedestrianAgent>;

  // 補充裝飾行人（由 SimulationLoop 定期呼叫）
  spawnDecorativeBatch(population: number): void;

  // 序列化
  toJSON(): PedestrianManagerJSON;
  fromJSON(data: PedestrianManagerJSON): void;

  // 統計
  getActiveCount(): number;
}
```

#### 3.3.3 tick 邏輯

```
tick(dt):
  for each agent:
    if agent.state === ARRIVED:
      mark for removal
      continue

    currentEdge = agent.edgePath[agent.edgeIndex]

    // 斑馬線等待邏輯
    if currentEdge.type === 'crosswalk' && agent.edgeProgress === 0:
      if !trafficLights.canPassPedestrian(edge):
        agent.state = WAITING_SIGNAL
        continue
      else:
        agent.state = WALKING

    // 平交道等待邏輯
    if currentEdge.type === 'level_crossing' && agent.edgeProgress === 0:
      cellKey = currentEdge.from.cellKey
      {x, y} = parsePosKey(cellKey)
      if levelCrossings.isCrossingBlocked(x, y):
        agent.state = WAITING_CROSSING
        continue
      else:
        agent.state = WALKING

    // 移動
    moveDistance = PEDESTRIAN_SPEED * dt
    agent.edgeProgress += moveDistance

    // 超過當前邊長度 → 進入下一條邊
    while agent.edgeProgress >= currentEdge.length:
      agent.edgeProgress -= currentEdge.length
      agent.edgeIndex++
      if agent.edgeIndex >= agent.edgePath.length:
        agent.state = ARRIVED
        break
      currentEdge = agent.edgePath[agent.edgeIndex]

    // 計算世界座標位置
    t = agent.edgeProgress / currentEdge.length
    agent.position.x = lerp(currentEdge.from.position.x, currentEdge.to.position.x, t)
    agent.position.y = lerp(currentEdge.from.position.y, currentEdge.to.position.y, t)
    agent.heading = atan2(
      -(currentEdge.to.position.y - currentEdge.from.position.y),
      currentEdge.to.position.x - currentEdge.from.position.x
    )

  remove ARRIVED agents
```

#### 3.3.4 常數與動態上限

```typescript
export const PEDESTRIAN = {
  SPEED: 1.5,           // 世界單位/秒（約 5 km/h 按 1 cell=12m 換算）
  MIN_ACTIVE: 50,       // 最低行人上限（小城市）
  MAX_ACTIVE: 2000,     // 最高行人上限（大城市）
  POPULATION_RATIO: 0.05, // 行人上限 = population * 0.05
  DESPAWN_TIMEOUT: 120,  // 秒，超時強制移除（防止卡住）
} as const;

// 根據人口動態計算行人上限
export function getMaxPedestrians(population: number): number {
  return Math.max(
    PEDESTRIAN.MIN_ACTIVE,
    Math.min(Math.floor(population * PEDESTRIAN.POPULATION_RATIO), PEDESTRIAN.MAX_ACTIVE)
  );
}
// 範例：
//   500 人口 →  50 行人（MIN 保底）
//   5,000 人口 → 250 行人
//  10,000 人口 → 500 行人
//  20,000 人口 → 1,000 行人
//  40,000+ 人口 → 2,000 行人（MAX 封頂）
```

#### 3.3.5 斑馬線等紅燈

行人到達 `crosswalk` 邊的起點時，檢查紅綠燈：

```typescript
canPassPedestrian(edge: SidewalkEdge): boolean {
  // crosswalk 邊跨越的方向（行人穿越方向）
  const dx = edge.to.position.x - edge.from.position.x;
  const dy = edge.to.position.y - edge.from.position.y;

  // 行人穿越道路的方向與車輛行進方向垂直
  // 行人南北穿越 → 需要車輛的東西向紅燈 → phase === 0（NS green = 行人 EW 穿越禁止）
  // 反轉：行人穿越方向 = 與車輛綠燈方向相同時才可通行
  //
  // 具體對照 TrafficLights.canPass：
  //   行人南北穿越（|dy| > |dx|）→ 等同車輛南北通行 → phase === 0 時可通行
  //   行人東西穿越（|dx| > |dy|）→ 等同車輛東西通行 → phase === 1 時可通行
  //
  // 直接呼叫 trafficLights.canPass() 即可，
  // 用 crosswalk 起點格和終點格的座標作為 from/to 參數
}
```

#### 3.3.6 平交道等待

行人到達 `level_crossing` 邊的起點時，檢查平交道柵欄：

```typescript
// 直接複用現有 API：
const { x, y } = parsePosKeyUnsafe(edge.from.cellKey);
if (levelCrossings.isCrossingBlocked(x, y)) {
  agent.state = PedestrianState.WAITING_CROSSING;
  // 行人停在柵欄前，不進入鐵軌
} else {
  agent.state = PedestrianState.WALKING;
  // 柵欄升起，行人穿越鐵軌
}
```

**與紅綠燈的差異**：
- 紅綠燈是固定週期切換（`PHASE_DURATION=8` ticks）
- 平交道是事件驅動（火車接近時啟動，離開後 1.5 秒冷卻）
- 平交道用 `isCrossingBlocked()` 查詢即可，不需要知道方向

**行人等待位置**：
- `level_crossing` 邊的 `from` 節點位於柵欄外側的人行道上
- 行人 `edgeProgress === 0` 時視覺上站在柵欄前方，與柵欄降下的渲染位置（`CURB=0.38`）對齊

#### 3.3.7 與通勤系統的整合 — 步行路線池

行人是**視覺模擬**，不追蹤個別市民的旅程。系統根據通勤模式分布建立一個**步行路線池（WalkingTripPool）**，行人按路線使用人數的比例隨機生成。

##### 步行路線池的建構

每次尖峰期開始時（`morning_rush` / `evening_rush`），SimulationLoop 遍歷所有通勤市民，收集所有步行路線：

```typescript
interface WalkingTrip {
  fromX: number; fromY: number;  // 起點格子
  toX: number; toY: number;      // 終點格子
  tripType: PedestrianTripType;
}

// 聚合結構：相同起終點的路線合併，記錄使用人數
interface AggregatedTrip extends WalkingTrip {
  count: number;                  // 使用此路線的市民數
}
```

```
建構流程（在現有通勤遍歷中附加）：

tripMap = new Map<string, AggregatedTrip>()   // key = "fromX,fromY→toX,toY"

for each eligible citizen:
  mode = ModeChoice.chooseMode(home, workplace, availableTransit, congestion)

  switch (mode):
    WALK:
      addTrip(home, workplace, FULL_WALK)

    BUS:
      originStop = findNearestStop(home, busSystem)
      destStop   = findNearestStop(workplace, busSystem)
      addTrip(home, originStop, FIRST_MILE)
      addTrip(destStop, workplace, LAST_MILE)

    RAIL / METRO / FERRY:
      originStation = findNearestStop(home, railSystem)
      destStation   = findNearestStop(workplace, railSystem)
      addTrip(home, originStation, FIRST_MILE)
      addTrip(destStation, workplace, LAST_MILE)

    DRIVE:
      // 不產生步行路線

function addTrip(from, to, type):
  key = `${from.x},${from.y}→${to.x},${to.y}`
  if tripMap.has(key):
    tripMap.get(key).count++
  else:
    tripMap.set(key, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, tripType: type, count: 1 })
```

**結果範例**（10,000 通勤者，聚合後約數百條唯一路線）：

```
路線                              使用人數   權重
住宅區A(3,5) → 公車站X(4,6)        200      200
住宅區B(3,7) → 公車站X(4,6)        180      180
公車站X(4,6) → 商業區D(5,8)        150      150
住宅區A(3,5) → 商業區D(5,8)         30       30   ← 全程步行
住宅區E(10,2) → 火車站Z(11,3)       15       15
...
```

熱門公車站前面自然人多，冷門路線自然人少——完全由通勤數據決定。

##### 行人生成（機率抽樣）

```
每個 spawn tick（尖峰期間每 tick、離峰期間每 N tick）：

  maxPed = getMaxPedestrians(population)
  currentPed = pedManager.getActiveCount()
  spawnBudget = min(BATCH_SIZE, maxPed - currentPed)

  for i in 0..spawnBudget:
    trip = weightedRandomSample(tripPool)   // 按 count 加權隨機抽取
    pedManager.spawnPedestrian(
      trip.fromX, trip.fromY,
      trip.toX, trip.toY,
      -1,                // citizenId = -1（不綁定個別市民）
      trip.tripType,
    )
```

**加權隨機抽取**：使用前綴和（prefix sum）陣列，O(log N) 二分搜尋，N = 聚合路線數（通常 < 500）。

##### 路徑快取（共享路由）

相同起終點的行人共用同一條 A* 路徑，與車輛的 `CommuteCache` 共享路由池概念一致：

```typescript
// PedestrianManager 內部
private pathCache = new Map<string, SidewalkEdge[] | null>();

function getCachedPath(fromX: number, fromY: number, toX: number, toY: number): SidewalkEdge[] | null {
  const key = `${fromX},${fromY}→${toX},${toY}`;
  if (this.pathCache.has(key)) {
    return this.pathCache.get(key)!;
  }
  const fromNode = this.sidewalkGraph.findNearestNode(fromX, fromY);
  const toNode = this.sidewalkGraph.findNearestNode(toX, toY);
  if (!fromNode || !toNode) {
    this.pathCache.set(key, null);
    return null;
  }
  const path = this.sidewalkGraph.findPath(fromNode.id, toNode.id);
  this.pathCache.set(key, path);
  return path;
}
```

**效果**：
- 路線池中 200 人走「住宅區A → 公車站X」→ 只需要 1 次 A* 尋路
- 聚合後約數百條唯一路線 → 最多數百次 A*（每次 <1ms）

**與車輛 CommuteCache 的對比**：

| | 車輛 | 行人 |
|-|------|------|
| 快取 key | `"fromCell→toCell"` | `"fromCell→toCell"` |
| 快取 value | `LaneEdge[][]`（多車道變體） | `SidewalkEdge[]`（單一路徑） |
| 多變體 | 有（分散到不同車道） | 無（人行道只有一條路） |
| 無效化 | `invalidateCell()` 局部清除 | `invalidateCells()` 局部清除 |

##### 快取清除時機

系統有兩層快取，各自的清除條件不同：

**1. pathCache（A* 路徑快取）— 局部更新**

參考車輛 `CommuteCache` 的 cell index 機制，只清除經過受影響格子的路徑：

```typescript
// PedestrianManager 內部
private pathCache = new Map<string, SidewalkEdge[] | null>();
private cellIndex = new Map<string, Set<string>>();  // cellKey → Set<pathKey>

// 快取路徑時同步建立 cell index
function cachePath(pathKey: string, path: SidewalkEdge[]): void {
  this.pathCache.set(pathKey, path);
  // 記錄這條路徑經過哪些格子
  for (const edge of path) {
    const cellKey = edge.from.cellKey;
    if (!this.cellIndex.has(cellKey)) this.cellIndex.set(cellKey, new Set());
    this.cellIndex.get(cellKey)!.add(pathKey);
  }
}

// 局部清除：只移除經過受影響格子的路徑
function invalidateCells(affectedCells: Iterable<string>): void {
  for (const cellKey of affectedCells) {
    const pathKeys = this.cellIndex.get(cellKey);
    if (!pathKeys) continue;
    for (const pathKey of pathKeys) {
      this.pathCache.delete(pathKey);
    }
    this.cellIndex.delete(cellKey);
  }
}
```

```typescript
// 掛在現有的 onRoadChanged 事件上（SimulationLoop 已有此機制）
onRoadChanged(affectedCells: Set<string>): void {
  // 車輛系統：commuteCache.invalidateCell(cellKey) + bumpGeneration()
  // 行人系統：同樣局部更新
  this.sidewalkGraph.updateCells(grid, [...affectedCells]);
  this.pedManager.invalidateCells(affectedCells);
}
```

| 觸發事件 | 動作 | 清除範圍 |
|----------|------|----------|
| 道路建造/拆除 | `invalidateCells(affectedCells)` | 只清除經過受影響格子的路徑 |
| 公車站/火車站新增/移除 | `invalidateCells(stationCells)` | 只清除涉及該站格子的路徑 |

未受影響的路徑保留快取，下次 spawn 時直接使用。被清除的路徑在下次 spawn 時 lazy rebuild（重新 A* 尋路）。

**2. WalkingTripPool（步行路線池）**

路線池取決於「誰走哪條路線」，受多種因素影響。核心策略：**每次尖峰期開始時完整重建**，中間不做即時更新。

| 影響因素 | 範例 | 處理方式 |
|----------|------|----------|
| 路網變更 | 蓋路/拆路 → 步行可達性改變 | 標記 dirty，下次尖峰期重建 |
| 公交路線變更 | 新增/刪除公車路線 → 模式分布改變 | 標記 dirty，下次尖峰期重建 |
| 擁堵程度變化 | 塞車 → 更多人改搭公車 | 每次尖峰期自然反映（ModeChoice 每次重算） |
| 市民換工作 | JobRelocation → workplace 改變 | 每次尖峰期自然反映（讀取當前 workplace） |
| 市民搬家 | 遷居 → home 改變 | 每次尖峰期自然反映（讀取當前 home） |
| 人口增減 | 出生/死亡/移民 | 每次尖峰期自然反映（遍歷當前市民） |
| 離峰期 | midday / night | 不重建，沿用上次尖峰期的池 |

```typescript
// PedestrianManager 內部
private tripPool: AggregatedTrip[] = [];
private tripPoolDirty = true;

// SimulationLoop 在尖峰期開始時呼叫
rebuildTripPool(citizens: Citizen[], ...): void {
  this.tripPool = buildWalkingTripPool(citizens, ...);
  this.tripPoolDirty = false;
}

// 道路/路線變更時
markTripPoolDirty(): void {
  this.tripPoolDirty = true;
}
```

**為什麼路線池不需要即時重建？**

路線池是純視覺用途，與車輛快取的性質不同：

| | 車輛 CommuteCache | 行人 WalkingTripPool |
|-|-------------------|---------------------|
| 用途 | 模擬正確性（車會撞牆） | 純視覺渲染 |
| 即時性 | 路網變更需即時無效化 | 等下一個尖峰期重建即可 |
| 換工作/搬家 | 需清除該市民的快取路由 | 下次重建自然反映 |

換工作、搬家、人口變動等都不需要特別處理——路線池每個尖峰期從**當前**市民資料完整重建，所有變動自動納入。時間差最多一個尖峰週期（遊戲內數分鐘），視覺上無感。

##### 設計優勢

- **不需要 `scheduleSpawn` / `PendingSpawn` / 延遲佇列**：首段和末段行人獨立生成，不需要追蹤時間先後
- **不需要 `estimateTransitTime`**：沒有延遲機制就不需要估算搭車時間
- **不需要追蹤個別市民**：`citizenId = -1`，行人是匿名的視覺代表
- **比例自動正確**：50% 搭公車 → 公車站周圍自然有最多行人
- **地理分布正確**：熱門路線權重高，人口密集區自然行人多
- **記憶體極低**：聚合後只有幾百條路線，不是幾萬筆市民資料

---

### 3.4 裝飾行人（補充用）

通勤行人已經按照實際模式比例產生，尖峰時段街道會有足夠人氣。裝飾行人的角色是**補充非尖峰時段**（midday / night），讓城市不會在離峰時完全沒有行人。

#### 3.4.1 設計

```typescript
export const DECORATIVE_PEDESTRIAN = {
  MAX_RATIO: 0.15,          // 裝飾行人最多佔總上限的 15%（通勤行人才是主體）
  SPAWN_INTERVAL: 8,        // 每 8 tick 嘗試生成一批
  BATCH_SIZE: 3,            // 每批最多生成 3 個
} as const;
```

#### 3.4.2 生成邏輯

```
僅在非尖峰時段（midday / night）由 SimulationLoop 呼叫：
  pedManager.spawnDecorativeBatch(population)

內部邏輯：
  maxDecorative = getMaxPedestrians(population) * MAX_RATIO
  currentDecorative = 統計 tripType === DECORATIVE 的行人數

  if currentDecorative < maxDecorative:
    隨機選取有人行道的道路段
    生成沿 2-3 段 sidewalk edge 步行的裝飾行人
    citizenId = -1, tripType = DECORATIVE
```

#### 3.4.3 簡化路徑

裝飾行人**不需要 A* 尋路**，僅沿單一 sidewalk edge 或連續 2-3 段移動。成本極低。

#### 3.4.4 與通勤行人共享上限

所有行人共用 `getMaxPedestrians()` 總上限。尖峰時段通勤行人多 → 裝飾行人自然減少或不生成。離峰時段通勤行人消失 → 裝飾行人自動補上。

---

## 4. Render Layer 詳細設計

### 4.1 人物幾何模型

**檔案**: `src/renderer/geometry/person.ts`

參考 `car.ts` 的 BoxGeometry 組合模式，建立 Low-poly 小人：

```typescript
export function buildPersonGeometry(): THREE.BufferGeometry {
  // 所有尺寸單位與車輛一致（車 = 0.22 長，人應明顯更小）
  //
  // 頭部: BoxGeometry(0.025, 0.025, 0.025) @ y=0.09
  //   顏色: 膚色 (0.87, 0.75, 0.65)
  //
  // 身體: BoxGeometry(0.03, 0.04, 0.02) @ y=0.06
  //   顏色: 白色 (1, 1, 1) → 由 InstancedMesh 的 per-instance color 覆蓋
  //
  // 左腿: BoxGeometry(0.012, 0.035, 0.014) @ x=-0.007, y=0.0175
  //   顏色: 深色 (0.15, 0.15, 0.2)
  //
  // 右腿: BoxGeometry(0.012, 0.035, 0.014) @ x=+0.007, y=0.0175
  //   顏色: 深色 (0.15, 0.15, 0.2)
  //
  // 左臂: BoxGeometry(0.01, 0.03, 0.012) @ x=-0.023, y=0.055
  //   顏色: 與身體同色（per-instance 覆蓋）
  //
  // 右臂: BoxGeometry(0.01, 0.03, 0.012) @ x=+0.023, y=0.055
  //   顏色: 與身體同色（per-instance 覆蓋）

  return mergeGeometries([head, body, leftLeg, rightLeg, leftArm, rightArm]);
}
```

**尺寸對照**：
- 車輛長度 0.22 units ≈ 4.5m（以 1 cell = 12m 換算：0.22 / 0.5 * 12 ≈ 5.3m）
- 行人高度 0.10 units ≈ 1.7m（比例合理）
- 行人渲染 Y 基準 = `SIDEWALK_Y` (0.028)，腳底齊平人行道

### 4.2 PedestrianRenderer

**檔案**: `src/renderer/PedestrianRenderer.ts`

沿用 `VehicleRenderer.ts` 的 InstancedMesh 模式：

```typescript
export interface PedestrianRenderData {
  id: number;
  x: number;         // 世界座標 X
  y: number;         // 世界座標 Z（注意：core 的 y → Three.js 的 z）
  heading: number;   // 弧度
  colorIndex: number; // 衣服顏色索引
}

export class PedestrianRenderer {
  private mesh: THREE.InstancedMesh | null = null;
  private maxCount = 2000;  // 與 PEDESTRIAN.MAX_ACTIVE 一致

  build(scene: THREE.Scene): void {
    const geo = buildPersonGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.maxCount);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(pedestrians: PedestrianRenderData[]): void {
    if (!this.mesh) return;
    const count = Math.min(pedestrians.length, this.maxCount);
    this.mesh.count = count;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const p = pedestrians[i];

      // 位置：core 的 (x, y) → Three.js 的 (x, SIDEWALK_Y, y)
      matrix.makeRotationY(p.heading);
      matrix.setPosition(p.x, SIDEWALK_Y, p.y);
      this.mesh.setMatrixAt(i, matrix);

      // 衣服顏色
      color.setHex(PERSON_COLORS[p.colorIndex % PERSON_COLORS.length]);
      this.mesh.setColorAt(i, color);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void { /* 清理 mesh */ }
}
```

**衣服顏色表**：

```typescript
const PERSON_COLORS = [
  0x2196F3, // 藍
  0xF44336, // 紅
  0x4CAF50, // 綠
  0xFF9800, // 橘
  0x9C27B0, // 紫
  0x00BCD4, // 青
  0xFFEB3B, // 黃
  0x795548, // 棕
  0x607D8B, // 灰藍
  0xE91E63, // 粉紅
  0x3F51B5, // 靛
  0x009688, // 深青
];
```

### 4.3 視距剔除（Camera Culling）

邏輯層可以同時跑 2,000 個行人代理，但渲染時只把**鏡頭附近**的行人送入 InstancedMesh。縮放到全城鳥瞰時，行人本來就看不見，不需要渲染。

```typescript
const CULL_RADIUS = 15;  // 世界單位，約 15 格範圍

function cullPedestrians(
  pedestrians: ReadonlyArray<PedestrianAgent>,
  cameraX: number,
  cameraZ: number,
): PedestrianRenderData[] {
  const rSq = CULL_RADIUS * CULL_RADIUS;
  const result: PedestrianRenderData[] = [];

  for (const p of pedestrians) {
    if (p.state === PedestrianState.ARRIVED) continue;
    const dx = p.position.x - cameraX;
    const dz = p.position.y - cameraZ;
    if (dx * dx + dz * dz > rSq) continue;

    result.push({
      id: p.id,
      x: p.position.x,
      y: p.position.y,
      heading: p.heading,
      colorIndex: p.colorIndex,
    });
  }
  return result;
}
```

**效果**：即使邏輯層有 2,000 個行人，渲染層通常只需處理 200-400 個（取決於鏡頭縮放等級），GPU 負擔與原本 200 上限相當。

### 4.4 Game.ts 整合

在 `Game.ts` 的每幀渲染迴圈中，加入行人收集與渲染：

```typescript
// === 初始化 ===
// 在 constructor 或 init 中（約 line 311 附近）：
this.pedestrianRenderer = new PedestrianRenderer();
this.pedestrianRenderer.build(this.scene);

// === 每幀更新 ===
// 在車輛收集之後（約 line 891 附近）：
const cameraTarget = this.controls.target; // OrbitControls 的注視點
const pedData = cullPedestrians(
  this.state.pedestrianManager.getPedestrians(),
  cameraTarget.x,
  cameraTarget.z,
);
this.pedestrianRenderer.update(pedData);
```

---

## 5. 檔案結構

```
src/
├── core/
│   └── traffic/
│       ├── SidewalkGraph.ts              # 人行道路網圖（新增）
│       ├── PedestrianAgent.ts            # 行人代理介面（新增）
│       ├── PedestrianManager.ts          # 行人管理器（新增）
│       └── __tests__/
│           ├── SidewalkGraph.test.ts      # 路網圖測試（新增）
│           ├── PedestrianManager.test.ts  # 行人管理器測試（新增）
│           └── PedestrianAgent.test.ts    # 行人代理測試（新增）
└── renderer/
    ├── PedestrianRenderer.ts             # 行人渲染器（新增）
    └── geometry/
        └── person.ts                     # 人物幾何模型（新增）
```

---

## 6. 實作順序（TDD）

### Phase A: SidewalkGraph（人行道路網圖）

**先寫測試 `SidewalkGraph.test.ts`**：

```
A1. 直線道路應在兩側生成人行道節點
    - 東西向道路 → 北側和南側各有節點
    - 節點位置對齊 SIDEWALK_Y 的 XZ 座標

A2. T 字路口應生成斑馬線邊
    - 3 路交叉口，每個方向的鄰格產生 crosswalk 邊
    - crosswalk 邊的起終點座標對齊 cwOffset=0.35

A3. 十字路口應在四個方向都有斑馬線邊

A4. 死路（1 方向）不應有斑馬線邊

A5. 跨格子的人行道邊應正確連接
    - 相鄰道路格子之間的同側人行道節點有 sidewalk 邊

A6. findPath 應找到從 A 到 B 的路徑
    - 直線道路：沿人行道直走
    - 需要過馬路：路徑包含 crosswalk 邊

A7. findNearestNode 應返回離建築最近的人行道節點

A8. updateCells 應在道路變更後正確更新局部路網

A9. 鐵路+道路交叉格應生成 level_crossing 邊
    - railType !== NONE && roadType !== NONE 的格子
    - 人行道跨越鐵軌的邊標記為 level_crossing 類型

A10. findPath 經過平交道時路徑應包含 level_crossing 邊

A11. 公車站應生成 transit_stop 節點並連接到最近的人行道節點

A12. 火車站應生成 transit_stop 節點（複用 building_access 邏輯）
```

### Phase B: PedestrianManager（行人管理器）

**先寫測試 `PedestrianManager.test.ts`**：

```
B1. spawnPedestrian 應建立行人代理並設定路徑

B2. tick 應沿路徑移動行人
    - 每 tick 移動 PEDESTRIAN_SPEED * dt 距離

B3. 行人到達終點應標記 ARRIVED 並移除

B4. 超過動態上限 getMaxPedestrians(population) 時不應生成新行人
    - population=500 → 上限 50
    - population=20000 → 上限 1000

B5. 行人遇到紅燈應在斑馬線起點等待
    - 當 crosswalk 邊的紅綠燈為紅時，state = WAITING_SIGNAL

B6. 綠燈後行人繼續穿越斑馬線

B7. toJSON / fromJSON 應正確序列化還原

B8. 無法尋路時 spawnPedestrian 應返回 null

B9. 行人遇到平交道柵欄放下時應等待
    - isCrossingBlocked() 返回 true → state = WAITING_CROSSING

B10. 柵欄升起後行人繼續穿越鐵軌
    - isCrossingBlocked() 返回 false → state = WALKING

B11. WALK 模式應生成 FULL_WALK 行人（home → workplace）

B12. 路線池應包含 BUS 的 FIRST_MILE 和 LAST_MILE 路線

B13. 路線池應包含 RAIL 的 FIRST_MILE 和 LAST_MILE 路線

B14. DRIVE 模式不應產生任何步行路線

B15. 相同起終點的路線應聚合（count 累加），不重複

B16. 加權隨機抽樣應按 count 比例分布
    - count=200 的路線被抽中機率應約為 count=10 的 20 倍

B16. 裝飾行人應以 citizenId = -1、tripType = DECORATIVE 生成

B17. 裝飾行人數量不超過 getMaxPedestrians() * DECORATIVE_MAX_RATIO
```

### Phase C: 渲染（person.ts + PedestrianRenderer）

```
C1. buildPersonGeometry 應返回有效的 BufferGeometry
    - 有 position attribute
    - 有 color attribute
    - 頂點數 > 0

C2. PedestrianRenderer.build 應建立 InstancedMesh 並加入場景

C3. PedestrianRenderer.update 應根據行人資料設定 matrix 和 color

C4. 行人數為 0 時 mesh.count 應為 0

C5. 視距剔除：鏡頭外的行人不應加入渲染資料
    - 距離鏡頭 > CULL_RADIUS 的行人被過濾
    - 距離鏡頭 < CULL_RADIUS 的行人正常渲染

C6. Game.ts 整合測試（可在瀏覽器中目視驗證）
```

### Phase D: 通勤整合

```
D1. WALK 通勤：SimulationLoop 應呼叫 spawnPedestrian(home, workplace, FULL_WALK)

D2. 尖峰期開始時應建構 WalkingTripPool
    - WALK 市民產生 FULL_WALK 路線
    - BUS 市民產生 FIRST_MILE + LAST_MILE 路線
    - RAIL 市民產生 FIRST_MILE + LAST_MILE 路線
    - DRIVE 市民不產生路線

D3. 相同起終點路線應聚合，count 為使用人數

D4. 每 tick 從路線池加權隨機抽樣生成行人

D5. 相同路線的行人應共用 pathCache（只算一次 A*）

D6. 反向通勤（下班）應重建路線池（方向相反）

D7. 行人地理分布應與通勤數據一致
    - 熱門公車站周圍行人最多

D8. 非尖峰時段應呼叫 spawnDecorativeBatch 補充裝飾行人
```

---

## 7. 關鍵座標對齊表

確保行人渲染位置與現有渲染幾何精確對齊：

| 元素 | Y 高度 | XZ 位置 |
|------|--------|---------|
| 道路路面 | `ROAD_Y = 0.025` | 格子中心 |
| 人行道 | `SIDEWALK_Y = 0.028` | 道路外緣，寬 0.14 |
| 斑馬線 | `MARKING_Y = 0.052` | 距交叉口中心 `cwOffset = 0.35` |
| 停車線 | `MARKING_Y = 0.052` | 距交叉口中心 `stopOffset = 0.25` |
| 行人腳底 | `SIDEWALK_Y = 0.028` | 沿 SidewalkEdge 插值 |
| 行人穿越斑馬線 | `SIDEWALK_Y = 0.028` | crosswalk 邊，XZ 對齊斑馬線條紋 |
| 車輛 | `0.0` (底盤) | 車道中心線 |

**行人在 Three.js 中的 Y 位置固定為 `SIDEWALK_Y (0.028)`**，無論走在人行道或斑馬線上。
斑馬線的 `MARKING_Y (0.052)` 是地面標線的高度，行人的腳踩在路面上所以用 `SIDEWALK_Y`。

---

## 8. 效能考量

| 項目 | 策略 |
|------|------|
| 行人數量 | 動態上限 `clamp(population * 0.05, 50, 2000)`，依人口自動調整 |
| Draw Call | 1 次（單一 InstancedMesh） |
| 路網圖記憶體 | ~4 節點/道路格 × 200 格 = ~800 節點，極低 |
| A* 搜尋 | 節點少，每次 < 1ms |
| tick 更新 | 2,000 個行人的 lerp 仍然微不足道（簡單算術） |
| 視距剔除 | 只渲染鏡頭半徑 15 格內的行人，實際渲染量 200-400 個 |
| 裝飾行人 | 無需 A* 尋路，僅沿單一 edge 移動，成本極低 |
| InstancedMesh 容量 | 預分配 2,000 instances，GPU 輕鬆處理（geometry 僅 6 個 box） |

---

## 9. 未來擴展（不在本期範圍）

- 行走動畫（腿部擺動）：用 vertex shader 對腿部頂點做 sin 偏移
- 人群密度視覺化（ViewMode 新增 Pedestrian Density 模式）
- 行人碰撞避讓（agent 之間保持最小間距）
- 公車站/捷運站的行人上下車動畫
- 夜間行人亮度降低或加入手電筒光
