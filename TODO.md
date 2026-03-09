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

### 8.7 計程車 ✅ 已整合到 SimulationLoop + GameState

- [x] **TEST**: 計程車站提供彈性交通
- [x] **TEST**: 居民可呼叫計程車
- [x] 實作 TaxiSystem 模組
- [x] 整合到 SimulationLoop ✅ taxi.tick() + getOperatingCost()
- [x] UI：計程車站放置 ✅ taxi_stand tool

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

- [x] 視錐剔除（Frustum Culling）
- [x] LOD（遠處簡化模型）
- [x] 區塊化載入（Chunk-based loading）

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
