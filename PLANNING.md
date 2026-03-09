# 網頁版都市經營模擬遊戲 — 完整規劃書

## 1. 專案概述

### 1.1 專案名稱

暫定：**WebCity**（待定）

### 1.2 專案目標

開發一款基於網頁的都市經營模擬遊戲，參考 Cities: Skylines（1 & 2）與 SimCity（2013）的核心機制。玩家在一塊空地上自由規劃道路、劃設區域、管理經濟與交通，打造一座活生生的城市。

### 1.3 技術棧

| 項目 | 選擇 | 理由 |
|------|------|------|
| 語言 | TypeScript | 型別安全、大型專案維護性 |
| 打包工具 | Vite | 快速 HMR、原生 ESM |
| 3D 渲染 | Three.js | 成熟生態、Low Poly 風格適合 |
| UI 框架 | Preact 或 Solid | 輕量、不與遊戲迴圈衝突 |
| 測試框架 | Vitest | 與 Vite 原生整合、Jest 相容 API |
| 套件管理 | pnpm | 快速、節省磁碟空間 |
| 程式碼品質 | ESLint + Prettier | 統一風格 |
| 存檔機制 | IndexedDB | 支援大型地圖資料 |
| 音效 | Howler.js | 跨瀏覽器音效處理 |

### 1.4 開發方法論

- **TDD（測試驅動開發）**：所有 core 邏輯先寫測試再寫實作
- 邏輯層（core）與渲染層（renderer）完全分離
- core 模組禁止 import Three.js，確保可獨立測試

### 1.5 視覺風格

- **3D Low Poly** + 等角（Isometric）/ 俯視視角
- OrthographicCamera 模擬經典城市經營遊戲視角
- 建築用簡單幾何體 + 柔和配色
- 低面數模型：高辨識度、高效能、開發效率高

### 1.6 世界比例尺

- **1 格（Grid Cell）= 12 公尺 × 12 公尺**
- 預設地圖 60×60 格 = 720m × 720m（約 0.52 km²）
- 道路：1 格寬 ≈ 12m（含人行道的雙向兩線道）
- 建築高度參考：
  - 住宅低密度：3~8m（1~2 層）
  - 住宅高密度：12~36m（4~12 層）
  - 商業低密度：5~12m（1~3 層）
  - 商業高密度：14~34m（5~11 層）
  - 工業：5~12m（1~3 層，含煙囪可更高）
  - 辦公大樓：18~54m（6~18 層）
- 一層樓高 ≈ 3m

---

## 2. 系統架構

### 2.1 多線程架構

遊戲採用 Web Worker 多線程架構，避免模擬運算阻塞渲染。

```
┌─────────────────────────────────────────────────┐
│                  Main Thread                     │
│  ┌───────────┐  ┌────────────┐  ┌────────────┐ │
│  │  渲染引擎  │  │  UI / DOM  │  │  輸入處理   │ │
│  │  Three.js  │  │  面板/工具  │  │  滑鼠/鍵盤  │ │
│  │  Canvas    │  │  列/資訊   │  │  地圖操作   │ │
│  └───────────┘  └────────────┘  └────────────┘ │
│        ▲                                         │
│        │ 每幀讀取 SharedArrayBuffer              │
│        │ + 接收 postMessage 事件通知             │
└────────┼────────────────────────────────────────┘
         │
    ┌────┴───────────────────────────────────┐
    │     資料同步層 (SharedArrayBuffer)       │
    └────┬────────────┬────────────┬─────────┘
         │            │            │
   ┌─────┴──────┐ ┌──┴─────┐ ┌───┴────────────┐
   │ Simulation  │ │Traffic │ │  Pathfinding    │
   │   Worker    │ │ Worker │ │  Worker Pool    │
   │             │ │        │ │  (2~4 Workers)  │
   │- 經濟模擬   │ │- 車流   │ │- A* 路徑計算    │
   │- 人口成長   │ │- 壅塞   │ │- 批量路徑請求   │
   │- 建築生長   │ │- 路口   │ │- 按需分配      │
   │- 服務覆蓋   │ │  號誌   │ │                │
   │- RCI 平衡   │ │- 貨運   │ │                │
   └────────────┘ └────────┘ └────────────────┘
```

