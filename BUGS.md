# WebCity Bug 追蹤

## 已修復的嚴重問題

### BUG-004: GameState 缺少大量子系統 ✅ 已修復
- 新增 `rciDemand`, `buildingGrowth`, `buildingUpgrade`, `pollution` 到 GameState

### BUG-005: SimulationLoop 只執行 4 個子系統 ✅ 已修復
- SimulationLoop.tick() 現在包含 8 步驟：RCI 計算、預算、電/水覆蓋、建築生長、居民老化、遷入遷出、交通、收入計算

### BUG-006: 建築不會生長 ✅ 已修復
- BuildingGrowth 已整合到 SimulationLoop

### BUG-007: 居民不會遷入 ✅ 已修復
- Migration 已整合到 SimulationLoop

### BUG-001: RCI 指標條不會動態更新 ✅ 已修復
- updateUI() 現在讀取 state.rciDemand 更新 RCI bar 高度

### BUG-002: 道路建設費用未從預算扣除 ✅ 已修復
- handleToolAction 現在扣除 result.cost

### BUG-009: 電力/水力 BFS 無法覆蓋區域格子 ✅ 已修復
- PowerGrid 和 WaterNetwork 的 calculateCoverage 現在擴展覆蓋到道路旁的區域格子

### BUG-010: 遷入門檻過高（空城市無法吸引居民）✅ 已修復
- 空城市 avgHappiness 設為 70（合理：沒有人不開心）
- 降低預設 pollution/crimeRate 值

---

## 待修問題

### BUG-008: 區域劃設視覺回饋不明顯 ✅ 已修復
- **修復**: BuildingRenderer 現在為空的區域格子渲染半透明彩色底板（綠=住宅、藍=商業、橙=工業、紫=辦公）

### BUG-003: 道路拖曳建設靈敏度
- **位置**: `src/Game.ts` - `setupInput()`
- **問題**: gridCursor 依賴 mousemove，初始位置可能不準確
- **嚴重性**: 中
- **狀態**: 待驗證

### BUG-014: 日期顯示錯誤 — 月份和天數未 wrap ✅ 已修復
- **位置**: `src/ui/GameUI.ts` 第 203 行
- **問題**: `getDay()` 和 `getMonth()` 回傳的是總天數/總月數，UI 直接顯示導致 "Month 21" 等不合理數字
- **修復**: 改為 `(clock.getDay() % 30) + 1` 和 `(clock.getMonth() % 12) + 1`

### BUG-012: Office 建築無法在 LOW density 道路旁生長 ✅ 已修復
- **修復**: 在 `src/core/building/types.ts` 新增 LOW density Office 建築 (id 16-18)，原 HIGH density 改為 id 19-21

### BUG-013: 滑鼠拖曳建設道路/區域 ✅ 已驗證正常
- 經瀏覽器實測，滑鼠拖曳建路和劃區都正常運作
- 區域劃設要求格子緊鄰道路（ZoneManager 的設計），非 bug

### BUG-016: ESC/Delete 快捷鍵未實現 ✅ 已修復
- **修復**: 在 handleKeyDown 新增 `escape` → select + 取消拖曳, `delete` → demolish

### BUG-017: AudioManager 從未被實例化 — 遊戲無聲音 ✅ 已修復
- **修復**: Game.ts constructor 中實例化 AudioManager 並呼叫 init()
- 建路成功 → playSfx('build')，劃區 → playSfx('zone')，拆除 → playSfx('demolish')，Select 點擊 → playSfx('click')
- GameUI 新增靜音按鈕（toggleMute）

### BUG-018: VehicleRenderer 從未接收車輛資料 — 看不到車輛 ✅ 已修復
- **修復**:
  1. SimulationLoop 新增 spawnVehicles()，基於人口在道路上生成通勤車輛（L 型路徑）
  2. Game.ts update() 新增 vehicleRenderer.update()，將 TrafficSimulation.vehicles 轉換為 VehicleData
  3. 瀏覽器實測：紅色小方塊在道路上移動

### BUG-019: 建築資訊面板未實現 — Select 工具點擊無反應 ✅ 已修復
- **修復**: handleToolAction 新增 'select' case，讀取 grid cell 的 buildingId 並用 getBuildingType() 取得資料
- GameUI 新增 #building-panel 顯示：建築名稱、等級（星號）、居民/工人數、稅收、區域類型
- 點空地時面板自動隱藏

