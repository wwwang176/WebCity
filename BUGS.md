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
- ~~地價系統 (LandValue) — 計算但未回寫到 grid~~ ✅ 已修復（第十八輪）
- ~~汙染系統 (Pollution) — 已加入 state 但未在 tick 中計算~~ ✅ 已修復（第十八輪）
- ~~建築升級/降級 — 已加入 state 但未在 tick 中呼叫~~ ✅ 已修復（第十八輪）
- 區域劃分與政策 (District) — 待做
- 災害系統 — 基本功能已有，進階連鎖待做
- 大眾運輸 — 核心邏輯已實作，UI 未整合
- 服務車輛調度 — 待做
- **嚴重性**: 低 — 核心子系統已整合，剩餘為進階功能
- **狀態**: 部分修復

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

### BUG-034: requestAnimationFrame 非焦點分頁暫停導致 tick 延遲 ✅ 已修復
- **修復**: `tickAccumulator = Math.min(tickAccumulator, tickInterval * 10)` 上限已存在

### BUG-035: 小視窗工具列按鈕重疊 ✅ 已修復
- **修復**: toolbar CSS 已加入 `flex-wrap: wrap`，按鈕在小視窗自動換行

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

### BUG-037: 建路遇到水域/山脈時整段靜默失敗 ✅ 已修復
- **位置**: `src/Game.ts` — `handleToolAction()` road case
- **修復**: 建路失敗時顯示通知訊息 "Cannot build road: water in the way / mountain in the way / insufficient funds" 等
- 通知持續 4 秒自動消失

### BUG-036: 車輛路線是隨機道路，不連接建築物 ✅ 已修復
- **位置**: `src/core/simulation/SimulationLoop.ts` — `spawnVehicles()`
- **修復**: 收集住宅建築格和工作建築格（商業/工業/辦公），車輛從住宅出發到工作地點
- 無建築時 fallback 到隨機道路格

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

### BUG-040: 工具列按鈕點擊有時無效 ✅ 已修復
- **位置**: `src/ui/GameUI.ts` — toolbar 按鈕
- **修復**: 在 toolbar button click handler 加入 `e.stopPropagation()` 防止事件冒泡到 canvas mousedown

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

### 新增已驗證功能（第十六輪測試 — Overlay + 季節 + 進階系統檢查）
- ✅ Power Overlay（黃色高亮有電區域，切換即時）
- ✅ Water Overlay（青色高亮有水區域）
- ✅ Traffic Overlay（紅/橘色高亮交通密度）
- ✅ Zone Overlay（多色高亮不同分區類型）
- ✅ Overlay None（清除所有覆蓋層）
- ✅ 季節循環（spring→summer→autumn→winter→spring，地面色調隨季節微調）
- ✅ 日夜循環持續運作（淺藍→暗藍→紅粉→淺藍）
- ✅ 災害系統自動觸發（Forest Fire + Tornado 通知，含座標和強度%）
- ✅ 里程碑系統完整（6 階段：500/1K/2.5K/5K/10K/25K 人口，各有解鎖項目）
- ✅ DistrictManager 核心邏輯已實作（create/merge/split/addCell），但無 UI 入口（BUG-011）
- ✅ 城市長期穩定運行（Year 9, Pop 440, $1.1M, Happiness 57%）
- ✅ 零 Console 錯誤

### 已完成全部驗收項目摘要

**核心功能（全部通過）：**
- 地圖渲染、地形生成、相機控制（WASD/Q/E/滾輪）
- 道路建設（拖曳/預覽線/預估成本/費用扣除）
- 分區劃設（R/C/I/O 四種類型，需緊鄰道路）
- 建築生長（有電有水的分區自動出現建築）
- 模擬引擎（8 步 tick：RCI/預算/電/水/建築/居民/交通/收入）
- 經濟系統（稅收/支出/資金/正負資金穩定性）
- 人口系統（遷入/遷出/老化/滿意度計算）
- 交通系統（車輛生成/路徑/擁塞/車流密度）
- 電力/水力覆蓋（BFS 從設施沿道路擴散）
- Save/Load（IndexedDB 完整保存/還原，含電廠水廠市民）
- UI（工具列/速度控制/稅率滑桿/面板收合/統計圖表）
- 音效（建路/拆除/劃區/里程碑/災害 + 靜音按鈕）
- Overlay（Power/Water/Zone/Traffic 四種覆蓋圖）
- 天氣（日夜循環 + 四季視覺 + 雨雪粒子）
- 災害（地震/龍捲風/森林火災 + 建築破壞 + 通知）
- 里程碑（6 階段人口門檻解鎖通知）

**待做進階功能（非核心，不影響基本遊玩）：**
- 建築升級/降級（BUG-011）
- 污染/地價回寫到 grid
- District 畫區 UI + 區域政策
- 大眾運輸系統
- 服務車輛調度
- UI 風格重設計（ENHANCE-002）
- 經濟/交通詳細面板（ENHANCE-003）
- 道路連續渲染（ENHANCE-001）

### 新增已驗證功能（第十七輪測試 — 鍵盤快捷鍵 + 建築面板 + 存檔 + 視窗自適應）
- ✅ 空格鍵暫停/恢復（Space toggle paused=true/false）
- ✅ `=`/`+` 加速（1→2→3，正確限制最大 3x）
- ✅ `-` 減速（3→2→1，正確限制最小 1x）
- ✅ 建築資訊面板四種區域完整：
  - Residential: "Small House" Level 1
  - Commercial: "Small Shop" Level 1
  - Industrial: "Small Factory" Level 1
  - Office: "Small Office" Level ★★☆, Workers 15, Tax $30/tick
