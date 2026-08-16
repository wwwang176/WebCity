# 大眾運輸系統 (Transport System)

WebCity 提供五種大眾運輸系統，市民會根據通勤條件自動選擇交通方式。

---

## 運輸類型

| 類型 | 站點造價 | 容量 | 速度 | 停靠時間 | 營運費/車 | 受壅塞影響 |
|------|---------|------|------|---------|---------|-----------|
| BUS (公車) | $100 | 50 | 2 格/tick | 2 ticks | $100 | 是 |
| METRO (地鐵) | $3000 | 200 | 3 格/tick | 2 ticks | $300 | 否 |
| RAIL (鐵路) | $2000 | 300 (客)/500 (貨) | 4 格/tick | 3 ticks | $400 | 否 |
| FERRY (渡輪) | $1500 | 100 | 0.375 格/tick | 6 ticks | $200 | 否 |
| AIRPORT (機場) | 見下方 | - | - | - | 見下方 | 否 |

---

## 交通模式選擇 (Mode Choice)

市民通勤時自動選擇最佳交通方式：

### 決策邏輯

```
1. 直線距離 ≤ 3 格 → 直接走路 (WALK)，不比較
2. 開車時間 = 距離 × (1 + 壅塞率)
3. 每一種大眾運輸的時間 = 走到站 + 等車 + 乘車 + 走到目的地
4. 比較時把走路那一段乘上「不情願權重」（見下）
5. 加權後最快的一種若 < 開車時間 × 1.5 → 搭它
6. 否則 → 開車 (DRIVE)
```

### 走路的兩個成本

**速度。** 開車是「一格一 tick」，走路慢得多：

```
走路速度（格/tick）= WALK_KMH (9) / DRIVE_REFERENCE_KMH (30)
```

`DRIVE_REFERENCE_KMH` 不是車速設定，改它不會讓車跑快跑慢 —— 它是把「走路 9 km/h」
換算成遊戲單位的分母，也就是「走路比開車慢幾倍」。它代表門到門的實際平均車速
（路口、轉彎、找車位都算在內），不是速限；壅塞那一項疊在它之上。

**不情願。** 同樣一分鐘，走的比坐的難熬。權重依教育程度而異：

| 教育程度 | 權重 | 不塞車時願意走 |
|---|---:|---:|
| 無 | 2.0 | 2 格 |
| 國小 | 1.6 | 3 格 |
| 高中 | 1.2 | 5 格 |
| 大學 | 0.8 | 走滿上限 |

低於 1 是刻意的：受過高等教育的人在意健康與環境，寧可走路，即使慢一點。整條階梯
因此跨過 1.0 ——「勉強忍受」與「主動選擇」是兩種態度，而蓋大學就是在把市民從前者
推向後者，反過來紓解壅塞。

這個遊戲沒有獨立的收入欄位，收入由教育推導，所以教育這一個軸同時代表知識與收入。

權重只用在**比較**。通勤統計與換工作門檻看的是實際花掉的時間 —— 混在一起的話，
通勤時間圖層上會出現一個沒有任何人真的花掉的數字。

### 步行到站的上限

| 運具 | 上限 | 理由 |
|---|---:|---|
| 公車 | 4 格 | 站密、班次疏、車慢 —— 不必也不值得走遠 |
| 渡輪 | 6 格 | 碼頭稀疏但船慢 |
| 捷運 / 火車 / 機場 | 8 格 | 快、班次密、站稀疏 |

這是「絕對走不到」的硬邊界，不是行為規則 —— 細部取捨由上面的時間與權重處理。

距離沿**人行道**量，不是直線。行人只在路口過馬路，所以對街的站牌在步行上可能很遠
（路口間距 8 格時，正對面那一格要走 7.44 格）。詳見 traffic-system.md。

### 交通模式

```
WALK  步行
DRIVE 開車
BUS   公車
METRO 地鐵
RAIL  鐵路
FERRY 渡輪
```

---

## 公車系統 (BusSystem)

### 特點

- 使用 LaneGraph 進行車道級路徑規劃
- 公車是交通模擬中的實際車輛，會受到壅塞影響
- 到站停靠 2 秒

### 路線規劃

1. 設定站點
2. 計算站到站之間的 LaneEdge 路徑
3. 產生公車車輛到交通模擬中

