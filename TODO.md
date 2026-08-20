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

- [x] **BUG-330 七萬人時每 1.5 秒卡 0.1 秒** — 分片輪流（`HappinessSlicing.ts`），
  `N = clamp(6, 人口/2100, 72)`，用 id 雜湊分片。人口 12 372 → 125 788（十倍），
  快樂度成本 1.66 → 4.6ms/tick;改動前同樣規模是 68.5ms 集中在一個 tick。
- [x] **分片第一版的三個正確性 bug（Codex 審查抓到，已修）** — 詳見 BUGS.md BUG-330。
  1. 片數每個 tick 從當下人口重算 → 人口跨門檻時全城重新分片，落後時間沒有上界。
     改成輪次游標（`happinessCycle`），片數開輪時定死。
  2. 屍體／垃圾的待處理佇列被快取進情境 → 72 片的城市只有 6/72 的人看得到。
     佇列搬出情境，每個 tick 重建（長度與人口無關，不花錢）。
  3. 空城時情境不作廢 → 重新遷入的人拿到上一座城市的稅率與服務。
- [ ] **快樂度分片的殘留代價（已知，無法消除）** — 短命事件只有當下那幾片的人感受得
  到，而感受到的人會把那個值留到下次輪到為止（最久 3 個遊戲日）。持續性的問題每個人
  遲早都會感受到。12 600 人以下完全不受影響。要消除只能放棄分片。
- [x] **同一種病的四個鄰居**（12 萬人實測的尖峰）— 三招分別對三種形狀:
  | 函式 | 改動前 | 形狀 | 修法 |
  |---|---|---|---|
  | `updatePoliceFireLoads` | 102ms | 產一份總表 | **按建築去重**（`CitizenLocationIndex`）。結果不變，零延遲代價 |
  | `updateHospitalLoads` | 33ms | 同上 | 同上，條目多帶一個 `count` |
  | `updateSchoolLoads` | 21ms | 同上 | 同上，鍵是「住址 \| 學制」 |
  | `runRelocation` | 195ms | 決策迴圈 | **切片器**（`beginHousingRelocation`），照 `JobRelocationSlicer` 的形狀，攤 50 個 tick |
  | `updateCitizenHealth` | 28ms | 每人一個值 | **分片**（與快樂度共用 `SliceCycle` 與雜湊）+ 住址記憶 |

  住址記憶（`homeFactsFor`）**每個 tick 清空**:斷電、缺水、污染是玩家看得見而且會
  突然改變的東西，跨 tick 留著就會慢半拍。省下來的是「同一棟樓查 120 次」變成一次。
- [ ] **`JobRelocationSlicer` 有 BUG-331 的同一組問題**（見 BUGS.md）— 它的名單一拍就是
  上百個 tick，而它只擋 `homeId === null`:不擋 `Citizen.removed` 墓碑（死人會被換工作，
  吃掉配額），也不檢查候選工作地在這段期間有沒有被拆掉。墓碑已經立好了，接上去是一行。
- [ ] **分片的片號奇偶等於 id 的奇偶** — 雜湊乘數是奇數，所以
  `imul(id, M) mod 2 === id mod 2`。片數是偶數時，跟 id 奇偶相關的屬性會整批落在同一
  半的片裡。實際城市裡 id 只是流水號，跟住哪、幾歲無關，所以看不出影響 —— 但它讓一個
  突變驗證照不出 bug（測試照 `i % 2` 分配住址，兩組人永遠不在同一個 tick 被處理）。
  要消除的話乘一個奇數之後再做一次位移混合。**沒有已知的實際影響，先不做。**
- [ ] **分片會讓快樂度的抖動變慢（只在超大城市）** — `factors.commuteDistance` 每次
  重算都重擲一次 `Math.random()`，造成每位市民 sd 2.36 的變化（中位數 68，等於 3.5%）。
  **這是刻意的設計**:讓數字有微幅變化、玩家不好完全預測，看起來像有在運作。
  但抖動是「重算時才發生」，所以分片把它的頻率一起拉長了:

  | 人口 | 片數 | 每位市民多久抖一次 |
  |---|---|---|
  | 12 372 | 6 | 每 6 tick —— **沒變** |
  | 68 228 | 33 | 每 33 tick |
  | 125 788 | 60 | 每 60 tick |

  全城平均不受影響（兩種做法下都穩在 66.11~66.83），只有單一市民面板看得出來。
  要修的話把種子改成 `f(citizen.id, floor(tick / SLOW_TICK_INTERVAL))` —— 抖動頻率
  回到改動前，成本一樣是幾奈秒。**十萬人以下用不到，先不做。**
- [ ] ~~舊描述~~ `updateCitizenHappiness` 逐市民重算
  （慢速槽 4，每 6 個 tick 一次）。7 萬人時 68.5ms，1.2 萬人時只有 2.5ms/tick。
  跟 BUG-328 是同一種病:O(人口)、沒有節流，只是長在別的地方。
  **記憶化量過了，不是答案**:那段查詢逐市民 18.4ms、照住址記憶化 6.0ms（3.1 倍），
  但它只占整個函式的三成 —— 68.5ms 只能變成約 54ms。剩下的是 `calculateHappiness`
  本身，真正逐市民。（這座城市只有 107 棟住宅住 12 400 人，記憶化倍率 578 倍，
  即使壓到零也只省 21ms。）
  **可能有用的是切片**（`advanceCommuteFill` 那一招），但那是行為改變:快樂度反應
  變慢，而它會影響遷入遷出與建築廢棄。切幾份要看快樂度變化得多快，還沒量。
  隔壁的 `updateHospitalLoads` 是同一個形狀（7 萬人時約 17ms）。

### 玩家回報的三個卡點（Chrome trace 量過，人口 12,351，速度 1）

三個症狀各有各的成因，而且都在 `game.update()` 裡 —— 算繪與 GC 的
`outside` 時間 p99 只有 7.2ms，不是它們的問題。模擬 tick 跑在主執行緒的算繪迴圈裡
（`Game.ts` 的 `simLoop.tick()`），所以一個貴的 tick 就是一個掉的幀。

- [x] **BUG-327 每 15 秒卡半秒** — 兩步修完:`PathCellCache` 把「這條路徑經過哪些
  格子」快取起來（292 → 60ms，輸出逐格相同），`CongestionFlowSweep` 再把剩下的
  攤到 40 個 tick 上（每 tick 最多 14ms）。**最慢的 tick 311 → 78.8ms**，
  `mod60 = 2` 已經不在最慢的前六名。
- [ ] **`refreshCommuteStats` 還是一次算完** — 每 60 tick 一發，比基準線高出約 25ms
  （`mod60 = 3`）。`CongestionFlowSweep` 同一招套得上去，但已經不是玩家感覺得到的
  等級了，排在 BUG-328 後面。
- [ ] **密集陣列累加還沒做，而且有地雷** — 把流量累加從 `Map<string, number>` 改成
  `Float64Array` 快 5 倍（55 → 11ms）。**但 cellKey 不一定是兩段的**:高架道路是
  `"27,55,1"`（x, y, 層）。照 `x,y` 解析會讓 60 格高架路（流量圖的 18%）安靜地
  消失，而且沒有任何測試會紅。要做的話得先發號碼牌（`Map<string, number>` 內插），
  不能自己拆字串。
- [ ] **BUG-328 每 0.25 秒卡 40ms** — `spawnCommuteVehicles` 每 tick 對 1,238 位取樣到的
  市民做完整的多模式運具選擇，呼叫 878 次生成，**只生出 3.9 台車（0.4%）**。
  已削掉一塊:`BusSystem.getSegmentDistances` 改成以段落陣列當 key 的 `WeakMap`，
  同場 A/B **17.53 → 12.76ms/tick（省 4.77ms）**。根本問題未解。
  - **不能把生成點檢查提前** —— 這個迴圈同時在累計 `dailyRiders` 與行人 `pendingTrips`，
    先擋掉非開車的人會讓搭乘數垮掉。
  - **也不能快取運具決策** —— 那個答案連同一個 tick 的下一個人都不一樣:
    `isOverCapacity` 讀即時的 `dailyRiders`，「擠滿了會找替代方案」是真的在跑的回饋。
    快取它等於把容量回饋抹平。
  - 剩下的路只有「把生車與統計搭乘拆成兩個各自的抽樣預算」，**那會改變面板上的
    搭乘數字**，要先問過。
- [ ] **量測教訓:比例要靠同場 A/B，不能靠插樁分段** — 在 `TransitAvailability` 熱迴圈裡
  塞六個 `performance.now()` 讓整個函式慢了 68%，歸戶跟著失真（量到 80.4%，實際 27%）。
  下次量佔比:把原版接回 prototype，同一個 session 交替量。
- [x] **BUG-329 讀檔後前 11 秒** — 改成游標續掃（`COMMUTE_FILL_SCAN_PER_TICK = 1024`）。
  進遊戲頭兩秒的平均幀距 **203.6 → 24.6ms**，跑得出來的幀數 9 → 81。代價是暖機
  全部跑完從約 13 秒變成約 18 秒，已經看不出來了。

