# 都市經營模擬遊戲 — 詳細 TODO LIST

> 開發方法：TDD（測試驅動開發）
> 標記說明：`[ ]` 未開始 | `[x]` 已完成
> 每個任務格式：先寫測試 → 紅燈 → 寫最小實作 → 綠燈 → 重構

---

## Phase 1：專案初始化與基礎建設

### 1.1 專案環境建置

- [x] 初始化 pnpm 專案（package.json）
- [x] 安裝核心依賴（TypeScript, Vite, Three.js, Preact/Solid）
- [x] 安裝開發依賴（Vitest, ESLint, Prettier）
- [x] 設定 tsconfig.json（strict mode, path alias）
- [x] 設定 vite.config.ts（含 COOP/COEP headers for SharedArrayBuffer）
- [x] 設定 vitest.config.ts
- [x] 設定 ESLint + Prettier 規則
- [x] 建立目錄結構（core/, renderer/, workers/, ui/, input/, audio/, save/）
- [x] 建立 index.html 入口
- [x] 建立 src/main.ts 入口
- [x] 驗證 `pnpm dev` 可正常啟動
- [x] 驗證 `pnpm test` 可正常執行

---

## Phase 2：地圖網格系統（Grid）

### 2.1 Grid 資料結構

- [x] **TEST**: 建立指定大小的網格（如 200×200），所有格子初始化為預設值
- [x] **TEST**: 用 (x, y) 座標查詢格子，回傳格子資料
- [x] **TEST**: 超出邊界的座標查詢回傳 null 或拋出錯誤
- [x] **TEST**: 設定格子屬性（terrainType, zoneType 等）
- [x] **TEST**: 批次查詢（取得一個矩形範圍內的所有格子）
- [x] **TEST**: 取得格子的相鄰格子（上下左右 / 含對角八方向）
- [x] 實作 Grid 類別
- [x] 實作 GridQuery 工具函式

### 2.2 SharedArrayBuffer 記憶體佈局

- [x] **TEST**: 建立 SharedArrayBuffer，每格 12 bytes，總大小正確
- [x] **TEST**: 透過 TypedArray 讀寫特定格子的特定屬性
- [x] **TEST**: 多個 TypedArray view 指向同一塊 buffer 能正確讀寫
- [x] 實作 GridBuffer 類別（封裝 SharedArrayBuffer 操作）

### 2.3 地形系統

- [x] **TEST**: 設定格子地形類型（平地/水/山/森林）
- [x] **TEST**: 設定格子高度值（elevation）
- [x] **TEST**: 水域格子不可建設
- [x] **TEST**: 查詢自然資源分佈（礦/石油/肥沃土地/森林）
- [x] 實作 Terrain 模組

---

## Phase 3：道路系統（Road）

### 3.1 基礎道路建設

- [x] **TEST**: 在兩點之間建一條直線道路，中間格子都變成道路
- [x] **TEST**: 道路格子記錄連接方向（上下左右 flags）
- [x] **TEST**: 不同道路類型有不同屬性（車道數/速限/容量/成本）
- [x] **TEST**: 在水域或山地上不可建路（除非高架/隧道）
- [x] **TEST**: 建路需要扣除資金，資金不足時失敗
- [x] 實作 RoadBuilder 模組

### 3.2 道路網路圖

- [x] **TEST**: 建路後自動加入路網圖（Graph），節點=交叉口/端點，邊=路段
- [x] **TEST**: 查詢兩點之間是否連通
- [x] **TEST**: 拆除道路後路網圖正確更新
- [x] **TEST**: 取得從 A 點到 B 點的所有可能路段
- [x] 實作 RoadNetwork 圖結構

### 3.3 交叉路口

- [x] **TEST**: 兩條道路交叉時，交叉格自動標記為交叉路口（intersection）
- [x] **TEST**: T 字路口正確識別（3 方向連接）
- [x] **TEST**: 十字路口正確識別（4 方向連接）
- [x] **TEST**: 交叉路口預設為紅綠燈模式
- [x] **TEST**: 可切換交叉路口為圓環模式
- [x] 實作 Intersection 模組

### 3.4 道路升級

- [x] **TEST**: 小路可升級為雙線道/四線道/六線道
- [x] **TEST**: 升級後道路屬性（車道數/速限/容量）正確更新
- [x] **TEST**: 升級需要費用差額
- [x] **TEST**: 升級後周圍區域的可發展密度上限隨之更新
- [x] 實作 RoadUpgrade 模組

### 3.5 曲線道路

- [x] **TEST**: 給定起點/控制點/終點，產生 Bezier 曲線離散化的格子序列
- [x] **TEST**: 曲線道路的格子正確記錄連接方向
- [x] **TEST**: 曲線道路與直線道路交叉時正確生成交叉口
- [x] 實作曲線道路邏輯

### 3.6 高架橋與隧道

- [x] **TEST**: 同一格可有不同高度層的道路
- [x] **TEST**: 不同高度層的道路不互相影響（不產生交叉口）
- [x] **TEST**: 高架橋建設成本高於平面道路
- [x] **TEST**: 隧道可穿越山地
- [x] 實作多高度層道路系統

---

## Phase 4：區域規劃（Zone）

### 4.1 區域劃設

- [x] **TEST**: 在道路旁的格子劃設住宅區（R）
- [x] **TEST**: 非道路旁的格子不可劃設區域
- [x] **TEST**: 支援批次劃設（塗刷工具，框選一個範圍）
- [x] **TEST**: 取消已劃設的區域
- [x] **TEST**: 已有建築的格子不可重新劃設（需先拆除）
- [x] 實作 ZoneManager 模組

### 4.2 密度規則

- [x] **TEST**: 小路/雙線道旁只能發展低密度
- [x] **TEST**: 四線道以上才能發展高密度
- [x] **TEST**: 道路升級後，已劃設區域的密度上限自動更新
- [x] **TEST**: 查詢某格的最大允許密度
- [x] 實作 DensityRules 模組

### 4.3 區域類型

- [x] **TEST**: 支援所有區域類型：低住宅/高住宅/低商業/高商業/工業/辦公
- [x] **TEST**: 每種區域類型有對應的建築池（可生長的建築清單）
- [x] **TEST**: 辦公區只有高密度，無低密度變體
- [x] 實作區域類型定義

---

## Phase 5：建築系統（Building）

### 5.1 建築生長

- [x] **TEST**: 有 RCI 需求 + 有道路 + 有電 + 有水 → 建築生長
- [x] **TEST**: 缺少任一條件 → 不生長
- [x] **TEST**: 生長的建築類型與區域類型匹配
- [x] **TEST**: 低密度區域只長低密度建築
- [x] **TEST**: 每個 simulation tick 有機率在符合條件的空格生長建築
- [x] 實作 BuildingGrowth 模組

### 5.2 建築升級

- [x] **TEST**: Level 1 建築滿足升級條件（服務覆蓋、地價）→ 升級為 Level 2
- [x] **TEST**: Level 2 → Level 3 需要更高條件
- [x] **TEST**: 條件不再滿足時降級
- [x] **TEST**: 升級後稅收增加
- [x] **TEST**: 升級後建築外觀 ID 改變（供渲染層使用）
- [x] 實作 BuildingUpgrade 模組

### 5.3 建築廢棄

- [x] **TEST**: 長期缺電/缺水/高犯罪 → 建築廢棄
- [x] **TEST**: 廢棄建築不產生稅收
- [x] **TEST**: 廢棄建築降低周圍地價
- [x] **TEST**: 條件改善後廢棄建築可恢復或被拆除重建
- [x] 實作建築廢棄邏輯

### 5.4 建築類型定義

- [x] **TEST**: 每種建築有：名稱、大小、居住/工作人數、稅收、需求類型
- [x] **TEST**: 住宅建築提供居住容量
- [x] **TEST**: 商業建築提供工作崗位 + 商品
- [x] **TEST**: 工業建築提供工作崗位 + 生產貨物
- [x] **TEST**: 辦公建築提供高教育工作崗位
- [x] 實作 BuildingTypes 模組

---

## Phase 6：居民模擬（Citizen）

### 6.1 居民基本屬性

- [x] **TEST**: 建立居民，有 id/age/education/income/happiness/health
- [x] **TEST**: 居民有 homeId 和 workplaceId
- [x] **TEST**: 新遷入居民需要找到住所
- [x] 實作 Citizen 資料結構

### 6.2 生命週期

- [x] **TEST**: 居民每個 tick 老化
- [x] **TEST**: 嬰兒(0-5) → 兒童(6-12) → 青少年(13-18) → 成人(19-65) → 老人(65+)
- [x] **TEST**: 兒童需要小學，覆蓋範圍內有小學 → 教育程度提升
- [x] **TEST**: 青少年需要高中
- [x] **TEST**: 青年可選擇上大學（需有大學設施）
- [x] **TEST**: 老人死亡後需要墓園/火葬場處理
- [x] **TEST**: 成年居民可生育（產生新居民）
- [x] 實作 Lifecycle 模組

### 6.3 就業系統

- [x] **TEST**: 成年居民自動搜尋工作
- [x] **TEST**: 教育程度決定可從事的工作類型
- [x] **TEST**: 大學畢業 → 優先找辦公區工作
- [x] **TEST**: 未受教育 → 只能工業/低階商業
- [x] **TEST**: 工作距離影響選擇（近的優先）
- [x] **TEST**: 失業 → 降低滿意度
- [x] 實作就業匹配邏輯

### 6.4 滿意度計算

- [x] **TEST**: 滿意度受正面因素影響：低通勤時間、服務覆蓋、低稅率、高地價
- [x] **TEST**: 滿意度受負面因素影響：高通勤時間、汙染、噪音、犯罪、失業
- [x] **TEST**: 滿意度極低 → 觸發遷出
- [x] **TEST**: 全城平均滿意度影響遷入率
- [x] 實作 Happiness 模組

### 6.5 遷入 / 遷出

- [x] **TEST**: 有空房 + 有工作機會 + 城市吸引力高 → 每 tick 有機率遷入
- [x] **TEST**: 遷入居民隨機分配年齡、教育、收入
- [x] **TEST**: 滿意度持續低 → 居民遷出，釋放住房和工作崗位
- [x] **TEST**: 遷入/遷出影響人口數
- [x] 實作 Migration 模組

---

## Phase 7：交通模擬（Traffic）

### 7.1 路徑搜尋（Pathfinding）

- [x] **TEST**: A* 演算法在路網圖上找最短路徑
- [x] **TEST**: 無路可達時回傳 null
- [x] **TEST**: 路徑成本 = 距離 × 壅塞係數 × (1/速限)
- [x] **TEST**: 紅綠燈路口增加等待成本
- [x] **TEST**: 單行道限制方向
- [x] **TEST**: 高架橋/隧道不與平面道路互通（除了匝道）
- [x] 實作 Pathfinding 模組

### 7.2 車流模擬

- [x] **TEST**: 車輛沿路徑移動，每 tick 更新位置
- [x] **TEST**: 車輛到達路段終點時進入下一路段
- [x] **TEST**: 前方有車時減速或停止
- [x] **TEST**: 路段車輛數增加 → trafficDensity 值上升
- [x] **TEST**: 車輛到達目的地後從路網移除
- [x] 實作 TrafficSimulation 模組

### 7.3 壅塞計算

- [x] **TEST**: 路段壅塞率 = 目前車輛數 / 容量
- [x] **TEST**: 壅塞率 > 0.8 → 車速下降
- [x] **TEST**: 壅塞率 > 1.0 → 車速趨近於零（嚴重塞車）
- [x] **TEST**: 壅塞即時回饋到路徑計算（新車輛繞路）
- [x] **TEST**: 壅塞隨車輛駛離自動緩解
- [x] 實作 Congestion 模組

### 7.4 停車系統 ✅

- [x] **TEST**: 車輛到達目的地附近需找停車位
- [x] **TEST**: 商業/辦公建築有有限的停車位（workers/2 = 停車位）
- [x] **TEST**: 停車位不足 → 車輛繞行 → 增加交通量（overflow count 追蹤）
- [x] 實作 Parking 模組 ✅ ParkingSystem 類別（register/tryPark/release/findNearby/overflow）

### 7.5 貨運物流 ✅

- [x] **TEST**: 工業區生產貨物 → 需要運輸到商業區 (單元測試)
- [x] **TEST**: 貨車使用路網，與一般車輛競爭道路容量 (單元測試)
- [x] **TEST**: 貨運路徑考慮壅塞 (單元測試)
- [x] **TEST**: 商業區長期缺貨 → 商業衰退 (單元測試)
- [x] 實作貨運邏輯（測試層面）
- [x] 整合到 SimulationLoop（貨物生產→運輸→消費循環）✅ FreightSystem.tick() 每 tick 執行
- [x] 整合到 GameState ✅ freight: FreightSystem 加入 GameState