### 路線中斷

路線站點間道路中斷時，路線被暫停 (`suspended = true`)。

---

## 地鐵系統 (MetroSystem)

### 特點

- 地下運行，不受路面壅塞影響
- 容量最大 (200 乘客)
- 建設成本高 ($5000/站)

### 班距與擁擠

班距不是欄位，是算出來的：

```
整圈時間 = 路線總長 / 速度
班距     = 整圈時間 / 車輛數
每日運能 = 車輛數 × 每車座位 × (一天 tick 數 / 整圈時間)
載重率   = 常態載客量 / 每日運能
等車時間 = 班距 × 0.5 × 擁擠倍率
```

**加車同時買到兩件事**：班距變短，載重被稀釋 —— 等車時間降兩次。代價是每 tick 的
營運成本，所以「服務品質 vs 錢」是一個真的決定。

擁擠倍率是連續的：載重 0.8 以前不受影響，之後線性爬到 4 倍，1.5 就真的擠不上去
（那條路線對這個人不存在）。玩家會先看到通勤時間變長，才輪到有人上不了車。

「常態載客量」取「今天的累計人次」與「跨日平滑值」的較大者 —— 只看今天的話，每天
早上每條路線都是空的，擁擠代價傍晚才出現，隔天再歸零。

實作在 `core/transport/RouteLoad.ts`。三個使用處（單一運具、轉乘路線、可及性圖）
共用同一組函式 —— 各寫一次的話會靜靜地不一致。

---

## 鐵路系統 (RailSystem)

### 服務類型

| 類型 | 容量 | 用途 |
|------|------|------|
| PASSENGER (客運) | 300 | 載客 |
| FREIGHT (貨運) | 500 | 運貨，每列火車增加 10 貨物/tick |

### 外部連接

鐵路連接到地圖邊緣時可形成外部連接：
- 人口流入
- 貨物流入
- 貨物流出

### 路徑

火車沿軌道圖 (RailNetwork) 的 A* 路徑移動。

### 外部列車（External Trains）

當鐵軌延伸到地圖邊緣時，系統會自動偵測外部連線。外部列車從地圖邊界生成，沿軌道行駛至站點後返回。

#### 連線偵測

`RailSystem.updateExternalConnection()` 使用 BFS 從邊緣鐵軌格（有 inward flag 的邊界格）向內搜索，找出所有可從地圖邊緣到達的車站：

1. 掃描地圖四邊的格子，找到 `railType !== 0` 且具有 `hasInwardFlag()` 的邊界格
2. 從這些邊界格出發，透過 BFS 沿相鄰鐵軌格擴散
3. 若 BFS 可達任一車站 → 該站標記為 `externalStations`，`hasExternalConnection = true`

#### 外部連線效果

```
populationIn = max(1, 路線數 × 5)
goodsIn      = max(1, 路線數 × 10)
goodsOut     = max(1, 路線數 × 5)
```

這些數值影響人口流入與 FreightSystem 的貨物進出口。

#### 外部列車動畫

渲染端由 `TrainAnimator` 管理外部列車動畫，同時最多一列外部列車：

- 生成間隔：`EXTERNAL_TRAIN_INTERVAL = 12` 秒（首列加快，初始計時器為 6 秒）
- 車輛 ID 起始偏移：`EXTERNAL_TRAIN_ID = 900_000`
- 動畫流程：
  1. `RailSystem.getExternalTrainPath()` 取得從隨機邊界鐵軌格到隨機外部車站的 `RailNetwork.findPath()` 路徑
  2. `buildExternalPath()` 將路徑平滑化並串接為來回路徑（edge → station → edge）
  3. 動畫分三個階段（`ExternalTrainAnim.phase`）：`incoming` → `dwell`（停站等待）→ `outgoing`
  4. 行駛完畢後清除動畫，重設計時器

#### 軌道視覺延伸

鐵軌在地圖邊緣不會突然斷開。`TrackRenderer` 偵測邊界鐵軌格後，使用 `edgeExtensionStrips()` 將道碴、鐵軌、枕木向地圖外延伸 `EDGE_EXTEND = 0.5` 格，營造軌道通往外界的視覺效果。

#### 建造方式