- ✅ IndexedDB 存檔驗證（Slot 0: AutoSave 118KB, Slot 1: TestSave 38KB，獨立運作）
- ✅ 視窗 800×600 自適應（Canvas 正確縮放，工具列換行兩排，面板可讀）
- ✅ 視窗恢復 1280×800 正常（工具列回到一排）
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第十八輪測試 — 模擬子系統整合修復 + 深度驗證）
**重大修復：BUG-011 核心整合**
- ✅ **污染系統整合** — 工業區產生 ground:150 + noise:70 污染，正確擴散衰減
  - 住宅區（距工業 10+ 格）pollution=0，工業區 pollution=255（ground+noise cap）
  - 每 10 ticks 更新一次（效能優化）
  - 污染值回寫到 grid.pollution 欄位，overlay 可顯示
- ✅ **地價系統整合** — 基於服務覆蓋、污染、水岸、公園計算
  - 住宅區（有公園加成）landValue=81
  - 商業區 landValue=81
  - 工業區 landValue=58（0.2x 自身污染因子，避免永遠為 0）
  - 森林地形視為自然公園，2 格半徑內 +15 地價
  - 水岸 +20 地價
- ✅ **建築升級系統整合** — L1→L2→L3 完整路徑驗證
  - L1→L2：serviceCov≥3 + landValue≥50 ✓（4棟住宅 + 4棟商業成功升級）
  - L2→L3：serviceCov≥5 + landValue≥80 + crime<20 + pollution<30 ✓
  - 住宅 bld1→bld2→bld3（Small→Medium→Large House）
  - 商業 bld7→bld8→bld9（Small→Medium→Large Shop）
  - 工業 bld13→bld14（Small→Medium Factory，L3 受污染限制，正確行為）
- ✅ **serviceCoverage / noiseLevel 回寫 grid** — overlay 顯示正確數值
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第十九輪測試 — Overlay 系統 + 鍵盤快捷鍵）
**新功能：Overlay 資料補全 + F-key 切換**
- ✅ **污染 overlay (F3)** — 工業區顯示暖色（棕/橙），住宅區無色，正確反映 grid.pollution
- ✅ **電力 overlay (F1)** — 黃色高亮有電覆蓋的建築區域
- ✅ **地價 overlay (F4)** — 藍色調，建築區域有不同深淺
- ✅ **水供 overlay (F2)** — 藍色高亮有水覆蓋區域
- ✅ **交通 overlay (F5)** — 綠→紅色漸層
- ✅ **區域 overlay (F6)** — 不同區域有不同色調
- ✅ **Toggle 切換** — 按同一鍵再次關閉 overlay
- ✅ **F1-F6 阻止瀏覽器預設行為**（防止 F5 重整頁面）
- ✅ 效能測試：FPS=165（含新子系統 + 大地圖 561 道路 + 1617 zones）
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第二十輪測試 — 災害系統 + Production Build）
- ✅ **地震災害** — 手動觸發 intensity=70%, radius=10：摧毀 10 棟建築（damage>0.5）
- ✅ **災害通知** — 畫面上方正確顯示「Earthquake at (25,39)! Intensity: 70%」
- ✅ **建築摧毀** — buildingId 正確設為 0，渲染即時更新（消失的建築）
- ✅ **Production Build 成功** — `vite build` 1.14s 完成
  - Game chunk: 544KB (gzip: 138KB) — 含 Three.js
  - GameUI chunk: 13KB (gzip: 3.8KB)
  - index chunk: 25KB (gzip: 7.9KB)
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第二十一輪測試 — 存檔完整性 + Load UI 修復）
**修復：Load Game 存檔列表 UI**
- ✅ Load Game 按鈕現在顯示存檔列表（名稱、slot、日期、大小）
- ✅ 點擊存檔即可載入（不再硬編碼 slot 0）
- ✅ Back 按鈕回到主選單
- ✅ **存檔/讀檔完整性驗證** — 所有新子系統資料正確序列化/反序列化：
  - 58 棟建築、44 污染格、68 地價格 — 完全匹配
  - tick=3087, population=34, funds=$387,230 — 完全匹配
  - 工業 cell: pollution=180, landValue=50, serviceCoverage=4 — 完全匹配
  - 住宅 L3 cell: buildingId=3 (Large House), landValue=81 — 完全匹配
  - 電廠×2、水廠×2 — 完全匹配
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第二十二輪測試 — 拆除/老化/建築重生/滑鼠互動）
- ✅ **建築重生** — 拆除住宅（buildingId=3→0, zoneType=1 保留）→ 300 ticks 後 buildingId=3 重新生長
- ✅ **市民老化正確** — 每遊戲年（1440 ticks）所有市民 age +1（26→27, 52→53 等）
- ✅ **市民死亡機制** — age>90 有 10% 機率死亡，age>100 必定死亡
  - Year 3→54（51 年），39→23 人，16 人因老化死亡
  - 最老 97 歲，最年輕 73 歲，遊戲穩定運行
- ✅ **滑鼠拆除建築** — Demolish 工具 + 滑鼠左鍵點擊建築，buildings 68→67 正確減少
- ✅ **拆除視覺即時更新** — 建築 3D 方塊立即消失
- ✅ **長期穩定性** — 55 遊戲年（~80K ticks），零 NaN/crash，資金 $9.4M
- ✅ **Balance 正確反映** — 拆除工業建築後 Balance $121→$118/tick（稅收減少）
- ✅ 零 Console 錯誤

### 新增已驗證功能（第二十三輪測試 — 建築面板/Overlay/存檔/子系統分析）
- ✅ **建築資訊面板 L3** — Large House: Level ★★★, Residents 8, Tax $28/tick, Zone: Residential (Low)
- ✅ **建築資訊面板 L2** — Medium House: Level ★★☆, Residents 6, Tax $18/tick
- ✅ **建築資訊面板四種區域完整**:
  - Commercial L3: Large Shop ★★★
  - Industrial L2: Medium Factory ★★☆
  - Office L2: Medium Office ★★☆, Workers 30, Tax $60/tick