### 2.2 資料同步策略

**混合使用 SharedArrayBuffer + postMessage：**

- **SharedArrayBuffer**：用於高頻、固定結構的地圖資料
  - 地塊類型、區域類型、建築 ID、交通密度、地價、汙染值等
  - 主線程渲染時直接讀取，零拷貝、零延遲
  - 使用 Atomics 做讀寫協調

- **postMessage**：用於低頻的事件與指令
  - 玩家操作（建路、劃區、蓋建築）
  - 系統事件（建築升級通知、居民遷入/遷出、災害發生）

**注意事項：**
- 需設定 COOP/COEP HTTP headers 才能使用 SharedArrayBuffer
- Vite dev server 需配置對應 headers

### 2.3 模擬 Tick 與渲染幀脫鉤

```
主線程 (60fps)：每幀只做「讀取狀態 → 渲染」，永不等待模擬
Worker (獨立節奏)：每 250ms 跑一個 simulation tick
```

- 渲染永遠不會被模擬阻塞
- 模擬 tick 慢了頂多遊戲時間走慢，畫面依然流暢
- 玩家加速（1x / 2x / 3x）= 調整 tick 間隔（250ms / 125ms / 83ms）
- 暫停 = 停止發送 tick

### 2.4 記憶體佈局（SharedArrayBuffer）

```
格狀地圖 200×200 = 40,000 格

每格佔用固定 bytes：
  - terrainType:     Uint8   (1 byte)   // 0=平地, 1=水, 2=山, ...
  - zoneType:        Uint8   (1 byte)   // 0=無, 1=低住, 2=高住, 3=低商, 4=高商, 5=工業, 6=辦公
  - buildingId:      Uint16  (2 bytes)  // 指向建築表
  - roadFlags:       Uint8   (1 byte)   // bit flags: 上下左右連接
  - roadType:        Uint8   (1 byte)   // 0=無, 1=小路, 2=雙線, 3=四線, 4=六線, 5=高速
  - trafficDensity:  Uint8   (1 byte)   // 0~255 壅塞程度
  - landValue:       Uint8   (1 byte)   // 0~255 地價
  - pollution:       Uint8   (1 byte)   // 0~255 汙染程度
  - noiseLevel:      Uint8   (1 byte)   // 0~255 噪音
  - serviceCoverage: Uint8   (1 byte)   // bit flags: 電/水/消防/警察/醫療/教育
  - elevation:       Int8    (1 byte)   // -128~127 地形高度
  - reserved:        Uint8   (1 byte)   // 保留欄位
  ─────────────────────────────────────
  合計每格 12 bytes

總共：40,000 × 12 = 480 KB（非常小）
```

### 2.5 專案目錄結構