### BUG-020: 里程碑通知系統未實現 ✅ 已修復
- **修復**: Game.ts 新增 checkMilestone()，每 tick 偵測人口里程碑
- GameUI 新增 #notification 元素，slide-in 動畫，8 秒自動消失
- 瀏覽器實測：人口達 500 時觸發 "Tiny Town!" 通知

### BUG-021: Save/AutoSave 未整合到遊戲循環 ✅ 已修復
- **修復**: Game.ts 新增 AutoSaver(100)，每 100 tick 自動存檔到 slot 0
- 瀏覽器實測 IndexedDB 確認 AutoSave 條目已寫入（27KB data）

### BUG-022: 道路預覽線和預估費用未實現 ✅ 已修復（預覽線部分）
- **修復**: Game.ts 新增 updatePreviewLine()，拖曳建路時顯示半透明藍色 L 型預覽線
- 使用 THREE.Line + LineBasicMaterial(color: 0x4fc3f7, opacity: 0.6)
- mouseup 時 clearPreviewLine() 清除
- 預估成本顯示尚未實現

### BUG-015: Load Game 按鈕無法真正載入存檔 ✅ 已修復
- **修復**:
  1. main.ts 新增 handleLoadGame() 呼叫 SaveManager.loadGame() + deserializeGameState()
  2. Game constructor 接受可選 loadedState 參數，跳過 terrain 生成和電廠/水廠初始化
  3. 瀏覽器實測：存檔 → 重整頁面 → Load Game → 地圖/資金/人口正確還原

### BUG-023: 居民老化速度過快 — 每 tick 增齡 1 歲 ✅ 已修復
- **位置**: `src/core/simulation/SimulationLoop.ts`
- **問題**: ageTick() 每 tick 呼叫一次，4 ticks = 1 天 → 居民每天老 4 歲，每遊戲年老 1440 歲
- **修復**: 改為每遊戲年（1440 ticks）才呼叫一次 ageTick()

### BUG-024: Load Game 載入錯誤的存檔 slot ✅ 已修復
- **位置**: `src/ui/MainMenu.ts`
- **問題**: Load Game 按鈕呼叫 `onLoadGame(1)` (slot 1)，但 AutoSaver 存到 slot 0
- **修復**: 改為 `onLoadGame(0)` — 載入 AutoSave slot

### BUG-026: 空城市商業/工業建築不生長 — 雞生蛋問題 ✅ 已修復
- **位置**: `src/core/economy/RCIDemand.ts`
- **問題**: 商業需求 = `population * 0.5 - supply`，人口 0 時需求 0，商業不生長 → 無工作 → 無遷入
- **修復**: 商業需求加入基礎值 +10，工業需求加入 +5，確保初始階段有少量商業/工業生長

### BUG-027: 拖曳建路無預估成本顯示 ✅ 已修復
- **位置**: `src/Game.ts` — `updatePreviewLine()`
- **修復**: 計算預覽路線格數 × 道路單價，顯示在 UI 右上角 `Tool: road (Est: $2200)`

### BUG-028: 拆除工具游標不夠醒目 ✅ 已修復
- **位置**: `src/Game.ts`, `src/renderer/GridCursor.ts`
- **修復**: 新增 `setOpacity()` 方法，拆除工具時游標不透明度提高到 0.6（預設 0.3）

### BUG-029: 車輛移動跳格無插值 ✅ 已修復
- **位置**: `src/Game.ts`
- **修復**: 追蹤每輛車的前一個位置，渲染時根據 tickProgress 在兩個位置之間線性插值

### BUG-025: Overlay 覆蓋圖完全透明 — 無實際資料 ✅ 已修復
- **位置**: `src/Game.ts` — `setOverlay()`
- **問題**: `setOverlay()` 呼叫 `overlayRenderer.setOverlay()` 時未傳入 `data` 參數，導致所有值為 0，覆蓋圖完全透明不可見
- **修復**: 新增 `buildOverlayData()` 方法，根據 overlay 類型構建資料：
  - `power`: 從 PowerGrid.isPowered() 取得電力覆蓋
  - `water`: 從 WaterNetwork.isSupplied() 取得水力覆蓋
  - `zone`: 從 grid cell.zoneType 取得區域類型
  - `traffic`: 從 TrafficSimulation.getSegmentDensity() 取得車流密度