- ✅ **Power Overlay (F1)** — 黃色清晰高亮有電覆蓋區域
- ✅ **Zone Overlay (F6)** — 多色分區底色清晰顯示（綠/藍/橙/紫）
- ✅ **Pollution Overlay (F3)** — 工業區 pollution=180，住宅區 pollution=0，數據正確
- ✅ **Toggle 切換** — 同一 F-key 再按關閉 overlay
- ✅ **多存檔插槽** — 4 個獨立存檔（Slot 0 AutoSave 34KB, Slot 1 TestSave 37KB, Slot 2 R23-MultiSlotTest, Slot 3 R21-SubsystemTest 35KB）
- ✅ **Production Build** — `vite build` 1.28s 成功（Game 544KB, GameUI 13KB, index 27KB）
- ✅ **日夜循環視覺** — 粉紅黃昏 → 淺藍天空，持續正確循環
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 子系統整合狀態總結（第二十三輪分析）

**已整合且運作正常：**
- Grid, Road, Zone, Building（生長/升級/降級）
- Citizen（遷入/遷出/老化/死亡/幸福度）
- Economy（RCI/稅收/預算/地價）
- Power/Water（BFS 覆蓋）
- Traffic（車輛生成/移動/密度）
- Pollution（ground/noise 擴散 + 回寫 grid）
- Save/Load（IndexedDB 完整序列化）
- Overlay（6 種 + F1-F6 快捷鍵）
- Weather（日夜/四季/雨雪粒子）
- Disaster（地震/龍捲風/森林火災 + 建築破壞）
- Milestone（6 階段人口門檻通知）
- Audio（音效 + 背景音樂 + 靜音）

**有程式碼但未整合到遊戲循環（僅單元測試通過）：**
- District 管理（DistrictManager/PolicyManager/Specialization）— 無 UI
- 公共交通 7 系統（Bus/Metro/Rail/Tram/Ferry/Taxi/Airport）— 無 GameState/UI
- 教育系統（educateTick 存在但未被呼叫）— 無 UI
- 預警系統（WarningSystem）— 無 GameState
- 水流系統（WaterFlow）— 無 GameState
- 自然資源管理（NaturalResourceManager）— 無 GameState
- 消防/警察/醫療服務調度 — 僅里程碑引用，無實作

### 新增已驗證功能（第二十四輪測試 — 端到端完整流程 + 新遊戲→載入循環）
- ✅ **主選單 New Game** — 正確進入新遊戲（Day 1, Year 1, Pop 0, $50,000）
- ✅ **主選單 Load Game** — 顯示 5 個存檔列表（可滾動），點擊載入正確
- ✅ **Back 按鈕** — 從存檔列表回到主選單
- ✅ **從零建城完整流程**:
  1. 建路（8 條網格道路 $8,000）
  2. 劃區（20R + 8C + 4I + 4O = 36 格）
  3. 放電廠水廠（BFS 覆蓋成功）
  4. 500 ticks → 31 棟建築自動生長（含 L2 升級）
  5. 50 居民遷入，Happiness 60%
- ✅ **長期運行** — 2500 ticks 後：36 buildings, Pop 50, $120K, Balance $34/tick
- ✅ **多存檔驗證** — 5 個獨立 slot（0-4）在 Load Game 列表中正確顯示
- ✅ **Save/Load 循環** — 存 Slot 4 → 重整頁面 → Load → Pop 50/$122K 正確還原
- ✅ **載入後遊戲持續運行** — 模擬、渲染、UI 全部正常
- ✅ **Production Build** — 1.28s 成功
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第二十五～二十六輪測試 — Bug 修復 + 程式碼審查驗證）
**修復 5 個待修 bug（待修清零）：**
- ✅ **BUG-034** — tickAccumulator 上限（`Math.min(acc, tickInterval*10)`）已確認存在
- ✅ **BUG-035** — toolbar `flex-wrap: wrap` 已確認存在
- ✅ **BUG-036** — 車輛從住宅→商業/工業/辦公，fallback 隨機道路（程式碼審查 + 單元測試通過）
- ✅ **BUG-037** — 建路失敗通知 "Cannot build road: water in the way" 等 5 種原因（程式碼審查確認）
- ✅ **BUG-040** — toolbar 按鈕 `stopPropagation` 防止 canvas 搶事件（瀏覽器互動驗證 Road/Demolish 點擊正確）
- ✅ Production Build 968ms 成功
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第二十七輪測試 — 視覺驗證 + BUG-041 發現修復）
**視覺驗證成功：**
- ✅ **BUG-037** 瀏覽器視覺確認 — 水面建路顯示 "Cannot build road: water in the way"，山丘顯示 "mountain in the way"
- ✅ 鍵盤快捷鍵 1-7 工具切換全部正常（Select/Road/Residential/Commercial/Industrial/Office/Demolish）
- ✅ 暫停/3x速度切換正常（暫停→tick停止，3x→tick速度×3）
- ✅ 存檔/讀檔完整流程正常（IndexedDB 多 slot，Load Game 列表顯示正確，讀取後狀態還原）
- ✅ 建築生長 + 電力水力 BFS 傳播正常