玩家使用鐵軌工具拖曳到地圖邊緣外即可。`RailBuilder.buildTrack()` 呼叫 `extractOutOfBoundsEdge()` 偵測超出邊界的末端格，將路徑截斷至最後一個有效格，並為該格加上 `outwardFlag`（方向旗標指向地圖外側），供後續 `hasInwardFlag()` 偵測使用。

---

## 渡輪系統 (FerrySystem)

### 特點

- 只能在水域行駛
- 碼頭必須建在水域旁
- 使用 A* 水路尋路演算法

### 路徑快取

路線建立時預先計算水路路徑並快取，避免每 tick 重新尋路。

---

## 機場系統 (AirportSystem)

### 規模

三種獨立 InfraType（`airport_s` / `airport_m` / `airport_l`），各有獨立 buildingId。

| 規模 | InfraType | buildingId | 佔地 | 噪音 | 旅客/tick | 貨物/tick | 造價 | 營運費 |
|------|-----------|-----------|------|------|---------|---------|------|--------|
| SMALL | `airport_s` | 237 | 3×2 | 10 | 50 | 20 | $5,000 | $500 |
| MEDIUM | `airport_m` | 236 | 5×4 | 25 | 200 | 100 | $15,000 | $1,500 |
| LARGE | `airport_l` | 235 | 7×6 | 50 | 500 | 300 | $40,000 | $4,000 |

### 機場配置

- 左右雙 taxiway：左側=起飛入口（near threshold），右側=降落出口（near runway end）
- 跑道顏色與道路一致（`0x3a3a3a`），分隔線使用 `MeshBasicMaterial`（恆亮）
- L 機場為雙跑道配置，最多同時 2 架飛機
- 放置需鄰接道路，支援 R 鍵旋轉（0°/90°/180°/270°）
- 拆除使用標準 `multi_cell_infra` 路徑

### 效果

- 旅客帶來商業需求
- 貨物增加 FreightSystem 的外部貨物
- 產生噪音污染

### 飛機動畫 (AirplaneAnimator)

渲染端動畫，與 TrainAnimator / FerryAnimator 相同模式（逐幀 LERP，不靠 tick）。

#### 動畫階段（9 Phase）

```
approach → roll → roll_wait → taxi_in → dwell → pushback → taxi_out → takeoff_roll → climb
```

| Phase | 說明 | 速度 |
|-------|------|------|
| approach | 從高空下降，Hermite flare 著地 | 3.0 u/s |
| roll | 跑道全長減速（線性煞車至零） | 3.0 → 0 |
| roll_wait | 在 taxiway 入口暫停 1s | - |
| taxi_in | 右 taxiway 上行 → apron → gate（弧線轉彎） | 1.5 u/s |
| dwell | 停在 gate 等待 | 5s |
| pushback | 向右弧形倒車，機頭轉向 taxiway 方向 | 0.8 u/s |
| taxi_out | 正向穿過 apron → 左 taxiway 下行 → 入跑道（弧線轉彎） | 1.5 u/s |
| takeoff_roll | 跑道全長加速（ease-in），後段漸進抬頭 | 5.0 u/s |
| climb | cubic Bezier 弧線離地 → 恆定爬升率 | 3.0 u/s |

#### 高度曲線

- **降落 approach**：恆定下降率 + Hermite cubic flare（C1 連續，著地時斜率=0）
- **起飛 climb**：cubic Bezier 弧線（B(s) = h·s²(2-s)）+ 恆定爬升率，pitch 從 Bezier 切線取 atan2

#### 飛機模型

737 風格低多邊形客機，3 層 InstancedMesh：

| Mesh | Material | 用途 |
|------|----------|------|
| Body | MeshLambertMaterial | 機身+機翼+水平尾翼+引擎（隨機航空公司機身色） |
| VTail | MeshLambertMaterial | 垂直尾翼（獨立隨機尾翼色） |
| NavLights | MeshBasicMaterial | 導航燈紅/綠/白（閃爍：0.2s 亮 / 0.8s 暗） |