```
web-city/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
│
├── src/
│   ├── main.ts                    # 應用程式入口
│   │
│   ├── core/                      # 純邏輯層（TDD 主戰場）
│   │   ├── grid/
│   │   │   ├── Grid.ts            # 地圖網格資料結構
│   │   │   ├── GridQuery.ts       # 格子查詢工具
│   │   │   └── __tests__/
│   │   │
│   │   ├── road/
│   │   │   ├── RoadNetwork.ts     # 道路網路圖
│   │   │   ├── RoadBuilder.ts     # 建路/拆路邏輯
│   │   │   ├── Intersection.ts    # 交叉路口
│   │   │   ├── RoadUpgrade.ts     # 道路升級
│   │   │   └── __tests__/
│   │   │
│   │   ├── zone/
│   │   │   ├── ZoneManager.ts     # 區域劃設
│   │   │   ├── DensityRules.ts    # 密度由道路寬度決定
│   │   │   └── __tests__/
│   │   │
│   │   ├── building/
│   │   │   ├── BuildingGrowth.ts  # 建築生長條件
│   │   │   ├── BuildingUpgrade.ts # 建築等級 1→2→3
│   │   │   ├── BuildingTypes.ts   # 建築類型定義
│   │   │   └── __tests__/
│   │   │
│   │   ├── citizen/
│   │   │   ├── Citizen.ts         # 居民 agent
│   │   │   ├── Lifecycle.ts       # 出生→上學→工作→退休→死亡
│   │   │   ├── Happiness.ts       # 滿意度計算
│   │   │   ├── Migration.ts       # 遷入/遷出
│   │   │   ├── Education.ts       # 教育程度
│   │   │   └── __tests__/
│   │   │
│   │   ├── traffic/
│   │   │   ├── TrafficSimulation.ts  # 車流模擬
│   │   │   ├── Congestion.ts         # 壅塞計算
│   │   │   ├── Pathfinding.ts        # A* 路徑搜尋
│   │   │   ├── PathCost.ts           # 路徑成本（長度+壅塞+速限+舒適度）
│   │   │   ├── Parking.ts            # 停車系統
│   │   │   └── __tests__/
│   │   │
│   │   ├── transport/
│   │   │   ├── BusSystem.ts       # 公車路線與站點
│   │   │   ├── MetroSystem.ts     # 地鐵系統
│   │   │   ├── TramSystem.ts      # 電車/輕軌
│   │   │   ├── RailSystem.ts      # 鐵路/火車
│   │   │   ├── FerrySystem.ts     # 渡輪
│   │   │   ├── AirportSystem.ts   # 機場
│   │   │   ├── TaxiSystem.ts      # 計程車
│   │   │   └── __tests__/
│   │   │
│   │   ├── economy/
│   │   │   ├── RCIDemand.ts       # 住宅/商業/工業需求指標
│   │   │   ├── Budget.ts          # 市政預算
│   │   │   ├── Tax.ts             # 稅率設定
│   │   │   ├── LandValue.ts       # 地價計算
│   │   │   ├── GlobalMarket.ts    # 全球市場價格波動
│   │   │   ├── Unemployment.ts    # 失業率
│   │   │   └── __tests__/
│   │   │
│   │   ├── service/
│   │   │   ├── PowerGrid.ts       # 電力網路（發電廠+電線）
│   │   │   ├── WaterNetwork.ts    # 自來水網路（水廠+水管）
│   │   │   ├── Sewage.ts          # 汙水處理
│   │   │   ├── FireService.ts     # 消防（覆蓋範圍+出勤）
│   │   │   ├── PoliceService.ts   # 警察（覆蓋範圍→犯罪率）
│   │   │   ├── HealthService.ts   # 醫療（覆蓋範圍→健康度）
│   │   │   ├── Education.ts       # 教育設施（小學/高中/大學）
│   │   │   ├── GarbageService.ts  # 垃圾處理（垃圾車路線）
│   │   │   ├── DeathCare.ts       # 墓園/火葬場
│   │   │   ├── ServiceDispatch.ts # 服務車輛調度（受交通影響）
│   │   │   └── __tests__/
│   │   │
│   │   ├── utility/
│   │   │   ├── NetworkGraph.ts    # 通用網路連通性（BFS/DFS）
│   │   │   ├── PowerConnectivity.ts  # 電力連通
│   │   │   ├── WaterConnectivity.ts  # 水管連通
│   │   │   └── __tests__/
│   │   │
│   │   ├── district/
│   │   │   ├── District.ts        # 區域劃分
│   │   │   ├── Policy.ts          # 區域政策
│   │   │   ├── Specialization.ts  # 工業/商業特化、城市專精
│   │   │   └── __tests__/
│   │   │
│   │   ├── environment/
│   │   │   ├── Pollution.ts       # 汙染（地面/水/空氣）擴散
│   │   │   ├── NaturalResource.ts # 自然資源（礦/石油/森林/肥沃土地）
│   │   │   ├── Terrain.ts         # 地形
│   │   │   ├── WaterFlow.ts       # 水流模擬
│   │   │   ├── Climate.ts         # 氣候與季節
│   │   │   └── __tests__/
│   │   │
│   │   ├── disaster/
│   │   │   ├── DisasterTypes.ts   # 地震/龍捲風/海嘯/隕石/火災/冰雹
│   │   │   ├── WarningSystem.ts   # 預警系統
│   │   │   ├── Damage.ts          # 建築損毀與重建
│   │   │   └── __tests__/
│   │   │
│   │   ├── milestone/
│   │   │   ├── Milestone.ts       # 人口里程碑與解鎖
│   │   │   ├── GreatWorks.ts      # 偉大工程
│   │   │   └── __tests__/
│   │   │
│   │   └── simulation/
│   │       ├── SimulationLoop.ts  # 主模擬 tick 協調器
│   │       ├── GameState.ts       # 遊戲全域狀態
│   │       ├── GameClock.ts       # 遊戲時間（速度控制）
│   │       └── __tests__/
│   │
│   ├── workers/                   # Web Worker 入口
│   │   ├── simulation.worker.ts
│   │   ├── traffic.worker.ts
│   │   └── pathfinding.worker.ts
│   │
│   ├── renderer/                  # Three.js 渲染層
│   │   ├── SceneManager.ts        # 場景管理
│   │   ├── CameraController.ts    # 相機控制（平移/旋轉/縮放）
│   │   ├── GridRenderer.ts        # 地圖網格渲染
│   │   ├── RoadRenderer.ts        # 道路渲染
│   │   ├── BuildingRenderer.ts    # 建築渲染（Low Poly 模型）
│   │   ├── VehicleRenderer.ts     # 車輛渲染
│   │   ├── TerrainRenderer.ts     # 地形渲染
│   │   ├── OverlayRenderer.ts     # 疊加圖層（交通熱力圖、地價圖等）
│   │   ├── WeatherRenderer.ts     # 天氣視覺效果
│   │   └── LowPolyModels.ts       # Low Poly 模型工廠
│   │
│   ├── ui/                        # UI 面板
│   │   ├── Toolbar.ts             # 工具列（道路/區域/建築/拆除）
│   │   ├── InfoPanel.ts           # 資訊面板（選取建築/居民資訊）
│   │   ├── BudgetPanel.ts         # 預算面板
│   │   ├── RCIIndicator.ts        # RCI 需求指標條
│   │   ├── MiniMap.ts             # 小地圖
│   │   ├── SpeedControl.ts        # 遊戲速度控制
│   │   ├── OverlaySelector.ts     # 疊加圖層切換
│   │   └── DistrictPanel.ts       # 區域/政策管理面板
│   │
│   ├── input/                     # 輸入處理
│   │   ├── MouseHandler.ts        # 滑鼠事件
│   │   ├── KeyboardHandler.ts     # 鍵盤快捷鍵
│   │   ├── RoadDrawTool.ts        # 道路繪製工具
│   │   ├── ZonePaintTool.ts       # 區域塗刷工具
│   │   ├── BulldozeTool.ts        # 拆除工具
│   │   └── DistrictPaintTool.ts   # 區域劃分工具
│   │
│   ├── audio/                     # 音效
│   │   ├── AudioManager.ts
│   │   └── SoundEffects.ts
│   │
│   └── save/                      # 存檔系統
│       ├── SaveManager.ts         # IndexedDB 存取
│       └── Serialization.ts       # 遊戲狀態序列化/反序列化
│
├── tests/
│   ├── integration/               # 整合測試
│   │   ├── simulation.test.ts     # 完整 tick 測試
│   │   ├── traffic-economy.test.ts # 交通影響經濟
│   │   └── chain-reaction.test.ts  # 連鎖效應
│   └── helpers/                   # 測試工具
│       └── testUtils.ts
│
├── public/
│   └── assets/                    # 靜態資源
│       ├── models/                # 3D 模型（如有預製）
│       ├── textures/              # 貼圖
│       └── sounds/                # 音效檔案
│
└── docs/
    └── ...
```