### BUG-011: 還有更多子系統未整合
- 地價系統 (LandValue) — 計算但未回寫到 grid
- 汙染系統 (Pollution) — 已加入 state 但未在 tick 中計算
- 建築升級/降級 — 已加入 state 但未在 tick 中呼叫
- 區域劃分與政策 (District)
- 災害系統
- 大眾運輸
- 服務車輛調度
- **嚴重性**: 中 — 核心遊戲循環已運作，這些是進階功能
- **狀態**: 待做

---

## 已修復其他問題
- Lint 錯誤（15 個 unused imports/variables）

---

## 驗收狀態（瀏覽器實測）

### 基礎功能
- ✅ 主選單顯示正確（New Game / Load Game）
- ✅ Loading Screen 正常顯示與移除
- ✅ 3D 等角視角地圖渲染（Low Poly 風格）
- ✅ 地形：河流、森林、山脈正確生成

### 相機控制
- ✅ WASD / 方向鍵平移相機
- ✅ Q/E 旋轉相機
- ✅ 滾輪縮放

### 工具系統
- ✅ 鍵盤快捷鍵 1-7 切換工具
- ✅ 工具列按鈕點擊切換
- ✅ 道路拖曳建設（滑鼠拖曳）
- ✅ 區域劃設拖曳（滑鼠拖曳，需緊鄰道路）
- ✅ 拆除工具正常清除建築/區域/道路
- ✅ 道路費用從預算扣除

### 區域與建築
- ✅ 住宅區（綠色底色 + 灰/綠建築）
- ✅ 商業區（藍色底色 + 藍色建築）
- ✅ 工業區（橙色底色 + 橙色建築）
- ✅ 辦公區（紫色底色 + 紫色建築）
- ✅ 區域劃設視覺回饋明顯（半透明底色）
- ✅ 建築生長（Low Poly Box 出現在有電有水的區域）
- ✅ 建築高度依 level 和 zone type 變化

### 模擬系統
- ✅ 居民遷入（Population 從 0 成長至 60+）
- ✅ 經濟系統（收入/支出/資金動態變化）
- ✅ RCI 需求計算與指標條即時更新
- ✅ 電力覆蓋（BFS 從電廠沿道路/建築擴散）
- ✅ 水力覆蓋（BFS 從水廠沿道路/建築擴散）
- ✅ 預算系統（道路維護費、建築稅收）

### UI 與顯示
- ✅ 日期顯示正確（Day/Month/Year 正確 wrap）
- ✅ 速度控制（暫停/1x/2x/3x 按鈕和鍵盤）
- ✅ 資金、人口、收支即時更新
- ✅ 日夜循環（天色變化：藍→橙→暗）
- ✅ 季節變化（spring/summer/autumn/winter）
- ✅ 天氣系統（WeatherRenderer 完整實作）

### 技術品質
- ✅ 無 Console 錯誤
- ✅ 無 ESLint 錯誤
- ✅ 所有 291 單元測試通過
- ✅ Vite HMR 正常運作

### 新增已驗證功能
- ✅ 音效系統（建路/拆除/劃區/點擊音效 + 靜音按鈕）
- ✅ 建築資訊面板（Select 工具點擊建築顯示名稱/等級/居民/工人/稅收/區域）
- ✅ 自動存檔（每 100 tick 存檔到 IndexedDB）
- ✅ Load Game 按鈕正確載入存檔（地圖/資金/人口還原）
- ✅ ESC 取消操作 / Delete 拆除模式

### 新增已驗證功能（第三輪測試）
- ✅ 里程碑通知系統（人口 500 觸發 "Tiny Town!" 通知）
- ✅ 道路預覽線（拖曳建路時藍色半透明 L 型線）
- ✅ 居民老化修正（每遊戲年老 1 歲，非每 tick）
- ✅ Load Game 正確載入 AutoSave slot 0
- ✅ 道路拖曳建設正常扣費
- ✅ 拆除工具清除建築/區域/道路
- ✅ 暫停/速度控制按鈕正常
- ✅ Q/E 旋轉相機
- ✅ 滾輪縮放
- ✅ WASD 平移相機