- [x] **BUG-326 壅塞改從需求算，並且逐路線** — 運具選擇改沿著市民自己那條快取路線
  逐格平均。全城負載 1.000 → 0.158，逐人 0.511 / 0.583 / 0.646。數車那一支整支移除。
- [ ] **公車的壅塞還是吃全城平均** — 公車跑在特定路線上，理當也逐路線算。
  `BaseTransportSystem.congestionLevel` 是單一數字，要改成逐路線得先動那個介面。
- [ ] **`FLOW_PER_LANE_SATURATED` 與 `CONGESTION_EXPONENT` 是照一座城市校準的** —
  12 280 人、284 格道路那一座。換個路網密度差很多的城市可能要重調。
- [ ] **玩一輪確認手感** — 量得出來的都量了（蓋路的回饋強度、分佈、運具分佈）。剩下
  「蓋東西的時候城市有沒有在回應你」只能親自踩一次。

- [x] **BUG-325 匯流偵測撈半徑內所有車** — 改成照終點（`toId`）分組，每 tick 檢查的車
  從 301 783 台降到 27 459 台。
- [x] **`advanceEdgeVehicles` 的三個熱點** — 匯流偵測改分組（68.6 → 7.9ms/tick）、
  跟車查詢提前收工（每台車 10.3 → 2.7 條邊）、排序的前綴和改查表（每幀 14 438 → 21.8
  條邊）。分段從 240.4 降到 136.3ms/tick，而且變平了:主迴圈 48.2、匯流分組建表 30.0、
  索引重建 24.6、排序 20.6、edgeIndex 11.6。
- [x] **查過了:排序是必要的，缺的是測試** — 迴圈最後每台車會把自己的新位置與
  `braking` 寫回逐邊索引（「Update edge index for trailing vehicles to see our new
  position」），所以後車讀到的確實是前車這一幀剛算好的值。實測同一份存檔跑一幀，
  842 台車有 547 台的位置與速度會因為順序而不同。補了 `FrontToBackOrder.test.ts`:
  把排序反過來、整個拿掉、或不寫排序鍵，三種都會紅。
- [ ] **`edgeIndex` 每幀配置 871 個項目物件**（整幀的 8.6%）— 試過池化重用，撤掉了:
  `vid` 忘了更新的話沒有任何測試會紅，而失敗模式是跟車距離靜靜地算錯。要做的話
  得先補得住那幾個欄位。`EdgeIndexFreshness.test.ts` 目前擋得住「位置凍結」那一種。
- [ ] **`mergeGroups` 與生成點索引各做一次逐車內插**（30.0 + 24.6ms/tick）— 兩邊要的都是
  位置與車頭方向。共用一份的話要處理「生成點索引必須排除已抵達的車」這件事，
  代價是位置晚一幀。

- [x] **BUG-323 生成點檢查掃過全部車輛** — 改成逐格索引（`spawnHash`），
  155.9ms/tick → 2.1ms/tick，整個 tick 從 485ms 降到 330ms。
- [ ] **BUG-324 生成被拒絕的比例過高** — 同一份存檔車輛數從 1970 掉到 890，路上比實際
  通勤量空一半;連帶讓「人口 ÷ 8」的運具評估迴圈每個 tick 跑滿（另外 21ms/tick）。
  拒絕率已量出:`spawnVehicleOnEdges` 每 tick 呼叫 878 次、成功 3.9 次，**99.6% 被
  `isSpawnBlocked` 擋下**，而車輛數（1,634）距離上限（2,000）還有 366 台。
  還沒分清楚是「檢查範圍太大」還是「出口本來就滿了」—— 下一步是量被拒絕的生成
  集中在少數幾個建築門口還是散在整張圖。

- [ ] **每 tick 的生成量分散（`SPAWN_SPREAD_TICKS`）沒有測試守住** — `spawnCommuteVehicles` 的
  `maxPerTick = max(5, ceil(eligible/8))` 把一天的通勤分散到 8 個 tick。把它改成
  `eligible.length` 之後全套測試仍然全過:車流上限會把總量擋在同一個位置，只是
  「一口氣衝滿」而不是慢慢長 —— 那是觀感，現有的斷言看不到。要守的話需要一個
  看「成長速率」而不是看「最終數量」的案例。
- [ ] **`Game.getTrafficStats()` 的接線沒有測試守住** — 面板的通勤車數量是在 `Game.ts`
  裡選擇要傳哪一支計數器（`getCommuteVehicleCount` vs `getVehicleCount`）。`Game.ts`
  會 import Three.js，core 測試碰不到。目前只靠 `TrafficStatsContext` 的欄位名
  （`commuteVehicleCount`）表明意圖，接錯不會變紅。
- [ ] **`src/ui/modals/TrafficModal.tsx` 是死碼** — `GameUI.tsx` 沒有掛載它，交通面板走的是
  `overview/TrafficPage.tsx`。兩邊各有一份摘要卡片，改動時要記得它不會被看到。

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
- [ ] 這一類已經不只三支了。2026-08-13 全跑三次，紅的組合每次都不一樣：
  `BirthAfterAgeing` ×2、`GroundPropLayer > should never scale a garden`、
  `BuildingMaterial > should at least be bracket-balanced`，全部單獨跑是綠的，
  紅的原因是 vitest 每條 5 秒的上限（那幾條單獨跑就要 0.9～4.2 秒）。逐條調
  `timeout` 是在追症狀 —— 該處理的是這些測試為什麼要跑幾秒鐘。
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

- [x] **生成點被佔著就不生車**（BUG-319）。通勤路線共用，同時出發的人全部落在同一
      個點。API 拆成 `addXxx`（原語，放車）與 `spawnXxx`（政策，出門）兩層 —— 第一版
      把檢查塞進 `addXxx`，30 個在建構情境的測試被迫加儀式，那是分錯層。
- [x] **車的起訖點釘在最外側車道**（BUG-318）。規則本來就存在，但寫在沒人呼叫的
      `refineLanePath` 裡（連測試都是綠的），實際跑的 `findLanePath` 從不管。
- [x] **轉向車道偏好只在路口生效**（BUG-317）。彎道沒有直行車流可以被切過（各車道
      的弧同心），但規則只看方向有沒有變，所以 S 型路每個右彎都要「切出去再切回來」，
      實測 5 次換道。條件加進共用的 `turnLanePenaltyInt`，兩個引擎共用。
- [ ] **`LANE_SPEED_DECAY` 讓內側車道便宜 5%**。它想表達的「內側比較快」是執行期
      現象（外側有人減速、右轉、公車靠站），卻寫成規劃期的固定成本 —— 副作用是每台車
      都把超車道當巡航道，跟靠外側行駛的慣例相反。要處理得連 `LaneChangeCost.test.ts`
      幾條建立在它上面的測試一起重寫。使用者已知，暫不動。
- [x] **車庫不開在匝道與路口上**（BUG-316）。匝道是跨過自己那一格爬上去的，結構
      壓在地面;路口正中央更不用說。兩條都加在 `findBuildingAccessPoints`。
- [ ] **`RAMP_OVER_ROAD` 的驗證不對稱**（BUG-316 順帶發現）。它只擋「匝道蓋在既有
      地面路上」，不擋「地面路畫在既有匝道底下」，所以同一格可以同時有路與斜坡，
      畫面上那條路會穿過斜坡。要修得在 `RoadBuilder` 加對稱檢查，會影響既有存檔。
- [x] **分區名稱不再被高樓蓋掉**（BUG-315）。`depthTest: false` 擋不住後畫的東西;
      建築也是 transparent，兩邊 `renderOrder` 都是 0，先後就由深度排序決定，而它
      比的是**物件原點** —— 整座城市拿地圖西北角的深度去排。標籤改設 900。
- [x] **路口放行改看車身中心**（BUG-314）。從「車尾出得去」放寬成「中心出得去」——
      真人開車會把車頭探出去一點，嚴格版看起來很僵硬。上限是半個車身（0.11 格，
      約 1.3 公尺）留在路口裡;整台車卡在裡面仍然會被擋。純外觀取捨，兩者效能相同。
- [x] **路口淨空只擋排隊中的車**（BUG-314）。BUG-313 不分前車停著還是在開，
      正常車流的通過量被砍一成（2214 → 1987）。改用 `Vehicle.braking`（它正在為
      前方減速）當訊號 —— 與路型無關，而且是車隊形成的訊號，比「它停了沒」早。
- [x] **路口淨空**（BUG-313）。車不再貼著前車停在路口正中央把橫向車流鎖死;進去
      之前先確認車尾出得來，否則停在停止線上。`LaneEdge.insideJunction` 在建圖時
      標好，自由車流時判斷會在第一行回頭，實測 0.057 ms/frame @ 2000 台。