---

## 3. 核心遊戲機制

### 3.1 道路與基礎建設

#### 3.1.1 道路類型

| 類型 | 車道數 | 速限 | 容量 | 允許最高密度 |
|------|--------|------|------|-------------|
| 鄉間小路 | 2 | 30 km/h | 低 | 低密度 |
| 雙線道 | 2 | 50 km/h | 中低 | 低密度 |
| 四線道 | 4 | 50 km/h | 中 | 高密度 |
| 六線道（大道） | 6 | 60 km/h | 高 | 高密度 |
| 高速公路 | 4~6 | 100 km/h | 極高 | 不可劃區 |
| 單行道 | 2~4 | 50 km/h | 中 | 依寬度 |

**關鍵機制：道路寬度決定周圍可發展的建築密度**（參考 SimCity）。

#### 3.1.2 道路功能

- 直線道路繪製
- 曲線道路繪製（Bezier 曲線）
- 道路交叉口自動生成
- 紅綠燈 / 圓環切換
- 高架橋與隧道（不同高度層）
- 道路原地升級（小路→大路）
- 行道樹道路變體（降噪、提升地價）
- 拆除與重建

#### 3.1.3 其他基礎建設

- 電線 / 電塔
- 水管（地下）
- 鐵路軌道
- 地鐵隧道