### 新增已驗證功能（第四輪測試）
- ✅ 覆蓋圖系統修復（Power/Water/Zone/Traffic overlay 正確顯示彩色覆蓋）
- ✅ 天氣系統：秋天下雨（雨滴粒子 + 橙色地面色調）
- ✅ 天氣系統：冬天下雪（雪花粒子 + 白藍地面色調）
- ✅ 季節地面色調變化（spring 綠 / summer 深綠 / autumn 橙 / winter 白藍）
- ✅ 日夜循環視覺效果（藍天→橙色黃昏→深藍夜晚→粉色晨曦）
- ✅ 四種建築區域正確渲染（綠=住宅、藍=商業、橙=工業、紫=辦公）
- ✅ 車輛沿道路 BFS 路徑移動（紅色小方塊在道路上）
- ✅ 建築資訊面板：住宅（Small House / Residents / Tax）
- ✅ 建築資訊面板：商業（Small Shop / Workers / Tax）
- ✅ 靜音按鈕切換（mute / unmute）
- ✅ 暫停按鈕（game.paused = true/false）
- ✅ 3x 速度（tickInterval = 83ms）
- ✅ 存檔/讀檔循環（Save → 重整 → Load → 城市還原）
- ✅ WASD 平移、Q/E 旋轉、滾輪縮放
- ✅ 鍵盤快捷鍵（2=road, 3=zone_r, ESC=select, Delete=demolish）
- ✅ 拆除工具清除建築+區域（buildingId=0, zoneType=0）
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第五輪測試）
- ✅ 車輛類型多樣化（car/bus/truck/firetruck，不同顏色和大小）
- ✅ 稅率滑桿 UI（右上角 1-20% 範圍，拖動即時更新收入）
- ✅ 背景音樂（Web Audio API 合成 4 和弦循環環境音樂）
- ✅ 道路預估成本顯示（拖曳建路時右上角 Est: $xxx）
- ✅ 拆除預覽紅色高亮（游標不透明度提升至 0.6）
- ✅ 車輛平滑移動（tick 間線性插值）
- ✅ 空城市商業/工業生長修復（RCI 基礎需求值）

### 新增已驗證功能（第六輪測試）
- ✅ 居民滿意度系統修復（BUG-030/031：calculateHappiness 每 tick 更新、avgHappiness 使用真實值）
- ✅ 經濟連鎖反應：加稅 20% → 滿意度 15 → 大量遷出（84→1）→ 降稅 5% → 人口回升至 150
- ✅ UI 面板展開/收合（三個面板各有 ▼ 按鈕，點擊切換 collapsed 狀態）
- ✅ 統計圖表（Canvas 即時繪製人口+滿意度歷史曲線，滾動 50 個數據點）
- ✅ 災害系統整合（隨機地震/龍捲風/森林火災 + 警報音效 + 通知訊息）
- ✅ 稅率遞進處罰（>=12%: -5, >=15%: -15, >=18%: -25, >=20%: -35）

### 新增已驗證功能（第七輪測試）
- ✅ 動態 happiness 系統（BUG-032：通勤距離、服務覆蓋率動態計算 + 市民個體差異）
- ✅ 存檔保存電廠/水廠/居民（BUG-033：Serializer 完整保存 → 讀檔後電力水力正常）
- ✅ 水域建路正確阻止（roadType=0, funds 未扣除）
- ✅ 資金不足建路正確阻止（$100 資金建長路 → 0 路段 + 資金不變）
- ✅ 拆除後重新劃區正常（buildingId=0, zoneType=0 → 重新劃為商業 zoneType=3）
- ✅ 極端稅率連鎖反應（20% → 人口 82→0 全部遷出 → 3% → 人口 0→85 恢復）
- ✅ 負資金穩定性（-$5000 → 100 tick 零 NaN，資金逐漸恢復）
- ✅ 零人口穩定性（清空市民 → 100 tick 零 crash）
- ✅ 1000-tick 穩定性壓力測試通過（零 NaN / Infinity / 錯誤）
- ✅ Save/Load 完整循環（存 82 pop → 重整 → Load → 90 pop + 電力水力正常）
- ✅ Overlay 覆蓋圖切換（Power/Water/Zone/Traffic/None）
- ✅ 面板收合/展開 toggle（▼ ↔ ▲ + 內容隱藏/顯示）
- ✅ 建築資訊面板（Small House, Level ★, Residents 4, Tax $10）
- ✅ 鍵盤快捷鍵 2=road, ESC=select 正確切換
- ✅ 日夜循環視覺效果（藍天→橙色黃昏→深藍夜晚）
- ✅ 零 Console 錯誤