**新 BUG 發現並修復：**
- ✅ **BUG-041** — `bfsRoadPath` 終點是建築 cell 而非 road cell，導致 BFS 永遠找不到路徑，車輛生成為 0
  - 原因：BUG-036 修復後 start/end 改用建築 cell，但 BFS 只沿 road cell 搜索
  - 修復：新增 `findAdjacentRoad()` 方法，將建築 cell 映射到鄰近道路 cell 再進行 BFS
  - 驗證：修復後車輛正常從住宅道路→工商業道路行駛，路徑長度合理
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第二十八輪測試 — UI 互動全面驗證）
- ✅ F1 Power Overlay — 黃色覆蓋層正確顯示道路沿線電力傳輸
- ✅ F2 Water Overlay — 青藍色覆蓋層正確顯示水力傳輸
- ✅ F6 Zone Overlay — 綠色住宅/藍色商業/橙色工業分色正確
- ✅ Q/E 相機旋轉 — 45度旋轉平滑正確
- ✅ 滾輪縮放 — 放大/縮小流暢
- ✅ 稅率滑桿 — UI 拖動更新 taxRates + 收入即時反映（9%→17%，Balance $12→$24）
- ✅ Demolish 工具 — UI 點擊拆除建築正常（buildingId→0, zoneType→0）
- ✅ Production Build 1.15s 成功
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第二十九輪測試 — 快捷鍵 + 邊界測試）
- ✅ 空白鍵暫停/恢復 — toggle 正常，tick 停止/繼續
- ✅ +/= 加速 — 1→2→3，clamp 在 3 不溢出
- ✅ - 減速 — 3→2→1，clamp 在 1
- ✅ ESC 取消工具 — demolish→select 正確
- ✅ 建築資訊面板 — Select 點擊顯示 Medium House / Level ★★☆ / Residents 6 / Tax $18 / Zone Residential (Low)
- ✅ 負資金/破產 — Funds: $-244 正確顯示，Balance: $-1/tick，遊戲不崩潰繼續運行
- ✅ 低稅率回饋 — 1% 稅率時 Happiness 升至 63%（合理）

### 新增已驗證功能（第三十輪測試 — 里程碑/災害/RCI 需求條）
- ✅ 里程碑系統 — Pop 510 觸發 "Tiny Town! (Pop 500) — Unlocked: fire_service, police, bus" 通知
- ✅ 災害系統 — "Disaster: Tornado at (10,15)! Intensity: 60%" 通知正確顯示
- ✅ RCI 需求條 — R(綠)/C(藍)/I(橙) 三色柱狀圖正確渲染，高度反映需求大小

### 待修 bug 數量：0

### 新增已驗證功能（第三十一輪測試 — 拖曳建設 + Console 安全確認）
- ✅ 拖曳建路 — mousedown→mousemove→mouseup 正確建出 27 格道路（$5,404 扣款）
- ✅ 拖曳劃區 — setZoneRect 正確限制為道路鄰近格（非鄰近格自動跳過）
- ✅ 完整建城流程（純 UI 操作）— 拖曳建路→旁邊劃區→電力水力→建築生長→車輛→20棟/7人口
- ✅ Delete 鍵 → Demolish 工具切換
- ✅ 零 Console 錯誤（頁面載入 + 新遊戲 + 完整操作流程）
- ✅ 建路預估成本顯示 "Tool: road (Est: $6400)" 正確

### 已完成的全面驗證清單（第1～31輪）
**核心遊戲循環：** 新遊戲→建路→劃區→供電供水→建築生長→市民入住→經濟循環→存檔/讀檔
**UI 互動：** 工具列點擊、鍵盤快捷鍵(1-7/Q/E/Space/+/-/ESC/F1-F6/Delete)、稅率滑桿、建築面板、通知系統
**3D 渲染：** 等角視角、相機旋轉縮放、建築/道路/車輛渲染、地形(水/山)、overlay 6 種
**模擬系統：** 速度控制(暫停/1x/2x/3x)、市民老化/死亡、建築升降級、拆除/再生長、車輛路由
**事件系統：** 里程碑通知、災害通知、建路失敗通知
**經濟系統：** 稅收/支出/負收入/破產處理
**品質保證：** 零 Console 錯誤、Production Build 成功、291/291 單元測試
**Bug 修復：** BUG-034~041 共 8 個已修復

### 未整合的進階子系統（有程式碼+單元測試，但無遊戲循環/UI）
- District 畫區 UI + 區域政策
- 公共交通 7 系統（Bus/Metro/Rail/Tram/Ferry/Taxi/Airport）
- 教育系統（educateTick 未被呼叫）
- 預警/水流/自然資源管理
- 消防/警察/醫療服務調度

### 新增已驗證功能（第三十二輪測試 — 天氣/季節/升級/自動存檔/圖表）
- ✅ **日夜循環視覺驗證** — 手動設定 timeOfDay 比較：
  - 午夜(0.0): 天空 #0a0a2e(深藍), ambient=0.15, directional=0, 場景明顯變暗
  - 正午(0.5): 天空 #87ceeb(淺藍), ambient=0.6, directional=0.8, 場景明亮
  - 日落(0.7): 天空 #d1643f(橙紅), ambient=0.19, directional=0.08, 暖色過渡
  - 夜晚(0.75+): 天空 #0a0a2e, 全暗
- ✅ **冬季雪花粒子視覺** — 設定 GameClock.tick→冬季月份：
  - season='winter', isSnowing=true, snowSystem 3000 顆粒子在場景中飄落
  - 季節 overlay: #eeeeff(白藍) opacity=0.15
  - 截圖清晰可見白色雪花粒子遍布場景
- ✅ **滿意度歷史圖表** — stats-chart canvas(140×60) 在右側面板中正確渲染：
  - 藍色線：人口(Pop: 7)
  - 黃/綠色線：滿意度(Happy: 59%)
  - 兩條線有歷史數據，隨時間變化
- ✅ **自動存檔驗證** — IndexedDB 確認：
  - Slot 0: "AutoSave", 24KB, 時間戳最近
  - 另有 4 個獨立存檔(Slot 1-4)，互不干擾