### 3.2 區域規劃

#### 3.2.1 區域類型

| 區域 | 低密度 | 高密度 | 說明 |
|------|--------|--------|------|
| 住宅（R） | 獨棟住宅 | 公寓/大樓 | 居民居住 |
| 商業（C） | 小商店 | 百貨/商場 | 提供商品與服務、工作 |
| 工業（I） | 小工廠 | 大型廠房 | 生產貨物、提供工作 |
| 辦公（O） | - | 辦公大樓 | 白領工作、低汙染 |

#### 3.2.2 規劃規則

- 只能在道路旁的格子劃設區域
- 密度上限由相鄰道路的寬度決定
- 道路升級後，周圍建築可隨之升級密度
- 劃設後建築不會立即出現，需滿足需求條件

#### 3.2.3 建築生長

建築生長條件：

1. 該區域類型有 RCI 需求
2. 有道路連接
3. 有電力供應
4. 有自來水供應
5. 符合密度條件

建築等級（1 → 2 → 3）升級條件：

- Level 1 → 2：基本服務覆蓋（電/水/教育）、地價達標
- Level 2 → 3：完整服務覆蓋、高地價、低犯罪、低汙染

不滿足條件時建築會降級或廢棄。

### 3.3 居民模擬（Agent-based）

#### 3.3.1 居民屬性

```
Citizen {
  id: number
  age: number                    // 0~100
  lifeStage: Baby | Child | Teen | Adult | Senior
  education: None | Elementary | HighSchool | University
  incomeLevel: Low | Medium | High
  happiness: 0~100
  health: 0~100
  homeId: BuildingId | null
  workplaceId: BuildingId | null
  commuteRoute: Route | null
}
```

#### 3.3.2 生命週期

```
出生 → 嬰兒(0~5) → 兒童(6~12, 小學) → 青少年(13~18, 高中)
→ 青年(19~22, 大學/就業) → 成人(23~65, 工作) → 退休(65+) → 死亡
```

- 教育程度影響可從事的工作類型與收入
- 大學畢業生傾向辦公區工作
- 未受教育者只能從事工業/低階商業工作

#### 3.3.3 每日行為

```
居住地 → 通勤（開車/搭大眾運輸/步行）→ 工作地
工作地 → 購物（商業區）→ 回家
```

每次移動都會產生交通流量。

#### 3.3.4 遷入 / 遷出

遷入吸引力公式（概念）：
```
attractiveness = 就業機會 + 服務覆蓋 + 地價 - 稅率 - 犯罪率 - 汙染 - 通勤時間
```

### 3.4 交通模擬

#### 3.4.1 微觀模擬

- 每輛車是獨立 agent
- 車輛在道路上移動，需煞車、加速、變換車道
- 到達目的地需尋找停車位

#### 3.4.2 路徑計算

使用 A* 演算法，路徑成本考量：
- 路段距離
- 目前壅塞程度
- 速限
- 紅綠燈等待時間
- 是否有收費站

#### 3.4.3 壅塞系統

```
每條路段有容量上限
目前車輛數 / 容量 = 壅塞率
壅塞率 > 80% → 速度開始下降
壅塞率 > 100% → 嚴重塞車
```

壅塞會即時回饋到路徑計算，車輛會嘗試繞路。

#### 3.4.4 連鎖效應

- 塞車 → 消防車延誤 → 火災擴大
- 塞車 → 通勤時間增加 → 居民不滿 → 遷出
- 塞車 → 貨物運輸延遲 → 商業供貨不足 → 商業衰退

#### 3.4.5 大眾運輸分流

居民選擇交通方式的決策：
```
if 大眾運輸路線可達 && 時間差 < 閾值:
    使用大眾運輸（不產生道路車流）
else:
    開車（產生道路車流）
```