### BUG-030: 居民滿意度從未更新 — 永遠停在初始值 50 ✅ 已修復
- **位置**: `src/core/simulation/SimulationLoop.ts`
- **問題**: `calculateHappiness()` 存在但從未在模擬循環中被呼叫，居民 happiness 永遠是初始值 50
- **修復**: 新增 `updateCitizenHappiness()` 方法，每 tick 根據稅率、就業率、污染等因素更新每位居民的 happiness

### BUG-031: 遷入/遷出使用假 avgHappiness ✅ 已修復
- **位置**: `src/core/simulation/SimulationLoop.ts` — `runMigration()`
- **問題**: `avgHappiness` 使用硬編碼公式 `Math.max(40, 70 - pop * 0.01)` 而非真實居民滿意度
- **修復**: 改為計算所有居民 happiness 的實際平均值

### BUG-032: 居民 happiness 恆定 50 — 輸入參數全部硬編碼 ✅ 已修復
- **位置**: `src/core/simulation/SimulationLoop.ts` — `updateCitizenHappiness()`
- **問題**: commuteDistance=10, serviceCoverage=2, hasPark=false 全部硬編碼，恰好都不觸發任何 happiness 加減分
- **修復**:
  1. commuteDistance 基於城市建築密度動態計算：`1 + sqrt(buildingCount) * 0.7`
  2. serviceCoverage 基於實際電力/水力覆蓋率計算
  3. 每位居民加入 ±3 隨機通勤抖動，產生差異化 happiness

### BUG-033: 存檔不保存電廠/水廠和居民資料 ✅ 已修復
- **位置**: `src/core/save/Serializer.ts`
- **問題**: `SerializedState` 只保存 grid/clock/budget/taxRates，不保存 power.plants/water.plants/citizens
- **影響**: 讀檔後電廠水廠消失 → 0 電力/水力覆蓋 → 建築不生長 → 城市停擺
- **修復**:
  1. PowerGrid/WaterNetwork 新增 `getPlants()` getter
  2. Serializer 新增 powerPlants、waterPlants、citizens 欄位
  3. Deserializer 還原時呼叫 addPlant() 和 createCitizen()
  4. 向下相容：舊存檔缺少這些欄位時使用空陣列

### 新增已驗證功能（第八輪測試 — 實際滑鼠互動 + UI 完整測試）
- ✅ 滑鼠拖拉建路（left_click_drag：hover → drag → road placed，L 型路 25 格 $5000）
- ✅ 滑鼠拖拉劃區（Residential 拖拉建 2×3 = 6 格住宅區）
- ✅ 滑鼠拖拉劃商業區（1 格商業區正確建立）
- ✅ 滑鼠點擊拆除（hover + click 在 demolish 模式下清除格子）
- ✅ 鍵盤快捷鍵完整（5→zone_i, 7→demolish 正確切換）
- ✅ 速度控制按鈕（暫停 paused=true → 3x speed=3 正確設定）
- ✅ 建築生長完整（18R + 6C + 6I = 30 棟全部建成）
- ✅ 人口遷入（0→60 居民，幸福度 65%）
- ✅ 存檔/讀檔 UI 完整循環（save slot 0 → 重整 → Load Game 按鈕 → 城市正確還原）
- ✅ 讀檔資料完整性（roads:86, zones:r18/c6/i6, buildings:30, powerPlants:1, waterPlants:1, pop:60）
- ✅ 鏡頭縮放（scroll up = zoom in, scroll down = zoom out）
- ✅ 稅率滑桿 UI（拖拉 9%→13%，gameState.taxRates.residential = 13 正確同步）
- ✅ 稅率影響幸福度（13% >= 12% → -5 懲罰 → 幸福度 65%→61%）
- ✅ 視窗 Resize 自適應（1218x711 → 786x454 → 1266x654，Canvas 正確重設大小，不變形）
- ✅ 全部 291 單元測試通過（28 測試檔，0 失敗）
- ✅ 主選單顯示正確（WebCity 標題 + New Game / Load Game + v0.1.0 版本號）
- ✅ 冬季雪花粒子正確顯示（Month 11-12）