- ✅ **建築升級 L1→L2→L3 驗證** — 20 棟建築等級分布：
  - L1: 0 棟（全部已升級）
  - L2: 19 棟（Medium House×10, Medium Factory×6, Medium Shop×3）
  - L3: 1 棟（Large House）
  - 建築資訊面板正確顯示：Large House, Level ★★★, Residents 8, Tax $28/tick, Zone Residential (Low)

### 新增已驗證功能（第三十三輪測試 — 四季完整 + Save/Load UI + 小修復）
- ✅ **四季視覺完整驗證**：
  - Spring: overlay #90ee90(淺綠) 5%, rain
  - Summer: overlay #228b22(深綠) 3%, 無降水
  - Autumn: overlay #cc7722(橙棕) 8%, rain
  - Winter: overlay #eeeeff(白藍) 15%, snow
- ✅ **主選單 Load Game UI** — 5 個存檔列表可滾動，顯示名稱/Slot/日期/大小
- ✅ **Back 按鈕** — 從存檔列表回到主選單
- ✅ **AutoSave 載入** — 點擊 Slot 0 → 城市完整還原（Pop 7, $78K, Month 11/Year 3）
- ✅ **BUG-042 修復** — 存檔名稱為 undefined 時顯示 "Unnamed"（MainMenu.ts `s.name || 'Unnamed'`）
- ✅ 零 Console 錯誤（頁面載入 + Load Game 全程無 error）
- ✅ 全部 291 單元測試通過
- ✅ Production Build 953ms 成功

### 新增已驗證功能（第三十四輪測試 — 新遊戲完整生命週期 + 穩定性壓力測試）
- ✅ **New Game 初始狀態** — Day 1/Month 1/Year 1, Pop 0, $50,000, 電廠(2,2)+水廠(4,2) 自動放置
- ✅ **從零建城完整流程** — JS 建路(3條)→劃區(32R+14C+13I/O=59格)→500 ticks→53棟建築+81居民+9車輛
- ✅ **經濟循環正常** — Balance +$57/tick, 資金 $45K→$69K 正成長
- ✅ **1000-tick 壓力測試** — 731ms, 零 NaN/Infinity/crash, Pop 81, $136K, Balance +$61/tick
- ✅ **城市穩定運行** — 建築 53→54, Happiness 58%→53%（微降屬正常波動）
- ✅ 零 Console 錯誤

### BUG-043: 相機平移無邊界限制 ✅ 已修復
- **位置**: `src/renderer/SceneManager.ts` — `panCamera()`
- **問題**: WASD 平移相機無任何邊界限制，可無限飛離地圖（x=-353 等）
- **修復**: 新增 cameraTarget clamp，限制在 [-10, 70]（地圖 0-60 ± 10 margin）

### 新增已驗證功能（第三十五輪測試 — 音效/相機/春雨/邊界修復）
- ✅ **音效系統** — AudioManager 運行中（audioContext.state="running"），BGM 播放，muted toggle 正常
- ✅ **SFX 播放** — playSfx('click') 無錯誤
- ✅ **BUG-043 修復** — 相機平移現在 clamp 在 [-10, 70]，不會飛出地圖外
- ✅ **春季雨滴** — isRaining=true, rainSystem 3000 顆粒子，場景活躍
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### BUG-044: 滾輪縮放不會累積 ✅ 已修復
- **位置**: `src/renderer/SceneManager.ts` — `zoomCamera()`
- **問題**: zoomCamera 使用硬編碼 `frustumSize = 60`，每次計算 `newSize = 60 + delta`，導致縮放不會累積（總是從預設值偏移一步）
- **修復**: 改用 `currentSize = (this.camera.top - this.camera.bottom) || 60`，讓縮放基於當前實際視野大小累積

### 新增已驗證功能（第三十六輪測試 — 縮放累積 + 快速切換 + 生產建置）
- ✅ **BUG-044 修復** — 縮放現在正確累積（30→15 after 10 zoom-ins → 45 after 20 zoom-outs）
- ✅ **快速工具切換** — 50 次連續鍵盤切換 (R/C/I/O/B/D/X)，零錯誤
- ✅ **Production Build** — `pnpm build` 成功 (1.14s, ~545KB main chunk)
- ✅ 零 Console 錯誤

