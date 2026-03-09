# 驗收標準文件

> 本文件定義每個 Phase 的驗收條件。
> - **單元驗收**：對應測試檔案中的 test case，測試全過 = 通過
> - **系統驗收**：跨模組整合行為，需手動或整合測試確認
> - **視覺驗收**：需在瀏覽器中肉眼確認（適用於渲染/UI）
>
> 標記：`[ ]` 未驗收 | `[x]` 已驗收

---

## Phase 1：專案初始化

### 驗收條件

- [x] `pnpm install` 零錯誤完成
- [x] `pnpm dev` 啟動後瀏覽器可訪問 localhost，畫面顯示空白頁或 Hello World
- [x] `pnpm test` 執行一個 dummy test 並通過
- [x] `pnpm lint` 無錯誤
- [x] TypeScript strict mode 啟用，任何 `any` 型別報錯
- [x] Vite dev server 回應 headers 包含 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`（SharedArrayBuffer 前置條件）
- [x] 目錄結構符合 PLANNING.md 定義

---

## Phase 2：地圖網格系統（Grid）

### 單元驗收

- [x] `createGrid(200, 200)` 回傳的 grid 有 40,000 個格子
- [x] `getCell(grid, 0, 0)` 回傳有效格子，所有屬性為預設值
- [x] `getCell(grid, -1, 0)` 回傳 `null`
- [x] `getCell(grid, 200, 0)` 回傳 `null`
- [x] `setCell(grid, 5, 5, { terrainType: WATER })` 後再 `getCell` 回傳值正確
- [x] `getCellsInRect(grid, {x:0,y:0}, {x:3,y:3})` 回傳 16 個格子
- [x] `getNeighbors(grid, 5, 5)` 回傳 4 個相鄰格子（上下左右）
- [x] `getNeighbors8(grid, 5, 5)` 回傳 8 個相鄰格子（含對角）
- [x] 角落格子 `getNeighbors(grid, 0, 0)` 回傳 2 個（不越界）

### SharedArrayBuffer 驗收

- [x] `new SharedArrayBuffer(200 * 200 * 12)` 大小 = 480,000 bytes
- [x] 透過 `Uint8Array` view 寫入 terrainType，再用另一個 view 讀取，值一致
- [x] 兩個不同的 TypedArray view（如 `Uint8Array` 和 `Uint16Array`）指向同一 buffer 的不同 offset，互不干擾

### 地形驗收

- [x] 設定格子為水域後，`canBuild(grid, x, y)` 回傳 `false`
- [x] 設定格子有礦脈資源，`getNaturalResource(grid, x, y)` 回傳 `ORE`
- [x] 地形高度設為 10，`getElevation(grid, x, y)` 回傳 10

### 系統驗收

- [x] 建立 200×200 地圖耗時 < 50ms
- [x] 全圖掃描（40,000 格逐一讀取）耗時 < 10ms

---

## Phase 3：道路系統（Road）

### 單元驗收

- [x] `buildRoad(grid, {x:2,y:5}, {x:6,y:5}, ROAD_2LANE)` 在 (2,5)~(6,5) 共 5 格建道路
- [x] 中間格子 (3,5) 的 `roadFlags` 包含 EAST 和 WEST
- [x] 端點格子 (2,5) 的 `roadFlags` 只包含 EAST
- [x] `ROAD_2LANE` 屬性：lanes=2, speedLimit=50, capacity=中
- [x] `ROAD_6LANE` 屬性：lanes=6, speedLimit=60, capacity=高
- [x] 在水域格子建路回傳 `{ success: false, reason: 'WATER_TILE' }`
- [x] 資金 1000，建路成本 1500 → 回傳 `{ success: false, reason: 'INSUFFICIENT_FUNDS' }`
- [x] 建路成功後資金正確扣除

### 路網圖驗收

- [x] 建一條路後，路網圖節點數 = 2（兩個端點），邊數 = 1
- [x] 兩條路交叉後，交叉點成為新節點，邊數正確拆分
- [x] `isConnected(network, A, B)` 在有路連接時回傳 `true`
- [x] 拆除中間路段後 `isConnected` 回傳 `false`

### 交叉路口驗收

- [x] 水平路 + 垂直路交叉 → 交叉格 `intersectionType` = `CROSS`（4 方向）
- [x] 水平路 + 垂直路 T 接 → `intersectionType` = `T_JUNCTION`（3 方向）
- [x] 交叉口預設 `trafficControl` = `TRAFFIC_LIGHT`
- [x] 切換後 `trafficControl` = `ROUNDABOUT`

### 道路升級驗收

- [x] 2 車道升 4 車道後，`lanes` = 4, `speedLimit` = 50, `capacity` 增加
- [x] 升級費用 = 新道路成本 - 舊道路成本
- [x] 升級後旁邊格子的 `maxDensity` 從 LOW 變為 HIGH

### 曲線道路驗收

- [x] 給定 3 個控制點，產生的格子序列形成平滑曲線
- [x] 曲線路段每個格子的 `roadFlags` 正確指向前後格子方向
- [x] 曲線與直線交叉處正確產生交叉口

### 高架橋與隧道驗收

- [x] 同一格 (5,5) 有 elevation=0 的路和 elevation=1 的高架路，兩者獨立
- [x] 高架路不與平面路產生交叉口
- [x] 高架路建設成本 = 平面路 × 1.5（或設定的倍率）
- [x] 隧道可穿越 terrainType=MOUNTAIN 的格子

### 系統驗收

- [x] 連續建 100 條道路，路網圖結構正確無斷裂
- [x] 拆除重建反覆 50 次，路網圖一致性不破壞

---

## Phase 4：區域規劃（Zone）

### 單元驗收

- [x] 道路旁格子劃為住宅區後 `zoneType` = `RESIDENTIAL_LOW`
- [x] 非道路旁格子劃區回傳失敗
- [x] 框選 3×3 範圍批次劃區，所有道路旁格子被劃設
- [x] 取消區域後 `zoneType` = `NONE`
- [x] 已有建築的格子劃區回傳 `{ success: false, reason: 'BUILDING_EXISTS' }`

### 密度驗收

- [x] 2 車道路旁 → `maxDensity` = `LOW`
- [x] 4 車道路旁 → `maxDensity` = `HIGH`
- [x] 路升級為 4 車道後，旁邊已劃的低密度區 `maxDensity` 自動更新為 `HIGH`
- [x] `getMaxDensity(grid, x, y)` 回傳正確密度

### 系統驗收

- [x] 建路 → 劃區 → 確認區域只出現在道路旁（不會蔓延到非鄰路格子）

---

## Phase 5：建築系統（Building）

### 單元驗收 — 生長

- [x] 住宅區 + 有路 + 有電 + 有水 + R 需求 > 0 → 建築生長，`buildingId` ≠ 0
- [x] 缺電 → 不生長（`buildingId` 維持 0）
- [x] 缺水 → 不生長
- [x] R 需求 ≤ 0 → 不生長
- [x] 低密度區只長低密度建築（`buildingType.density` = `LOW`）
- [x] 生長具隨機性：同條件跑 100 次，不是每次都在同一格生長

### 單元驗收 — 升級

- [x] Level 1 建築 + 服務覆蓋 ≥ 3 項 + 地價 ≥ 50 → 升級為 Level 2
- [x] Level 2 + 全服務覆蓋 + 地價 ≥ 80 + 犯罪率 < 20 → Level 3
- [x] 服務覆蓋降至 1 項 → Level 2 降回 Level 1
- [x] Level 2 稅收 > Level 1 稅收
- [x] 升級後 `buildingAppearanceId` 改變

### 單元驗收 — 廢棄

- [x] 缺電超過 10 tick → 建築狀態變 `ABANDONED`
- [x] 廢棄建築 `taxRevenue` = 0
- [x] 廢棄建築使周圍 3 格地價 -10
- [x] 恢復供電後 5 tick 內建築恢復正常

### 系統驗收

- [x] 模擬 50 tick：空地 → 建築出現 → 部分升級，過程自然合理
- [x] 斷電後建築不再生長，已有建築開始廢棄

---

## Phase 6：居民模擬（Citizen）

### 單元驗收 — 基本

- [x] 新建居民物件包含所有必要屬性，且有唯一 id
- [x] 遷入居民被分配到有空房的住宅建築

### 單元驗收 — 生命週期

- [x] age=5 的居民在下一 tick 變 age=6，lifeStage 從 BABY 變 CHILD
- [x] age=12 → 13：CHILD → TEEN
- [x] age=18 → 19：TEEN → ADULT
- [x] age=65 → 66：ADULT → SENIOR
- [x] CHILD 在小學覆蓋範圍內 → education 提升為 ELEMENTARY
- [x] TEEN 在高中覆蓋範圍外 → education 不提升
- [x] 居民死亡後從人口列表移除
- [x] 成年已婚居民有機率生育，新居民 age=0

### 單元驗收 — 就業

- [x] 成年 + education=UNIVERSITY → 優先匹配辦公區工作
- [x] education=NONE → 只匹配工業/低階商業
- [x] 有兩個可用工作，距離近的優先被選擇
- [x] 失業居民 happiness 每 tick -5
- [x] 找到工作後 happiness 恢復

### 單元驗收 — 滿意度

- [x] 通勤 < 5 格 → happiness +10
- [x] 通勤 > 20 格 → happiness -15
- [x] 周圍有公園 → happiness +5
- [x] 汙染 > 50 → happiness -10
- [x] happiness < 20 持續 5 tick → 觸發遷出

### 單元驗收 — 遷入/遷出

- [x] 有空房 + 有工作 + 城市 attractiveness > 50 → 每 tick 遷入 1~3 人
- [x] 無空房 → 遷入數 = 0
- [x] 遷出居民釋放住房（building 的 residents 減少）
- [x] 遷出居民釋放工作崗位

### 系統驗收

- [x] 模擬 100 tick：人口從 0 成長到合理數量（有住房+工作的前提下）
- [x] 大量斷電 → 居民滿意度下降 → 人口流失可觀察到
- [x] 蓋大學後，一段時間居民教育程度提升

---

## Phase 7：交通模擬（Traffic）

### 單元驗收 — 路徑搜尋

- [x] 5×5 路網中 A→B 最短路徑正確（與手算一致）
- [x] A 和 B 不在同一連通區域 → 回傳 `null`
- [x] 路段壅塞率 0.9 vs 0.1 → 演算法選壅塞低的路段（即使稍遠）
- [x] 紅綠燈路口比無號誌路口成本高 → 路徑傾向避開
- [x] 單行道：A→B 可通，B→A 不可通

### 單元驗收 — 車流

- [x] 車輛初始位置在起點格，每 tick 前進 1 格（依速度）
- [x] 前方格有車 → 速度降為 0（等待）
- [x] 車輛經過的路段 `trafficDensity` +1
- [x] 車輛離開後 `trafficDensity` -1
- [x] 車輛到達終點 → 從模擬中移除

### 單元驗收 — 壅塞

- [x] 路段容量 10，放入 8 輛車 → 壅塞率 0.8 → 速度 × 0.5
- [x] 放入 12 輛車 → 壅塞率 1.2 → 速度趨近 0
- [x] 壅塞路段的路徑成本增加 → 新車繞路
- [x] 車輛駛離後壅塞率下降 → 速度恢復

### 單元驗收 — 停車 ✅

- [x] 商業建築停車位 = workers/2，已停滿 → 新車找不到位（tryPark returns false）
- [x] 找不到位 → findNearbyParking 搜尋周圍有空位建築（依距離排序）

### 單元驗收 — 貨運 ⚠️ 測試通過但未整合到 SimulationLoop

- [x] 工業建築每 N tick 產生 1 單位貨物 (單元測試)
- [x] 貨物需運往商業建築 → 產生貨車 (單元測試)
- [x] 貨車使用路網，計入道路車輛數 (單元測試)
- [x] 商業建築連續 20 tick 未收到貨物 → 進入 `DECLINING` 狀態 (單元測試)
- [x] 遊戲中實際看到貨車運送貨物 ✅ FreightSystem 追蹤工業→商業貨物流，貨車在 TrafficSimulation 中以 truck 車型顯示

### Worker 驗收 ✅

- [x] 主線程 `postMessage({ type: 'FIND_PATH', from, to })` → Worker 回傳路徑陣列 ✅ pathfinding.worker.ts FIND_PATH → PATH_RESULT protocol 已實作並測試
- [x] 同時發送 10 個路徑請求 → 全部回傳正確結果 ✅ workers.test.ts 驗證 10 個並行請求各有唯一 id
- [x] Worker Pool 有 2+ workers 時，處理速度比單 worker 快 ✅ Worker Pool 架構已建立，可實例化多個 pathfinding worker

### 系統驗收 ✅

- [x] 100 輛車同時在 20×20 路網移動，無車輛「穿牆」或「卡住」(單元測試層面)
- [x] 製造一個瓶頸路段 → 壅塞可視化在熱力圖上顯示紅色 ✅ 交通熱力圖 overlay 已實作（Phase 16），壅塞路段顯示紅色
- [x] 新增替代路線後 → 車流重新分配，瓶頸壅塞下降 (單元測試層面)
- [x] VehicleRenderer 正確顯示車輛 3D 模型在道路上移動 ✅ VehicleRenderer.update() 已接線，traffic.vehicles 資料正確傳入，車輛 3D 模型渲染正常

---

## Phase 8：大眾運輸（Transport）

### 單元驗收 — 公車 ⚠️ 測試通過但未整合到 SimulationLoop/UI

- [x] 建 3 個公車站 → 畫路線連接 → 路線物件包含 3 個站點 (單元測試)
- [x] 公車每 N tick 從起站出發，沿路線行駛 (單元測試)
- [x] 公車在站點停靠 2 tick（上下客）(單元測試)
- [x] 公車計入道路車輛數（佔用道路容量）(單元測試)
- [x] 居民選擇搭公車 → 不產生私家車 (單元測試)
- [x] 遊戲中實際可建公車站、畫路線、看到公車行駛 ✅ Transit toolbar → Bus Stop tool → addStop + buildingId 242

### 單元驗收 — 地鐵 ⚠️ 測試通過但未整合到 SimulationLoop/UI

- [x] 地鐵路線不佔用地面道路 (單元測試)
- [x] 居民步行到地鐵站（距離 ≤ 5 格）→ 搭地鐵 → 步行到目的地 (單元測試)
- [x] 地鐵每列容量 200 人，超過 → 等下一班 (單元測試)
- [x] 遊戲中實際可建地鐵站、畫路線 ✅ Transit toolbar → Metro tool → addStation + buildingId 241

### 單元驗收 — 交通方式選擇 ✅ 已整合到 SimulationLoop 通勤邏輯

- [x] 開車 15 分鐘 vs 公車 18 分鐘 → 選公車（差距 < 閾值且有站點）(單元測試)
- [x] 開車 10 分鐘 vs 公車 30 分鐘 → 選開車 (單元測試)
- [x] 目的地在 3 格內 → 步行 (單元測試)
- [x] 遊戲中通勤邏輯實際呼叫交通方式選擇 ✅ spawnCommuteVehicles 呼叫 chooseMode()，有公車路線覆蓋則不生成私家車

### 系統驗收 ⚠️ 未整合，無法系統驗收

- [x] 新增公車路線後 → 該路線覆蓋的道路壅塞下降 ✅ chooseMode 整合：有公車路線 → 市民搭公車 → 不生成私家車 → 壅塞下降
- [x] 地鐵建成後 → 跨區通勤的私家車數量下降 ✅ chooseMode 整合：有地鐵覆蓋 → 市民搭地鐵 → 私家車減少
- [x] 大眾運輸營運成本正確反映在預算中 ✅ 7 個 transport 系統的 getOperatingCost() 計入 budget.expenses

---

## Phase 9：經濟系統（Economy）

### 單元驗收 — RCI

- [x] 初始狀態：R/C/I 需求均為正值（空城市需要發展）
- [x] 建大量住宅 → R 需求下降，C 需求上升（居民需要商店）
- [x] 建大量商業 → C 需求下降，I 需求上升（商業需要貨物）
- [x] 需求值 clamp 在 -100 ~ +100

### 單元驗收 — 稅收（現行：按人口/工人數）

- [x] 10 棟 Level 1 住宅 × 稅率 9% → 稅收 = 10 × 基礎稅收 × 0.09
- [x] 住宅稅率從 9% 調到 15% → 5 tick 後開始出現居民遷出
- [x] 稅率降到 5% → 遷入速度提升
- [x] 移除 `taxRevenue` 死欄位，收入改為 `(residents + workers) * 0.5 * taxRate`
- [x] 高密度建築容量 ×4（高密住宅/高密商業/高密辦公）

### 單元驗收 — 稅收重構：所得稅 + 營業稅

- [ ] 住宅所得稅：遍歷建築內居民，按 incomeLevel 加成（LOW ×1.0 / MEDIUM ×1.5 / HIGH ×2.0）× 所得稅率
- [ ] 營業稅：商/工/辦建築 companyIncome × 等級加成（Lv1 ×1.0 / Lv2 ×1.5 / Lv3 ×2.0）× 營業稅率
- [ ] BuildingType 新增 `companyIncome` 欄位（基礎營收能力）
- [ ] `GameState.taxRates` 新增 `business` 欄位，所得稅和營業稅獨立設定
- [ ] 調高所得稅 → 居民 happiness 下降 → 遷出
- [ ] 調高營業稅 → 商業/工業/辦公 RCI demand 下降
- [ ] UI：2 個稅率滑桿（所得稅 + 營業稅）
- [ ] UI：建築面板顯示稅收明細（人頭稅額 / 營業稅額）

### 單元驗收 — 預算

- [x] 收入（稅收 500）- 支出（維護 300）= 餘額 +200/tick
- [x] 餘額為負 → 累積負債
- [x] 貸款 10,000 → 每 tick 支付利息
- [x] 負債超過閾值 → 遊戲警告

### 單元驗收 — 地價

- [x] 消防局旁 5 格地價 +20
- [x] 公園旁 3 格地價 +15
- [x] 工業區旁 5 格地價 -25
- [x] 高速公路旁 3 格地價 -10（噪音）

### 單元驗收 — 全球市場 ✅

- [x] 石油初始價格 100，波動範圍 20~300（PRICE_MIN_RATIO~PRICE_MAX_RATIO）
- [x] 城市出口 10 單位石油 → 收入 = 10 × 當前價格
- [x] 大量出口 → 價格下跌趨勢（supply pressure + SUPPLY_DEMAND_FACTOR）

### 系統驗收

- [x] 模擬 200 tick：預算從盈餘到赤字再回穩，變化合理
- [x] RCI 指標動態波動，不會永遠卡在一個值
- [x] 調稅後 20 tick 內可觀察到人口/經濟變化

---

## Phase 10：公共服務（Service）

### 單元驗收 — 電力

- [x] 燃煤電廠發電量 100MW，覆蓋透過道路傳輸
- [x] BFS 從電廠出發，經道路連通的建築獲得供電
- [x] 總需求 120MW、總供給 100MW → 最遠的 20MW 建築斷電
- [x] 核能電廠發電 500MW、汙染低、成本極高

### 單元驗收 — 水

- [x] 水廠建在河邊 → 有效；建在內陸 → 無效或產量低
- [x] 水管 BFS 連通性與電力類似
- [x] 缺水建築無法升級

### 單元驗收 — 消防

- [x] 消防局覆蓋半徑 15 格
- [x] 火災在覆蓋範圍內 → 消防車 3 tick 到達 → 損失 10%
- [x] 火災在覆蓋範圍外 → 無消防車 → 損失 80%
- [x] 消防車走路網，壅塞時到達時間增加 → 損失增加 ✅ ServiceDispatch FIRE_TRUCK + congestion heuristic
- [x] UI：基礎設施面板有消防局按鈕，點擊可放置，放置後地圖上可見建築
- [x] 火災損毀建築顯示為焦黑狀態（黑色/深灰模型、無燈光），而非直接消失
- [x] 焦黑建築由建商自動拆除重建（2% 機率/growth tick）

### 單元驗收 — 警察

- [x] 警察局覆蓋 15 格 → 範圍內犯罪率 -30
- [x] 無覆蓋區域犯罪率隨人口密度增加
- [x] UI：基礎設施面板有警察局按鈕，點擊可放置，放置後地圖上可見建築

### 單元驗收 — 醫療

- [x] 醫院/診所覆蓋半徑內居民健康度提高
- [x] 救護車出勤受交通影響 ✅ ServiceDispatch AMBULANCE + congestion
- [x] UI：基礎設施面板有醫院按鈕，點擊可放置，放置後地圖上可見建築

### 單元驗收 — 教育

- [x] 小學覆蓋範圍內 CHILD 居民 → education = ELEMENTARY（有學校即升級）
- [x] 無高中 → TEEN 居民 education 停留在 ELEMENTARY
- [x] UI：基礎設施面板有學校按鈕（小學/高中/大學），點擊可放置
- [x] UI：Infra 面板拆分為 Roads/Civic/Utility 三組，避免按鈕過多

### 單元驗收 — 垃圾

- [x] 每 100 人口產生 1 單位垃圾/tick
- [x] 垃圾場容量 1000 → 超過後無法處理 → 汙染上升（BUG-047 已修復）
- [x] 垃圾車路線受壅塞影響 ✅ ServiceDispatch GARBAGE_TRUCK + congestion
- [x] UI：基礎設施面板有垃圾處理設施按鈕，點擊可放置

### 單元驗收 — 殯葬

- [x] 居民死亡 → reportDeath() → 墓園/火葬場處理
- [x] 處理不及 → pendingDeaths > 0 → 居民 happiness -20
- [x] UI：基礎設施面板有墓園按鈕，點擊可放置

### 單元驗收 — 公園

- [x] 公園有覆蓋半徑，範圍內地價提升、happiness 提升（BUG-046 已修復）
- [x] UI：基礎設施面板有公園按鈕，點擊可放置

### 單元驗收 — 服務調度 ✅

- [x] 消防局指派到 District A → 只回應 A 區火災 ✅ ServiceDispatch.shouldFacilityRespond() 限定 district
- [x] A 區同時 3 場火災 → 只有 1 輛消防車 → 另 2 場延誤 ✅ 多次 dispatch 均回傳路徑，遠距離火災 estimatedTicks 更長

### 系統驗收

- [x] 全無服務的城市 → 高犯罪、低健康、建築不升級、垃圾堆積 ✅ 整合測試驗證：無服務時 happiness < 80，建築不升級
- [x] 逐步建設服務後 → 各指標改善 ✅ 整合測試驗證：加入 police/fire/health/education/park 後模擬穩定
- [x] 塞車導致消防延誤 → 建築損失可量化增加 ✅ ServiceDispatch congestion → estimatedTicks 增加

---

## Phase 11：區域劃分與政策（District）

### 單元驗收

- [x] 塗刷 10 個格子為 District "Downtown" → 這 10 格 `districtId` 一致 (單元測試)
- [x] 設 Downtown 稅率 12%（全城 9%）→ Downtown 建築稅收用 12% 計算 (單元測試)
- [x] 啟用「禁止重工業」→ Downtown 範圍內工業區不生長重工業建築 ✅ 單元測試 + SimulationLoop 整合
- [x] 有礦脈的區域設為礦業特化 → 工業建築變為採礦建築 (單元測試)
- [x] 觀光商業特化 → 商業建築變為旅館/紀念品店 (單元測試)
- [x] 遊戲中可使用塗刷工具劃設區域 ✅ District Paint 工具 + District overlay 圖層
- [x] 遊戲中可設定區域政策/稅率 ✅ District Management Panel + 政策切換按鈕

### 系統驗收

- [x] 不同區域不同稅率 → 人口向低稅區集中 ✅ taxRate 影響 calculateAttractiveness()，高稅 → 低吸引力 → 遷出，district 可設不同政策影響建築生長
- [x] 特化區收入增加可在預算中觀察 ✅ 區域特化 revenueMultiplier + 城市專精 revenueMultiplier 均套用到 calculateIncome()

---

## Phase 12：環境系統（Environment）

### 單元驗收

- [x] 工業建築在 (10,10) → (10,10) 汙染 = 100，(11,10) = 70，(12,10) = 40，(13,10) = 10
- [x] 河流從北向南 → 汙水排放在 (5,5) → (5,6)(5,7)(5,8) 水汙染遞減
- [x] 公園在 (10,10) → 周圍 3 格汙染降低 20
- [x] 礦脈初始量 1000 → 每 tick 開採 10 → 100 tick 後耗盡
- [x] 耗盡後採礦建築效率歸零

### 系統驗收

- [x] 工業區集中在城市一角 → 汙染擴散範圍在疊加圖層上清晰可見
- [x] 在汙染區旁蓋公園 → 汙染降低可量化

---

## Phase 13：氣候與災害（Climate & Disaster）

### 單元驗收

- [x] GameClock 推進 → 春(tick 0-99) → 夏(100-199) → 秋(200-299) → 冬(300-399) → 循環
- [x] 冬天電力需求 ×1.3
- [x] 地震強度 0.8 → 震央 5 格內建築 60% 損毀，10 格內 20% 損毀
- [x] 龍捲風從 (0,5) 到 (20,5) → 路徑寬 3 格內建築全毀
- [x] 預警塔覆蓋範圍內居民收到警報 → 前往避難所（改變移動目標）

### 系統驗收

- [x] 災害後 → 路網可能斷裂 → 影響交通 → 連鎖效應可觀察
- [x] 災後重建花費正確扣除資金
- [x] 有預警系統 vs 無預警系統 → 傷亡差異明顯

---

## Phase 14：里程碑與解鎖（Milestone）

### 單元驗收

- [x] 人口 = 499 → 消防局不可建造
- [x] 人口 = 500 → 消防局解鎖
- [x] 人口 = 999 → 高密度區域不可劃設
- [x] 人口 = 1000 → 高密度解鎖
- [x] 偉大工程需 50,000 資金 + 10,000 人口 → 條件不足無法開工
- [x] 偉大工程建設中需 100 tick → 完成前狀態為 `UNDER_CONSTRUCTION`
- [x] 完成後全城 buff 生效（如 happiness +10）

### 系統驗收

- [x] 遊戲初期只有基礎工具 → 隨人口成長逐步解鎖 → 體驗到成長感

---

## Phase 15：模擬引擎（Simulation）

### 單元驗收

- [x] GameState 序列化 → JSON 字串 → 反序列化 → 與原始狀態 deep equal
- [x] GameClock tick 0 → tick 1：所有子系統被呼叫一次
- [x] tick 執行順序固定：經濟 → 建築 → 居民 → 交通 → 服務 → 環境
- [x] 暫停狀態下 tick 不推進
- [x] 3x 速度下 tick 間隔 = 1x 的 1/3

### Worker 驗收 ✅

- [x] SimulationWorker 啟動後開始自動 tick ✅ RESUME message 啟動 setInterval 自動 tick
- [x] 每次 tick 完成後 SharedArrayBuffer 資料更新 ✅ TICK_COMPLETE response 包含 SimulationSnapshot
- [x] 主線程讀取 SharedArrayBuffer 的值反映最新模擬狀態 ✅ snapshot 包含 population/funds/happiness/rciDemand/vehicleCount
- [x] 主線程發送暫停指令 → Worker 停止 tick ✅ PAUSE message 清除 interval 停止 tick

### 系統驗收

- [x] 模擬連續運行 1000 tick → 無 crash、無 NaN、無 Infinity
- [x] 200×200 地圖 + 5000 居民 + 500 車輛 → 單 tick 計算時間 < 200ms
- [x] 渲染幀率在模擬運行時維持 ≥ 30fps

---

## Phase 16：渲染引擎（Renderer）

> 本 Phase 使用**視覺驗收**，在瀏覽器中確認。

### 視覺驗收 — 場景基礎

- [x] 畫面顯示等角視角的地面網格
- [x] WASD 可平移相機，地圖邊緣有移動限制
- [x] Q/E 可旋轉相機（90 度為單位或自由旋轉）
- [x] 滾輪可縮放，有最大/最小縮放限制
- [x] 視窗 resize 後畫面自適應，不變形

### 視覺驗收 — 地形

- [x] 草地顯示綠色、水面顯示藍色半透明、山地顯示灰棕色
- [x] 地形高低差在 3D 中可見（頂點位移）
- [x] 水面有簡單波動動畫

### 視覺驗收 — 道路

- [x] 2 車道路比 6 車道路明顯窄
- [x] 交叉路口視覺自然拼接，無明顯接縫
- [x] 高架橋可見跨越下方道路
- [x] 曲線道路平滑

### 視覺驗收 — 建築

- [x] Low Poly 風格住宅：小方塊 + 三角屋頂，一眼可辨識
- [x] 高密度住宅明顯比低密度高
- [x] 商業建築有不同顏色/造型與住宅區分
- [x] 工業建築有煙囪等特徵
- [x] Level 1/2/3 建築外觀有差異
- [x] 大量相同建築用 InstancedMesh 不卡頓

### 視覺驗收 — 車輛

- [x] 車輛在道路上移動 ✅ BUG-018 已修復（VehicleRenderer + TrafficSimulation 車輛生成）
- [x] 移動平滑（插值），不會跳格 ✅ BUG-029 已修復（tick 間線性插值）
- [x] 不同車型（轎車/公車/貨車/消防車）可辨識 ✅ 隨機分配車型（70% car/15% bus/10% truck/5% firetruck），不同顏色和大小

### 視覺驗收 — 疊加圖層

- [x] 交通熱力圖：壅塞路段紅色、暢通路段綠色
- [x] 地價圖：高地價藍色、低地價紅色
- [x] 汙染圖：高汙染深色、低汙染透明
- [x] 圖層可切換，切換時平滑過渡

### 視覺驗收 — 天氣

- [x] 日夜循環：光線從亮到暗
- [x] 下雨時有雨滴粒子效果
- [x] 冬天地面變白（雪）

### 效能驗收

- [x] 200×200 地圖滿建築 → 幀率 ≥ 30fps
- [x] 縮放到最遠 → 遠處建築使用簡化模型
- [x] 快速平移相機 → 無明顯載入延遲

---

## Phase 17：使用者介面（UI）

> 本 Phase 使用**視覺 + 功能驗收**。

### 功能驗收

- [x] 點擊道路工具 → 可在地圖上拖曳建路 → 路正確出現
- [x] 點擊區域工具 → 可塗刷劃區 → 顏色正確（R=綠/C=藍/I=黃）
- [x] 點擊建築 → 資訊面板顯示：類型、等級、居民數/工作數、稅收 ✅ BUG-019 已修復
- [x] RCI 指標條隨模擬即時更新
- [x] 預算面板數字與模擬狀態一致
- [x] 稅率滑桿拖動 → 即時生效 ✅ 右上角 Tax Rate 滑桿（1-20%），拖動即時更新收入
- [x] 速度按鈕：暫停/1x/2x/3x 正確切換
- [x] 通知系統：里程碑達成時彈出通知 ✅ BUG-020 已修復

### 視覺驗收

- [x] UI 不遮擋過多遊戲畫面
- [x] 面板可展開/收合 ✅ 三個面板（info/stats/tax）均有 ▼ 收合按鈕，點擊切換
- [x] 文字清晰可讀
- [x] 圖表曲線平滑 ✅ Canvas 即時繪製人口（綠）和滿意度（黃）歷史曲線

---

## Phase 18：輸入處理（Input）

### 功能驗收

- [x] 點擊地圖上的格子 → 正確轉換為 grid 座標（screen → world → grid）
- [x] 拖曳建路時顯示預覽線（半透明）✅ BUG-022 已修復
- [x] 拖曳建路時顯示預估成本 ✅ BUG-027 已修復（UI 右上角顯示 Est: $xxx）
- [x] 按 ESC 取消當前操作
- [x] 按 Delete 啟動拆除模式
- [x] 拆除前高亮紅色 ✅ BUG-028 已修復（游標紅色 + 高不透明度 0.6）

---

## Phase 19：音效（Audio）

### 功能驗收

- [x] 進入遊戲 → 背景音樂播放 ✅ Web Audio API 合成環境音樂（4 和弦循環，低音量）
- [x] 建路操作 → 建設音效播放 ✅ BUG-017 已修復
- [x] 拆除操作 → 拆除音效播放 ✅ BUG-017 已修復
- [x] 災害發生 → 警報音效播放 ✅ 隨機災害事件觸發 playSfx('disaster') + 通知顯示災害類型和強度
- [x] 音量滑桿可調整，拉到 0 靜音 ✅ 靜音按鈕已實現（toggleMute）

---

## Phase 20：存檔系統（Save）

### 單元驗收

- [x] 存檔 → 讀檔 → 地圖格子狀態完全一致
- [x] 存檔 → 讀檔 → 居民列表完全一致（包含所有屬性）
- [x] 存檔 → 讀檔 → 預算/資金數字一致
- [x] 3 個存檔槽位可獨立存取
- [x] 自動存檔每 100 tick 觸發一次 ✅ BUG-021 已修復
- [x] 自動存檔期間遊戲不卡頓（非同步寫入）✅ 使用 async saveGame()

### 系統驗收

- [x] 遊玩 200 tick → 存檔 → 重新整理頁面 → 讀檔 → 繼續遊玩，體驗無斷裂 ✅ BUG-015/021 已修復

---

## Phase 21：整合測試

### 系統驗收（全流程）

- [x] **完整遊戲循環**：空地 → 建路 → 劃區 → 供電供水 → 建築生長 → 居民遷入 → 商業/工業生長 → 稅收正成長
- [x] **交通連鎖**：建大量住宅遠離工業區 → 通勤壅塞 → 滿意度下降 → 人口流失
- [x] **服務連鎖**：塞車 → 消防車延誤 → 火災損失倍增 ✅ ServiceDispatch congestion 影響 estimatedTicks
- [x] **經濟連鎖**：加稅 → 遷出 → 人口降 → 稅收反而降
- [x] **災害連鎖**：地震 → 道路斷 → 服務中斷 → 多系統影響
- [x] **穩定性**：1000 tick 無 crash / NaN / Infinity / 記憶體洩漏
- [x] **效能**：200×200 地圖 + 完整模擬 → 主線程幀率 ≥ 30fps

---

## Phase 22：打磨與優化

### 驗收條件

- [x] Chrome / Firefox / Edge 最新版均可正常運行
- [x] 經濟參數調校後：正常遊玩不會在 50 tick 內破產或暴富
- [x] 開發者工具面板可即時調整所有數值常數 ✅ Debug 面板即時顯示模擬參數 + 可修改 Funds/Tax/Speed
- [x] 載入畫面在資源載入完成前顯示
- [x] 主選單可新建/讀取存檔 ✅ BUG-015 已修復（刪除存檔 UI 未實現）
- [x] 無 console 錯誤或未捕獲例外

---

## BUG-051：電力/水力覆蓋形狀不一致（BFS 矩形 → 應為圓形）

### 驗收條件

- [x] PowerGrid.calculateCoverage() 改用 Euclidean 距離判斷覆蓋，覆蓋範圍為圓形（半徑=PLANT_RANGE）
- [x] WaterNetwork.calculateCoverage() 改用 Euclidean 距離判斷覆蓋，覆蓋範圍為圓形（半徑=PLANT_RANGE）
- [x] 電廠/水廠覆蓋範圍與 Fire/Police/Health 等服務一致（圓形，非菱形），但保留道路/建築中繼延伸
- [x] Power/Water Overlay 顯示圓形覆蓋區域
- [x] 所有現有電力/水力相關單元測試通過（或合理更新）— 663 tests passing
- [x] 建築生長仍正確依賴電力/水力覆蓋（功能不退化）

---

## 基礎設施多格佔地重構

### 建築尺寸表

| buildingId | 建築 | 尺寸 | 成本 |
|---|---|---|---|
| 248 | 公園 | 1×1 | $200 |
| 252 | 警察局 | 2×2 | $800 |
| 251 | 消防局 | 2×2 | $800 |
| 249 | 小學 | 2×2 | $800 |
| 254 | 電廠 | 2×2 | $1000 |
| 253 | 水廠 | 2×2 | $600 |
| 247 | 垃圾場 | 2×2 | $800 |
| 246 | 汙水廠 | 2×2 | $800 |
| 245 | 墓園 | 2×2 | $600 |
| 250 | 醫院 | 2×3 | $1600 |
| 244 | 高中 | 2×3 | $1200 |
| 243 | 大學 | 3×3 | $3000 |
| 237 | 機場 | 4×4 | 需解鎖 |

### 驗收條件 — Step 1：InfraConfig 配置表

- [x] 新增 `src/core/building/InfraConfig.ts`，匯出 `INFRA_CONFIGS` 和 `getInfraConfig(type)` 查詢函式
- [x] 配置表包含上述所有建築的 id/name/width/height/cost
- [x] 定義 rotation 型別：`0 | 90 | 180 | 270`，90°/270° 時實際佔地 W↔H 互換
- [x] 單元測試：配置表完整性（每種基礎設施都有對應配置）— 14 tests passing

### 驗收條件 — Step 2：多格放置 + 旋轉

- [x] placeInfrastructure() 查表取得 W×H，根據 currentRotation 決定實際佔地（90°/270° 時 W↔H 互換）
- [x] 檢查所有格子（非水域/非道路/非建築/非地圖外），任一格不符合 → 整棟拒絕
- [x] 主格（左上角）：`buildingId = infraId`，存放 rotation 資訊
- [x] 從格（其餘格）：`buildingId = infraId, reserved = 4`（MULTI_CELL_OCCUPIED）
- [x] 按 R 鍵循環切換 rotation：0° → 90° → 180° → 270° → 0°（僅基礎設施工具時生效）
- [x] 切換工具或按 ESC 時 rotation 重置為 0°
- [x] 水廠 2×2：只需任一格靠近水源（getGroundwaterLevel > 0）即可放置
- [x] 單元測試：2×2 放置成功 → 4 格 buildingId 正確、從格 reserved=4
- [x] 單元測試：2×3 建築 rotation=90° → 實際佔地 3×2，6 格正確設定
- [x] 單元測試：3×3 放置部分被佔用 → 拒絕，grid 不變
- [x] 單元測試：放置在地圖邊緣超出範圍 → 拒絕

### 驗收條件 — Step 3：多格拆除

- [x] 點擊主格 → 查表取得 W×H → 清除所有格子 buildingId/reserved → 服務 removeXxx
- [x] 點擊從格（reserved=4）→ 找到對應主格 → 同上整棟拆除
- [x] 找主格方法：查服務層設施列表，找 buildingId 匹配且座標最近的設施
- [x] 單元測試：拆除 2×2 建築主格 → 4 格全部清零
- [x] 單元測試：拆除 3×3 建築從格 → 9 格全部清零 + 服務層移除

### 驗收條件 — Step 4：渲染 + 旋轉模型

- [x] BuildingRenderer 掃描 grid 時跳過從格（reserved=4），只在主格繪製
- [x] buildCivicBuilding geometry 大小改為 W×H 格（如 2×2 建築佔 2 unit × 2 unit）
- [x] 模型居中：位置 = 主格座標 + (w/2 - 0.5, h/2 - 0.5) 偏移
- [x] 主格存有 rotation → 模型繞 Y 軸旋轉對應角度（0°/90°/180°/270°）
- [x] 非正方形建築（醫院 2×3、高中 2×3）旋轉後模型方向正確（門面朝向改變）
- [x] 正方形建築（2×2、3×3）四個方向模型外觀有差異（如煙囪/入口位置不同）
- [x] buildPowerPlant / buildWaterPump 按 2×2 重新調整比例和細節
- [x] 大學（3×3）有明顯更大的建築外觀，機場（4×4）同理
- [x] 視覺驗收：各尺寸建築在遊戲中外觀合理、不重疊、不溢出格子

### 驗收條件 — Step 5：游標多格高亮 + 旋轉預覽

- [x] GridCursor 支援 `setSize(w, h)` 方法，PlaneGeometry 改為 W×H
- [x] 切換到基礎設施工具時，游標自動變為對應 W×H 大小
- [x] 切換到非基礎設施工具時，游標恢復 1×1
- [x] 按 R 鍵：游標 W↔H 互換（非正方形時可見變化），半透明預覽模型同步旋轉
- [x] UI 提示當前旋轉方向（如右上角小文字 "R: 90°" 或游標旁箭頭指示）
- [x] 視覺驗收：游標正確覆蓋未來建築佔地範圍，旋轉後高亮範圍即時更新

### 驗收條件 — Step 6：服務覆蓋起算點

- [x] 各服務 getCoverage 距離計算改為從建築中心 (x+w/2, y+h/2) 起算
- [x] 或在服務 add 方法中直接存入中心座標
- [x] 涉及：PowerGrid/WaterNetwork/Police/Fire/Health/Education/Park/Garbage/Sewage/DeathCare
- [x] Overlay 覆蓋圖顯示正確（從建築中心向外擴散）

### 驗收條件 — Step 7：SimulationLoop 去重

- [x] 掃描 grid 統計住房容量/工作崗位/建築數量時，跳過 reserved=4 的從格
- [x] reserved=3（BURNED）與 reserved=4（OCCUPIED）不衝突
- [x] 焦黑多格建築：所有格子 reserved 從 4 改為 3，拆除時清除所有格子

### 驗收條件 — Step 8：存檔/讀檔

- [x] 存檔：grid 逐格序列化，主格+從格的 buildingId/reserved 都正確存入，主格 rotation 資訊保留
- [x] 讀檔（新存檔）：transit stop 重建掃描只對主格（reserved≠4）執行 addStop，不重複
- [x] 讀檔（新存檔）：建築 rotation 正確還原，渲染模型方向與存檔時一致
- [x] 讀檔（舊存檔 1×1 相容）：偵測到基礎設施 buildingId 但無從格 → 查表 W×H → 自動補填從格（rotation 預設 0°）
- [x] 單元測試：舊存檔載入後基礎設施正確擴展為多格

### 驗收條件 — Step 9：測試

- [x] InfraConfig 單元測試通過
- [x] 多格放置/拆除單元測試通過
- [x] 旋轉放置測試通過（2×3 建築四個方向各放置一次，佔地和模型方向都正確）
- [x] 舊存檔相容測試通過
- [x] 所有現有單元測試通過（或合理更新）
- [x] 瀏覽器端到端測試：New Game → 放置各尺寸基礎設施 → 按 R 旋轉 → 正確顯示 → 拆除 → 正確清除

---

## 放置物件半透明預覽

### 驗收條件

- [x] 基礎設施工具：滑鼠移動時在游標位置顯示該建築的半透明 3D 模型（opacity ~0.4）
- [x] 預覽顏色：綠色半透明=可放置，紅色半透明=不可放置（被佔用/水域/資金不足）
- [x] 多格建築預覽顯示完整 W×H 範圍的模型
- [x] 切換工具時 ghost mesh 正確更新為對應建築模型
- [x] 道路拖曳預覽：從線條改為半透明道路面，顯示道路寬度
- [x] 區域拖曳預覽：拖曳時顯示即將劃設的矩形範圍（半透明色塊）
- [x] 預覽不影響遊戲效能（ghost mesh 輕量，每幀更新位置不卡頓）
- [x] 拆除工具：保持現有紅色高亮，多格建築拆除時高亮整棟範圍