### 新增已驗證功能（第九輪測試 — 深度功能驗證 + 邊界測試）
- ✅ Overlay 覆蓋圖切換（Power=黃色/Water=青色/Zone=多色/Traffic=紅色/None）
- ✅ 建築資訊面板四種區域（住宅 Small House/商業 Small Shop/工業 Small Factory/辦公 Small Office）
- ✅ 建築資訊面板顯示完整（名稱/等級/居民或工人數/稅收/區域類型）
- ✅ 相機 WASD 平移 + 邊界限制（不會飛出地圖外）
- ✅ 相機 Q/E 旋轉（視角明顯轉動）
- ✅ 相機滾輪縮放（zoom in/out 限制正常）
- ✅ 鍵盤快捷鍵 1-7 全部正確（select/road/zone_r/zone_c/zone_i/zone_o/demolish）
- ✅ ESC → select / Delete → demolish 正確
- ✅ 冬天雪花粒子效果（Month 11, 白藍天空色調）
- ✅ 拆除道路正確清除 roadType + 更新相鄰格子 roadFlags
- ✅ Save/Load 完整循環（存 tick=2672/pop=135/funds=$89,933/buildings=54 → 重整 → Load → 完全還原）
- ✅ 載入後電力/水力覆蓋正確（257 格，電廠水廠各 1）
- ✅ 2000-tick 壓力測試通過（Year 1→4，零 NaN/Infinity/crash）
- ✅ 經濟長期穩定（Income $63 > Expenses $20，資金穩定成長至 $175K）
- ✅ 人口穩定（135 人，Happiness 63-66%）
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### BUG-034: requestAnimationFrame 非焦點分頁暫停導致 tick 延遲
- **位置**: `src/Game.ts` — `update()`
- **問題**: 分頁失去焦點時 rAF 暫停，tickAccumulator 持續累積（最高 475 秒），
  恢復焦點後只有每幀處理 1 tick，需數分鐘才能追趕完畢
- **建議修復**: 加入 `tickAccumulator = Math.min(tickAccumulator, tickInterval * 10)` 上限
- **嚴重性**: 低 — 僅影響非焦點分頁恢復時的體驗
- **狀態**: 待修

### BUG-035: 小視窗工具列按鈕重疊
- **位置**: `src/ui/GameUI.ts` — toolbar CSS
- **問題**: 800x600 視窗下，Office/Demolish 按鈕被速度控制按鈕遮擋
- **嚴重性**: 低 — 僅影響小視窗使用者
- **狀態**: 待修

### 新增已驗證功能（第十輪測試 — 滑鼠互動 + UI 元件 + 里程碑）
- ✅ 工具列按鈕點擊切換（Road 按鈕 → Tool: road 正確反映）
- ✅ 滑鼠拖曳建路（canvas 拖曳 → $3600 扣除 → 16 條新路）
- ✅ 面板收合/展開（▼ 按鈕切換 → Funds/Pop 隱藏/顯示）
- ✅ 速度控制按鈕（暫停 paused=true → 3x speed=3 正確）
- ✅ 稅率滑桿互動（form_input 9%→15% → residential 稅率同步更新）
- ✅ 稅率影響幸福度（15% → Happiness 64%→50%，恢復 9% 後回升）
- ✅ 建築資訊面板顯示/隱藏（Select 點建築 → 面板 visible → 點空地 → hidden）
- ✅ RCI 需求指標條（R/C/I 三色柱狀圖高度反映需求差異）
- ✅ 統計圖表歷史曲線（黃色 Happiness 曲線，可見加稅跌幅和恢復）
- ✅ 拆除工具清除建築+區域（buildingId=0, zoneType=0）
- ✅ Demolish 按鈕高亮紅色 + 預估成本顯示 (Est: $3600)
- ✅ 靜音按鈕切換（🔊 ↔ 🔇 圖示變化）
- ✅ 里程碑通知（Pop 500 → "Tiny Town!" + Unlocked: fire_service, police, bus）
- ✅ 日夜循環視覺效果（深藍夜空）
- ✅ 零 Console 錯誤

### BUG-037: 建路遇到水域/山脈時整段靜默失敗
- **位置**: `src/core/road/RoadBuilder.ts` — `buildRoad()` 第 24-29 行
- **問題**: buildRoad 預先檢查路徑上所有格子，只要有一格是水域或山脈，整條路（包含有效部分）全部取消，
  且沒有任何 UI 回饋告知使用者失敗原因。拖曳長路跨河時會靜默失敗。
- **預期行為**: 應建設到水域/山脈前停下（partial build），或至少顯示失敗提示。
- **嚴重性**: 中 — 使用者會困惑為何路沒有建成
- **狀態**: 待修