- [x] **建築只從地面上路**（BUG-312）。緊鄰高架的房子原本會直接掛到橋面的車道點，
      車憑空出現在二樓。新增 `UnifiedRoadLookup.getGroundKeyAtPosition`，並把同步
      與 worker 兩條各自抄了一份掃描迴圈的呼叫端收斂到 `findBuildingAccessPoints`。
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

## 公共建築的夜景（BUG-238）

**進行中，分支 `feat/civic-building-facelift`。**
規劃：`docs/superpowers/specs/2026-08-11-civic-building-facelift-design.md`
計畫：`docs/superpowers/plans/2026-08-11-civic-building-facelift.md`

- [x] **Task 0 — 立面 if 鏈改由 `ZONE_CAT` 生成。** 原本是手寫的六個門檻，
      也就是 `ZONE_CAT` 的第二份資料。整份 shader 的差異只有一行
      （`0.30000000000000004` → `0.3`，編譯後同一個 float）。
      驗收靠 `building-frag-baseline.glsl` 的逐字元比對。
- [x] **Task 1 — 四個公共立面類別**（`FACADE_CIVIC` 1.2 / `UTILITY` 1.4 /
      `TRANSIT` 1.6 / `GREEN` 1.8，key 從 101 起跳避開 `ZoneType` 0–6）。
      辦公那個無條件的 `else` 換成 `else if` —— 沒換的話公共建築會靜靜地
      長出辦公的玻璃帷幕窗格。
- [x] **Task 2 — `civic/` 基礎建設**（`CivicPlan` / `assembleCivic` /
      `assembleDecals` / 靜態 model 表）。量體借分區建築的 `Volume` 與
      `shapeOf`，只換護欄：擋佔地邊界而不是行人包絡線。
- [x] **Task 3 — showcase 的 civic 檢視模式。** 三角形預算改逐格算。
- [x] **代表色**（使用者追加）。新增逐幾何的 `aBldgColor` 屬性 ——
      公共建築是普通 `Mesh`，沒有 `instanceColor`，原本會**全部變成同一片灰**。
      顏色沿用舊版（警局靛藍、消防局紅……），並支援逐量體覆寫（醫院的紅十字、
      大學的金頂）。垃圾場的舊色與小學一模一樣，已改成工業褐。
- [x] **物件與綠化的額度調寬**（使用者指定）。公共建築一座城市只有幾十棟，
      單棟多花的三角形量不到；分區建築鋪滿地圖，同樣的想法會打爆預算。
      矮物件從每格 120 提到 400。
- [x] **矮物件全部抽成共用圖元**（使用者：「花盆什麼的所有矮物件都可以做成
      共用?」）。17 個圖元從 `groundProps` 搬到 `geometry/plants.ts` 與
      `geometry/props.ts`，改吃世界座標而不是「格子的物件帶」——
      公共建築佔 2×2 到 9×6 格，根本沒有環帶這回事。住宅那側改成薄包裝，
      幾何逐頂點不變（頂點指紋 fixture 守著）。
- [x] **公共建築的夜燈：有電才亮，而且不是全亮。** `aOccupancy` 在公共建築上
      載的是「有沒有電」而不是使用率 —— 它們不是住的，變暗的原因是停電。
      有電時的亮窗門檻取**住宅那條規則在住戶比例 85% 時的值**
      （`mix(0.95, 0.4, 0.85)` ≈ 0.48，約一半亮）。第一版寫成「85% 的窗亮著」
      是讀錯需求 —— 85% 亮看起來仍然像一張發光的板子。哪幾扇亮隨 uTime 的
      epoch 換，週期 150–300 秒，與住宅同一個節奏。
- [x] **停放的車輛改用現成的車輛幾何**（使用者：「巡邏車看起來是一個方塊而已，
      是不是有車輛的物件可以參考?」）。`CivicPlan.vehicles` 吃 8 種現成車型，
      與城市裡開著的那些是同一份幾何。它們自己一個 mesh 走車輛材質 ——
      車輛把 RGB 直接寫在 `color` 屬性上，而建築 shader 把 `color` 讀成
      （零件標籤, 分區, 地面明度），混在一起會把警車變成一塊灰。
      `PlacedCivic` 因此把 `building` 與 `vehicles` 在型別上分開。
- [x] **展示區的 civic 模式一次排出全部十九棟**（使用者指定）。逐一切換看不出
      彼此的關係，而顏色分不分得開、高度差合不合理、街道家具的密度一不一致
      正是要驗收的東西。下拉選單移除。
- [x] **批 1 — 民生服務 6 種**
  - [x] 警局（2×2）L 形＋瞭望塔（疊在翼樓屋頂上）
  - [x] 消防局（2×2）一排捲門＋**落地的**訓練塔＋紅色主體
  - [x] 醫院（2×3）主樓＋雙側翼＋連廊＋頂樓直升機坪＋急診紅帶與發光十字
  - [x] 小學（2×2）低矮、兩排平行教室、操場與球場線、遊具（滑梯／攀爬架／鞦韆）
  - [x] 高中（2×3）三層教室樓＋**橢圓跑道**（20 段轉向標線）＋司令台
  - [x] 大學（3×3）四面圍合的方庭＋圓頂主樓＋鐘塔（兩面發光的鐘）
- [x] **批 2 — 綠地 2 種**。公園（1×1，涼亭＋十字步道＋四塊草地）、
      墓園（2×2，成排對齊的墓碑＋山牆禮拜堂＋發光十字＋門柱）。
- [x] **批 3 — 公用設施 4 種**。共用 `FACADE_UTILITY`，差別在剪影：
      煙囪（電廠）／圓池（水廠）／土丘（垃圾場）／方池（汙水廠）。
      水面與覆土走 `PART_GROUND` + `shade`，不是牆。
- [x] **批 4 — 交通站點 4 種**（全部 1×1，全專案最緊的尺度）。共用夜間語彙是
      發光的識別柱。候車亭／地面出入口＋電梯井／站房大鐘＋月台＋雙軌／
      深色水面上的棧橋＋航道標誌燈。
- [x] **批 5 — 機場 3 種**。三座由同一個生成器產出（小 5×4／中 7×4／大 9×6）。
      五條帶：跑道（虛線中線＋兩側邊燈＋頭端燈）／滑行道（連續中線＋等待線＋
      兩條斜引道）／停機坪（機位導引線＋停著的真飛機＋空橋）／航廈＋塔台／前庭。
- [x] **三角形預算校準**（計畫 Task 11）。原本四個數字是推的，現在是十九種
      實測最大值 × 約 1.5：量體 200／貼片 30／懸挑 20／矮物件 750 + 每格 140。
      矮物件改成「基礎 + 斜率」—— 純逐格的模型在 1×1 的公園上不成立，
      它整塊基地就是矮物件。
- [x] **批 6 — 遊戲整合**（BUG-238 收尾）。十九種在遊戲裡也走 `CivicPlan`。
  - [x] 擺放搬到 `renderer/geometry/civic/place.ts`，遊戲與展示區共用同一份
        （`placeCivicPlan`）。`instanceAttrs.ts` 跟著從 `showcase/` 搬進
        `renderer/geometry/civic/` —— 它已經不是展示區專用的了。
  - [x] `BuildingRenderer.buildModel` 改走 plan，十九個手寫的 `buildXxx()`
        連同 1 683 行一起刪掉。留著跑不到的第二份畫法只會被誤認成現役的。
  - [x] `HighlightManager.applyTintToGroup` 改寫 `aHighlight` /
        `aHighlightColor`（建築 shader 本來就吃這兩個屬性），不再 clone 材質
        —— clone 出來的收不到 `uTime`，被高亮過的窗戶會凍結。
  - [x] `snapToGround` 的渡輪碼頭例外拿掉。那是照著「基地裡有港池」那一版
        寫的，而那片水在 BUG-244 就拿掉了 —— `isShorePosition` 要求碼頭
        那一格是陸地。
  - [x] ~~機場的裝飾幾何與 `AirplaneAnimator` 的路徑表對不上（BUG-239）。~~
        已修：路徑表搬到 `renderer/airportPaths.ts` 成為單一事實來源，
        `buildAirport()` 從它推導跑道帶、滑行道、機位與空橋，不再自己決定
        任何一個 z。大型機場因此長出兩條跑道帶。靜態飛機只停在算出來的遠端
        機坪（小／中型沒有空間，就一架都不停）。