### 7.6 交通 Worker ✅

- [x] 建立 traffic.worker.ts，在 Worker 中運行交通模擬 ✅ pathfinding.worker.ts 含 BFS 路徑搜尋
- [x] 建立 pathfinding.worker.ts，Worker Pool 架構 ✅ src/workers/pathfinding.worker.ts
- [x] **TEST**: 主線程發送路徑請求 → Worker 回傳結果 ✅ workers.test.ts FIND_PATH protocol
- [x] **TEST**: 多個路徑請求可並行處理 ✅ workers.test.ts 10 concurrent requests with unique ids
- [x] 實作 Worker 通訊協定 ✅ SET_GRID/FIND_PATH → READY/PATH_RESULT
- [x] 將目前主線程 BFS 路徑搜尋搬到 PathWorker（PLANNING.md 已規劃）✅ bfsRoadPath in pathfinding.worker.ts

### 7.7 車道級連接圖（Lane Connection Graph）

#### Phase A — LaneGraph 資料結構 + 從 Grid 建構 ✅

- [x] **TEST**: ConnectionPoint 包含 id/position/tangent/cellKey/lane/type 屬性
- [x] **TEST**: LaneEdge 包含 from/to/bezierControl/length/type 屬性
- [x] **TEST**: 直路段（2LINE）每條方向車道產生 1 entry + 1 exit ConnectionPoint
- [x] **TEST**: 4LINE 產生 2 entry + 2 exit（每方向 2 車道）
- [x] **TEST**: 6LINE 產生 3 entry + 3 exit（每方向 3 車道）
- [x] **TEST**: 同方向相鄰 lane 之間有 lane_change 類型斜向邊
- [x] **TEST**: 不同寬度道路銜接（2LINE→4LINE）：lane0.exit→lane0.entry 正確映射，lane1 為額外車道
- [x] **TEST**: 十字路口產生 turn 類型邊：每個入口車道→每個合法出口車道
- [x] **TEST**: T 字路口只產生 2 個出口方向的 turn 邊（非 3 個）
- [x] **TEST**: 建路後 LaneGraph 自動更新受影響區域
- [x] **TEST**: 拆路後 LaneGraph 正確移除相關 ConnectionPoint 和 LaneEdge
- [x] 實作 `src/core/traffic/LaneGraph.ts`

#### Phase B — Bezier 曲線工具 ✅

- [x] **TEST**: 給定進出方向，自動生成三次 Bezier 控制點
- [x] **TEST**: 直行（同方向進出）控制點在 cell 中心兩側
- [x] **TEST**: 90° 轉彎控制點形成平滑弧線
- [x] **TEST**: 弧長參數化：等距采樣 N 點，誤差 < 1%
- [x] **TEST**: 在 Bezier 曲線任意 t 值取得 position 和 tangent
- [x] 實作 `src/core/traffic/BezierPath.ts`

#### Phase C — 車輛沿 LaneEdge 移動 ✅

- [x] **TEST**: 車輛路徑改為 LaneEdge 序列（取代 cell key 陣列）
- [x] **TEST**: 車輛 pathPos 沿 LaneEdge.length 累加，跨邊時切換到下一條 LaneEdge
- [x] **TEST**: 直路段車輛位置 = 線性插值（entry→exit）
- [x] **TEST**: 轉彎車輛位置 = Bezier 曲線插值（弧長參數化）
- [x] **TEST**: 換道車輛位置 = lane_change 邊的斜向插值
- [x] **TEST**: 前車先動排序保留（按 LaneEdge 序列進度排序）
- [x] **TEST**: 同 LaneEdge 上的碰撞偵測（gap 計算基於弧長距離）
- [x] **TEST**: 速度限制依當前 LaneEdge 所屬 cell 的 speedLimit
- [x] **TEST**: 紅綠燈在十字路口 entry ConnectionPoint 處攔停
- [x] 修改 `TrafficSimulation.ts`：Vehicle 改用 LaneEdge[] path

#### Phase D — Lane-level Pathfinding ✅

- [x] **TEST**: Phase 1 cell-level A* 回傳 cell 路線後，Phase 2 在 LaneEdge 子圖上細化
- [x] **TEST**: 細化結果為 LaneEdge 序列，涵蓋每個 cell 的具體車道選擇
- [x] **TEST**: 目標車道偏好：右轉提前靠右、左轉提前靠左 ✅ **BUG-214**
      主執行緒與工人執行緒兩套 A* 都已套用（共用 `traffic/TurnLane.ts`），17 支測試
- [x] **TEST**: 換道代價 > 直行代價（避免不必要換道）— `LANE_CHANGE_COST = 0.15`，加法而非乘法
- [ ] ~~**TEST**: 無法在指定距離內完成換道 → 選擇替代路線~~
      → 建議關閉：換道邊是格內單階、整條車道路徑由 A* 事前規劃，
        回傳的路徑依定義即換道可行；本專案沒有「行進中才決定車道」的架構。
        詳見 BUGS.md 第七十五輪。若日後把 BUG-214 改成硬性限制，此項才會重新成立
- [x] 修改 `Pathfinding.ts`：新增 refineLanePath() 階段

#### Phase E — 渲染整合 ✅

- [x] 車輛位置/朝向改用 LaneEdge Bezier 插值（平滑轉彎，消除 90° 瞬轉）
- [x] 換道動畫：車輛沿 lane_change 邊斜向滑動（非瞬間橫移）
- [x] VehicleRenderer 的 heading 改用 Bezier tangent（轉彎時車頭朝向曲線切線方向）
- [ ] 視覺驗收：車輛在十字路口轉彎平滑、換道自然

#### Phase F — Worker 整合 ✅

- [x] Lane Graph 建構搬到 Worker（路網變動時局部重建）
- [x] Lane-level pathfinding 搬到 Pathfinding Worker Pool
- [x] **TEST**: Worker 回傳 LaneEdge 序列（序列化/反序列化正確）
- [x] **TEST**: 路網變動 → Worker 重建 LaneGraph → 新車輛使用更新後的圖

---

## Phase 8：大眾運輸（Transport）

### 8.1 公車系統 ✅ 已整合到 SimulationLoop + GameState

- [x] **TEST**: 建立公車站
- [x] **TEST**: 繪製公車路線（連接多個站點）
- [x] **TEST**: 公車沿路線行駛，在站點停靠
- [x] **TEST**: 公車使用道路，受壅塞影響
- [x] **TEST**: 居民可選擇搭公車（不產生私家車流量）
- [x] **TEST**: 公車有營運成本
- [x] 實作 BusSystem 模組
- [x] 整合到 SimulationLoop（每 tick 更新公車位置/乘客）✅ bus.tick() + getOperatingCost() 計入預算
- [x] UI：公車站放置工具、路線繪製工具 ✅ bus_stop tool + Transit toolbar group

### 8.2 地鐵系統 ✅ 已整合到 SimulationLoop + GameState

- [x] **TEST**: 建立地鐵站和地下路線
- [x] **TEST**: 地鐵不受地面交通影響
- [x] **TEST**: 居民可步行到地鐵站 → 搭地鐵 → 步行到目的地
- [x] **TEST**: 地鐵有容量上限
- [x] **TEST**: 地鐵有建設成本和營運成本
- [x] 實作 MetroSystem 模組
- [x] 整合到 SimulationLoop ✅ metro.tick() + getOperatingCost()
- [x] UI：地鐵站放置、地下路線繪製 ✅ metro_station tool

### 8.3 電車 / 輕軌 ✅ 已整合到 SimulationLoop + GameState

- [x] **TEST**: 電車在路面軌道上行駛
- [x] **TEST**: 軌道佔用道路空間
- [x] **TEST**: 電車有固定路線和站點
- [x] 實作 TramSystem 模組
- [x] 整合到 SimulationLoop ✅ tram.tick() + getOperatingCost()
- [x] UI：電車軌道/站點放置 ✅ tram_stop tool

### 8.4 鐵路 ✅ 已整合到 SimulationLoop + GameState

- [x] **TEST**: 建鐵軌和火車站
- [x] **TEST**: 火車可載客和載貨
- [x] **TEST**: 城際連線（外部人口/貨物進出）
- [x] 實作 RailSystem 模組
- [x] 整合到 SimulationLoop ✅ rail.tick() + getOperatingCost()
- [x] UI：鐵軌/火車站放置 ✅ train_station tool

### 8.5 渡輪 ✅ 已整合到 SimulationLoop + GameState

- [x] **TEST**: 在水域設碼頭
- [x] **TEST**: 渡輪在碼頭間行駛
- [x] 實作 FerrySystem 模組
- [x] 整合到 SimulationLoop ✅ ferry.tick() + getOperatingCost()
- [x] UI：碼頭放置 ✅ ferry_dock tool

### 8.6 機場 ✅ 已整合到 SimulationLoop + GameState

- [x] **TEST**: 建機場（需要大面積空地）
- [x] **TEST**: 機場帶來外部觀光客和貨物
- [x] **TEST**: 機場產生噪音汙染
- [x] **TEST**: 機場需達人口里程碑才解鎖
- [x] 實作 AirportSystem 模組
- [x] 整合到 SimulationLoop ✅ airport.tick() + getOperatingCost()
- [x] UI：機場放置 ✅ airport tool (requires pop >= 10000)

### 8.7 計程車 — 已移除

> Taxi 系統已從專案中完全移除（TaxiSystem.ts、buildingId 236、ViewMode.TAXI_FOCUS、相關 UI/渲染/測試）。舊存檔中的 taxi_stand (236) 會在載入時自動清除。

### 8.8 居民交通方式選擇 ✅ 已整合到通勤邏輯

- [x] **TEST**: 居民比較開車 vs 大眾運輸的時間/成本/舒適度
- [x] **TEST**: 大眾運輸可達且時間差小 → 選擇大眾運輸
- [x] **TEST**: 大眾運輸覆蓋不足 → 開車
- [x] **TEST**: 步行距離內 → 步行（不產生車流）
- [x] 實作交通方式決策邏輯
- [x] 整合到通勤邏輯（spawnCommuteVehicles 中加入交通方式判斷）✅ chooseMode + getAvailableTransit 整合

---

## Phase 9：經濟系統（Economy）

### 9.1 RCI 需求指標

- [x] **TEST**: 住宅需求 = f(就業機會, 吸引力) - 目前住宅供給
- [x] **TEST**: 商業需求 = f(人口, 消費力) - 目前商業供給
- [x] **TEST**: 工業需求 = f(商業貨物需求, 出口需求) - 目前工業供給
- [x] **TEST**: 三者相互影響（建大量住宅 → 商業需求上升）
- [x] **TEST**: 需求值介於 -100 ~ +100
- [x] 實作 RCIDemand 模組

### 9.2 稅收系統

- [x] **TEST**: 每 tick 根據建築數量和等級計算稅收
- [x] **TEST**: 可分區域/分密度設定不同稅率
- [x] **TEST**: 稅率過高 → 居民/商家遷出
- [x] **TEST**: 稅率過低 → 吸引遷入但收入不足
- [x] 實作 Tax 模組
- [x] 移除 `taxRevenue` 死欄位，改為按人口/工人數計算收入
- [x] 高密度建築容量 ×4（Res 80/160/320, Com 80/160/320, Office 160/320/600）

### 9.6 稅收重構：所得稅 + 營業稅分離

- [x] **TEST**: 住宅建築所得稅 = Σ 每位居民(基礎係數 × incomeLevel 加成) × 所得稅率
- [x] **TEST**: incomeLevel 加成：LOW ×1.0, MEDIUM ×1.5, HIGH ×2.0
- [x] **TEST**: 同一棟住宅內不同 incomeLevel 居民各自計算稅額
- [x] **TEST**: 商/工/辦營業稅 = companyIncome × 等級加成(Lv1×1.0/Lv2×1.5/Lv3×2.0) × 營業稅率
- [x] **TEST**: BuildingType 新增 `companyIncome` 欄位（基礎營收）
- [x] **TEST**: 所得稅率和營業稅率獨立設定，互不影響
- [x] **TEST**: 調高所得稅率 → 居民 happiness 下降 → 遷出增加
- [x] **TEST**: 調高營業稅率 → 商業/工業/辦公 demand 下降
- [x] 修改 `calculateIncome()`：住宅掃市民 incomeLevel，商/工/辦用 companyIncome
- [x] 修改 `GameState.taxRates`：新增 `business` 稅率欄位（原 `residential` 改為所得稅率）
- [x] UI：稅率滑桿從 1 個改為 2 個（所得稅率 + 營業稅率）
- [x] UI：建築面板顯示稅收計算明細（居民人頭稅 / 營業稅額）

### 9.3 市政預算