#### 3.4.6 車道級連接圖（Lane Connection Graph）

目前的交通模擬使用 cell-level 路徑（cell key 陣列）加上橫向 lane offset，無法正確處理：
- 不同寬度道路銜接時的車道映射（2LINE → 4LINE）
- 十字路口內的轉彎車道分配
- 真實的換道動態（需要行進距離，非瞬間橫移）

**解決方案：Lane Connection Graph — 車道級有向圖**

##### 資料結構

```
ConnectionPoint {
  id: string
  position: {x, y}       // 世界座標
  tangent: {tx, ty}       // 切線方向（Bezier 用）
  cellKey: string         // 所屬格子
  lane: number            // 車道索引
  type: 'entry' | 'exit'  // 進入點 / 離開點
}

LaneEdge {
  from: ConnectionPoint   // 出發點
  to: ConnectionPoint     // 目標點
  bezierControl?: Point[] // 曲線控制點（十字路口轉彎用）
  length: number          // 弧長（constant-speed traversal 用）
  type: 'straight' | 'turn' | 'lane_change' | 'merge'
}
```

##### 連接規則

**直路段（同一 cell 內）：**
- 每條方向車道產生 1 個 entry + 1 個 exit
- entry.position = cell 邊緣（來向側），exit.position = cell 邊緣（去向側）
- 同方向相鄰 lane 之間有斜向 lane_change 邊（需行進距離，非瞬移）

**不同寬度道路銜接（如 2LINE → 4LINE）：**
- 2LINE 有 1 條方向車道，4LINE 有 2 條方向車道
- 2LINE.lane0.exit → 4LINE.lane0.entry（靠內側，主通道）
- 4LINE.lane1 為額外車道，可從 lane0 透過 lane_change 邊合流

**十字路口：**
- 每個入口車道 → 每個合法出口車道產生一條 turn 類型 LaneEdge
- 轉彎路徑用 Bezier 曲線（控制點根據進出方向自動計算）
- 4-way + 4-lane 路口：8 入口 × 3 方向 = 最多 24 條 turn 邊（可控）
- 6-lane 最壞情況：12 入口 × 3 方向 = 36 條（仍可控）

**換道（Lane Change）：**
- 同一 cell 內，lane_i.mid → lane_j.mid 的斜向邊
- 車輛換道需走完一段距離（更真實），非瞬間橫移
- 斜向邊長度 ≈ √(cell_length² + lane_offset²)

##### 兩階段路徑搜尋

```
Phase 1: Cell-level A*
  - 使用現有 RoadNetwork 圖（粗粒度）
  - 結果：cell key 陣列 ["0,0", "1,0", "2,0", ...]

Phase 2: Lane-level Refinement
  - 在 Phase 1 路線的 LaneEdge 子圖上搜尋
  - 決定每個 cell 使用哪條車道、何時換道
  - 結果：LaneEdge 序列（車輛實際行駛路徑）
```

##### Bezier 曲線處理

- 十字路口轉彎路徑使用三次 Bezier 曲線
- 控制點由進出方向自動生成（切線延伸）
- 需弧長參數化（arc-length parameterization）確保等速行駛
- 方案：預計算查找表（LUT），每條 turn 邊存 N 個等距采樣點

##### Worker 分工

- **Lane Graph 建構**：路網變動時在 Worker 中重建受影響區域的 LaneEdge
- **Lane-level Pathfinding**：在 Pathfinding Worker Pool 中執行 Phase 2 細化
- Cell-level A* 仍在現有 Worker 中執行

### 3.5 經濟系統

#### 3.5.1 RCI 需求

```
住宅需求 = f(就業機會, 城市吸引力) - 目前住宅供給
商業需求 = f(人口數, 消費力) - 目前商業供給
工業需求 = f(商業需要的貨物, 出口需求) - 目前工業供給
```

三者相互影響，形成動態平衡。

#### 3.5.2 稅收計算

稅收分為**所得稅**（住宅）和**營業稅**（商業/工業/辦公），各有獨立稅率。

**所得稅（住宅建築）：**

基於每位市民的 `incomeLevel` 計算：