- [x] **批 5.5 — 使用者回饋的形象修正**（BUG-240 / BUG-241）。
  - [x] 空橋改成從航廈的牆伸到機頭前的一條臂（長度由機位與機身推導），
        並加上落地的支撐腳。前兩版一版插進機身、一版飄在停機坪上。
  - [x] 墓園拆掉禮拜堂 —— 一座 5.5 m 的紀念碑取代 8 × 6 m 的山牆小屋。
        「墓園裡沒有房子」由「不准有任何一片 `PART_ROOF`」與
        「任何量體的佔地 < 16 m2」兩條守。
  - [x] 抽水廠改成蓋在水岸邊：北端一條深色河面貼片、護岸、跨在岸線上的
        取水口與伸進水裡的攔汙柵，色系從水藍改成水務綠。
  - [x] 醫院改白色系。牆本來就是 0xe8e8e8，問題在屋頂 —— `PART_ROOF` 吃的是
        各分區共用的屋頂色盤，公家那組是深瀝青（最亮 0.38），等角視角下
        屋頂面積比牆大，整棟讀起來是深灰的。改走 `PART_GROUND` + 高明度。
  - [x] 捷運站改成四面都能下樓的通道建築：中央玻璃通道 + 四個方向各一道
        接到人行道的階梯口（原本是單一出入口 + 電梯井擠在左半）。
  - [x] 十二處「車停在東西裡面」（BUG-240）與火車站的假鐵軌（BUG-241）。
  - [x] 停機坪不再放靜態飛機 —— 它與地勤車搶同一塊地，而動畫飛機本來就會
        降落、滑進來、停 5 秒再推出去。

- [x] **批 5.6 — 第二輪形象修正**（BUG-242 / BUG-243）。
  - [x] 空橋改成沿著機身左舷走：長度 ×2、寬度 ÷1.5、往 −x 偏 1.9 m。
        原本它停在機頭正前方（與機位同中線），讀起來是「頂著機頭」。
  - [x] 火車站站房 7.6 → 5.6 m（屋脊 9.6 → 7.2 m）。
  - [x] 渡輪碼頭重做：港池走新的 `PART_WATER`、碼頭邊停一艘**渡輪**
        （`buildFerryGeometry`，與航線上跑的同一份）、跳板接到船舷。
  - [x] 抽水廠主色改成河的藍（色相對齊 `TERRAIN_COLORS[WATER]`），
        水塔與塔頂改白。
  - [x] 大學拆掉鐘塔，圓頂改成**半球 + 鼓座**（`shapeOf` 新增 `dome`）。
  - [x] 電廠改成**冷卻塔**的剪影（`shapeOf` 新增 `cooling`：有腰的旋轉體），
        並補上出線構架。原本的兩支圓柱煙囪與水廠的圓柱水塔幾乎同一個剪影。
  - [x] 十六處「共用圖元長在建築裡」（BUG-242）。

- [x] **批 5.7 — 第三輪形象修正**（BUG-244 / BUG-245）。
  - [x] 抽水廠與渡輪碼頭不再自己畫水；碼頭把「岸」做在佔地前緣，船靠在
        那條線上（隔壁那一格才是地形的水）。
  - [x] 電廠的煙囪與冷卻塔改走 `PART_DETAIL` —— 不再長高窗帶。
  - [x] 大型機場四個機位、間距 1.0 格（12 m > 翼展 10.8 m）。
  - [x] 大學圓頂 −30%（直徑 8.4 → 6.4、鼓座 3.5 → 2.2 m）。

- [x] **批 5.8 — 第四輪形象修正**（BUG-246 / BUG-247）。
  - [x] 新增 `PART_SHELL`（0.9）：唯一照量體自己的顏色畫的分支。三條既有的
        路（牆／`PART_DETAIL`／`PART_GROUND`）都畫不出白色，而且都不報錯。
  - [x] 抽水廠的塔身與塔頂改走 `PART_SHELL` + 白，這才真的是白的。
  - [x] 抽水廠重排：四座池排成 2×2、中間讓出十字通道，機房橫在南緣，
        塔站在機房旁邊 —— 河拿掉之後東北角原本一大片是空的。
  - [x] 電廠的煙囪與冷卻塔改走 `PART_SHELL` + 清水混凝土色。
  - [x] 新增 `shape: 'stack'`：煙囪頂上是一圈環加一個凹下去的管口，
        內壁法線朝軸心（`LatheGeometry`），俯視看得進去。
  - [x] 渡輪碼頭移除靜態渡輪（與公車站同一條理由：真船由 `FerryAnimator`
        開），甲板加寬成南半整片並架起候船雨棚。

- [x] **批 5.9 — 截圖抓到的三件**（BUG-248 / BUG-249）。
  - [x] 冷卻塔套上與煙囪同一個折回去的塔口 —— 使用者說的破口一直是它，
        `LatheGeometry` 上下都沒有蓋，高視角俯視就直接看穿。
  - [x] `SHELL_LIFT`（1.06 / 頂面 +0.14）+「必須 ≥ 1」的驗收；水塔改純白。
  - [x] 沉澱池與曝氣池的水面改走 `PART_WATER` —— 地面的色譜全是灰的，
        那四個圓原本是四個黑洞。
  - [x] `shot.html` + `src/showcase/shot.ts`：單棟、鏡頭與時間全由 query
        決定的截圖頁。展示區一次排十九棟，要看某一棟得手動拖曳，而那個
        位置沒有辦法重現 —— 同一個網址永遠得到同一張圖，才拿得來比對前後。

- [x] **批 5.10 — 第五輪形象修正**（BUG-250 / BUG-251 / BUG-252）。
  - [x] 電廠全廠高度 ×0.7（煙囪 25 → 17.5 m、冷卻塔 17 → 11.9 m），
        抽水廠的水塔 15 → 10.5 m。上下界一起釘住 —— 只留下限的話調回去
        不會有任何東西轉紅。
  - [x] 水的色譜補上泥漿那一段（`WATER_MURK_MAX`），汙水廠改成土色。
  - [x] 水位**真的**上下起伏：`BUILDING_VERT` 吃 `uTime`，只位移朝上的面，
        振幅 `WATER_BOB` 不得超過水層厚度的一半。
  - [x] 火車站的站房與月台用**跨站天橋**連起來；軌道走廊從禁建區改成
        淨空包絡線（`TRACK_CLEARANCE`）。站前加門廊，大鐘改掛站前那一面。
  - [x] 全專案的註解不再逐字引用對話原話 —— 改寫成設計事實（69 處）。

- [x] **批 5.11 — 第六輪形象修正**（BUG-253 ～ BUG-258）。
  - [x] 新增兩個**開口容器**形狀：`tub`（圓）與 `basin`（方）。實心的量體
        畫不出「水面低於槽緣」—— 水面壓到頂面之下就整個埋進量體裡了，
        資料是對的而畫面上什麼都沒有。比例寫在 `TUB`，量體與幾何共用。
  - [x] 抽水廠：高塔移除，四座池改成**白色的大水桶**（`PART_SHELL` + 純白
        + `tub`），水位低於桶緣 0.98 m。機房拉長補上高塔騰出來的南緣。
  - [x] 汙水廠：四座方池改 `basin`、圓池改 `tub`，水位低於池緣 0.43 m。
        走道橋的柱子從池心移到池與池之間 —— 池挖空之後它們會站在水裡。
  - [x] 電廠：冷卻塔移除，改成**兩支煙囪**（一高一矮）。管口的凹槽從
        全高的 12% 加深到 86%，並在管口裡塞一支深色內襯（`boreLining`）
        —— 這個引擎沒有環境光遮蔽，光挖深的話管壁仍然是亮的。
  - [x] 火車站：天橋與樓梯塔拆掉，**站房改成站在月台上**，月台是它旁邊
        一片鋪面加一道雨遮。月台明度拉開站前鋪面，邊緣警示帶從標線層
        改成月台面上的一道薄帶。

- [x] **批 5.12 — 第七輪形象修正**（BUG-259 / BUG-260）。
  - [x] 電廠改成**一座粗的、有腰的塔**（`shape: 'cooling'`，直徑 11 m、
        高 19 m），塔口凹槽加深到全高的 22% 並加上深色內襯。輪廓移進
        `metrics.ts`：塔口的內外緣（`COOL.THROAT` / `COOL.RIM`）要算出來，
        航警燈才站得住那一圈環。
  - [x] 開關場補上四根電桿、九條**黑色導線**、兩層橫擔與四台變壓器。
        導線走 `PART_SHELL` + 近黑色，並由一條驗收守住「兩端都要落在桿上」。
  - [x] 展示區畫出真的那條軌道（`showcase/track.ts`），證明鋼軌貫穿車站。
  - [x] 火車站補上電車線（柱、懸臂、接觸線壓在 `TRACK_CLEARANCE` 上）、
        月台的長椅／垃圾桶／時刻表，以及月台盡頭會亮的號誌機。
  - [x] 火車站改成**雙側式月台**：軌道兩側各一座月台，站房與候車室對角
        站在上面，各自一道雨遮。這一格因此沒有地面了 —— `fixtures` 清空，
        月台上的東西全部走 `props`（識別柱也是，`totem()` 多一個柱腳參數）。
        `OVERHEAD_PER_CELL` 20 → 30：兩道雨遮與佔地大小無關。
  - [x] 展示區的軌道 7 格 → 3 格。連同兩端的延伸段原本伸出 4 格，而排版的
        間距只有 2 格 —— 鐵軌從隔壁那一棟的屋頂穿出來。

順手記下的小事（不在計畫裡，未排）：