- [x] **TEST**: 收入 = 各類稅收總和 + 服務費
- [x] **TEST**: 支出 = 道路維護 + 服務營運 + 貸款利息
- [x] **TEST**: 收支平衡計算
- [x] **TEST**: 赤字累積 → 可貸款（有利息）
- [x] **TEST**: 長期赤字 → 需要削減服務或加稅
- [x] 實作 Budget 模組

### 9.4 地價系統

- [x] **TEST**: 地價受服務覆蓋正面影響
- [x] **TEST**: 地價受公園/水岸正面影響
- [x] **TEST**: 地價受汙染/噪音/犯罪負面影響
- [x] **TEST**: 地價影響建築升級和居民收入層級
- [x] **TEST**: 地價每 tick 根據周圍因素動態更新
- [x] 實作 LandValue 模組

### 9.5 全球市場 ✅

- [x] **TEST**: 資源（石油/礦物/農產品/電子）有市場價格
- [x] **TEST**: 市場價格隨遊戲時間波動
- [x] **TEST**: 城市可出口資源（收入）
- [x] **TEST**: 城市可進口資源（支出）
- [x] **TEST**: 供需影響價格趨勢
- [x] 實作 GlobalMarket 模組 ✅ ResourceType enum + 價格波動/供需/均值回歸/序列化，已整合到 GameState + SimulationLoop

---

## Phase 10：公共服務（Service）

### 10.1 電力系統

- [x] **TEST**: 建發電廠，有發電量和汙染值
- [x] **TEST**: 電力透過道路 / 電線傳輸（BFS 連通性）
- [x] **TEST**: 建築在電網範圍內才有電
- [x] **TEST**: 電力需求 > 供給 → 部分建築斷電
- [x] **TEST**: 不同發電廠類型：風力/太陽能/燃煤/天然氣/核能
- [x] 實作 PowerGrid 模組

### 10.2 自來水系統

- [x] **TEST**: 水廠建在水源旁，有產水量
- [x] **TEST**: 水透過水管傳輸（BFS 連通性）
- [x] **TEST**: 建築在水網範圍內才有水
- [x] **TEST**: 水需求 > 供給 → 部分建築缺水
- [x] 實作 WaterNetwork 模組

### 10.3 汙水處理

- [x] **TEST**: 排水管出口排放汙水
- [x] **TEST**: 汙水影響下游水質（未處理汙水產生 ground 汙染）
- [x] **TEST**: 汙水處理廠降低汙染
- [x] 實作 Sewage 模組
- [x] 整合到 SimulationLoop（汙水汙染連動 updatePollution）

### 10.4 通用網路連通性

- [x] **TEST**: BFS/DFS 判斷網路是否連通
- [x] **TEST**: 新增/刪除節點後連通性正確更新
- [x] **TEST**: 效能：大型網路（10,000+ 節點）在合理時間內完成
- [x] 實作 NetworkGraph 模組（電力/水管共用）

### 10.5 消防服務

- [x] **TEST**: 消防局有覆蓋半徑
- [x] **TEST**: 火災發生時消防車出動
- [x] **TEST**: 消防車走路網，受壅塞影響 ✅ ServiceDispatch FIRE_TRUCK
- [x] **TEST**: 到達時間影響火災損失
- [x] **TEST**: 覆蓋範圍外 → 火災失控 → 建築損毀
- [x] 實作 FireService 模組
- [x] UI：基礎設施面板新增消防局按鈕
- [x] 整合到 SimulationLoop（每 tick 更新覆蓋範圍、出勤邏輯）
- [x] 火災損毀建築應標記為焦黑狀態（BURNED），而非直接移除
- [x] 渲染層：焦黑建築顯示為黑色/深灰色模型，無燈光
- [x] 焦黑建築由建商自動拆除重建（2% 機率/growth tick）

### 10.6 警察服務

- [x] **TEST**: 警察局有覆蓋半徑
- [x] **TEST**: 覆蓋範圍內犯罪率降低
- [x] **TEST**: 犯罪率影響地價和滿意度
- [x] 實作 PoliceService 模組
- [x] UI：基礎設施面板新增警察局按鈕
- [x] 整合到 SimulationLoop（crime 影響 happiness/landValue）

### 10.7 醫療服務

- [x] **TEST**: 醫院/診所有覆蓋半徑
- [x] **TEST**: 覆蓋範圍內居民健康度提高
- [x] **TEST**: 救護車出勤受交通影響 ✅ ServiceDispatch AMBULANCE
- [x] 實作 HealthService 模組
- [x] UI：基礎設施面板新增醫院按鈕
- [x] 整合到 SimulationLoop（health 影響 happiness/壽命）

### 10.8 教育服務

- [x] **TEST**: 小學/高中/大學各有覆蓋範圍
- [x] **TEST**: 覆蓋範圍內對應年齡居民獲得教育
- [x] **TEST**: 教育程度提升 → 可從事更高階工作
- [x] 實作 Education 服務模組
- [x] UI：基礎設施面板新增學校按鈕（小學/高中/大學分開按鈕）
- [x] 整合到 SimulationLoop（education 影響就業匹配）
- [x] UI：拆分 Infra 面板為 Roads/Civic/Utility 三組

### 10.9 垃圾處理

- [x] **TEST**: 垃圾場/焚化爐處理城市垃圾
- [x] **TEST**: 垃圾車有路線，受交通影響 ✅ ServiceDispatch GARBAGE_TRUCK
- [x] **TEST**: 垃圾未處理 → 汙染、地價下降
- [x] 實作 GarbageService 模組
- [x] UI：基礎設施面板新增垃圾處理設施按鈕
- [x] 整合到 SimulationLoop（垃圾產生/處理/汙染連動）— BUG-047 已修復

### 10.10 殯葬服務

- [x] **TEST**: 老人死亡 → 需墓園/火葬場處理（ageTick→reportDeath→deathCare.tick）
- [x] **TEST**: 處理不及 → 產生 happiness -20 懲罰
- [x] 實作 DeathCare 模組
- [x] UI：基礎設施面板新增墓園按鈕

### 10.11 服務車輛調度 ✅

- [x] **TEST**: 服務車輛（消防/救護/垃圾/殯葬）使用路網出勤 ✅ BFS 路網搜尋
- [x] **TEST**: 出勤路徑受交通壅塞影響 ✅ 壅塞越高 estimatedTicks 越長
- [x] **TEST**: 可將服務設施指派到特定 District ✅ assignFacilityToDistrict
- [x] 實作 ServiceDispatch 模組 ✅ ServiceDispatch.ts (4 種車輛類型)

---

## Phase 11：區域劃分與政策（District）

### 11.1 區域劃分

- [x] **TEST**: 玩家用塗刷工具畫出區域範圍
- [x] **TEST**: 每個格子歸屬一個 District（或預設全城區域）
- [x] **TEST**: 區域可命名
- [x] **TEST**: 區域可合併/拆分
- [x] 實作 District 模組
- [x] 整合到 GameState（建立 DistrictManager 實例）
- [x] UI：區域塗刷工具、District overlay 圖層

### 11.2 區域政策

- [x] **TEST**: 設定區域獨立稅率
- [x] **TEST**: 政策：禁止重工業 → 該區不長工業建築
- [x] **TEST**: 政策：鼓勵回收 → 降低垃圾產生
- [x] **TEST**: 政策：高密度禁令 → 只允許低密度
- [x] **TEST**: 政策有啟用成本
- [x] 實作 Policy 模組
- [x] 整合到 SimulationLoop（政策影響建築生長/經濟、政策成本計入預算支出）

### 11.3 工業 / 商業特化

- [x] **TEST**: 有自然資源的區域可設為農業/林業/礦業/石油區
- [x] **TEST**: 特化後工業建築變為對應類型
- [x] **TEST**: 商業特化：觀光商業、有機食品
- [x] 實作 Specialization 模組
- [x] 整合到建築生長邏輯（特化建築類型）✅ SimulationLoop.calculateIncome() 套用 revenueMultiplier

### 11.4 城市專精

- [x] **TEST**: 達到條件後可選城市專精方向
- [x] **TEST**: 採礦城：礦業效率 +、可建精煉廠
- [x] **TEST**: 科技城：需要大學 + 研發中心
- [x] **TEST**: 觀光城：景點 + 旅館 → 觀光客收入
- [x] **TEST**: 賭博城：高收入、高犯罪
- [x] 實作城市專精邏輯
- [x] 整合到 GameState/SimulationLoop ✅ CitySpecialization 加入 GameState，revenue multiplier 套用於 calculateIncome()
- [x] UI：城市專精選擇面板 ✅ Specialize 按鈕 + 彈窗面板（7 種專精可選，需 5000 人口）

---

## Phase 12：環境系統（Environment）

### 12.1 汙染擴散

- [x] **TEST**: 工業區每 tick 產生地面汙染
- [x] **TEST**: 汙染向周圍格子擴散（衰減）
- [x] **TEST**: 水汙染沿水流方向擴散
- [x] **TEST**: 噪音汙染沿道路/工業區擴散
- [x] **TEST**: 公園/綠地降低周圍汙染
- [x] 實作 Pollution 模組

### 12.2 自然資源

- [x] **TEST**: 地圖初始化時隨機分佈資源
- [x] **TEST**: 資源開採後逐漸耗盡
- [x] **TEST**: 資源耗盡後特化工業效率歸零
- [x] 實作 NaturalResource 模組

### 12.3 水流模擬

- [x] **TEST**: 河流有流向
- [x] **TEST**: 水壩可改變水流
- [x] **TEST**: 汙染物隨水流方向移動
- [x] 實作 WaterFlow 模組

---

## Phase 13：氣候與災害（Climate & Disaster）

### 13.1 季節系統

- [x] **TEST**: 遊戲時間推進四季循環
- [x] **TEST**: 冬天增加暖氣需求（電力消耗+）
- [x] **TEST**: 季節影響居民戶外活動
- [x] **TEST**: 不同氣候類型有不同季節效果
- [x] 實作 Climate 模組

### 13.2 天然災害

- [x] **TEST**: 地震 → 建築隨機損毀（依距離衰減）
- [x] **TEST**: 龍捲風 → 路徑上建築摧毀
- [x] **TEST**: 海嘯 → 沿海低地淹水
- [x] **TEST**: 森林火災 → 蔓延、需消防對應
- [x] **TEST**: 隕石 → 撞擊點大範圍毀滅
- [x] 實作 DisasterTypes 模組

### 13.3 預警與疏散

- [x] **TEST**: 預警塔覆蓋範圍內居民收到警報
- [x] **TEST**: 收到警報的居民前往避難所
- [x] **TEST**: 疏散路線規劃
- [x] 實作 WarningSystem 模組

### 13.4 災後重建

- [x] **TEST**: 損毀建築可修復（花費資金）
- [x] **TEST**: 完全摧毀的建築需重建
- [x] **TEST**: 道路損毀後斷開路網
- [x] 實作 Damage 模組

---

## Phase 14：里程碑與解鎖（Milestone）

### 14.1 人口里程碑

- [x] **TEST**: 人口達 500 → 解鎖消防/警察/公車
- [x] **TEST**: 人口達 1,000 → 解鎖高密度/地鐵
- [x] **TEST**: 人口達 2,500 → 解鎖工業特化/電車
- [x] **TEST**: 人口達 5,000 → 解鎖城市專精/鐵路
- [x] **TEST**: 人口達 10,000 → 解鎖機場/偉大工程
- [x] **TEST**: 人口達 25,000+ → 解鎖全部
- [x] 實作 Milestone 模組

### 14.2 偉大工程

- [x] **TEST**: 偉大工程有建設前置條件（資金/資源/人口）
- [x] **TEST**: 建設中需要多個 tick 完成
- [x] **TEST**: 完成後提供全城 buff
- [x] **TEST**: 類型：國際機場/太陽能農場/太空中心/超級體育場
- [x] 實作 GreatWorks 模組

---

## Phase 15：模擬引擎（Simulation）

### 15.1 遊戲狀態

- [x] **TEST**: GameState 包含所有子系統狀態
- [x] **TEST**: GameState 可序列化為 JSON
- [x] **TEST**: 從 JSON 反序列化恢復 GameState
- [x] 實作 GameState 模組

### 15.2 遊戲時鐘

- [x] **TEST**: GameClock 以 tick 為單位推進
- [x] **TEST**: 1x/2x/3x 速度控制
- [x] **TEST**: 暫停功能
- [x] **TEST**: 遊戲內時間（日/月/年）對應 tick 數
- [x] 實作 GameClock 模組

### 15.3 模擬迴圈協調

- [x] **TEST**: 每個 tick 按正確順序執行各子系統
- [x] **TEST**: tick 執行順序：經濟 → 建築 → 居民 → 交通 → 服務 → 環境
- [x] **TEST**: 一個 tick 內各系統讀取一致的狀態
- [x] 實作 SimulationLoop 模組

### 15.4 Simulation Worker ✅