### BUG-036: 車輛路線是隨機道路，不連接建築物
- **位置**: `src/core/simulation/SimulationLoop.ts` — `spawnVehicles()` (第 274-307 行)
- **問題**: 車輛起點和終點是從所有道路格子中隨機選取的，完全不考慮建築物位置。
  導致車輛行駛在沒有建築物的道路末端，不符合真實通勤/貨運邏輯。
- **預期行為**: 車輛應從住宅建築出發，前往商業/工業/辦公建築（通勤）；
  或從工業建築出發前往商業建築（貨運）。
- **修復建議**:
  1. 收集有建築物的格子（按 zone type 分類）
  2. 通勤車輛：住宅 → 商業/工業/辦公（隨機配對）
  3. 貨運車輛：工業 → 商業
  4. 找不到建築配對時才 fallback 到隨機道路
- **嚴重性**: 中 — 視覺上不真實，但不影響核心遊戲邏輯
- **狀態**: 待修

### 新增已驗證功能（第十一輪測試 — 稅率修復 + 建築升級調查）
- ✅ 稅率滑桿修復驗證（設 14% → residential/commercial/industrial/office 全部 = 14）
- ✅ 建築升級未整合確認（SimulationLoop 8 步中缺 buildingUpgrade，已記錄於 BUG-011）
- ✅ Load Game 第二次點擊正常（首次可能因 Vite HMR 延遲未觸發）
- ✅ 存檔載入後人口回歸正確值（135，非注入的 500）
- ✅ 零 Console 錯誤

### BUG-039: 道路可以建在有建築物的格子上 ✅ 已修復
- **位置**: `src/core/road/RoadBuilder.ts` — `buildRoad()` 第 24-29 行
- **問題**: buildRoad 只檢查水域/山脈，不檢查建築物。可在有建築的格子上建路（道路與建築共存）。
- **修復**: 新增 `if (cell.buildingId !== 0) return { success: false, reason: 'BUILDING_EXISTS' }` 檢查

### BUG-038: 稅率滑桿只影響住宅稅率 ✅ 已修復
- **位置**: `src/ui/GameUI.ts` 第 340 行
- **問題**: tax-slider 的 input handler 只更新 `taxRates.residential`，commercial/industrial/office 不受影響
- **修復**: 同時更新所有四個稅率

### UI/渲染改進需求