- 圓筒機身 + 蛋形機鼻（SphereGeometry scale 1.6x）+ upsweep 尾椎
- 後掠梯形機翼（root:tip = 7:1）
- S 機場飛機縮放 80%
- 每次 spawn 隨機配色（10 色機身 × 10 色尾翼）
- Gate 碰撞避免：同機場不選已佔用的 gate
- 夜間前照燈（隨 pitch 旋轉，2× 加長），無尾燈
- 支援機場旋轉（localToWorld 符合 Three.js Y 軸旋轉慣例）

#### 生成頻率

| 尺寸 | 間隔 | 最大同時 |
|------|------|---------|
| S | 35s | 1 架 |
| M | 25s | 1 架 |
| L | 18s | 2 架（雙跑道） |

---

## 多模式轉乘系統 (Multi-Modal Transfer)

> 多模式轉乘系統已獨立為 [transfer-system.md](transfer-system.md) — 涵蓋 TransferGraph、站對站快取、多模式路線搜尋、TransferTracker、chooseModeMultiModal、轉乘覆蓋 UI。

---

## 站點統計

每個站點追蹤乘客數據：

| 欄位 | 說明 |
|------|------|
| `passengers` | 當前等候乘客數 |
| `dailyRiders` | 今日累計搭乘人次 |
| `lastDayRiders` | 昨日搭乘人次 |
| `smoothedDailyRiders` | EMA 平滑的每日搭乘人次 |

---

## 路線路徑動畫

### 地鐵路徑 (MetroLinePath)

地鐵列車沿站對站的直線路徑移動：
- 2 站: A→B→A 往返（totalLength = 距離×2）
- 3+ 站: 完整環形 A→B→C→...→A
- 列車動畫使用 `advanceTrain()` 推進距離，到站時停留 `waitTime` 秒

### 鐵路路徑 (RailLinePath)

火車沿實際軌道座標移動（非直線）：
- 使用 `RailNetwork.findPath()` 回傳的逐格路徑
- 支援距離插值和朝向角計算

### 渡輪路徑 (FerryLinePath)

渡輪沿 A* 水路路徑移動：
- 預計算段長度和累積長度
- 支援距離插值（位置 + 朝向角）

### 地鐵隧道 (MetroTunnelPath)

地鐵隧道的幾何路徑：
- 站間使用中點控制點的曲線
- 隧道在 Y = -0.15 地面以下

---

## 路線渲染資料

### 路線顏色

| 系統 | 顏色 | 中斷顏色 |
|------|------|---------|
| BUS | #ff9800 (橙) | #666666 (灰) |
| METRO | #00bcd4 (青) | #666666 |
| RAIL | #ff5722 (深橙) | #666666 |
| FERRY | #0097a7 (深青) | #666666 |

### 路線 ID 偏移

為避免跨系統 ID 衝突，各系統使用不同的 ID 偏移：

| 系統 | 路線 ID 偏移 | 車輛 ID 偏移 |
|------|------------|------------|
| BUS | +10,000 | +100,000 |
| METRO | +20,000 | - |
| RAIL | +40,000 | +400,000 |
| FERRY | +50,000 | +500,000 |
| AIRPLANE | - | +800,000 |

---

## 壅塞對公車的影響

公車實際速度：
```
速度 = max(0.1, 1 - 壅塞率 × 0.5) × 基礎速度
```

其他大眾運輸（地鐵/鐵路/渡輪）不受壅塞影響。

---

## 路線結構

```typescript
TransportRoute {
  id: number;
  type: TransportType;
  stops: TransportStop[];
  vehicles: number;        // 配置車輛數
  operatingCost: number;   // 營運成本
  suspended?: boolean;     // 路線中斷
}
```

沒有 `frequency` 欄位：班距是「整圈時間 ÷ 車輛數」，在使用處算出來。存成欄位的話，
每個動到路線的地方都得記得重算，而加車那條路就漏過 —— 加車只把容量上限往上推，
等車一秒都沒有變短。

---

## 站點放置規則

### 通用規則

- 站點格子不能有道路（`roadType = 0`）
- 站點格子不能有建築（`buildingId = 0`）

### 特殊規則

| 站點類型 | 額外規則 |
|---------|---------|
| 公車站 | 必須有至少一個鄰接道路格 |
| 火車站 | 必須有鐵軌（`railType != 0`），道路可共存 |
| 地鐵站 | 通用規則 |
| 碼頭 | 必須緊鄰水域 |

### 容量判定