- [ ] `pickChain` 產生的色票門檻帶著浮點雜訊（`0.3333333333333333`）。
      Task 0 的 `round6` 只修了分區門檻，沒動色票 —— 那是既有行為，
      Task 0 的基準裡就有 3 處。純粹是可讀性，編譯後是同一個 float。


- [ ] **公共建築完全沒有夜間燈光，也幾乎沒有窗。** 警局／消防局／醫院／學校／
      公園／電廠／水廠／垃圾場／汙水廠／墓園／車站／機場走的是另一條渲染
      路徑：20 個手寫 `buildXxx()`、220 個 `MeshLambertMaterial` 實心盒子，
      完全不經過 `BUILDING_FRAG`。`emissive` 在整個 `BuildingRenderer.ts`
      裡出現 0 次。唯一的「窗」是消防局那兩個貼平色的塔窗盒子
      （`BuildingRenderer.ts:1029-1037`）。
      它們**有**光照（Lambert 吃 directional + ambient，天黑會跟著暗、
      陰影也正常），缺的是自發光與窗格。詳見 BUGS.md BUG-238，那裡列了
      三條修法與各自的成本。
- [ ] 上面那條與 `colorspace_fragment` 那條是同一個裂縫的兩面 —— 公共建築
      搬進 shader 的話，兩個色彩空間的不一致會一起消失。要動的話一起評估。

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

---

## 效能（2026-08-10 實測）

- [x] **換工作那一輪切片化** —— 1474 ms → 每 tick ≤ 49 ms，長影格歸零。止痛。
- [x] **BUG-109 治本：改走路網圖。** 實機驗收：快取在有高架的城市裡穩定到達
  READY（改前永遠 empty），runJobRelocation 從 1474 ms／輪降到 0 ms，抽 120 對
  家→工作比對快取與同步查詢零不一致。詳見 BUGS.md。
  現在只要有一格高架道路，整座城市的距離快取就停用（連算都不會算），
  341 人的城市每輪要 1474 ms 的 Dijkstra。
  spec 與計畫已完成（`docs/superpowers/specs|plans/2026-08-10-workplace-distance-graph*`，
  經 Codex 三輪審核）。做法不是把高架塞進平面緩衝，而是建一張格子層的
  `RoadCellGraph`，把樓層與匝道規則在建圖時消化掉，同步查詢與 worker 共用
  同一個 flood 核心。
  - [x] 成本整數化（順序無關，硬約束才可能成立）
  - [x] Task 1 建圖／Task 2 flood 核心／Task 3 種子與附掛／Task 4 轉置圖
  - [x] Task 5 序列化／Task 6 同步查詢改用核心／Task 7 worker／Task 8 接線與刪閘門
- [ ] **下一個瓶頸：`computeCongestionFlow`**（實測 20 秒 7 次、合計 236 ms、
  單次最高 47.4 ms）。它是批次計算，單次就是一個掉幀 —— BUG-109 治本之後
  它是最慢 tick 的主因。
- [x] **BUG-237：反向 flood 付錯端點的成本**（隨 BUG-109 治本一併修，見 BUGS.md）
- [x] **量過了：快取來得及重建，A 值得做**（2026-08-10，2297 人的存檔）。
  先前的疑慮是「作廢比重建快，快取永遠到不了 READY，A 會白做」。**不成立。**

  ```
  作廢頻率    30 秒 10 次（0.33/s），間隔中位數 2704 ms、最短 302 ms
  重建耗時    173 ms（101 個工作地點、budget 60），而且在 worker 裡
  ```

  重建比最短的作廢間隔還快。粗估快取約有 **94%** 的時間會是 READY，剩下
  6% 落在重建視窗裡 —— 而那段時間走的同步 fallback 現在已經被切片化，
  不會再造成卡頓。主執行緒在重建時只付一次 3600 bytes 的緩衝複製。

  量法：暫時在執行期讓 `hasAnyElevatedRoad()` 回 false，讓遊戲自己走正常
  路徑發出請求並計時到 READY，接著立刻還原閘門並 `reset()` 丟掉那份忽略
  高架、因此不正確的結果。
- [ ] **下一個瓶頸是車流**：`advanceEdgeVehicles` + `queryNearbyInto` +
  `findGapAhead` ≈ 主執行緒 12%。每幀均攤，不造成卡頓。

- [x] **BUG-262：車輛渲染的實例容量逐車種寫死 500**（見 BUGS.md）。模擬端的上限
  是全部車種合計 2000，人口約 2400 以上時 `car` 就越過 500 —— 越過的照樣參與
  碰撞，只是不畫，畫面上是一台車對著空白煞車、一兩秒後那台憑空出現。改成不夠
  就加倍擴容。
- [x] **車輛的視錐剔除**（BUG-262 的後續，見 BUGS.md）。車輛的 mesh 是
  `frustumCulled = false`，所以逐台的判斷得自己做。正常遊玩的縮放下省掉 73%
  的車輛頂點。判準是視錐不是固定半徑 —— 後者在拉遠時會讓車只出現在畫面中央。
- [x] **BUG-263：號誌插在對向車道的柏油路上**（見 BUGS.md）。改成路緣式懸臂，
  `TrafficLight` 加 `roadType` 讓渲染端算得出路緣。
- [ ] **車道模型與路寬模型在六車道上對不起來**：`LANE_GEOMETRY.LANE_WIDTH` 是
  0.18，六車道每向三條 = 0.54，而 `ROAD_WIDTHS[SIX_LANE]` 的半寬只有 0.475 ——
  最外側那條車道有一部分在路面外。車子實際上就開在那裡（`LaneGraph` 的橫向偏移
  用的是 0.18）。要嘛車道寬跟著路寬算，要嘛六車道加寬。BUG-263 只是繞過它
  （燈頭改放車道中間），沒有解決。
- [x] 號誌桿原本是 `0x333333`，貼在黑色柏油上幾乎看不見 —— 貼近看時四支只有
  一支讀得出來。改成直接用 `STREET_LAMP_COLOR`：路邊的金屬桿件是同一個顏色，
  而共用同一個常數就不會有第二份可以漂移。
- [x] **BUG-264：車道寬與路寬是兩套獨立的數字**（見 BUGS.md）。改成
  `getLaneWidth(roadType) = 路寬 / 2 / 該向車道數`，虛線也從同一個來源算。
- [ ] **單行道只用到半邊路面**。`LaneGraph` 從中心線往行進方向右側排車道，而單行道
  所有車道同向 —— 於是車全擠在右半邊，左半邊的柏油是空的。要修的是**錨點**：單行道
  的車道應該以路面中心為基準攤開，而不是以中心線為基準往一側排。BUG-264 因此讓單行道
  也切半幅（車至少都在柏油上），並讓它維持原本的中心虛線。
- [x] **BUG-265：載入完成的城市，模擬讀到的通勤人口只剩兩成**（見 BUGS.md）。
  `warmup` 的第二份工作（替全體通勤人口建立路線快取）沒有名字，最佳化第一份時被
  一起丟了。載入仍然只算要上路的那些，其餘的人留 `pending` 記號，`advanceCommuteFill`
  逐 tick 補完。載入 20.2 秒 → 5.9 秒的改善保住，預測車流回得去。
- [x] **BUG-266：換工作跑到一半拆掉住宅就丟例外**（見 BUGS.md）。分片器的名單是
  開一輪時拍下來的，`citizen.homeId!` 那個驚嘆號跨 tick 之後不成立。
- [x] **BUG-267 誤判，已撤回**（見 BUGS.md）。「worker 在真實城市找不到路徑」是量測
  腳本自己造成的 —— 包裝 `onResult` 時抓到的是前一段診斷留下的樁。重量的結果是
  worker 完全正常，40 個 tick 回了 3 000 多筆、沒有一筆是空的。
- [x] **補完全城通勤路線約 30 個 tick**（1 倍速約 7.5 秒，2 146 人的存檔）。預測車流
  3 501 對上改前的 3 504。沒有 worker 時（生產環境缺 COOP/COEP）走主執行緒每 tick
  2 條，慢得多但一樣會補完。
- [x] **BUG-268：切過 Metro Underground 再切回來，馬路變成灰色**（見 BUGS.md）：
  `RoadRenderer.setViewMode` 白模化時蓋掉材質顏色，離開時只還原透明度不還原顏色。
  新增 `renderer/ViewModeDim.ts` 統一記錄／還原原色（`userData.baseColor`）。
  不只 Underground，Rail / Ferry / Bus focus 與「點選建築回到正常視角」都會踩到。
- [x] **BUG-269：地下模式看得到一整層不透明的高架橋**（見 BUGS.md）：
  `ElevatedRoadRenderer` 沒有 `setViewMode`，`Game.applyViewMode` 也沒通知它。
  高架改為與地面共用 `VIEW_MODE_OPACITY[mode].road`；視角記在 renderer 上，
  重建（`ensureLevel`）與新增格子（橋墩／護欄）都會重新套用；路燈光暈直接關掉。