- [x] 建立 simulation.worker.ts ✅ src/workers/simulation.worker.ts
- [x] Worker 內運行 SimulationLoop ✅ INIT/TICK/PAUSE/RESUME/SET_SPEED protocol
- [x] 寫入結果到 SharedArrayBuffer ✅ SimulationSnapshot via postMessage
- [x] 與主線程的 postMessage 通訊 ✅ TICK_COMPLETE response with snapshot data

---

## Phase 16：渲染引擎（Renderer）— 不使用 TDD

### 16.1 場景基礎

- [x] 初始化 Three.js 場景、相機、渲染器
- [x] OrthographicCamera 設定（等角視角）
- [x] 相機控制：平移（WASD/拖曳）、旋轉（Q/E）、縮放（滾輪）
- [x] 遊戲迴圈（requestAnimationFrame）
- [x] 視窗大小自適應

### 16.2 地形渲染

- [x] 地面網格渲染（平面 + 頂點位移表現高低）
- [x] 水面渲染（半透明 + 簡單動畫）
- [x] 地形顏色（草地/沙地/岩石）
- [x] 自然資源視覺標示

### 16.3 道路渲染

- [x] 道路幾何體（不同寬度）
- [x] 交叉路口拼接
- [x] 曲線道路渲染
- [x] 高架橋 / 隧道視覺
- [x] 道路標線

### 16.4 建築渲染

- [x] Low Poly 建築模型工廠
- [x] 住宅建築（低密度：小房子；高密度：公寓）
- [x] 商業建築（小店面 / 商場）
- [x] 工業建築（工廠 / 倉庫）
- [x] 辦公建築（辦公大樓）
- [x] 公共設施建築（電廠/水廠/消防局等）
- [x] InstancedMesh 實例化渲染（效能）
- [x] 建築等級視覺差異（Level 1/2/3）

### 16.5 車輛渲染

- [x] Low Poly 車輛模型
- [x] 車輛沿道路移動（插值平滑）
- [x] 公車/貨車/消防車等不同車型
- [x] 火車/電車渲染

### 16.6 疊加圖層

- [x] 交通熱力圖（壅塞程度以顏色顯示）
- [x] 地價圖
- [x] 汙染圖（地面/噪音/水）
- [x] 犯罪率圖
- [x] 服務覆蓋圖（消防/警察/醫療/教育）
- [x] 電力/水管網路圖
- [x] 區域（District）邊界

### 16.7 天氣與視覺效果

- [x] 日夜循環（光線變化）
- [x] 天氣效果（雨/雪/陰天）
- [x] 季節視覺變化（樹葉顏色等）

### 16.8 效能優化

- [ ] ~~視錐剔除（Frustum Culling）~~ **不做**：所有 InstancedMesh 都刻意設
  `frustumCulled = false`（38 處）。three.js 是用整個 mesh 的 bounding sphere
  判斷，而一個桶的實例散在整張地圖上，開著會整桶一起消失。真正的剔除必須
  逐實例重排 count，成本高於省下來的 draw call。
- [x] LOD（遠處簡化模型）—— 縮到遠景時關掉矮物件與懸挑（`DETAIL_LOD`）。
  鏡頭是正交的，沒有「遠處的建築」，所以不需要簡化幾何，只需要一個看縮放的
  全域閘門。地面貼片刻意留著。
- [ ] 區塊化載入（Chunk-based loading）—— renderer 裡沒有任何 chunk 機制。
  目前靠「一格一實例 + 分桶」承載，200×200 也還撐得住，先不做。

> 這三條原本全部打勾，但只有 LOD 那一條後來真的做了。另外兩條沒有對應程式碼
> 也沒有測試 —— 盤點 LOD 時才發現。打勾要有東西佐證。

---

## Phase 17：使用者介面（UI）

### 17.1 工具列

- [x] 道路建設工具（含類型選擇）
- [x] 區域劃設工具（塗刷 R/C/I/O）
- [x] 建築放置工具（公共設施）
- [x] 拆除工具
- [x] 區域劃分工具
- [x] 大眾運輸路線工具 ✅ Transit toolbar + Routes modal（站點放置 + 一鍵建立路線）

### 17.2 資訊面板

- [x] 點擊建築顯示詳細資訊
- [x] 點擊居民顯示個人資訊 ✅ 建築面板顯示居民/工人列表，點擊居民顯示詳細資訊（年齡/教育/收入/幸福/健康/住所/工作）
- [x] 點擊道路顯示交通量
- [x] RCI 需求指標條（常駐）

### 17.3 管理面板

- [x] 預算總覽面板
- [x] 稅率調整面板
- [x] District 政策管理面板 ✅ 已整合（District Management Panel + 政策切換按鈕）
- [x] 大眾運輸路線管理 ✅ Transit Routes modal — 顯示公車/地鐵/電車系統狀態 + 一鍵建立路線
- [x] 城市統計圖表（人口/收入/滿意度歷史曲線）

### 17.4 其他 UI

- [x] 小地圖（MiniMap） ✅ Canvas 即時渲染城市俯瞰圖（道路/建築/區域顏色區分）
- [x] 遊戲速度控制（暫停/1x/2x/3x）
- [x] 疊加圖層切換選單
- [x] 通知系統（里程碑達成、災害警報、預算赤字等）
- [x] 教學引導（新手教程） ✅ 9 步教學覆蓋（道路/區域/水電/服務/經濟/圖層），支援 Next/Back/Skip

---

## Phase 18：輸入處理（Input）

- [x] 滑鼠點擊格子座標轉換（screen → world → grid）
- [x] 滑鼠拖曳繪製道路
- [x] 滑鼠拖曳塗刷區域
- [x] 右鍵拖曳平移相機
- [x] 滾輪縮放
- [x] 鍵盤快捷鍵（工具切換、速度控制、圖層切換）
- [x] 道路預覽（建路前顯示預計路線） ✅ BUG-022 已修復
- [x] 拆除預覽（拆除前高亮顯示）

---

## Phase 19：音效（Audio）

- [x] 背景音樂
- [x] 環境音效（城市噪音、鳥鳴、交通聲） ✅ Brown noise 城市底噪 + 鳥鳴 + 交通聲，音量隨人口/車輛動態調整
- [x] 操作音效（建路、劃區、拆除）
- [x] 事件音效（里程碑達成、災害警報）
- [x] 音量控制

---

## Phase 20：存檔系統（Save）

### 20.1 存檔

- [x] **TEST**: GameState 序列化為可存儲格式
- [x] **TEST**: 序列化包含所有子系統狀態
- [x] **TEST**: 存檔寫入 IndexedDB
- [x] **TEST**: 支援多個存檔槽位
- [x] 實作 SaveManager 模組

### 20.2 讀檔

- [x] **TEST**: 從 IndexedDB 讀取存檔
- [x] **TEST**: 反序列化恢復完整 GameState
- [x] **TEST**: 讀檔後各系統狀態一致
- [x] 實作讀檔邏輯

### 20.3 自動存檔

- [x] **TEST**: 每隔 N 個 tick 自動存檔
- [x] **TEST**: 自動存檔不影響遊戲效能（非同步）
- [x] 實作自動存檔

---

## Phase 21：整合測試

- [x] **TEST**: 從空地圖開始，建路 → 劃區 → 建築生長 → 居民遷入（完整流程）
- [x] **TEST**: 交通壅塞 → 影響居民滿意度 → 影響遷入率
- [x] **TEST**: 服務車輛受交通影響 → 火災損失加大
- [x] **TEST**: 稅率調高 → 居民遷出 → 人口下降 → 稅收下降
- [x] **TEST**: 災害發生 → 建築損毀 → 重建需求
- [x] **TEST**: 模擬運行 1000 tick 後城市不崩盤（穩定性測試）
- [x] **TEST**: 大地圖（200×200）模擬效能在可接受範圍內

---

## Phase 22：打磨與優化

- [x] 效能 profiling 與優化
- [x] 平衡性調校（經濟參數）
- [x] 開發者除錯工具面板（即時調整參數） ✅ Debug 按鈕 + DebugTools 模組（即時顯示模擬狀態 + 修改 Funds/TaxRate/Speed）
- [x] 瀏覽器相容性測試
- [x] 無障礙性（Accessibility）基本支援 ✅ ARIA role/label 已加入（banner/toolbar/dialog/alert/meter/group/img）
- [x] 錯誤處理與容錯
- [x] Loading 畫面
- [x] 遊戲封面 / 主選單

---

## 待修正項目（開發過程中發現）

- [x] 公園 land value 影響只看 FOREST 地形，未檢查 ParkService 設施（buildingId=248）→ 放置的公園不影響地價 — BUG-046 已修復
- [x] Civic 建築（police/fire/hospital/school/park 等 buildingId 243-252）在 zoneType=NONE 的空地上放置時，渲染引擎已支援，拆除後清理正確（demolish 已處理所有 buildingId 243-254）
- [x] 電力/水力覆蓋從 BFS 矩形改為 Euclidean 圓形 — BUG-051
- [x] 基礎設施多格佔地重構（跨系統重構）
  - [x] **Step 1 — InfraConfig 配置表** (`src/core/building/InfraConfig.ts`) ✅
    - 定義每種基礎設施的 id/name/width/height/cost
    - 公園 1×1($200)、警察/消防/小學/電廠/水廠/垃圾/汙水/墓園 2×2、醫院/高中 2×3、大學 3×3($3000)、機場 4×4
    - 匯出 `getInfraConfig(type)` + `getInfraConfigById(id)` 查詢函式
    - rotation 型別：0°/90°/180°/270°（四方向），90°/270° 時 swap W↔H
    - `getRotatedSize(w, h, rotation)` 工具函式
  - [x] **Step 2 — 多格放置邏輯** (`src/core/building/InfraPlacement.ts` + `src/Game.ts`) ✅
    - canPlaceInfra() 查表取得 W×H，根據 rotation 決定實際佔地（90°/270° 時 W↔H 互換）
    - 檢查所有 W×H 格（非水域/非道路/非建築/非地圖外）
    - 主格(左上角)：`buildingId = infraId`
    - 從格(其餘格)：`buildingId = infraId, reserved = 4 (MULTI_CELL_OCCUPIED)`
    - 水廠 2×2：只需任一格靠近水源即可
    - 按 R 鍵循環切換 rotation：0° → 90° → 180° → 270° → 0°（僅基礎設施工具時生效）
  - [x] **Step 3 — 多格拆除邏輯** (`src/core/building/InfraPlacement.ts` + `src/Game.ts`) ✅
    - 點擊任一格 → findPrimaryCell() 判斷主格位置
    - removeInfraFromGrid() 清除所有格子的 buildingId/reserved
    - removeInfraService() 呼叫服務層 removeXxx
  - [x] **Step 4 — 渲染層** (`src/renderer/BuildingRenderer.ts`) ✅
    - 掃描 grid 時跳過從格(reserved=4)，只在主格繪製建築
    - buildCivicBuilding/buildPowerPlant/buildWaterPump 接受 scale 參數，geometry 按比例縮放
    - 模型居中：位置 = 主格座標 + (w/2 - 0.5, h/2 - 0.5) 偏移
  - [x] **Step 5 — 游標多格高亮 + 旋轉** (`src/renderer/GridCursor.ts`) ✅
    - GridCursor 新增 `setSize(w, h)` 方法，PlaneGeometry 改為 W×H
    - Game.ts 切換工具時呼叫 `updateCursorSize()` 更新游標大小
    - 按 R 鍵：rotation 切換 → 游標 W↔H 互換 + 游標位置偏移
  - [x] **Step 6 — 服務覆蓋起算點**（各 Service 檔案）
    - Game.ts placeInfrastructure() 計算 center = getInfraCenter(x, y, type, rotation) 後傳入服務 add
    - Game.ts removeInfraService() 用 getInfraCenterById(px, py, buildingId) 匹配服務
    - InfraPlacement.ts 新增 getInfraCenter() / getInfraCenterById() 工具函式
    - 涉及：PowerGrid/WaterNetwork/Police/Fire/Health/Education/Park/Garbage/Sewage/DeathCare
  - [x] **Step 7 — SimulationLoop 去重** (`src/core/simulation/SimulationLoop.ts`) ✅
    - 掃描 grid 統計建築/住房/工作時，跳過 reserved=4 的從格
    - reserved=3(BURNED) 與 reserved=4(OCCUPIED) 不衝突
  - [x] **Step 8 — 存檔/讀檔** (`src/core/save/Serializer.ts`) ✅
    - Grid.reservedData Uint8Array 存儲 reserved 欄位（修復原本未存儲的 bug）
    - Serializer 序列化/反序列化 reserved 欄位
    - 舊存檔相容：reserved 預設 0，基礎設施仍為 1×1（需未來 migration）
  - [x] **Step 9 — 測試更新** ✅
    - 新增 InfraConfig 單元測試 14 tests（配置表完整性）
    - 新增 InfraPlacement 單元測試 29 tests（多格放置/拆除/旋轉/邊界）
    - Grid reserved 欄位修復 + Serializer 更新
    - 706 tests all passing
    - 新增舊存檔相容測試