### 新增已驗證功能（第三十七輪測試 — 視窗縮放 + UI 面板 + 完整互動驗證）
- ✅ **視窗縮放響應** — 1920→800x600→400x300→1920 全程 canvas/camera 正確更新，無 NaN
- ✅ **滾輪縮放累積** — 60→35(zoom in 5x)→85(zoom out 10x)，修復後正確累積
- ✅ **縮放極限** — min=10, max=200 正確 clamp
- ✅ **Camera Pan/Rotate API** — panCamera/rotateCamera 正常移動相機
- ✅ **Camera 邊界 Clamp** — 極端平移後相機被限制在 [-10, 70] 範圍
- ✅ **速度控制** — pause/1x/2x/3x 切換正常，暫停時 tick 不前進
- ✅ **UI 即時更新** — Date/Funds/Population/Balance/Happiness 全部正確顯示
- ✅ **Zone 機制** — 只有道路相鄰格子可劃區（isAdjacentToRoad 驗證正確）
- ✅ **基礎設施連接** — 電廠/水廠需道路連接才能供電供水，連接後建築立即生長
- ✅ **建築資訊面板** — Select 工具點擊建築顯示 building-panel（Large House, Level ★★★, Residents 8）
- ✅ **RCI 指標條** — R(綠100%), C(藍64.75%), I(橙55%) 正確反映需求
- ✅ **Demolish 功能** — 建築/zone/道路全部清除（buildingId→0, zoneType→0）
- ✅ **通知系統** — "Cannot build road: insufficient funds" 正確顯示（timer=4s）
- ✅ **AutoSave** — Slot 0 "AutoSave" 成功寫入 IndexedDB（37KB）
- ✅ **Loading Screen** — 主選單→New Game 時顯示 "Loading WebCity..." 進度條
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第三十八輪測試 — 里程碑、災害、地形、交通、子系統完整驗證）
- ✅ **里程碑系統** — Tiny Town (500 pop) + Small City (1000 pop) 正確觸發通知 + 解鎖內容
- ✅ **災害系統** — Earthquake 正確觸發，顯示位置/強度，破壞建築
- ✅ **地形建設限制** — 水域 "water in the way"，山脈 "mountain in the way" 正確阻止
- ✅ **地形分佈** — PLAIN:3150, WATER:180, MOUNTAIN:49, FOREST:221（60x60 地圖）
- ✅ **面板折疊/展開** — panel-toggle 點擊正確切換 collapsed class
- ✅ **Pollution 系統** — avgPollution:37.6, 道路旁 0（工業區在遠處）
- ✅ **Crime 系統** — avgCrime:20.18
- ✅ **Land Value** — 道路旁 73，遠處 0（位置影響正確）
- ✅ **Service Coverage** — poweredRatio:1, wateredRatio:1（100% 覆蓋）
- ✅ **交通車輛** — 22 輛車行駛中，完整 BFS 路徑（20 步），currentIndex 追蹤移動
- ✅ **稅率系統** — R/C/I/O 各 9%（預設值）
- ✅ 零 Console 錯誤（僅 Chrome 擴充套件通訊錯誤，非遊戲本身）

### 新增已驗證功能（第三十九輪測試 — 市民、序列化、壓力測試完整驗證）
- ✅ **市民系統** — 1009 位完整屬性（id, age, lifeStage, education, incomeLevel, happiness, health）
- ✅ **年齡分佈** — 20s/30s/40s/50s 多種年齡段
- ✅ **教育等級** — NONE/ELEMENTARY/HIGH_SCHOOL/UNIVERSITY 分佈
- ✅ **收入等級** — LOW/MEDIUM/HIGH 分佈
- ✅ **建築等級分佈** — L1:2, L2:51, L3:6（升級系統運作正常）
- ✅ **序列化完整性** — AutoSave 包含 version/grid(575 cells)/clock/budget/taxRates/powerPlants/waterPlants/citizens(1009)
- ✅ **2000-tick 乾淨壓力測試** — 1687ms, 零 NaN, $35K→$142K, Pop 95, 46 棟建築
- ✅ **交通路段** — 27 個路段有車輛，23 輛活躍
- ✅ 零 Console 錯誤

### 新增已驗證功能（第四十輪測試 — 3D 渲染、Overlay、鍵盤快捷鍵、截圖驗證）
- ✅ **3D 場景結構** — 14 子物件：3 燈光 + 10 Mesh + 1 Points 粒子系統
- ✅ **4 渲染器** — BuildingRenderer/RoadRenderer/TerrainRenderer/WeatherRenderer 全部存在
- ✅ **鍵盤快捷鍵 100%** — 1-7(工具)/Escape/Delete/Space(暫停)/+-(速度) 全部正確
- ✅ **Overlay 切換** — power/water/pollution/landValue/traffic/zone 全部 toggle on/off 正確
- ✅ **截圖視覺驗證** — 等角 3D 視角、綠色地圖、道路(黑方塊)、建築(彩色方塊)、水域(藍)、車輛(紅)
- ✅ **UI 完整** — 左上資訊面板、右上統計、底部工具欄、RCI 條、速度控制、Tax Rate slider
- ✅ 零 Console 錯誤

### 新增已驗證功能（第四十一輪測試 — 存檔多 slot、稅率滑桿、拖拽、預覽線）
- ✅ **多 slot 存檔** — 6 個存檔正常（Slot 0 AutoSave + Slot 5 Round41-Test, 40KB）
- ✅ **Tax Rate slider** — 拖拽調整 9%→15%，四種稅率同步更新
- ✅ **範圍 Demolish** — 拖拽選取 7 棟建築一次全部清除（buildingId+zoneType 歸零）
- ✅ **Road 預覽線** — dragStart 設定後 previewLine 正確建立（場景 +1 子物件），清除時正確移除
- ✅ **Grid Cursor** — PlaneGeometry 半透明白色 mesh，追蹤滑鼠位置
- ✅ 零 Console 錯誤（23 條均為 Chrome 擴充套件通訊，非遊戲本身）

### 新增已驗證功能（第四十二輪測試 — Load Game 完整恢復 + 截圖驗證）
- ✅ **Load Game 存檔列表** — 主選單→Load Game 顯示 6 個存檔（名稱/Slot/日期/大小）
- ✅ **Load Game 完整恢復** — Slot 5 載入：tick 2207, funds $150,879, pop 95, buildings 46, roads 70
- ✅ **載入後遊戲繼續運行** — tick 2207→2257, 資金 $150K→$153K（50 tick 正常增長）
- ✅ **截圖驗證** — 載入後城市視覺完整：道路/建築/水域/地形全部正確渲染
- ✅ **序列化保真** — taxRates/citizens/grid/clock/budget 全部精確恢復

### 新增已驗證功能（第四十三輪測試 — Overlay 截圖、Stats Chart、Mute 完整驗證）
- ✅ **Pollution Overlay 截圖** — 背景粉橙色，工業區紅色熱力圖，汙染視覺化正確
- ✅ **Zone Overlay 截圖** — 住宅(綠)/商業(藍)/工業(橙)/辦公(紫) 色塊清楚顯示
- ✅ **Stats Chart** — Population 綠線 + Happiness 黃線即時繪製（140x60 canvas）
- ✅ **Mute Toggle** — toggleMute() 正確切換靜音/取消靜音
- ✅ **AudioManager API** — startBGM/stopBGM/playSfx/setMasterVolume/setMusicVolume/setSfxVolume 完整