- [x] **BUG-270：進入任何聚焦模式，全城建築整個消失**（見 BUGS.md）：
  白模的 `mergeGeometries` 因為屬性集合不齊而回 null，但原本的網格已經隱藏了。
  改成烘白模前先去索引、只留 position/normal。
- [x] **BUG-271：路口號誌在聚焦模式下還是實心的**（見 BUGS.md）：
  `TrafficLightRenderer` 補上 `setViewMode`，跟著 `road` 透明度走，重建自動套回。
- [x] **BUG-272：路線連線畫在正常視角，一進聚焦反而全部消失**（見 BUGS.md）：
  改為 `filterRoutesForViewMode`；聚焦中的站點不白模化（`getFocusedStopKind`）。
- [x] **路線連線改成拋物線**：直線連線在密集路網上會糊成一團 —— 兩條共用同一段的
  路線完全重疊。弧的數學放在 `core/transport/RouteArc`（純邏輯，禁 Three.js）：
  水平投影仍是直線、端點落在站上、拱高照跳距等比但有上限（`ARC.RISE_MAX`）。
  拱高與段數是外觀值，看實機再調。
- [x] **BUG-273：換工作的兩個門檻一個永遠不成立、一個永遠成立**（見 BUGS.md）：
  改成單一規則「通勤時間 > 60」，估不出時間才退回直線距離。門檻由六種合成城市
  加一份真實存檔的實測分布定出。順手刪掉失去呼叫者的 `getCommuteLength`。
- [x] **BUG-274：住房評分看距離，捷運蓋了也不影響居住選擇**（見 BUGS.md）：
  改看通勤時間，並新增 `TransitAccessField` 把配對查詢壓成 O(1)。
- [x] **通勤時間圖層與總覽面板**：新增 `OverlayType.COMMUTE`（住宅格上色為住戶的
  平均通勤時間，綠→紅，刻度是絕對值：滿格 = 換工作的門檻），同時標出所有大眾運輸
  站牌 —— 「這片紅色離最近的站有多遠」正是這張圖要回答的。Overview → Traffic 分頁
  加上中位數／平均／超過門檻的比例／分布長條／交通方式分布／通勤最久的 5 個住宅區
  （可點擊移動鏡頭）。統計不進存檔，慢速 tick 重算。
- [x] **BUG-275：覆蓋圖層下地面貼片隨鏡頭角度忽隱忽現**（見 BUGS.md）：
  地面覆蓋層補上明確的 `renderOrder`，排在地面細節之前。所有圖層共用同一段
  建立程式碼，所以一次修好全部。
- [x] **BUG-276：漸層高亮下所有公共建築被塗成同一個顏色**（見 BUGS.md）：
  `hoverHighlightGradient` 對基礎設施一律用 `cells[0].color`，改成逐格查表。
- [x] **BUG-277：通勤圖層是死的快照**（見 BUGS.md）：統計更新不會亮起任何 dirty
  旗標，圖層因此不會重建。補上統計版本號，`updateRenderers` 比對後重建。
- [x] **BUG-278：步行距離用直線量，看不見馬路**（見 BUGS.md）：四個挑站牌的地方
  （`TransitAccessField.build`、`findAvailableTransit`、`findMultiModalRoutes`、
  `findNearestStop`）全部改用新的 `SidewalkStopReach` —— 從站牌的門節點在人行道圖
  上跑有界 Dijkstra。行人只在路口過馬路是設計，繞路本身沒錯；錯的是模擬把住戶配給
  對街的站牌。代價是公車涵蓋範圍縮到 52~56%，「站牌蓋在路口旁」因此成為有後果的
  決定。轉乘步行（`buildTransferGraph`）一併改掉 —— 留一個用直線就是留一個縫。
- [x] **BUG-279：新蓋的交通設施與公共建築進不了人行道圖**（見 BUGS.md）：
  `placeTransportStop` / `placeInfra` / `placeAirport` 都補上 `applyBuildingChange`
  （原 `applyBuildingRemoval`，改名是因為它一直都是「照 grid 重算這幾格」）。
  `warmup` 補上 `ensureSidewalkGraph`。
- [x] **BUG-280：每一次道路編輯都重建整張人行道圖**（見 BUGS.md）：改走既有但從
  未被呼叫的 `updateCells`。不能沿用 `dirtyRoadCells`（`rebuildLaneGraph` 會先把它
  清掉），改用獨立的 `dirtySidewalkCells`。84~159 ms → 0.24~0.42 ms。
- [x] **BUG-281：拆格子留下指向已刪節點的殘邊**（見 BUGS.md）：反向邊是拿組出來的
  id 比對的，而 id 早就含了種類與路寬，永遠對不上。改成直接比對終點。
- [x] **BUG-282：getEdgeIds 每次都掃全圖**（見 BUGS.md）：改成隨增刪維護 Set。

- [x] **BUG-283：搭車的人被記到別條路線的站**（見 BUGS.md）：`findAvailableTransit`
  算出上下車站之後把它丟掉，派車再用「整個系統最近的站」重挑一次，同運具多條路線
  時會挑到別條線上。改成把估計所依據的上下車站一起帶回來，派車與計數直接用它；
  `StopChoice.ts` 整支刪掉。

- [x] **BUG-284：公共建設剛蓋好就顯示缺水缺電**（見 BUGS.md）：涵蓋範圍只在 slot 1
  重算，而放置路徑的「立刻重算」漏掉了電與水。抽成
  `SimulationLoop.recalculateUtilityCoverage()`，放置與拆除都叫它。
- [ ] **建商蓋好的房子仍有最多六個 tick 的水電延遲**：BUG-284 只補了玩家動手的路徑。
  成長 tick 沒補，是因為它一次會蓋很多棟，每棟都跑一次全圖 BFS 太貴 —— 而玩家沒點
  任何東西，看不到那個延遲。要修的話得先讓涵蓋範圍能增量更新。

### 這一輪留下的、還沒處理的
- [x] **步行上限要不要調**：已調 —— 公車 4→5，其餘 ×1.5（捷運／火車／機場 8→12、
  渡輪 6→9、未知運具 5→8）。60×60 合成城市量到：涵蓋 1192→1663 格，壅塞 1.0 時
  大眾運輸分擔率 5.0%→10.0%，不壅塞時幾乎不動（2.1%→2.8%）。放寬上限只有在
  「開車夠痛苦」的時候才換得到搭乘率，這正是想要的形狀。
- [ ] **合成城市量不到二階效果**：可及性圖變寬會讓更多格子的通勤分數變好，居民
  往那邊搬，搭乘率再上去一輪。上面那組數字是固定住居民位置量的，實機玩過才看得到
  完整幅度。
- [ ] **`invalidateNear` 的半徑跟著變 12**：理論上每次道路編輯要丟掉 2.25 倍的站牌
  快取。建圖本身只從 33.2ms 變成 36.0ms，但失效那條路徑沒有單獨量過。
- [ ] **`SidewalkGraph.findNearestNode` 仍是全圖線性掃描**（兩萬個節點）。只在
  「格子裡沒有門節點」時才會走到，BUG-279 修完之後那條路徑幾乎不會發生，但它還在。
- [ ] **`findPathMultiTarget` 的 open set 是線性找最小值**（O(n²)）。行人路徑快取
  擋掉大部分成本，還沒成為瓶頸。

## 分區覆蓋層（BUG-285 ~ 287，2026-08-17）

- [x] **BUG-285**：`getColor` 補 `DISTRICT` 分支，把 builder 的值當色相用
- [x] **BUG-286**：逐格透明度接到 geometry（頂點色改 itemSize 4 / RGBA），沒有資料
  的格子不再被塗。濃度是二元的，不照數值等比縮放 —— 多數圖層的數值是分類而非強度
- [x] **BUG-287**：分區色值改用流水號走黃金比例展開，連號分區不再撞色

### 這一輪順手查到、沒有處理的
- [ ] **覆蓋層的頂點取樣偏半格**。頂點 (i,j) 位在世界座標 (i−0.5, j−0.5)，也就是格
  (i,j) 的左上角，卻直接吃格 (i,j) 的值 —— 所以色塊整體往左上偏半格，而且單格的
  特徵會沿著格子邊界暈開一格。分區是大塊區域，看不太出來；如果之後有逐格精度要求
  的圖層（例如單格的違規標示），要改成 per-cell 的四頂點或換成 InstancedMesh。
- [ ] **`OverlayRenderer` 的高架層仍然沒有逐格透明度**。`instanceColor` 只有三個
  分量，three.js 沒有 instance alpha；高架格是明確列舉出來的，值為 0 的格子不會進
  清單，所以目前不成問題。

## 條例系統（2026-08-17）

計畫：`docs/superpowers/plans/2026-08-17-district-ordinances.md`（經 Codex 兩輪審查改寫）