- [x] 放置物件半透明預覽 — 基礎設施放置時顯示半透明 3D 模型預覽（綠色=可放置/紅色=不可放置），道路拖曳預覽改為面，區域拖曳顯示範圍預覽，拆除工具多格高亮

---

## 第六十八輪深度掃描待修 Bug（BUG-052 ~ BUG-068）

多 Agent 靜態掃描 + 對抗驗證產出，詳細根因/重現/修復方向見 `BUGS.md`。
**全部遵循 TDD：先寫失敗測試再修。** 每條的建議測試已寫在 BUGS.md 對應條目。

### 🔴 Critical
- [x] **BUG-052** `InfraPlacement.ts:214` — `forEachMultiCell` 改用主格 rotation 解碼真實 W×H 矩形；
      `findPrimaryCell` 驗證候選 footprint 確實包含該格（修復中發現的同根因附加缺陷）；
      `DemolishClassifier` 孤兒格改判 `single_cell_infra` 而非 `regular` ✅
- [x] **BUG-053** `Serializer.ts:141` — 四者皆已序列化；替換 DistrictManager 時一併重建 PolicyManager；
      SAVE_VERSION 5→6 + no-op migration ✅

### 🟠 High
- [x] **BUG-054** `LaneGraph.ts:155` — 改為依 `owner(e) = viaCellKey ?? from.cellKey` 刪除／重建邊，
      borderNeighbors 修補 pass 整段移除 ✅
- [x] **BUG-055** `migrations.ts:94` — 抽出 `migrateSavedCitizens()` 對原始 payload 執行；
      v3 GameState migration 改為留空並註明原因；`restoreCitizen` 傳入真實 tick ✅
- [x] **BUG-056** `SimulationLoop.ts:836` — 抽出 `takeBuildingOutOfService(x,y)`，火災與廢棄路徑共用 ✅
- [x] **BUG-057** `SimulationLoop.ts:645` — `factors.isEmployed` 改讀 `citizen.workplaceId !== null` ✅
- [x] **BUG-058** `VehicleLookahead.ts:85` — `canAdvance(cur, next, via?)` 並傳入 `edge.viaCellKey`；
      邏輯抽成純模組 `core/traffic/CanAdvance.ts`；刪除已死的中點分支 ✅

### 🟡 Medium
- [x] **BUG-059** `ElevatedPathValidation.ts:82` — 改以 `storeLevel` 為碰撞檢查條件 ✅
- [x] **BUG-060** `RoadBuilder.ts:128` — `removeRoad` 只更新 flag，不碰 `roadType`；刪除 `getMaxNeighborRoadType` ✅
- [x] **BUG-061** `CommuteCache.ts:51` — `bumpGeneration` 不再清 `routeRefCount`；空過的測試已改名並修正 ✅
- [x] **BUG-062** `EconomyBreakdown.ts:39` — 補三項支出 + citySpec 收入加成，UI 新增三列；
      刪除死碼 `ui/modals/EconomyModal.tsx` ✅
- [x] **BUG-063** `reconstructPath` 加步數上限（防 worker 永久卡死）；批次迴圈抽成 `runBatch()`
      並接上原本沒人讀的 `version` 守衛。依對抗驗證結論不做 Atomics seqlock ✅
- [x] **BUG-064** `BusSystem.ts:295` — 實作 `onRouteStopRemoved` 覆寫；`computeRideDistance` 加長度守衛 ✅
- [x] **BUG-065** `Game.ts:533` — 建構時傳入 `railNetwork`；新增 `rebuildElevatedRailNetwork()` 並接上載入流程 ✅
- [x] `ElevatedRailBuilder.removeElevated` 仍是死碼（拆除一律走 `elevatedRoadBuilder.removeElevated`）— BUG-065 遺留
- [x] **BUG-066** `IncomeCalcAdapter.ts:14` — 單趟 O(N) 建 map，取代每建築一次的 citizen filter ✅
- [x] **BUG-067** `SidewalkGraph.ts:176` — 邊的重建集合擴大一環（`edgeOwners`），利用既有的 edge id 去重 ✅

### 🔵 Low
- [x] **BUG-068** `Disaster.ts:159` — `setCell` 一併清 `reserved` ✅（`clearBuildingCell` helper 仍列在系統性改善）

### 系統性改善（治本，優先於逐條修）
- [ ] 讓 LaneGraph / SidewalkGraph 的跨格邊發出**對稱**（每格發四方向並去重），使任何格的邊都不依賴鄰居被重建
- [x] 加不變式測試：`updateCells(...)` 產出的圖必須等同同一 grid 全新 `buildFromGrid` ✅（LaneGraph + SidewalkGraph 皆已加）
- [x] 加測試列舉 GameState 欄位，當某欄位既未序列化也未標記 transient 時失敗（可抓 BUG-053 這類）
- [x] 加測試斷言經濟 breakdown 加總 === `calculateTotalExpenses` 實收金額 ✅（BUG-062 一併完成）
- [ ] 抽出 `clearBuildingCell(grid,x,y)` 與具旋轉感知／主格驗證的 `forEachOwnedCell` 單一權威 helper
- [x] 載入時（及 debug panel）跑一次調和 pass：每個註冊設施在 grid 上是否仍存在？每個 homeId/workplaceId 是否仍指向活建築？
- [x] 把 `Game._canAdvance` 抽成純粹可測的 core 模組 `core/traffic/CanAdvance.ts` ✅（BUG-058 一併完成）
- [ ] 把 Game 的 builder 接線也抽成可測模組（Game.ts 因 import Three.js 而完全未測）
- [x] 為放置與圖的測試套件加入「相鄰／雙實例」fixture（現有測試全部只在空 grid 上放單一實例）

### 既有測試套件問題（非本輪掃描產出，但阻礙驗證）
- [ ] `Integration.test.ts` 200x200 效能測試在平行負載下逾時（單獨跑 3752ms / 上限 5000ms），餘裕僅 25%
- [ ] `CommuteTraffic.test.ts` 的 `should spawn vehicles at any hour` 在平行負載下
  偶發失敗（2026-08-10 全跑時紅一次，單獨跑 15 條全過）。與 `BirthAfterAgeing`
  同一類：時間敏感的測試在 325 個檔案並行時被排擠。
- [x] `tsc --noEmit` 有 329 個錯誤（約 70 個在 production code），`pnpm build` 目前在 main 上就失敗


## 第六十九輪待辦 — 全數完成 (第七十輪處理，BUG-125 ~ BUG-146)

33 項全部修復並附測試，細節見 BUGS.md「第七十輪」。
每一項都先寫失敗測試，再用「把修復 revert 掉重跑」確認測試有鑑別力。

### 測試品質 (審查明確指出為 vacuous 或無鑑別力)
- [x] LoadDoesNotRerunDailyBlocks 前兩條是套套邏輯 (斷言 getDay() === getDay())；改為觀察行為
- [x] lastRiderDay 是存活的 mutant - 刪掉建構子那行賦值，測試全綠
- [x] TransitNetworkInvalidation 自己呼叫 markTransitNetworkDirty，等於只測 setter；真正的接線 (Game.ts / TransitModal.tsx) 零覆蓋
- [x] PolicyEffectiveness 的 IMPLEMENTED_POLICY_TYPES 子集斷言型別上恆真；應改為與 POLICY_ZONE_RESTRICTIONS 鍵集合相等
- [x] ExpenseCalculator 的 "returns 0 when no policies are active" 用假 type，已不再守護 active 過濾
- [x] EconomyPanelMatchesBudget 的 fixture 讓 transportCost / policyCost / elevatedMaintenance 恆為 0
- [x] VehicleSortCost 鑑別邊際僅 4.3%；改為直接計數 edgeTotalProgress 呼叫次數
- [x] RoadDistanceMinCost 只斷言「有變小」；期望值可精算 (4.0 vs 29/6)
- [x] MultiCellUtilityDemand 只走 calculateDemand，bfsBudgetDrainFlood 路徑零覆蓋
- [x] ShoppingAccess.test.ts 全檔無高架案例，level-aware 分支從未被執行

### 未修的既有缺陷 (審查過程中發現，非本輪引入)
- [x] Game.applyZone 的 pre-scan 沒複製 setZone 的三道守衛，拆路後重劃會產生「已驅離但未重劃」的殭屍建築
- [x] applyZone 未清 deathCare / garbage 的 per-position 待處理佇列 (demolish 有清)
- [x] applyDisasterDamage 與基礎設施覆蓋拆除都不清 abandonmentStress；建議在 AbandonmentStressTick 改為剪枝，一次覆蓋 5 條路徑
- [x] 既有存檔的基礎設施格仍保留 zoneType (BUG-074 只修放置當下)；migrateOldInfra 還會在載入時重新製造。需要 version 7 migration
- [x] bfsBudgetDrainFlood 對多格設施逐格結算，BUG-070 後次格 demand=0 成為免費中繼，付不起的設施會顯示 3/4 供電
- [x] IncomeCalculator / CityMetrics / ServiceCoverageQuery / GridPollutionSources 仍是裸的 buildingId > 0，未收斂到 isActiveZoneCell
- [x] 燒毀的工廠仍排放滿額工業污染 (GridPollutionSources 不看 reserved)
- [x] SewageService 的覆蓋比 operational 狀態慢一個 slow cycle (education 是即時的)
- [x] getPollutionSources 與 collectPending 對「哪些掩埋場算數」判準不同 (前者不看 connected)
- [x] ServicesPage / InfraDetails 的容量顯示仍含非運作設施，UI 與 core 模型不一致
- [x] EDUCATION_THRESHOLDS.AVG_LAND_VALUE = 100 實務上仍不可達：getAvgLandValue 對全部建築取平均，全城 crime 常數在 pop >= 2500 時恆扣 8 分，非水岸單格上限僅 97
- [x] countJobOpenings 用總人口當勞動力代理，退休實作後約 43% 崗位永久空著，商業/工業/辦公稅收約降 29%
- [x] birthTick 排在 runMigration 之後，移民 (頻率 6 倍) 先吃光空位，自然生育退化為殘餘機制
- [x] DistrictModal 的 POLICY_TYPES / POLICY_LABELS 是第三、四份需手動同步的清單
- [x] 已啟用未實作政策的舊存檔：政策物件仍在但 UI 不再列出，玩家無法關閉；日後實作時會無聲生效
- [x] markTransitNetworkDirty 靠註解維繫「每個變更點都要呼叫」；建議改為 BaseTransportSystem 內部 version 計數器
- [x] transferGraphDirty 的消費點埋在 spawnCommuteVehicles 內，車流達上限的大城市永遠不會重建
- [x] FerrySystem 的 waterPathCache 在拆站路徑上仍洩漏 (hook 拿不到 route 物件)
- [x] placeTransportStop / addBusVehicle 觸發完整 transfer graph 重建並清空 transferTracker 面板資料，過度失效
- [x] GridPollutionSources 的高架 tier 用 getHighestLevel，高架鐵路疊在高架公路上時 roadType 為 0，BUG-099 症狀復發
- [x] 高架起始層啟發式取「最高層」，同格多層或地面+高架並存時會選錯，且無法從 level 1 延伸到 level 2
- [x] rebuildLaneGraph 全量重建分支 (dirtyRoadCells 為 null) 完全不清車
- [x] 機場與所有運輸站點在電/水消耗表中無條目，40000 造價的大型機場用電用水皆為 0


## 第七十輪備註

- 全套測試 3746 條，連續四次整包執行全綠——這是本分支第一次做到。
- 核心測試在 6 組不同亂數種子 (1 / 7 / 12345 / 999983 / 424242 / 31337) 下皆通過，
  確認斷言測的是不變量而非某一組抽樣。
- tsc 錯誤數 323，與分支起點 329 相比淨減 6，且無新增。
- `src/core/__tests__/helpers/seededRandom.ts` 提供 `useSeededRandom()` / `reseedRandom()`。
  用途是**排除干擾**，不是讓斷言只在某個種子下成立——結果本身會變動時，
  請斷言不變量（比值、上下界），不要斷言抽樣結果。

## 對抗審查回饋 (第七十一輪) — 待辦

- [ ] BUG-109 真正的修法：把高架層序列化進 workplace-distance worker 的緩衝區，
      讓快取在有高架的城市也能用。目前是「有任何高架道路就不用快取」，
      正確但每個 slow cycle 要對每個失業家戶跑一次預算 Dijkstra。

## 第七十一輪對抗審查 — 尚未處理的 findings