大眾運輸路線在以下情況被視為滿載：
```
dailyRiders 總和 ≥ 車輛數 × 單車容量
```
滿載路線不再作為新市民的可用選項。

---

## 可用路線搜尋

`findAvailableTransit()` 搜尋起訖點附近（步行範圍內）的大眾運輸路線：

1. 遍歷所有運輸系統的路線
2. 算出班距與載重率；擠不上去（載重 ≥ 1.5）的路線直接跳過
3. 找起點附近的站點（**沿人行道**的距離 ≤ 該運具的步行上限）
4. 找終點附近的站點
5. 計算環形路線上兩個方向的搭乘距離，取較短的
6. 估計時間 = **走到站 + 等車 + 乘車 + 走到目的地**，並記下其中走路佔多少

第 6 點曾經只回報乘車那一段。那個數字會直接跟開車時間比大小 —— 一條班距 40 tick、
站牌在五格外的公車，看起來會跟「門口就有、班班準點」一樣好，於是幾乎永遠贏過開車。
結果是實際派車的路徑對步行距離完全不收費。

「走路佔多少」要分開帶著，因為比較時要對走路多收一份不情願，回報時不能收。

---

## 高速公路外部連線 (Highway External Connection)

高速公路可延伸到地圖邊緣，建立與外部世界的車輛交通與貨物貿易連線。

### 建造方式

玩家使用道路工具將道路拖曳到地圖邊緣外：

1. `GridCursor` 允許游標超出地圖邊界 1 格（`// Allow 1 cell beyond edge`）
2. `RoadBuilder.buildRoad()` 呼叫 `extractOutOfBoundsEdge()` 偵測超出邊界的末端格
3. **僅 `RoadType.HIGHWAY` 類型會產生外部連線**，其他道路類型（一般道路、大道）即使拖到邊界外也會忽略超出的格子
4. 最後一個有效邊界格會被加上 `outwardFlag`（指向地圖外的方向旗標）
5. 鐵軌也支援相同的拖曳超出邊界機制（`RailBuilder.buildTrack()`）

### 連線偵測

`HighwayConnection.updateExternalConnection()` 每 60 tick 由 SimulationLoop 呼叫，掃描地圖四邊：

1. 檢查所有邊界格是否有 `RoadType.HIGHWAY`
2. 使用 `hasInwardFlag()` 確認該格有方向旗標指向地圖內側（過濾掉平行於邊界的高速公路）
3. 同時檢查地面層與高架層（`ElevationManager`），高架高速公路也能形成外部連線
4. 收集所有符合條件的格子到 `edgeHighwayCells`

### 外部連線效果

```
populationIn = max(1, 連線格數 × 3)
goodsIn      = max(1, 連線格數 × 8)
goodsOut     = max(1, 連線格數 × 5)
throughput   = 連線格數 × THROUGHPUT_PER_CONNECTION (30)
```

#### 配置常數（`HIGHWAY_EXTERNAL`）

| 常數 | 值 | 說明 |
|------|---|------|
| `THROUGHPUT_PER_CONNECTION` | 30 | 每個連線格的吞吐量 |
| `SPAWN_PER_100_POP` | 1 | 每 100 人口的外部車輛生成數 |
| `MAX_PER_TICK` | 3 | 每 tick 最大外部車輛生成數 |
| `CAP_RATIO` | 0.9 | 容量上限比例 |

### 視覺效果

道路在地圖邊緣的渲染會向外延伸 `EDGE_EXTEND = 0.5` 格（`RoadRenderer`），使高速公路不會在地圖邊界突然截斷，呈現通往外部世界的視覺效果。鐵軌同樣有 0.5 格的邊緣延伸（`TrackRenderer`）。

### 邊緣工具共用模組

道路與鐵軌的邊界偵測共用 `EdgeUtils`：

- `extractOutOfBoundsEdge(path, mapWidth, mapHeight)` — 檢測路徑末端是否超出地圖，回傳 `outwardFlag` 與截斷長度
- `hasInwardFlag(x, y, mapWidth, mapHeight, flags)` — 檢查邊界格的方向旗標是否指向地圖內部
- 方向旗標值：`NORTH=0b0001`, `SOUTH=0b0010`, `WEST=0b0100`, `EAST=0b1000`