```
每人稅額 = 基礎係數 × incomeLevel 加成 × 所得稅率

incomeLevel 加成：
  - LOW    × 1.0
  - MEDIUM × 1.5
  - HIGH   × 2.0

住宅建築總稅收 = Σ 該建築所有居民的個人稅額
```

calculateIncome 需統計每棟住宅建築內各 incomeLevel 居民數量，
居民的 `incomeLevel` 已存在於 `Citizen.incomeLevel`。

**營業稅（商業/工業/辦公建築）：**

基於建築的 `companyIncome` 計算：

```
companyIncome = 基礎營收 × 等級加成
  - Lv1: ×1.0
  - Lv2: ×1.5
  - Lv3: ×2.0

建築營業稅 = companyIncome × 營業稅率
```

`companyIncome` 為 BuildingType 新增欄位，代表該建築的基礎營收能力。
未來可受 landValue、交通便利度、貨運供應等動態因素影響。

**基礎營收參考值：**

| 類型 | Lv1 基礎營收 | Lv3 實際營收 |
|------|-------------|-------------|
| 低密商業 | 10 | 20 |
| 高密商業 | 40 | 80 |
| 工業 | 15 | 30 |
| 低密辦公 | 20 | 40 |
| 高密辦公 | 60 | 120 |

**UI 改動：**
- 稅率滑桿從 1 個改為 2 個（所得稅率 + 營業稅率）
- 建築面板顯示稅收計算明細

#### 3.5.3 市政預算

```
收入：
  - 所得稅（住宅，基於市民 incomeLevel）
  - 營業稅（商/工/辦，基於 companyIncome）
  - 服務費用（大眾運輸票價等）

支出：
  - 道路維護
  - 公共服務營運（消防/警察/醫療/教育/垃圾）
  - 大眾運輸營運
  - 公共設施維護（電廠/水廠）
  - 貸款利息
```

#### 3.5.4 地價

地價受以下因素影響：
- (+) 服務覆蓋範圍（消防/警察/醫療/教育）
- (+) 公園/綠地/水岸
- (+) 交通便利度
- (-) 汙染
- (-) 噪音（鄰近工業區/高速公路）
- (-) 犯罪率

#### 3.5.5 全球市場（參考 SimCity）

- 石油、礦物、農產品、電子產品有市場價格
- 價格會隨供需波動
- 工業特化城市可出口資源獲利
- 增加遊戲策略深度

### 3.6 公共服務

#### 3.6.1 電力系統

| 發電廠類型 | 成本 | 產電量 | 汙染 |
|-----------|------|--------|------|
| 風力發電 | 低 | 低 | 無 |
| 太陽能 | 中 | 中 | 無 |
| 燃煤電廠 | 中 | 高 | 高 |
| 天然氣電廠 | 中高 | 高 | 中 |
| 核能電廠 | 極高 | 極高 | 低（有災害風險） |

- 電力透過電線傳輸，需形成連通網路
- 道路旁的建築自動接入電網
- 電力不足 → 建築無法運作

#### 3.6.2 自來水系統

- 水廠（建在水源旁）+ 水管網路
- 排水管出口位置影響下游汙染
- 汙水處理廠降低水汙染

#### 3.6.3 覆蓋範圍型服務

消防/警察/醫療/教育都有覆蓋半徑，建築在範圍內才能享受服務。

**關鍵：服務車輛（消防車、救護車、垃圾車）的出勤路線受交通影響。** 塞車會導致服務延誤。

#### 3.6.4 服務指派（參考 CS2）

可將服務設施指派到特定區域（District），提升該區域的回應效率。

### 3.7 區域劃分與政策

#### 3.7.1 District 系統

玩家可自由畫出城市子區域，每個區域可設定：
- 獨立稅率
- 區域政策（如：禁止重工業、鼓勵回收、高密度禁令）
- 工業特化（農業/林業/礦業/石油，依自然資源）
- 商業特化（觀光商業/有機食品）

#### 3.7.2 城市專精（參考 SimCity）

整座城市可選擇發展方向：
- 採礦城：大量開採礦物出口
- 石油城：煉油與出口
- 科技城：大學+研發 → 高科技產業
- 觀光城：景點+旅館 → 觀光收入
- 賭博城：賭場 → 高收入但高犯罪
- 貿易城：貨運港 + 倉儲