### 已確認、待修
- [x] 垃圾污染兩個分支不對等：landfill 分支 `perFacility = ceil(penalty/n)` 再乘 `forEachFacilityCell`（2x2=4 格），實測一座垃圾場排放 400 vs 無垃圾場 100。等於「有廢棄物設施」污染反而重 4 倍，是 BUG-101 誘因的較輕版本
- [x] `UNCOLLECTED_POLLUTION_SITES = 12` 在平均分佈時只是「最早回報的 12 格」（sort 穩定、count 全部相同），200 格垃圾中 188 格排放 0；且 pendingBags splice 會讓這 12 格在無遊戲原因下漂移
- [x] `save.worker.ts` 的 `tx.onerror` 搶在 `tx.onabort` 前 reject，`tx.error` 當下仍是 null → 真正的 QuotaExceededError 被換成佔位字串
- [x] `Game.ts` 沒有 `saveWorker.onmessage`，SAVE_COMPLETE（成功與失敗）全部被丟棄 → autosave 配額滿時玩家完全不知情
- [x] `openDB` 沒接 `onblocked`（SaveManager 與 save.worker 皆是）；DB_VERSION 一旦調升且有第二個分頁開著，promise 永不 settle
- [x] `listSaves` / `deleteSave` 的 rejection 在 MainMenu 無 `.catch`，SettingsModal 的 `await listSaves()` 在 try 之外
- [x] `main.ts` 載入失敗會 catch 後直接開新遊戲，覆蓋玩家存檔且無提示
- [x] `BusSystem.onRoadChanged` 只比對 `from/to.cellKey`，不看 `viaCellKey` → 拆掉公車轉彎的交叉口格子時該路線不會重算，公車永遠開在已刪除的邊上
- [x] `removeElevated` 的 `highest-1` 掃描沒有確認該層是否還有 segment → 堆疊高架時會切斷下層還存在的連線
- [x] 高架道路寫入時 `railType/railFlags` 對 `i > 0` 全部歸零 → 高架道路橫跨高架鐵路會刪掉鐵路那一格
- [x] 起點格 `roadType` 保留邏輯在「純鐵路高架」上會產生 roadFlags 指向不存在道路的孤島（BUG-097 症狀復現）
- [x] `ShoppingAccess` 的地面鄰居展開完全不看 level，高架橋經過地面道路旁就會與之合併（無匝道）
- [x] `CitizenManager` 退休釋放 commuteCache 的 `onEvicted` 完全沒有測試（刪掉三行呼叫，全套測試仍綠）
- [x] `getAvgNoise` 改讀 live pollution 沒有測試；`getAvgResidentialNoise` 現在是死碼
- [x] `highestMilestonePop` 沒有 round-trip 測試；非有限值會讓 `Math.max` 回傳 NaN 並永久停用里程碑
- [x] `dirtyRoadCells` 跨編輯累積，同一 tick 內拆除再改向重鋪會逃過清掃（已由 edge-identity 改法解決，待確認）

### 第三批對抗審查（92a4d03 / 84a4713 / 45e2901 / 77bcef5 / 6c2f042 / 6ac7d9e / 43a145d）

**已修**：BUG-147 ~ BUG-152（見 BUGS.md 第七十一輪）。BUG-147 是這一輪最重的一條，
且不是本輪 commit 引入的——四種區劃/道路組合永遠蓋不出建築，是既有缺陷。

**待修 — 缺陷**（BUG-153 ~ BUG-166，細節見 BUGS.md）
- [x] BUG-153 ServicesPage 污水廠列：過濾分母 / 未過濾分子，全部停機時顯示綠色「Normal」
- [x] BUG-154 警消醫短缺警告在容量歸零時反而不觸發
- [x] BUG-155 InfraPage 掩埋場列顯示「1800 / 0」且進度條回到健康色
- [x] BUG-156 污水/垃圾產量仍計入廢墟，與 getCellDemandAt 對同格的答案矛盾
- [x] BUG-157 BUG-111 還有 placeAirport / placeTransportStop 兩條路徑沒修
- [x] BUG-158 永久停駛的公車路線讓城市任一處鋪路都清空 transfer 面板
- [x] BUG-159 SidewalkEdge.id 不含 roadType，道路拓寬後行人走在車道裡
- [x] BUG-160 SidewalkEdge.id 不含 type，crosswalk 與 level_crossing 撞 id，行人繞過紅綠燈
- [x] BUG-161 buildingGrowthTick 改人行道圖但不設 dirty，退場掃描永遠看不到
- [x] BUG-162 chooseStartLevel 不問該層有沒有道路，平手時會選中純鐵路層
- [x] BUG-163 目標層為純鐵路層時，高架道路直接抹掉一段高架鐵路
- [x] BUG-164 住宅容量回呼對無建築地址回傳 8，與 countResidentialCapacity 不一致
- [x] BUG-165 BUG-140 只修生育路徑，移民路徑仍走舊閘門
- [x] BUG-166 JOB_SCORE 與失業罰則失衡；SummaryPage 仍用舊的職缺定義

**待修 — 測試品質**（審查代理實際 revert 修復後仍為綠）
- [x] `TransitNetworkInvalidation` 的「should still drop the departing ferry vessel path」：
      從未 tick，vesselPaths 恆空，getVesselPath 無條件回 null。把 onVehicleRemoved 清空仍綠
- [x] `MultiCellUtilityDemand` 的「should not let a ruin starve a live house of power」：
      電廠容量由 `pg.getDemand()` 決定，未修版本下那本來就是兩戶份，兩邊都會供上電
- [x] `CollectPendingScaling` 的「should collect each surviving bag at most once」：
      12 個袋子全在單 tick 收完，`after` 是空陣列，斷言是恆真式
- [x] `ShoppingAccessElevated` 商業側斷言仍卡在 `Math.min(1, ...)` 上限，重複計算也測不出來
- [x] `BirthAndJobOpenings` 4 個生育案例有 3 個在還原修復後仍綠；
      「should not count children and retirees as employed」與年齡完全無關（那些人只是沒有 workplaceId）
- [x] `ElevatedLevelChoice` 10 個案例有 7 個對「取最高層 vs 取最大值」沒有鑑別力
      （HIGHWAY 放 level 2 時兩種語意答案相同，要倒過來放才測得出）
- [x] `FerryPathCacheEviction` 的負向對照：在 x=7 築壩不會切斷 (2,2)↔(2,10)，
      該斷言在「完全不清快取」與「整個 clear()」下都會過
- [x] `PedestrianSignalWiring` 用與產品碼相同的算式重算 approachIsNS，
      把相位對應反過來仍會綠

**待修 — 低優先**
- [x] `getAllEdges()` 內部已建好一份 id Set 卻丟棄，呼叫端重建第二份（改用 getEdgeIds）
- [x] `SimulationLoop.rebuildLaneGraph` 的 `affectedCells` 區域變數已無人使用
- [x] `PedestrianManager` 的 WAITING_SIGNAL 重檢分支永遠不會擋人（currentEdge 恆為接近邊）
- [x] `getHighestRoadType` 取的是 enum 最大值而非最吵：ONE_WAY(6) > HIGHWAY(5) 但噪音係數 1.2 < 2.0（改由呼叫端提供排序依據）
- [x] `SchoolService.getTotalCapacity` 用 getOperationalFacilities（只看電）而非 getActiveFacilities（電+路）
- [x] `DistrictModal` 區域列的 `{d.name}` / `{d.cells.size}` 仍不具反應性
- [x] `PolicyManager.applyPolicy` 以 type 去重，存為 `active:false` 的已實作政策仍永久卡死
- [x] `GridPollutionSources` 的 `reserved` 必填不具強制力（method shorthand 在 strictFunctionTypes 下仍是雙變）
- [x] `birthTick` 移到 per-day 區塊之前，新生兒當天即暴露於 deathTick、且讀到前一天的 age
- [x] `Migration` 的 AVG_LAND_VALUE `× 0.75` 是包裝成推導的魔術數字，實測門檻仍偏低

## E2E 實際遊玩觀察（Playwright 有頭，60x60 地圖）

玩家體驗問題，非程式錯誤，但都會讓新玩家卡住：

- [x] **空的劃區格永遠不說明自己為什麼不蓋東西。** 已修：`ZoneBlocker` 診斷 +
      overlay 依阻因上色 + 點擊空劃區格顯示原因面板。實測 NO_POWER×12 →
      接通道路後變 "Ready to develop"，面板即時更新。
- [x] **沒有水就完全長不出東西，而水廠需要地下水（離河 ≤3 格）。**
      新手在內陸開局會看到人口永遠 0、資金因道路維護持續流失，
      而唯一的提示只有點下去那一瞬間的「No groundwater here」toast。
      建議：新遊戲提示、或在地圖上標出可建水廠的區域。
- [x] **道路拖曳碰到水面會整條取消**，只回報「Cannot build road: Cannot build on water」。
      比較合理的做法是蓋到碰水為止。
- [x] 放置失敗的 toast 現在會說明放的是什麼（`Cannot place Water Plant: ...`）。
      註：原本回報的「主詞恆為 road」是我看錯了——那句來自同一批操作裡真正的道路拖曳；
      真正的缺陷相反，是三條放置路徑**完全沒有主詞**。
- [x] 工具列群組按鈕是 toggle，連續選同群組的兩個工具時第二次會把選單關掉
      （自動化與鍵盤操作都會踩到；滑鼠玩家較不明顯）

## 第七十二輪：清空第七十一輪待辦

三件依序完成：

1. **建築停電/停水閃爍圖示**（`BuildingUtilityWarning` + `BuildingRenderer`）。
   判準直接沿用 `FacilityOperational` 的豁免表——電廠不會被標成缺電、停擺的公車站不會沉默。
   廢墟排除、多格設施只標主格。core 與 renderer 兩側都有測試。
   注意：這是**空劃區格底色**之外的另一半；空劃區格仍是整格變色，不是圖示。

2. **BUG-153 ~ BUG-166 全部修完**，每一項先寫失敗測試、修完再 revert 驗證會轉紅。
   其中 BUG-162/163 查證後是同一個根因（`chooseStartLevel` 選中純鐵路層），
   審查員推測的 `existingAtStart` 機制經實測不成立——起點格根本不會被寫入。

3. **8 個沒有鑑別力的測試全部重寫**，每個都用「還原修復 → 測試轉紅」證明過。

### 需要你決定的一件事

`BUG-166` 的修正改變了遊戲平衡：職缺吸引力現在乘上 `(1 - 失業率)`，
所以「有職缺但沒人到得了」不再加分。原本有兩個測試明確斷言
「全失業仍應高於移民門檻」「失業懲罰應該溫和」——它們的前提是舊的職缺定義，
已改寫並註明原因。若你認為原本的平衡才對，改 `ATTRACTIVENESS` 一行即可。

## 第七十三輪：換道成本 + 三個死政策

### 已修

- [x] **換道成本**（`Pathfinding.laneEdgeCost`）。原本換道邊只比直行貴 2%（幾何長度
      0.9178 vs 0.9000），但成本同時除以 `0.95^lane`，內側每層快 5%——所以
      「換到 lane 0」比「留在 lane 1」**更便宜**（0.9178 < 0.9474）。實測筆直的
      10 格六線道會產生 `2 1 1 0 0 … 0 1 1 2 2`，四次換道，外側那對毫無收益。
      改為固定加法成本 0.15，六線道降到兩次；`LanePathfinding.test.ts` 既有的
      「3 格不換 / 10 格要換」兩條仍然成立（第一次我訂 0.5 就是被這兩條抓到的）。
- [x] **三個死政策全部實作**（`POLICY_EFFECTS`）：
      回收 ×0.65 垃圾產量、觀光 ×1.2 稅收、有機食品 +6 地價（clamp 之前）。
      `IMPLEMENTED_POLICY_TYPES` 現在同時由兩張表推導，政策「有效果」和「會被收費」
      無法再分岔。

### 修正先前文件的錯誤

- **焚化不是缺的功能。** `GARBAGE.BURN_RATE = 90`，每個垃圾設施每 tick 焚化 90 單位，
  `burnDaily` 有七日統計。之前寫「垃圾只有掩埋場會填滿」是錯的。
  真正沒有的是**獨立的焚化爐/回收中心建築**——`INFRA_CONFIGS` 垃圾類只有一個條目
  `garbage`（名稱 "Landfill"），機制包在那一棟裡。
- **貨運火車站不是缺的功能。** `collectTradePositions` 明確走三種通道：
  `railStations.throughput`、`airports.cargoPerTick`、`highwayCells.throughput`。
  沒有的只有**貨運港口**——渡輪碼頭不在該清單，只載客。
- **車道選擇不是缺的功能。** `refineLanePath` 是車道子圖 Dijkstra，
  `LaneGraphPathfinder` 是完整車道級 A*，都含每車道速度加權。
  缺的只有轉向車道偏好與「距離內換不完就改道」兩條策略。

前一份清單是用英文關鍵字掃出來的（`incinerator`、`cargo`），
實際命名是 `BURN_RATE`、`throughput`，所以掃空了。