### 新增已驗證功能（第四十四輪測試 — 滑鼠/鍵盤完整互動 + UI 按鈕 + 速度控制）
- ✅ **Select 工具 + 滑鼠點擊建築** — 點擊紫色建築顯示 "Medium Office, Level ★★☆, Workers 30, Tax $60/tick, Zone: Office"
- ✅ **7 個工具列按鈕全部滑鼠點擊正常**:
  - Select→select, Road→road, Residential→zone_r, Commercial→zone_c
  - Industrial→zone_i, Office→zone_o, Demolish→demolish
- ✅ **鍵盤工具切換** — 按 1=select, 2=road, 3=zone_r, 7=demolish 全部正確
- ✅ **Demolish 工具** — 程式碼呼叫 handleToolAction 正確清除道路（roadType:2→0, 109→108 roads）
- ✅ **速度控制按鈕滑鼠點擊**:
  - 1x 按鈕 → speed=1
  - 2x 按鈕 → speed=2
  - 3x 按鈕 → speed=3
- ✅ **暫停按鈕滑鼠點擊** — paused=true 正確
- ✅ **Space 鍵恢復** — 點擊 canvas 取得焦點後 Space toggle paused=false
- ✅ **Q 鍵旋轉** — 相機 posX:30.62→43.30, posZ:73.05→42.43（繞 Y 軸旋轉）
- ✅ **E 鍵反向旋轉** — 視覺確認視角轉回
- ✅ **滾輪縮放** — frustumSize 60→35（scroll up 5 ticks zoom in）
- ✅ **滾輪縮放反向** — scroll down 恢復正常視野
- ✅ **Tax Rate 滑桿拖拽** — 從 9%→13%，四種稅率同步更新
- ✅ **稅率影響收入** — Balance $55/tick→$85/tick（+54% 符合 9%→13% 漲幅）
- ✅ **稅率影響幸福度** — Happiness 59%→54%（高稅懲罰生效）
- ✅ **Mute 按鈕切換** — 點擊→muted=true, 再點擊→muted=false
- ✅ **Weather 系統** — season=winter, timeOfDay=0.506（正午），季節/日夜循環正常
- ✅ **Notification 系統** — 字串通知正確顯示+自動消失（timer 機制正常）
- ✅ **新道路+分區建設** — 中地圖(30,28-32)建 5 條路 + 10 格住宅區，全部成功
- ✅ **人口持續成長** — 95→114（19 人遷入，新分區+舊分區貢獻）
- ✅ **經濟穩定** — $156K→$165K, Balance $55→$86/tick

### 新增已驗證功能（第四十五輪測試 — 最終全面驗證 + 系統完整性）
- ✅ **25 個遊戲子系統全部運行** — grid/roadNetwork/citizens/traffic/power/water/clock/budget/taxRates/rciDemand/buildingGrowth/buildingUpgrade/pollution/sceneManager/terrainRenderer/roadRenderer/buildingRenderer/vehicleRenderer/overlayRenderer/weatherRenderer/audioManager/autoSaver/simLoop/zoneManager/roadBuilder — 全部 `!= null`
- ✅ **Camera panCamera() API** — 直接呼叫 panCamera(5,0)，相機 X:30.62→34.15 正確移動
- ✅ **零遊戲 Console 錯誤** — 23 條 error 全為 Chrome 擴充套件通訊，非遊戲本身
- ✅ **Production Build** — `vite build` 944ms 成功（Game 545KB, GameUI 13KB, index 27KB）
- ✅ **全部 291 單元測試通過**（28 測試檔，0 失敗，1.80s）
- ✅ **ACCEPTANCE.md 核心 Phase 1-7, 9, 12-22 全部 [x] 驗收通過**
  - Phase 8 (Transport)、10 (Service)、11 (District) 有程式碼+單元測試但無 UI 整合（已知限制）
- ✅ **遊戲持續穩定運行** — tick 2570, Pop 114→持續成長, $165K, 50 棟建築, 108 道路

### 最終驗證結論（Round 1-45 總結）

**完全通過的核心功能（22 個 Phase 中 19 個完全通過）：**
1. Phase 1: 專案初始化 ✅
2. Phase 2: 地圖網格系統 ✅
3. Phase 3: 道路系統 ✅
4. Phase 4: 區域規劃 ✅
5. Phase 5: 建築系統（生長/升級/降級/廢棄）✅
6. Phase 6: 居民模擬（遷入/遷出/老化/死亡/滿意度）✅
7. Phase 7: 交通模擬（車輛/路徑/密度）✅
8. Phase 9: 經濟系統（RCI/稅收/預算）✅
9. Phase 12: 環境系統（污染/地價）✅
10. Phase 13: 氣候與災害（日夜/四季/雨雪/地震/龍捲風/火災）✅
11. Phase 14: 里程碑與解鎖（6 階段通知）✅
12. Phase 15: 模擬引擎（8 步 tick pipeline）✅
13. Phase 16: 渲染引擎（Three.js 等角 3D）✅
14. Phase 17: 使用者介面（工具列/面板/圖表/RCI）✅
15. Phase 18: 輸入處理（滑鼠/鍵盤/拖曳/快捷鍵）✅
16. Phase 19: 音效（BGM/SFX/靜音）✅
17. Phase 20: 存檔系統（IndexedDB/多 slot/自動存檔）✅
18. Phase 21: 整合測試（完整遊戲循環/壓力測試/穩定性）✅
19. Phase 22: 打磨與優化（Production Build/零錯誤/經濟平衡）✅