### 3.8 環境系統

#### 3.8.1 汙染擴散

- 地面汙染：工業區產生，向周圍擴散
- 水汙染：汙水排放、工業廢水
- 空氣汙染：工業+高交通量
- 噪音汙染：道路（尤其高速公路）、工業區

汙染影響地價、居民健康、滿意度。

#### 3.8.2 自然資源

地圖上隨機分佈：
- 肥沃土地 → 農業
- 森林 → 林業
- 礦脈 → 採礦
- 石油 → 煉油

資源會隨開採逐漸耗盡。

#### 3.8.3 水流

- 河流有流向
- 可建水壩（發電 + 蓄水）
- 汙染物隨水流方向擴散

### 3.9 氣候與災害

#### 3.9.1 季節系統

- 四季循環，影響視覺與居民行為
- 冬天：暖氣需求增加（電力消耗 +）、居民減少外出
- 夏天：冷氣需求
- 依地圖氣候類型（溫帶/大陸/極地）有不同表現

#### 3.9.2 天然災害

| 災害 | 效果 |
|------|------|
| 地震 | 建築損毀、道路斷裂 |
| 龍捲風 | 路徑上建築摧毀 |
| 海嘯 | 沿海地區淹水 |
| 隕石 | 撞擊點周圍大範圍毀滅 |
| 森林火災 | 蔓延、需消防對應 |
| 冰雹 | 建築輕微損傷 |

災害可隨機發生，或由玩家觸發（沙盒模式）。

預警系統：建預警塔 + 疏散避難所 + 疏散路線規劃。

### 3.10 里程碑與進度

#### 3.10.1 人口里程碑

| 人口 | 解鎖 |
|------|------|
| 500 | 基礎服務（消防/警察）、公車 |
| 1,000 | 高密度區域、地鐵 |
| 2,500 | 工業特化、電車 |
| 5,000 | 城市專精、鐵路 |
| 10,000 | 機場、偉大工程 |
| 25,000+ | 進階政策、全部建築解鎖 |

#### 3.10.2 偉大工程（參考 SimCity）

需要大量資金與資源的超大型建築：
- 國際機場
- 太陽能農場
- 太空發射中心
- 超級體育場

完成後提供全城 buff。

---

## 4. 技術挑戰與解決方案

### 4.1 交通模擬效能

**挑戰：** 數千車輛即時路徑搜尋。

**方案：**
- 路徑搜尋交給 Pathfinding Worker Pool（2~4 workers 並行）
- 路網變動時用類似「路由表」的方式局部更新，而非全部重算
- 車輛移動模擬約每秒 4 次，渲染用插值平滑

### 4.2 道路編輯器

**挑戰：** 曲線道路、交叉口自動拼接、高架橋。

**方案：**
- 曲線用 Bezier 曲線離散化為路段
- 交叉口用模式匹配（T 字路口/十字路口/Y 字路口）自動判斷
- 高架用高度層概念，同一格可有不同高度的道路

### 4.3 大地圖渲染

**挑戰：** 200×200 格地圖 + 大量建築。

**方案：**
- 視錐剔除（Frustum Culling）
- LOD（Level of Detail）：遠處建築用更簡單幾何體
- InstancedMesh：相同模型用 GPU 實例化渲染
- 地形用單一大 mesh + vertex displacement

### 4.4 模擬平衡

**挑戰：** 經濟參數不好玩。

**方案：**
- 所有數值公式抽出為常數配置檔
- 開發者工具面板可即時調整參數
- 自動化測試模擬城市運行 N 個 tick，驗證不會崩盤

---

## 5. 不採用 TDD 的部分

| 部分 | 原因 | 驗證方式 |
|------|------|----------|
| Three.js 渲染 | 視覺輸出難以 assert | 肉眼 + 截圖比對 |
| UI 互動 | DOM 互動不是核心邏輯 | 手動測試 / 簡單 E2E |
| 音效 | 聽覺驗證 | 手動測試 |
| Worker 通訊 | 整合層面 | 整合測試 |

---

## 6. 開發階段

詳見 TODO.md。