- [x] Task 1：收入乘數認得分區類型（`revenueByZone`）
- [x] Task 2：`Policy.level` 取代 `active`，存檔遷移
- [x] Task 3：`POLICY_EFFECTS` 分級，`maxLevel` 由表推導
- [x] Task 4：`crime` 槓桿 —— 條例可以有代價
- [x] BUG-288：舊存檔的回收遷移到正確的等級
- [x] Task 5：依規模計費，刪 `Policy.cost`
- [x] Task 6：全城條例 + 節能法規
- [x] Task 7：條例 UI（分級按鈕、全城條例面板）
- [x] Task 8：預算面板逐條列出政策支出

### 條例系統留下的、沒有處理的
- [ ] **條例目錄**（賭場、壅塞費、育兒補貼、義務教育等）。機制已經做好，那些是往
  `POLICY_EFFECTS` / `POLICY_BILLING` / `POLICY_SCOPE` 加列，另開一份計畫。
- [ ] **地形驅動的分區專精**（`docs/districts-options.md` 的選項 B）。獨立子系統。
- [ ] **刪掉 `taxRateOverride` 與 `efficiencyMultiplier`**。兩個沒有消費端的欄位。
- [ ] **預算面板是即時重算的，帳本每六個 tick 才算一次**。中間人口或分區格數變了，
  面板顯示的金額會跟國庫上一次實際扣的錢不同。這對每一列支出都成立（道路維護、
  服務費用也都是即時重算），不是政策獨有的 —— 但按人口計費的條例讓這個差距變得
  成比例而不是零頭。要修的話得讓面板讀結帳當下的快照，而那會讓面板在第一次結帳前
  顯示 0（暫停時永遠不會結帳，跟 BUG-284 同一類毛病），所以需要一併處理。

### 條例目錄（第一批+第二批）已完成
條例從 6 條長到 16 條。分區 11 條、全城 5 條。

- [x] Task 1：`crime` / `landValue` / `garbage` 三個槓桿接上全城範圍
- [x] Task 2：五條分區條例（賭場、夜間經濟、宵禁、歷史保存、產業補貼）
- [x] Task 3：兩條全城條例（監視器網路、垃圾隨袋徵收）
- [x] BUG-290：犯罪補齊到圖層、幸福度、棄置壓力
- [x] BUG-291：分區垃圾乘數的整合測試
- [x] 夜生活三條互斥（賭場 / 夜間經濟 / 宵禁），setter 與存檔兩道都擋
- [x] Task 4：`waterDemand` 槓桿 + 節水法規（乘數同時作用在帳面需求與供水 BFS）
- [x] Task 5：`sewageLoad` 槓桿 + 汙水處理標準
- [x] Task 6：`industrialPollution` 槓桿 + 工業排放管制（範圍改成分區）
- [x] Task 7：16 條依分類分組（土地使用 / 經濟 / 治安 / 環境）
- [x] 移民吸引力也接上條例的犯罪效果（測的是骰子的偏向，不是擲出來的結果）
- [x] 跨全表的方向不變量、精確的 16 條清單、獨立的範圍 oracle

### 條例目錄留下的、沒有處理的
- [ ] **兩個 modal 的接線沒有測試守得到**。分組邏輯全在 core 的 `policiesByCategory`
  且測到底，但「modal 有沒有呼叫它」守不到 —— 專案沒有 jsdom 也沒有 Solid 的測試庫。
  要補的話得先決定加不加那兩個開發相依。
- [ ] **代價可能落空**。宵禁套在沒有商業的住宅區只有好處沒有代價;歷史保存套在
  純工業區同理;節水法規在純住宅城市也一樣。靜態的 `PolicyTradeoff` 檢查只看效果
  物件裡有沒有代價欄位，看不到那個代價在這座城市裡有沒有承擔者。
- [ ] **數值平衡**。16 條的數字都是第一版，還沒有實際玩過一輪校準。
- [x] **第三批條例**（育兒補貼、義務教育、免費診所、禁菸令、壅塞費）。見下一節。

## 第三批條例（2026-08-18）

條例從 16 條長到 21 條。五個新槓桿，每一個都追到一個真的會改變模擬結果的行。

- [x] `fertility` → `Birth.birthTick` 的最終生育機率
- [x] `compulsorySchooling` → `CitizenManager.educateTick` 的兩個 phase
- [x] `deathRate` / `coveredDeathRate` → `deathTick` 的 `DeathContext.policyMult`
- [x] `driveDeterrence` → `chooseModeMultiModal` 的開車成本（三個呼叫端都接）
- [x] 計費基數認得人口結構:`babies` / `children` / `teens` / `clinicPatients`
- [x] 育兒補貼分三級 = 補到嬰兒／兒童／青少年，費用按實際受補人頭算
- [x] 義務教育分三級 = 辦到國小／高中／大學，範圍外的階段不加速
- [x] 免費診所只保護醫院蓋得到的人（覆蓋外的人本來就沒在看病）
- [x] 新分類 Welfare 與 Transport

### 第三批留下的、沒有處理的

- [x] **壅塞費的過路費進市庫了**（2026-08-18）。做法見下面「條例的收入面」。
- [ ] **`citizen.health` 仍然是唯寫欄位**。它有一個寫入者（`updateCitizenHealth`）、
  零個讀取者 —— 死亡、幸福、遷移都不看它，只有面板印得出來。免費診所刻意走死亡率
  而不是接在這裡，就是為了不再犯一次 BUG-091（收錢但對模擬沒有效果）。要修的是
  讓健康分數真的影響什麼，那是獨立的一件事。
- [ ] **第三批的數字都是第一版**，跟前兩批一樣還沒有實際玩過一輪校準。`ChildcareSubsidy`
  的 1.2/1.45/1.7 與 `FREE_CLINIC` 的 0.88/0.75 尤其沒有把握 —— 生育與死亡都是
  複利型的量，偏一點點跑久了差很多。
- [ ] **壅塞費只在「公車搭得到但輸給開車」的窄區間裡看得出效果**。站牌超出步行範圍
  的話公車根本不會被列為選項（`getAvailableTransit` 直接不回報），收多少費都改變
  不了什麼;站牌在範圍內的話公車又幾乎穩贏。測試是靠「三站一台車」把班距拉長才
  搭出那個區間的。這不是 bug，但它讓這條條例在真實的城市裡多半不痛不癢。
## 條例的收入面（2026-08-18）

條例本來只會花錢。壅塞費是第一條會賺錢的 —— 而它同時兩邊都有:門架要維運，過路費
要收。

- [x] `POLICY_REVENUE` 獨立一張表，不是讓單價帶正負號。一條條例的兩邊跟著**不同的
  東西**變（門架跟道路格數、過路費跟還在開車的人），一個帶正負號的數字表達不了。
  分開也讓計費表既有的不變量原封不動繼續守支出。
- [x] 新的流量基數 `chargedDrivers`:還在開車、而且起訖任一端在收費區裡的通勤人數。
  由 `refreshCommuteStats` 那一趟順手數出來 —— 它本來就在算每個人選了哪一種運具。
- [x] 門架維運費改跟**分區內的道路格數**走，不是總格數。門架架在路上，圈一片綠地
  不該產生任何維運費。
- [x] 帳本多一列綠色的 Policy Charges;逐條明細同一列同時顯示 −門架費 與 +過路費。
- [x] 條例卡片顯示淨額，賺錢時是綠色的 `+$X`。
- [x] `panelIncomeTotal` 把面板的總收入加總抽成函式 —— 寫在 .tsx 裡的話，漏加一項
  不會有任何測試轉紅，而漏加的正好會是最新加進來的那一個。

### 上線後回報的（2026-08-18，玩家實測）

- [x] **BUG-320:過路費被每個收費區各收一次**。付費人數本來是一個全城的總數，而計費
  是逐分區跑的 —— 兩個收費區就把同一筆過路費收兩次，畫十個收十次。改成
  `chargedDriversByDistrict`，一趟車只記給它真正付費的那一區（兩端都在收費區時記
  給嚇阻比較高的那一個，跟 `tripDriveDeterrence` 取最大是同一條規則）。
- [x] **BUG-321:數值嚴重失衡**。實測 1700 台車的城市收到 $50,000，比整座城市的總支出
  大一個數量級。門架 `[2.5, 6]` → `[0.8, 1.8]`，過路費 `[1.8, 3.2]` → `[0.04, 0.09]`。
  仍然沒有實際玩過一輪校準。
- [x] **BUG-322:帳本收合起來只顯示支出**。展開看得到 −門架費 與 +過路費，收合卻只
  印負的。改成兩張表各自自洽:規費只出現在收入表（可展開，逐條列出哪幾條在賺錢），
  維運費只出現在支出表。同一筆錢在兩邊各印一次的話，玩家把看得見的列加起來會對不上
  總額。
- [x] 清掉 `GameUI` 裡沒有入口的 `'ordinances'` 分支與那段已經不成立的註解。

### 這一輪留下的、沒有處理的