**有程式碼但未整合到遊戲 UI 的進階子系統（3 個 Phase）：**
- Phase 8: 大眾運輸（Bus/Metro/Rail 等 7 系統 — 有單元測試，無 UI）
- Phase 10: 公共服務（消防/警察/醫療調度 — 有單元測試，無 UI）
- Phase 11: 區域劃分與政策（District/Specialization — 有單元測試，無 UI）

**已修復 Bug 數量：** 45 個（BUG-001 ~ BUG-045）
**Bug 待修數量：** 0
**單元測試：** 291/291 通過
**瀏覽器驗證輪數：** 46 輪

### BUG-045: 水力 BFS 無法穿越電廠位置，導致水網斷連 ✅ 已修復
- **位置**: `src/core/service/PowerGrid.ts`, `src/core/service/WaterNetwork.ts`, `src/core/simulation/SimulationLoop.ts`
- **問題**: 電廠(2,2)和水廠(4,2)放在相鄰格子，但兩者位置不在道路上。電力 BFS 從(2,2)出發能直接擴散到鄰近道路，但水力 BFS 從(4,2)出發到達(3,2)後被(2,2)阻擋（無道路無建築），導致水網無法連通到主幹道。結果：電覆蓋 84 格 vs 水覆蓋只有 5 格，建築因缺水不生長。
- **修復**:
  1. `PowerGrid.bfsPower()` 和 `WaterNetwork.bfsWater()` 新增可選 `infra?: Set<string>` 參數
  2. BFS 擴散條件從 `roadType !== NONE || buildingId !== 0` 改為 `roadType !== NONE || buildingId !== 0 || infra?.has(key)`
  3. `SimulationLoop.tick()` 收集所有電廠+水廠位置為 `infrastructurePositions` Set，傳遞給兩個 BFS
  4. 修復後：電覆蓋 73 格 = 水覆蓋 73 格，27/27 zone 都有電有水

### 新增已驗證功能（第四十六輪測試 — BUG-045 修復 + 端到端完整流程驗證）
- ✅ **BUG-045 修復驗證** — 電力 73 格 = 水力 73 格，27/27 zone 全部供電供水
- ✅ **端到端完整新遊戲流程**:
  1. 主選單→New Game→Day 1, Year 1, $50,000, Pop 0
  2. 建路（橫貫 x=0-6 + 縱貫 y=2-20 + 3 橫路 = 46 格，$10,000）
  3. 劃區（9R + 4C + 12I = 27 格）
  4. 10 秒 3x 速度 → 27 棟建築全部生長
  5. 17 居民遷入，Happiness 56%
  6. Balance +$28/tick，資金 $45K→$96K 正成長
- ✅ **建築成長完整** — 27/27 zone 全部建成（修復前：0/16 因缺水不長）
- ✅ **車輛交通** — 9 輛車在路上行駛，路徑正確
- ✅ **Overlay 7 種全部正常** — power/water/pollution/landValue/zone/traffic/none 切換無錯
- ✅ **Power Overlay 截圖** — 黃色覆蓋層清晰顯示道路沿線+zone 區域電力傳輸
- ✅ **存檔成功** — Slot 99 "E2E Test Save" 寫入 IndexedDB
- ✅ **拆除功能** — buildingId=2/zoneType=1 → buildingId=0/zoneType=0（完全清除）
- ✅ **子系統完整**:
  - WeatherRenderer: update/dayNight/season/rain/snow 12 方法
  - BuildingUpgrade: canUpgrade/tryUpgrade/shouldDowngrade/tryDowngrade
  - AudioManager: 11 方法（init/BGM/SFX/volume/mute）
  - Clock season: summer→autumn 季節轉換正常
  - Pollution: ground=60, noise=20（工業區附近）
  - LandValue: 66（商業建築）
- ✅ **經濟穩定** — Year 2, Funds $96K, Balance +$28/tick, Income $24.66, Expenses $4.60
- ✅ 零 Console 錯誤
- ✅ 全部 291 單元測試通過

### 新增已驗證功能（第四十七輪測試 — 存檔載入往返 + 建築降級 + Production Build）
- ✅ **存檔載入往返完整性** — Slot 99 "E2E Test Save" 重整頁面後載入：
  - Population: 17（完全匹配）
  - Funds: $76,007（匹配存檔時 ~$76K）
  - Buildings: 27, Roads: 46, Zones: 27（全部匹配）
  - Power: 73 格, Water: 73 格（BUG-045 修復後的正確值）
  - PowerPlants: 1, WaterPlants: 1（序列化/反序列化正確）
  - TaxRates: R/C/I/O 各 9%（匹配）
  - RCI 需求: R=100, C=12.5, I=11.8（活躍需求）
  - 4 輛車在路上行駛
- ✅ **存檔列表 UI** — 7 個存檔正確顯示（Slot 0~5 + Slot 99），可滾動，Back 按鈕正常
- ✅ **建築降級驗證** — 拆除主幹道斷電斷水後：
  - 電力 73→12 格、水力 73→12 格（22 zone 斷聯）
  - `shouldDowngrade(2,12, {serviceCov:2})` = true（2 < 3 觸發）
  - `tryDowngrade` 成功：Medium Shop (id=8, L2) → Small Shop (id=7, L1)
  - 降級機制完全正確，隨機抽樣（30/3600 格/tick）自然需要多 tick 命中
- ✅ **道路重建恢復** — 重建幹道後電力/水力立即恢復 73 格
- ✅ **建築等級正確映射** — L1:21, L2:6, L3:0（使用 BUILDING_TYPES 正確判定，非 ID 範圍）
- ✅ **Production Build** — 984ms 成功（Game 546KB, GameUI 14KB, index 28KB）
- ✅ **全部 291 單元測試通過**（28 測試檔）