### 仍未開發（確認過 0 命中）

- 轉向車道偏好（右轉提前靠右）、換不完就改道
- 地形編輯、監獄、地標/獨特建築、成就系統、貨運港口
- 獨立的焚化爐/回收中心建築（機制已在掩埋場內）

---

## 第七十四輪：清空全部待辦

一次做完 TODO.md 上所有未修項目（BUG-169 ~ BUG-213，記錄在 BUGS.md）。
每條都先寫紅燈測試、修好、再把修正還原確認測試轉紅。

測試 3971 → 4185，`tsc --noEmit` 321 → **0**，`pnpm build` 從失敗變成可以產出 `dist/`。

### 十個群組，全部完成

1. **建置**（本輪最重要）：`pnpm build` 原本就是壞的，321 個型別錯誤裡藏著
   四個真缺陷，包含一個「點任何建築都會 crash」的 `<For>` 未 import。
2. **存檔／資料遺失**：載入失敗會靜默開新遊戲蓋掉存檔、autosave 失敗完全無聲、
   `openDB` 沒接 `onblocked` 會永久 pending、worker 把 QuotaExceededError
   換成佔位字串。
3. **垃圾污染**：掩埋場分支把 penalty 排放四次（實測 400 vs 100）；
   平均分佈時 200 格垃圾只有 12 格排放。
4. **高架／鐵路**：高架路橫跨高架鐵路會刪掉鐵路、路可以從純鐵路高架起頭導致
   匝道懸空、拆上層會切斷下層、拆高架鐵路不清 RailNetwork。
5. **交通／圖**：公車不看 `viaCellKey`、行人紅燈重檢問錯邊、
   ShoppingAccess 讓無匝道高架吸收地面。
6. **服務一致性**：學校／醫院容量不看道路、汙水完全沒有接進幸福度與地價、
   政策 `active:false` 永久卡死、DistrictModal 不具反應性。
7. **人口**：生育排在當日老化與死亡之前、移民門檻的 `× 0.75` 魔術數字。
8. **測試缺口**：四個沒有測試的行為，其中 `highestMilestonePop` 的 round-trip
   測試當場抓到一個真 bug（非有限值讓里程碑永久失效）。
9. **玩家體驗**：內陸開局無解、道路碰水整條取消、工具列 toggle 誤關。
10. **系統性**：GameState 欄位序列化覆蓋測試（首跑就抓到兩個無人負責的欄位）、
    載入時的調和 pass。

### 對抗審查

兩個 subagent 針對前三個 commit 做對抗審查，在我自己的修正裡找到 12 個缺陷
（包含一個回歸：新版本存檔從可載入變成被拒絕並被說成損毀）。全部已修並補測試。

### 仍未做（三項系統性重構，非 bug）

刻意留下。這三項都是大型架構重構，在一輪長工作的尾聲倉促動手，風險大於收益；
它們也都不是缺陷，而是「治本」的改善。

- [ ] 讓 LaneGraph / SidewalkGraph 的跨格邊發出**對稱**（每格發四方向並去重），
      使任何格的邊都不依賴鄰居被重建。影響整個路網圖的建構，需要獨立一輪。
- [ ] 抽出 `clearBuildingCell(grid,x,y)` 與具旋轉感知／主格驗證的
      `forEachOwnedCell` 單一權威 helper。本輪新增的 `Reconcile` 已經覆蓋了
      這個 helper 想防的**後果**（懸空引用），但沒有消除重複的來源。
- [ ] 把 Game 的 builder 接線抽成可測模組（Game.ts 因 import Three.js 而完全未測）。
      本輪已用「把邏輯搬進 core」的方式處理了會碰到的部分
      （`ServiceStatusView`、`WaterPlantSites`、`Reconcile`、`SaveWorkerHandler`），
      整體抽離仍待做。

其餘先前標記「先不動」的項目維持不動：轉向車道偏好、距離內換不完就改道、
轉彎視覺驗收、BUG-109 把高架層序列化進 workplace worker、
`Integration.test.ts` 200x200 效能測試餘裕僅 25%。

## 第七十五輪：車道級交通剩餘項的查證

「車輛看起來很順暢，真的有必要做嗎？」的查證結果，量測數字見 BUGS.md 第七十五輪。

### 第七十六輪已修

- **BUG-214** 已修：轉向邊依偏離應走車道的距離加成本（`TURN_LANE_PENALTY = 0.5` / 車道），
  主執行緒 `LaneGraphPathfinder` 與工人 `PooledAStar` 共用 `traffic/TurnLane.ts`。
- **BUG-215**（修 214 過程中發現並一併修）：工人執行緒的 A* 從來沒有計算
  `LANE_CHANGE_COST`，換道是免費的，主執行緒卻一直在收 0.15。
  `LaneGraphBuffer` 的 point stride 用原本保留的 pad byte 帶上 laneCount，stride 不變。
- **BUG-216** — 已決議**不用收斂方式修**（2026-08-09）：強制所有轉向車走同一條車道
  會把路口轉向吞吐量砍半，而且不管旁邊有沒有車都砍。現狀多出的吞吐量雖然是
  `findCrossEdgeGap` 漏看造成的，但正解是 BUG-217 而非趕車進同一條車道。
  已上線的 `TURN_LANE_PENALTY` 仍讓約一半的轉向車自動走對車道。
- [ ] **BUG-217**：`findCrossEdgeGap` 只比對相同 `toId`，路口裡路徑交叉但終點不同的
  兩台車互相看不到、直接穿過去。改用行進方向與橫向距離判斷交叉。
  嚴格優於強制收斂——只有旁邊真的有車才禮讓。影響所有路口車流，需獨立一輪。
- 仍未做：四岔路口上「同時轉彎又換道」那類邊與新路直行車的幾何關係（起始車道正確，
  不屬於 BUG-214）。

---

- 轉向車道偏好 → 確認是真缺陷 **BUG-214**（錯誤車道轉彎與直行車路徑最近距離 0.0048，
  車身寬 0.09，且 `findCrossEdgeGap` 只比對同 `toId` 故兩車互不可見 → 直接穿過彼此），
  但只在每方向 ≥2 車道的道路上發生。預設的 TWO_LANE 完全不適用——這正是目前看起來順暢的原因。
- 距離內換不完就改道 → 建議關閉，架構上不適用。

## BUG-218 已修：住宅高密度變體 3 越過格子邊界（幾何包圍盒測試首跑抓到）

---

## 建築模型多樣性 — 階段 0 + 1 完成（2026-08-09）

規格：`docs/superpowers/specs/2026-08-09-building-model-variety-design.md`
計畫：`docs/superpowers/plans/2026-08-09-building-model-variety-phase-0-1.md`

- [x] **階段 0**：`BuildingAppearance`（修掉偏移雜湊的對角線相關性）、`parts.ts`（含
      `PART_DETAIL`）、`BuildingMaterial`、`registry.ts` + `getVariants(zone, level)`、
      展示區（三檢視 + 相機 + 日夜 + 三角形計數 + 重複度指標）
- [x] **階段 1**：`aSeed` 逐實例立面種子、四個分區的樓層高度／窗寬／相位不再寫死、
      低密度住宅立面（窗＋門＋夜間亮燈）、`PART_DETAIL` shader 分支
- [ ] **階段 2**（範圍已擴編，需另排計畫）
  - 參數化生成器，變體 key 改成 (分區, **密度**, 等級) — BUG-220
  - 目標高度表：低密度照實算、高密度壓縮（規格修訂 1）
  - 地面物件獨立圖層 — BUG-219，樹不再跟著建築長高
  - 等級的豪華階梯：量體／材質／零件／周邊四項一起動（規格修訂 4）
  - 色盤與 `aSeed.z` 加上等級維度
  - 容量動態配置
- [ ] **階段 3**：屋頂物件層、立面附加零件
- [ ] **階段 4**：`seedByte` 持久化、~~LOD~~（已做，見 16.8）、接進遊戲驗收

### 階段 2A 已完成（2026-08-09）

- [x] 目標高度表（公尺）＋目標基地寬度表，等級不再是縮放係數
- [x] 變體桶 key 加上密度 — BUG-220
- [x] 容量動態配置（初始 256，滿了倍增，四個自訂屬性一起搬）
- [x] `MAX_BUILDING_WIDTH_M` 共用常數 — BUG-221
- [x] 使用者確認過的尺寸表（工業放低放寬、低密度辦公拉高）

### 階段 2B 已完成（2026-08-09）

計畫：`docs/superpowers/plans/2026-08-09-building-model-variety-phase-2b.md`

- [x] BUG-222：幾何置中、上限改用離格心最大距離並含抖動、鋪滿基地的分區取消向上抖動
- [x] 實例桶機制抽成 `InstancedLayer`（BuildingRenderer −199/+35 行）
- [x] `groundProps.ts`：庭院帶由目標寬度與行人包絡線推導；住宅低 L1/L2/L3 各兩個組合
- [x] 地面物件獨立圖層，矩陣只含旋轉與位置 — BUG-219
- [x] 建築幾何不再含 `PART_FOLIAGE`；住宅低目標寬度 7.2 → 6.0
- [x] 展示區顯示地面物件層 + 開關 + 量體／物件分列計數
- [x] BUG-223：`triangleCount` 取代 `position.count / 3`

**測試**：4326 → 4352。新增 `BuildingFootprint`、`GroundProps`、`GroundPropLayer` 三支。

**階段 2B 途中量到的缺陷**：BUG-222（14/20 個變體越過行人包絡線，4 個吃進鄰居格子）、
BUG-223（三角形計數器數頂點，少報三到五成）。

### 階段 2B-2 已完成（2026-08-09）

計畫：`docs/superpowers/plans/2026-08-09-building-model-variety-phase-2b2.md`

階段 2B 的結論「只有住宅低密度放得下地面物件，其餘分區沒有留白，這是幾何事實」
只對三分之一 —— 它推導的是**矮物件**（站在地上、佔高度、行人會撞到）。另外兩類的
限制完全不同，而且每個分區都放得下，不必動任何建築尺寸：

| 類別 | 放置帶 | 為什麼可以 |
|---|---|---|
| 貼片 | 建築外緣 → 格子邊界 0.5 | 完全平，行人走在上面 —— 那本來就是人行道 |
| 矮物件 | 建築外緣 → 行人包絡線 0.4083 | 唯一受行人繞行路徑限制的一類 |
| 懸挑 | 建築外緣 → 格子邊界 0.5 | 最低點高過人頭 2.2 m，行人從下面走過 |

- [x] `PART_GROUND = 0.7` 標籤與 shader 的鋪面分支（頂點色 B 通道帶明度）
- [x] `propBands.ts`：三類放置帶推導 + `GROUND_LAYERS` 離地高度表
- [x] 目標寬度縮 7–8%（8.4 → 7.8、9.8 → 9.0），讓其他分區也有 0.4 m 矮物件帶
- [x] `decals.ts`：七個 (分區, 密度) 各三級的前庭鋪面，柏油／混凝土／磚／草坪
- [x] 矮物件詞彙從 4 種擴到 12+ 種；住宅低每級四個組合；其餘分區各有詞彙
- [x] `overheadProps.ts`：雨遮、立體招牌、看板、卸貨雨棚
- [x] 三層接進 `BuildingRenderer`（`attachments` 表）與展示區（三開關 + 四列統計）
- [x] BUG-224：所有建築浮空 0.6 m，影子與底部分離
- [x] BUG-225：前庭鋪面四個角落互疊，鏡頭一動就閃爍
- [x] BUG-226：雨遮與鋪面貼的是「最寬的假想建築」，其餘每一棟上都浮空

**測試**：4352 → 4422。新增 `PropBands`、`Decals`、`OverheadProps`、`GroundLayers` 四支。

**階段 2B-2 途中量到的缺陷**：BUG-224（分區建築放在**路面**高度 0.05 而不是地面
高度，連同十九種基礎設施一起浮空 0.6 m）、BUG-225（相鄰兩邊的鋪面在角落互疊 ——
既有測試數的是塊數，看不到位置）、BUG-226（貼牆的附掛物用了最寬牆面 ——
既有測試量的也是同一個假想建築，給了假綠燈）。

### 階段 2C-1 已完成（2026-08-09）

規格：`docs/superpowers/specs/2026-08-09-parametric-massing-design.md`
計畫：`docs/superpowers/plans/2026-08-09-parametric-massing-2c1.md`

手寫的 2–3 個變體換成每桶 8 個參數化生成的變體，實例縮放整個取消。

| | 改造前 | 改造後 |
|---|---|---|
| 每桶變體數 | 2–3 | **8** |
| 相鄰同變體率 | 33.4%（商業高 49.9%） | **3.1%** |
| 輪廓兩兩相異 | 未量 | **28/28 對**（每桶） |
| 不對稱變體 | 幾乎 0（置中方盒） | **4–6/8** |
| 等級對外型 | 無（`void level`） | 原型隨等級開放 |
| 實例矩陣 | `scale(±15%, ±10%, ±15%) × rotation` | **rotation + position** |
| 建築桶 | 60 | 168（空桶不送 draw call） |