- [ ] **壅塞費在真實城市裡幾乎不減少車輛**（玩家實測:政策下去後車輛數沒變）。
  機制是「讓開車在心裡變貴，所以有替代方案的人改搭大眾運輸」—— 但一趟通勤如果
  兩端都走不到站牌，`getAvailableTransit` 根本不會回報任何選項，選擇清單裡只有
  開車，收再多錢也改變不了。目前它在多數城市是一條純收費、不減量的條例。
  要讓它真的減量，得加一個「這趟乾脆不出門」的出口（trip suppression，現實裡道路
  定價確實有這個效果），而那是在運具選擇裡加一種新結果，會動到通勤統計與生車兩條
  線。是一個設計決定，不是調參數。
- [ ] **收費區只認起訖點，不認路過**。家跟公司都在區外、只是開車穿過去的人不會被
  收費。原因是選運具發生在**算路線之前** —— 那時候還不知道他會走哪條路。要做成
  真正的過路收費得把順序倒過來（先算路線再選運具），那是另一件事。
- [ ] **每次重繪都會走一趟全部分區的格子**。`countRoadCellsInDistrict` 是
  O(分區格數)，而 `billableDistricts` 在預算面板與條例面板的 signal 上。跟
  `computeCityScales` 是同一個問題:面板該讀結帳當下的快照，而不是自己重算一次。
  三件事（規模、道路格數、面板與帳本的一致性）要一起處理。
- [ ] **收入表的不變量還很薄**。目前只有一條條例有收入面，所以「單價要正、逐級要
  更多」這種跨表檢查只驗得到它自己。第二條收入型條例出現時要回頭補跨表的方向
  不變量，像支出那邊一樣。
- [ ] **`chooseMode`（非多模式版）沒有跟著加嚇阻乘數**。它沒有任何生產端呼叫者，
  只有測試在用 —— 跟著改會讓一批測試改成無關的形狀，不改則兩個版本的行為分岔。
  真正該做的是把它刪掉，那要先確認那批測試是不是還在守什麼別的東西。
- [ ] **條例面板每次重繪都會走一趟市民清單**。`computeCityScales` 是 O(人口)，而
  `scale()` 在 Solid 的 signal 上，面板開著時每個 tick 都會重算。十萬人的城市開著
  面板時會有感。要修的話得讓迴圈把結帳當下的規模快取起來給面板讀 —— 而那跟
  「預算面板是即時重算的，帳本每六個 tick 才算一次」是同一個問題。


### 測試的隨機性（已掃過一輪）
用 24 個不同種子跑全套，只倒兩條，都已修（BUG-294）。方法記在這裡以免重做:

- **有效的做法**:替換 `Math.random` 成固定種子的 PRNG，用多個種子跑全套。每個種子
  都是一次可重現的「倒楣日」。
- **無效的做法**:把 `Math.random` 換成常數 0 或 0.999。那會讓每個機率分支全開或
  全關，倒下來的多半是「測隨機性本身」的測試（`pickWeighted`、加權取樣、死亡率統計），
  不是缺陷。`src/core/__tests__/helpers/seededRandom.ts` 的註解早就寫過這件事。
- 還沒上種子但會跑到擲骰子路徑的測試檔還有六十幾個。24 個種子下都沒倒，所以沒有
  一次全部套上 —— 真的倒了再補，比製造大量 churn 好。

### 環境問題（開發中遇到，尚未查明）
- [ ] **派 Codex 背景審查會弄壞 `node_modules/.bin`**。兩次審查結束後 `npx vitest`
  都開始報「找不到指令」，`node_modules/.bin/` 整個消失，而且 `.pnpm` 也缺檔案，
  要 `rm -rf node_modules && pnpm install` 才修得好。推測是 Codex 在主 repo 或
  它自己開的 worktree 裡跑了安裝指令。之後派工要明確禁止它動 `node_modules`。
- [ ] **不要在 Codex 背景審查跑的時候 `git add -A`**。審查會為了突變測試暫時改壞
  原始碼再還原，那個中間狀態被 `git add -A` 收進了 7222238（見 BUG-291）。要嘛等
  審查結束再提交，要嘛只 `git add` 明確路徑並在提交前看一次 diff。

### 分區筆刷（BUG-297 之後）
- [ ] **單格搶別區的格子做不到**。點一下別區的格子是「選它」，所以要把別區的單獨
  一格併進來只能拖一個更大的矩形再扣掉多的。取捨是刻意的（見 BUG-297）。
- [ ] **刪除沒有二次確認**。分區身上的條例設定會一起消失，而那是玩家花時間調的。
  目前只有 tooltip 說了這件事。要不要加確認，等實際玩過再決定 —— 畫分區是高頻
  動作，每次都問會很煩。

### 地形高度也偏西北半格（BUG-305 的另一半）
- [ ] **`TerrainRenderer.build` 第 54-66 行**用了跟覆蓋層一樣的 `頂點(i,j) ← 格(i,j)`，
  而頂點在格子的角上。地形**顏色**沒事（DataTexture + NearestFilter，一格一 texel，
  對位是對的），但**高度**被釘在每格的西北角:一格獨立的高地，隆起的最高點落在它的
  西北角，斜坡與明暗跟著偏。水面 `-0.2` 走同一條路，所以海岸線也偏。
  正解是頂點取共用它的**四格平均**（邊界夾住），一格高地就會變成對稱、以格子為中心
  的小丘。覆蓋層那招（少一段）在這裡用不了 —— 地面必須鋪滿整張地圖。
  沒有一起改是因為它會動到**每一座山的輪廓**，是外觀決定不是純修正。

### 圖層的製造點（藍色）
- [ ] **五張圖層沒有可以指的製造點**:車流、汙染、土地價值、用地、分區。前四張的
  來源是整座城市共同的結果，硬指一棟會誤導；汙染看起來最像有來源，但遊戲裡的
  `PollutionSource` 包含**每一格工業建築與每一條有車流的路**（見
  `GridPollutionSources`），全標藍等於把路網整個點亮。要做的話得先決定只標玩家
  自己蓋的那幾種設施（發電廠、掩埋場、汙水廠、機場），並想清楚漏掉工業區會不會
  反而讓玩家找錯地方。
- [ ] **`Game.appendOverlaySourceHighlights` 沒有測試守著**。哪張圖層讀哪一批設施、
  多格建築的佔地怎麼展開，都在 `OverlaySources` 裡且有測試；但「算出來的格子真的
  被推進 `overlayHighlightCells`、而且推在結果之後」這段接線在 `Game.ts` 上，
  而 `Game` 至今沒有任何測試（要先解決 jsdom + Three.js 的建構成本）。

### 測試環境
- [ ] **有測試對機器負載敏感，而且不只一條**。`BirthAfterAgeing.test.ts` 是已知的
  兩條（5 秒 timeout，單獨跑 1 秒內結束，但瀏覽器分頁在 60fps 跑遊戲時整套會從 20 秒
  變 64 秒）。合併回 main 那次另外倒過 5 條與 2 條，**當下沒有抓到檔名**，重跑就全綠 ——
  所以受影響的範圍比已知的那兩條更大。
  後來在 `src/renderer` 抓到了檔名，錯誤訊息都是 `Test timed out in 5000ms`，連跑三次
  倒的是不同的組合:`BuildingAppearance` / `BuildingCapacity` / `BuildingMaterial` /
  `GroundPropLayer` / `GroundProps` / `MassingGeometry` / `civic/CivicPlans` /
  `civic/models/Airport`。這些測試在建幾何，單獨跑都是毫秒級。
  模擬那邊也有:`Simulation` 與 `Integration` 的「跑一千 tick」、`WarmupCost`、
  以及原本就知道的 `BirthAfterAgeing`。同樣單獨跑全過。
  要處理的話有兩條路:把 timeout 調高（治標，但那些測試本來就不該花 5 秒），或找出
  慢在哪裡。在那之前，跑全套前先把跑著遊戲的瀏覽器分頁關掉。

### Codex 審查（e75aeee..HEAD）留下的
- [ ] **`paintDistrictRect` 接受越界座標**。唯一的 UI 路徑在 `Game` 裡先夾過，所以
  玩家操作是安全的;但這個匯出的 core API 拿不到地圖尺寸，直接餵 `(-1,-1)` 會把無效
  的格子寫進 `DistrictManager` 並存檔。要修得把尺寸傳進來，那會動到所有呼叫端。
- [ ] **忙碌的城市會頻繁重建整張圖層**。`rebuildDirtySubsystems` 尾端在任何子系統
  dirty 的那一幀會重跑 `setOverlay`，而那會 dispose 並重配 200×200 的 PlaneGeometry
  與所有分區的文字貼圖。空城實測是 0 次／224 幀（有 `if (!anyDirty) return` 擋著），
  但城市一忙 `d.buildings` 會常亮。要修得給圖層自己的 dirty 判斷。
- [ ] **範圍是按樣本數裁的，不是按日曆天**。`bucketChartSeries` 把 `spec.days` 當成
  「最後 N 筆」，而 `history.days` 的實際值不參與判斷。目前採樣每幀都跑、天數不會跳，
  所以碰不到;但如果之後改成節流或背景分頁採樣，Week 就可能裝著幾十天前的資料。