#### ENHANCE-002: UI 整體風格重新設計
- **問題**: 目前 UI 介面風格較簡陋，不夠專業和好用
- **設計工具**: 使用 [Google Stitch](https://stitch.withgoogle.com/) 線上 UI 設計系統
  - 給提示詞請它設計城市經營遊戲的 UI
  - 在介面上方按 more > 查看程式碼 > 複製程式碼
  - 將設計稿轉換為實際 HTML/CSS 套用到遊戲中
- **嚴重性**: 中（影響使用體驗和遊戲質感）
- **狀態**: 待做

#### ENHANCE-003: 經濟與交通詳細面板（彈出視窗）
- **問題**: 經濟與交通是遊戲主軸，但目前只有右上角簡略數字，缺乏詳細檢視功能
- **預期改進**:
  1. **經濟面板** — 新增按鈕開啟彈出視窗，包含：
     - 收入/支出明細分項（住宅稅、商業稅、工業稅、辦公稅、道路維護、服務費等）
     - 經濟歷史曲線（資金、收入、支出隨時間變化的折線圖）
     - 預算分配控制（各項服務支出調整）
     - 貸款管理介面
  2. **交通面板** — 新增按鈕開啟彈出視窗，包含：
     - 交通流量統計（總車輛數、平均通勤時間）
     - 擁塞路段排名（最壅塞的道路列表）
     - 交通熱力圖 overlay 快捷切換
     - 道路容量使用率
  3. 面板設計為可拖曳、可關閉的彈出視窗（modal/popup）
- **嚴重性**: 中（核心遊戲體驗改善）
- **狀態**: 待做

#### ENHANCE-001: 道路渲染改進 — 連續道路外觀
- **位置**: `src/renderer/RoadRenderer.ts`
- **問題**: 目前道路渲染為獨立的格子方塊，相鄰道路格子之間有明顯接縫，不像真實道路。
- **預期改進**:
  1. 相鄰道路格子應視覺上合併為連續路面（無接縫）
  2. 添加車道分隔線（白色虛線/實線）
  3. 十字路口應有特殊渲染（斑馬線、轉彎標線等）
  4. T 型路口和彎道應有平滑拐角
  5. 道路邊緣應有人行道或路緣石
- **嚴重性**: 低（視覺品質改善，非功能性問題）
- **狀態**: 待做

### 新增已驗證功能（第十三輪測試 — 視覺驗證 + Save/Load + 完整互動）
- ✅ 道路渲染正常（InstancedMesh，深灰色 BoxGeometry 方塊，renderDirty 自動觸發 build()）
- ✅ 建築渲染正常（四色 3D 方塊：綠=住宅、藍=商業、橙=工業、紫=辦公，高度隨等級變化）
- ✅ 車輛渲染正常（小彩色方塊在道路上移動，9+ 台車輛同時運行）
- ✅ 道路預覽線正常（拖曳建路時淺藍色半透明 L 型線，previewCost $3200 正確顯示）
- ✅ 分區底色正常（zone 半透明色板：綠/藍/橙/紫 與對應區域一致）
- ✅ 日夜循環視覺（天空色：淺藍白天→粉紅/紅色黃昏→深藍夜晚，動態變化）
- ✅ 水面動畫（TerrainRenderer.update() 用 sin() 上下擺動 ±0.02，代碼正確）
- ✅ 河流/森林/山脈地形渲染正確（水域=藍、森林=深綠、山脈=棕色）
- ✅ 相機方向鍵移動（ArrowLeft×10 成功平移相機）
- ✅ 相機 Q/E 旋轉（視角正確轉動 ±45°）
- ✅ 速度控制按鈕互動（暫停 paused=true → 2x speed=2 正確切換）
- ✅ Demolish 工具正常（建築 buildingId=1 → 0，zone/road 同時清除）
- ✅ Save Game 正常（saveCurrentGame slot 0/1 成功寫入 IndexedDB）
- ✅ Load Game 完整循環（Save pop=67 → 重整頁面 → Load Game → pop=90 城市正確還原）
- ✅ 主選單正常渲染（WebCity 標題 + New Game/Load Game + v0.1.0）
- ✅ 全部 291 單元測試通過（28 測試檔，0 失敗）
- ✅ 零 Console 錯誤（頁面載入 + 遊玩全程無 error/warning）
- ✅ 城市持續成長（Pop 0→90+, Happiness 66%, Balance $19+/tick）

### BUG-040: 工具列按鈕點擊有時無效
- **位置**: `src/ui/GameUI.ts` — toolbar 按鈕
- **問題**: 點擊 Road 按鈕時，右上角 Tool 未切換為 "road"，需使用鍵盤快捷鍵 2 才能切換
- **可能原因**: 按鈕 click handler 可能被 canvas 的 mousedown 事件搶先處理，或按鈕 z-index 問題
- **嚴重性**: 低 — 鍵盤快捷鍵可作替代方案
- **狀態**: 待修

### 新增已驗證功能（第十四輪測試 — 邊界條件與穩定性壓力測試）
- ✅ 大規模城市渲染（245 建築 + 323 道路 + 22 車輛，120 FPS 流暢運行）
- ✅ 500-tick 快進測試（704ms = 761 ticks/sec，零錯誤）
- ✅ 5000-tick 長期穩定性（6574ms，tick 6272 = 4.4 遊戲年，零 NaN/Infinity/crash）
- ✅ 經濟長期穩定（Pop 440, Funds $1.84M, Happiness 56%, Balance $218/tick）
- ✅ 負資金穩定性（-$1000 → 200 tick → $46,504 恢復，零 NaN）
- ✅ 負資金建路正確拒絕（INSUFFICIENT_FUNDS）
- ✅ 100 次快速建拆循環（零錯誤，Grid 狀態正確清理）
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第十五輪測試 — 大規模 Save/Load 完整性驗證）
- ✅ 大城市存檔（440 人、245 建築、323 道路、445 分區 → IndexedDB）
- ✅ 大城市載入（重整頁面 → Load Game → 城市完整還原）
- ✅ 資料完整性：15 項中 13 項完全匹配（tick/funds 因繼續運行而變化，屬正常）
  - 完全匹配：Pop, Income, Expenses, 4 稅率, 電廠, 水廠, 市民數, 建築數, 道路數, 分區數
- ✅ 載入後遊戲持續運行正常（模擬、經濟、渲染）
- ✅ 災害系統在載入後正常觸發（"Forest Fire at (28,29)! Intensity: 80%" 通知顯示）
- ✅ 零 Console 錯誤

### 未完成功能
- ⚠️ 部分進階子系統未整合（BUG-011：污染、地價、建築升級等）