- [x] `massing/metrics.ts`：共用純量搬到葉節點，斷開 propBands ↔ massing 的循環
- [x] `rng.ts` + `dimensions.ts`：容差改成 `max(10% × 目標, 一層樓)`
- [x] `volume.ts`：量體型別、`maxAbsOf`、`overlapOf`、`centroidOffset`、輪廓光柵
- [x] `composers.ts`：八個組合器（single／偏屋／L 形／裙樓塔／退縮／U 形／雙塔／兩跨）
- [x] `prototypes.ts`：六分區原型表，`minLevel` 決定等級差異，不對稱的排前面
- [x] `roofForms.ts`：七種屋頂形式，與原型分開挑
- [x] `assemble.ts` + `index.ts`：五種形狀共用一個 `frustum`
- [x] `propBands`：牆面改成**量**八個變體，不再是抖動公式；三個 band 加 `level`
- [x] 刪 17 個手寫變體與六個縮放函式（−792 行）
- [x] 鄰居迴避：相鄰重複率 33.4% → 3.1%
- [x] 空桶 `visible = false`；`aSeed.x` 改由變體的樓高決定，窗戶橫列對齊樓板
- [x] 展示區加變體選擇器與相鄰重複率顯示
- [x] BUG-227：量體的面全部朝內（帶號體積 −0.80）；展示區切分區時用上一個
      分區的密度重繪，配錯就是零個變體、整片空白

**測試**：4430 → 4498。新增 `MassingMetrics`、`MassingDimensions`、`MassingVolume`、
`MassingComposers`、`MassingPrototypes`、`MassingRoofs`、`MassingGeometry`、
`MassingVariety`、`InstancedLayerVisibility` 九支；刪除 `BuildingFootprint`
（十三條測試的去處逐條列在計畫裡）。

**與規格不同的三處**（都在計畫裡標明並附理由）：

1. 高度容差 ±10% → `max(10% × 目標, 一層樓)`。固定百分比在矮建築上把可行組合
   塌成一個 —— 住宅低 L1 只湊得出「2 層 × 2.64 m」。等級階梯因此改成看平均值。
2. 不對稱配額 6/8 → 4/8。板樓與裙樓塔本質上對稱，而它們是高密度分區在 L1
   僅有的原型。主要條件改成「八個變體的輪廓兩兩相異」。
3. 拿掉「一樓凹進（騎樓）」原型 —— 俯視高度圖看不出來，會與單一量體判定成
   同一個輪廓。騎樓效果本來就由懸挑層的雨遮負責。

**回退驗證抓到的三個假綠燈**（沒有它們會靜靜通過）：

- 所有輪廓測試都跑在 `Volume` 上，證明不了「畫出來的東西照著規劃」——
  把 `frustum` 的位移註解掉，十二條測試全綠
- `OverheadProps` 的貼牆測試拿 `narrowestBuildingEdge` 當基準，而雨遮的幾何
  也是用它建的 —— **BUG-226 的同一個錯誤又出現一次**
- 「原型 × 屋頂枚舉得到乘積」根本沒被測到；屋頂改回餘數，八條測試全綠

**階段 2C-1 途中量到的缺陷**：`differenceRatio` 的分母是整張光柵圖，所以形狀
愈小愈容易被判定成相同（改成兩者佔用格的聯集）；`CommuteTraffic.test.ts` 在
並行負載下偶發逾時（單獨跑 15 綠，與 `BirthAfterAgeing` 同一類，與本階段無關）。

### 階段 2C-2 待辦（尚未排計畫）

裝飾詞彙 —— 清單見規格附錄。

- [ ] 屋頂物件（現在完全空白）：住宅的煙囪／老虎窗／天線、商業的空調主機／
      排氣彎管／頂樓字牌、工業的煙囪／筒倉／集塵器／管架、辦公的冷卻塔／
      升降機房／停機坪標記
- [ ] 立面附加零件：陽台帶、體外之字形樓梯、水平遮陽百葉、轉角壁柱帶
- [ ] 地面詞彙擴充：公共電話亭、佈告欄、小候車棚、點餐車、三色回收桶組、
      變電箱、棧板堆、立式燈箱、停在架上的自行車、盆栽組
- [ ] 稀疏使用：每個變體從自己分區的詞彙抽 k 樣，k 隨等級走（L1 抽 1、
      L2 抽 2、L3 抽 3）

### 階段 2C 舊待辦（部分已由 2C-1 完成）

- [x] ~~參數化量體生成器：每桶 8 個變體，重複率 → 5% 以下~~ — 2C-1 完成（3.1%）
- [x] ~~等級的豪華階梯（量體）~~ — 2C-1 由 `minLevel` 完成；材質與零件仍待辦
- [ ] 色盤與 `aSeed.z` 加上等級維度
- [x] ~~工業的等級階梯改用煙囪／筒倉／管架／貨櫃，不再靠高度~~ — BUG-229 完成
      （量體加煙囪與筒倉，地面加管架／氣瓶架／棧板堆）
- [x] ~~商業低／辦公低若要庭院，先調窄目標寬度~~ — 2B-2 已做（8.4 → 7.8）

**階段 0+1 途中抓到的缺陷**：BUG-218（住宅高變體 3 越過格子邊界，包圍盒測試首跑抓到）、
BUG-219（升級把庭院的樹一起拉高 1.75 倍）、BUG-220（辦公區 15 人與 160 人的建築渲染相同）。
**階段 2B 規畫途中量到的缺陷**：BUG-222（14/20 個變體越過行人包絡線，4 個吃進鄰居格子）。

**測試**：4230 → 4295。**`BuildingRenderer.ts`**：3670 → 2866 行。

### 使用者驗收回饋（2026-08-09，接在 BUG-227 之後）

- [x] ~~商業低密度改用藍色系~~ — 牆色盤換藍；屋頂色盤從 GLSL 搬進
      `ColorPalettes.ROOF_PALETTE_TABLE` 才測得到，順便讓分區門檻由 `ZONE_CAT`
      推導而不是手寫
- [x] ~~有綠地貼面的邊要種樹~~ — BUG-228
- [x] ~~工業要有工業元素~~ — BUG-229

**這一輪抓到的缺陷**：BUG-228（樹種在沒有草皮的那一邊）、BUG-229（工業沒有任何
工業元素，地面物件比商業還少）；另外兩個在 BUG-229 途中冒出來的：屋頂蓋在煙囪
頂上、組合器沒替屋脊留位置導致一層樓的變體把煙囪埋掉。

**待辦**：屋頂色盤目前只有商業低密度換過色，其餘分區逐項照抄舊值 —— 若之後要
統一調色，資料已經在一張表裡了。

### 夜間照明（2026-08-09，使用者盤點後）

- [x] ~~商業低密度一樓落地窗進 windowMask~~ — 保留一整層樓高的玻璃與豎向窗框，
      只是它現在會亮；逐扇決定「這家店今晚有沒有開」
- [x] ~~切一個會發光的零件標籤~~ — `PART_LAMP`：燈頭、側招、廣告看板，吃
      `aOccupancy`（沒有人的建築不發光）
- [x] ~~工業的夜間語彙~~ — 高窗帶 + 「有些捲門是開著的」，第一版待調整
- [x] ~~展示區加住戶比例滑桿~~ — 順帶補上展示區從來沒餵過的逐實例屬性

**還沒做的（見 BUG-230 的盤點）：**

- [ ] 煙囪頂的航警紅燈 —— 靠 `PART_LAMP` 加一個小量體放在煙囪頂，閃爍用
      `uTime`。不要在 shader 裡猜「這是不是煙囪頂」
- [ ] **基礎設施建築完全不走這個材質** —— 警局／消防／醫院／學校／電廠／
      水廠／公園全是手搭的 `MeshLambertMaterial` Group，沒有窗戶也沒有燈。
      這是夜景剩下最大的一塊，但它們不是 instanced、沒有頂點色標籤也沒有
      `aOccupancy`，要獨立成一個階段
- [ ] 鋸齒天窗的斜面發光（那個斜面本來就是玻璃）—— 要在 `isRoof` 裡加分區
      判斷，而屋頂分支目前很乾淨，想做的話獨立一次

### 展示區忠實度（2026-08-10）

- [x] ~~地板顏色與遊戲地形一致~~ — BUG-231；顏色表抽成 `renderer/terrainColors.ts`
- [ ] 工業的「停車格」標線在尺度上不成立：貼片帶只有 1.97 m 深，而標線是
      1.6 × 1.67 m，真實停車格是 2.5 × 5 m。那個深度現實中畫的是**卸貨區
      分隔線或危險區斜紋**，不是停車格。`bays` 這個名字與它畫出來的東西
      也對不上
- [ ] 建築材質是 ShaderMaterial 且沒有 include colorspace_fragment，所以它
      的顏色是在**顯示空間**寫的，而 Lambert 材質（地形、基礎設施）在線性
      空間。兩者混在同一個場景裡，調色時很容易比錯 —— 目前靠註解擋著

---

## 遠景細節剔除（DETAIL_LOD）

已做。縮到視錐高度 90 格以上就把 `propLayer` 與 `overheadLayer` 整層關掉，
75 格以下放回來（中間 15 格是遲滯，避免滾輪停在門檻上時每幀開關）。

- 鏡頭是 `OrthographicCamera`，全畫面同一個距離 —— 逐棟算距離沒有意義，
  唯一有效的訊號是 `camera.top - camera.bottom`。
- 因此成本是每幀兩個比較，沒有逐實例的工作。
- 地面貼片（`decalLayer`）**不關**：它是平的鋪面，撐住「地面有東西」的觀感，
  關掉會讓遠景整片地變空，工業區那塊柏油也會跟著消失。
- 順手修掉 BUG-232（`setViewMode` 沒藏三個附掛層）—— 同一個 `visible` 的
  收斂點。
- 展示區也套用了。它畫的是普通 `Mesh`、走另一條路徑，所以實作分成兩份
  （`showcase/detailVisibility.ts`），但**門檻與遲滯共用** `renderer/detailLOD`
  ——各寫一份的下場已經示範過了（BUG-231 的地板顏色）。

還沒做的：

- [ ] 遠景時一併降低陰影成本。矮物件與懸挑本來就是 `castShadow = true` 的
  大戶，關掉整層等於也省了陰影那一趟，但量體的陰影仍然全開。
- [ ] 門檻沒有依畫面像素密度調整。90 格是照 1080p 推的（1 公尺 ≈ 1 像素），
  4K 或超寬螢幕上偏保守。

---

## 陰影品質（BUG-234 之後）

- [x] **`SHADOW_BIAS` 的世界距離沒有被算過。** 已算並已修（BUG-234 二修）：
  它是深度空間的值，世界距離是 `bias × (far - near)`，而 near/far 寫死成
  1 / 200 給了 199 格 = 2388 公尺的深度。改成每幀跟著陰影相機收
  （`shadowFit.shadowDepthRange`），bias 本身降到 -0.00002。
- [x] **兩個 bias 的數值已由使用者實機確認**（2026-08-10）：
  `SHADOW_NORMAL_BIAS = 5.0e-3`、`SHADOW_BIAS = -2.0e-5`。
  **這兩個數字不是推算出來的，是看過畫面決定的** —— 陰影貼回物體底部、
  地面沒有 acne，兩者的交界點沒有公式（它取決於陰影貼圖一個 texel 有多大，
  而 texel 隨縮放變）。要再動它們之前，先用展示區的兩根 bias 滑桿看過。
- [ ] **陰影貼圖的解析度限制。** `SHADOW_MAP_SIZE 2048`，陰影相機收到可見範圍
  再加 30% 之後，預設縮放下一個 texel 約 0.8 公尺、拉近到視錐 20 格時約
  0.27 公尺。**14 公分的燈桿在任何縮放下都小於一個 texel**，所以它的接觸
  陰影本質上畫不出來 —— 調 bias 幫不上忙，只有提高 SHADOW_MAP_SIZE 才有，
  而那是 VRAM 與填充率的成本。

---

## 圓塔（BUG-235 之後）

- [ ] **圓塔的立面窗格在轉角可能錯開。** shader 的 `wallU` 是「|n.x| > |n.z| 就
  取世界 z，否則取世界 x」。八角柱的每個面法線固定，所以每面各自算得沒錯，
  但相鄰兩面取的是不同軸，窗格在稜線上可能對不齊。手寫版沒這問題是因為它是
  2C-1 之前的舊 shader。**要開起來看才知道嚴不嚴重。**
- [ ] 其他分區要不要也有圓塔（辦公？住宅高？）。目前只有商業高密度 L3，
  八個變體裡一個。

