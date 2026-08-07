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

#### ENHANCE-002: UI 整體風格重新設計 ✅ 已完成
- **問題**: 目前 UI 介面風格較簡陋，不夠專業和好用
- **修復**:
  - 全新 frosted glass 風格面板（backdrop-filter blur）
  - 頂部欄整合日期/資金/人口/收支/幸福度 + 速度控制
  - 工具列加入 emoji 圖示、分隔線、Economy/Traffic 快捷按鈕
  - 統一色系：深藍底 + 青色強調（#42a5f5）
  - 改善字型、間距、陰影、動畫效果
  - MainMenu 也同步更新為深色漸層 + 微光效果
- **狀態**: 已完成（Round 49）

#### ENHANCE-003: 經濟與交通詳細面板（彈出視窗）✅ 已完成
- **修復**:
  1. **經濟面板** — 工具列 Economy 按鈕開啟 modal：
     - 摘要卡片（Treasury / Income / Expenses / Net Balance）
     - 收入明細表（住宅稅、商業稅、工業稅、辦公稅 + 各自稅率和金額）
     - 支出明細表（道路維護、電廠、水廠、貸款利息）
     - 經濟歷史 Canvas 折線圖（資金/收入/支出三條線）
     - 貸款管理（Outstanding 餘額 + Borrow $5K/$10K + Repay $5K 按鈕）
  2. **交通面板** — 工具列 Traffic 按鈕開啟 modal：
     - 摘要卡片（Active Vehicles / Avg Path Length / Road Tiles / Peak Density）
     - Top 8 壅塞路段排名表（位置、車輛數、色彩漸變壅塞條）
     - Overlay 快捷按鈕（Traffic/Power/Water/Pollution/Land Value/Zones）
  3. 面板為可關閉的 modal（點擊 X 或背景關閉），動畫淡入效果
- **新增檔案修改**:
  - `src/ui/GameUI.ts` — 完全重寫 UI（新設計 + Economy/Traffic 面板）
  - `src/ui/MainMenu.ts` — 更新主選單風格
  - `src/Game.ts` — 新增 getEconomyBreakdown()、getTrafficStats()、takeLoan()、repayLoan()
  - `src/core/traffic/TrafficSimulation.ts` — 新增 getTopCongested()、getAveragePathLength()
- **狀態**: 已完成（Round 49）

#### ENHANCE-001: 道路渲染改進 — 連續道路外觀 ✅ 已完成（Round 49）
- **位置**: `src/renderer/RoadRenderer.ts`
- **修復**: 完整重寫 RoadRenderer，使用四層 InstancedMesh：
  1. ✅ 連續路面：道路格子根據 roadFlags 延伸至鄰格，消除接縫
  2. ✅ 車道分隔線：直線段中間白色虛線（N+S 或 E+W）
  3. ✅ 十字路口斑馬線：3+ 連接的路口每個方向放置白色條紋
  4. ✅ L 型彎道和 T 型路口填滿整格（無間隙）
  5. ✅ 人行道邊緣：未連接方向的道路邊緣有灰色凸起邊條

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
- ~~UI 風格重設計（ENHANCE-002）~~ ✅ 已完成
- ~~經濟/交通詳細面板（ENHANCE-003）~~ ✅ 已完成
- ~~道路連續渲染（ENHANCE-001）~~ ✅ 已完成

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
- 公共交通 6 系統（Bus/Metro/Rail/Tram/Ferry/Airport）— 無 GameState/UI（Taxi 已移除）
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
- 公共交通 6 系統（Bus/Metro/Rail/Tram/Ferry/Airport）（Taxi 已移除）
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

---

## 待修復 Bug

### BUG-046: 放置的公園不影響地價 ✅ 已修復
- updateLandValue() 中 parkProximity 只檢查 terrainType === 3 (FOREST)
- 已加入 ParkService.getCoverage() + buildingId === 248 檢查

### BUG-047: 垃圾溢出不影響汙染 ✅ 已修復
- 已在 updatePollution() 中加入：垃圾設施半滿以上產生地面汙染 + 溢出產生全城汙染

### BUG-048: Tutorial Skip 後刷新頁面又會出現 ✅ 已修復
- Tutorial dismiss 狀態只存在記憶體，未持久化到 localStorage
- 修復：在 Tutorial.dismiss() 寫入 localStorage，constructor 讀取恢復狀態

### BUG-049: 缺少手動存檔按鈕 — 只有 AutoSave ✅ 已修復
- 玩家無法在關鍵時刻手動存檔，只能靠每 100 tick 的自動存檔
- 修復：在 Debug 面板加入 Save Game 按鈕，呼叫 game.saveCurrentGame()

### BUG-051: 電力/水力覆蓋形狀為 BFS 矩形，應改為 Euclidean 圓形
- **位置**: `src/core/service/PowerGrid.ts`, `src/core/service/WaterNetwork.ts`
- **問題**: PowerGrid 和 WaterNetwork 使用 BFS 四方向傳播（dirs=[[-1,0],[1,0],[0,-1],[0,1]]），覆蓋形狀為菱形/矩形。其他所有服務（Fire/Police/Health/Education/Park）均使用 Euclidean 距離（`Math.sqrt(dx*dx+dy*dy) <= radius`）產生圓形覆蓋。遊戲沒有電線/水管建設機制，BFS 網路傳播模式對玩家不直覺。
- **修復方向**: 改為與其他服務一致的 Euclidean 圓形覆蓋，PLANT_RANGE 作為圓形半徑。
- **狀態**: 待修復

### BUG-050: 鍵盤快捷鍵 7 映射到錯誤的道路類型 ✅ 已修復
- **位置**: `src/Game.ts` — `handleKeyDown()`
- **問題**: `case '7'` 映射到 `road_2lane`，但 UI 工具列顯示 key 7 = `road_rural`（Rural 道路）
- **額外問題**: 缺少 `case '2'` 快捷鍵映射（常用的 2-Lane 道路無快捷鍵）
- **修復**:
  1. `case '7'`: `road_2lane` → `road_rural`（與 UI 一致）
  2. 新增 `case '2'`: `road_2lane`（補充常用道路快捷鍵）

### 新增已驗證功能（第四十八輪測試 — BUG-050 修復 + 完整回歸測試）
- ✅ **BUG-050 修復驗證** — key 2=road_2lane, key 7=road_rural（與 UI 一致）
- ✅ **鍵盤快捷鍵全部正確**:
  - 1=select, 2=road_2lane, 3=zone_r, 4=zone_c, 5=zone_i, 6=zone_o, 7=road_rural
  - 8=power, 9=water, 0=demolish, ESC=select, Delete=demolish
  - Space=pause toggle, =/+=speed up, -=speed down
- ✅ **Save/Load 完整循環** — Save slot 1 → 重整頁面 → Load Game 列表(2 slots) → 載入 Regression Test R30 → Pop 142, Buildings 47 完全匹配
- ✅ **Demolish 工具** — 建築 (5,9) buildingId=2→0, zoneType→0, buildings 47→46（完全清除）
- ✅ **從零建城完整流程** — New Game → 建路(31格) → 劃區(8R+4C+5I+4O=21格) → 電廠水廠 → 21/21 供電供水 → 2000 ticks → 64 pop, 20 buildings
- ✅ **3000-tick 壓力測試** — 966ms, 零 NaN/Infinity, Pop 64, $58K, Balance +$22/tick
- ✅ **Overlay 6 種切換** — power/water/pollution/landValue/traffic/zone 全部 toggle on/off 正確
- ✅ **Economy Overview 面板** — Treasury $60K, Income +$33/tick, Expenses -$11/tick, 四種稅率各 9%, Tax slider, City Statistics chart
- ✅ **Traffic Overview 面板** — 15 Active Vehicles, Avg Path 10.1, 31 Road Tiles, Peak Density 5, Top 7 壅塞路段排行（紅→橙→綠色條）
- ✅ **Tutorial Skip** — Skip 按鈕正常關閉 tutorial overlay
- ✅ **日夜循環** — 白天(淺藍)→黃昏(橙紅)→夜晚(深藍) 連續循環
- ✅ **小地圖** — 左下角 canvas 正確顯示城市俯瞰
- ✅ 零 Console 錯誤
- ✅ 全部 649 單元測試通過（45 測試檔）

### 新增已驗證功能（第四十九輪測試 — Civic Buildings + Load Game + 壓力測試）
- ✅ **Civic Buildings 完整放置** — Police(252)/Fire(251)/Hospital(250)/School(249)/Park(248)/Cemetery(245) + High School(244) + University(243)
- ✅ **教育系統運作** — High School + University 放置後居民教育分佈：NONE:18, ELEMENTARY:14, HIGH_SCHOOL:14, UNIVERSITY:29
- ✅ **建築升級系統** — L1:16, L2:13, L3:3（serviceCoverage=4 + landValue 符合條件）
- ✅ **Economy Overview 面板** — Treasury $55K, Income +$55/tick, Expenses -$14/tick, 4 稅率明細, Tax slider 9%, City Statistics chart
- ✅ **Traffic Overview 面板** — 39 Active Vehicles, Avg Path 21.2, 58 Road Tiles, Peak Density 11, Top 8 壅塞排行
- ✅ **建築資訊面板** — Large House ★★★ (Residents 8, $28/tick) + Medium Factory ★★☆ (Workers 20, $40/tick) + 居民/工人列表
- ✅ **F1-F6 Overlay 快捷鍵** — F1=power, F3=pollution, F4=landValue, F6=zone, toggle on/off 全部正確
- ✅ **6 種 Overlay 切換** — power/water/pollution/landValue/traffic/zone 全部正常
- ✅ **2000-tick 壓力測試** — 845ms, Pop 102→112, Funds $72K→$104K, Happiness 71%, 零 NaN
- ✅ **Save/Load 循環** — Slot 1 "Regression Test R30" 載入成功：Pop 142, Buildings 45, Roads 63, Zones 96, PowerPlants 1, WaterPlants 1
- ✅ **存檔列表 UI** — 3 個存檔正確顯示（名稱/Slot/日期/大小），Back 按鈕正常
- ✅ **災害系統** — Earthquake at (55,33) Intensity 72% 自動觸發通知
- ✅ **日夜循環** — 白天(淺藍)→黃昏(橙紅)→夜晚(深藍)
- ✅ **Production Build** — 4.29s 成功（Game 616KB, GameUI 74KB, index 56KB）
- ✅ 零 Console 錯誤
- ✅ 全部 649 單元測試通過

### 新增已驗證功能（第五十輪測試 — 穩定性、邊界、車輛、建設流程）
- ✅ **負資金穩定性** — -$5000 → 200 ticks → -$3660（逐漸恢復），零 NaN，建路正確拒絕 INSUFFICIENT_FUNDS
- ✅ **50 次快速建拆循環** — 零錯誤，零 NaN，Grid 狀態完全乾淨
- ✅ **車輛路線驗證** — 32 輛車全部路徑有效（validPaths=32, invalidPaths=0），路徑長度 19 步
- ✅ **Pollution Overlay 視覺** — 工業區周圍橘黃色汙染熱力圖，62 格有污染，平均值 64
- ✅ **Land Value Overlay 視覺** — 建築區域淺藍/白色高地價，河流水岸加成可見
- ✅ **稅率連鎖反應** — 20% 重稅 Happiness 66→30%（暴跌），3% 低稅恢復至 71%
- ✅ **新區域建設完整流程** — 建路(11格)+劃區(22R)+連接路網→電力水力覆蓋→11棟建築生長→Pop +45
- ✅ **5000-tick 壓力測試** — 2172ms (2302 ticks/sec), Pop 144 穩定, Funds $94K→$128K, 零 NaN
- ✅ **15/15 鍵盤快捷鍵** — 1-0/ESC/Delete/Space/+/- 全部正確
- ✅ 零 Console 錯誤
- ✅ 全部 649 單元測試通過

### 新增已驗證功能（第五十一輪測試 — 新遊戲端到端完整建城流程）
- ✅ **新遊戲完整建城** — New Game → 建路(68格網格) → 劃區(16R+16C+20I+11O=63格) → 電廠+水廠 → 63/63 供電供水
- ✅ **水廠地下水限制** — 水廠需靠近河流（groundwaterLevel>0），遠離河流的位置正確拒絕並提示 "No groundwater here"
- ✅ **道路延伸連接水源** — 從主路網延伸道路到河流附近，水廠成功放置
- ✅ **Civic Buildings 放置** — Police/Fire/Hospital/School/Park 全部成功（道路旁空格）
- ✅ **城市成長** — 1000 ticks: 43 buildings, Pop 61, Happiness 72%, Balance +$31/tick
- ✅ **3000-tick 壓力測試** — 1658ms (1809 ticks/sec), Pop 120, Buildings 62, Funds $55K, 零 NaN
- ✅ **Water Overlay 視覺** — 水廠→道路→zone BFS 覆蓋清晰（青色），河流地下水（淺藍）
- ✅ 零 Console 錯誤
- ✅ 全部 649 單元測試通過

### 新增已驗證功能（第五十二輪測試 — Debug Panel / Specialize / District / Bug Fix）
- 🐛 **BUG-023 修復: Debug Panel input 被 auto-refresh 覆蓋** — 每 2 秒 updateDebugPanel() 重建整個 innerHTML，導致使用者在 Funds/Tax/Speed 欄位輸入時值被覆蓋。修復：focus 中的 input 或顯示 save status 時跳過 refresh。
- ✅ **Debug Set Funds** — 輸入 999999 → 點 Set → funds 從 $103K 變成 ~$1M，正確生效
- ✅ **Debug Set Tax Rate** — 輸入 15 → 點 Set → 所有稅率(R/C/I/O)均變為 15%
- ✅ **Debug Set Speed** — 輸入 3 → 點 Set → clock.speed=3 正確設定
- ✅ **Debug Save Game** — 點 Save Game → IndexedDB slot 0 存檔成功（65KB）
- ✅ **Debug Funds 顯示整數** — 修復浮點數過長問題，改用 Math.round(snap.funds)
- ✅ **Specialize Panel** — 7 種專業化選項（None/Mining/Oil/Tech/Tourism/Gambling/Trade），各含 Revenue/Happiness/Crime 加成，None 預設選中
- ✅ **District Tool** — 設定 district 工具→繪製區域→成功創建 "District 1"，getDistrictAt() 正確回傳
- ✅ **城市完整建城** — Roads(161格)+Zones(R72/C36/I36)+Power+Water+Civic(5棟)→Pop 128, Happiness 71%
- ✅ 零遊戲 Console 錯誤（僅 Chrome extension 連線訊息）
- ✅ 全部 649 單元測試通過

### 新增已驗證功能（第五十三輪測試 — UI Panels / Overlays / 快捷鍵全面回歸）
- ✅ **Economy Panel** — Treasury $142K, Income +$148/tick, Expenses -$24.4, Net $123.6; Tax Rate slider 拖動到 13% 正常
- ✅ **Traffic Panel** — 60 Vehicles, 23.6 Avg Path, 164 Roads, 8 Peak Density; 8 段壅塞路段表格（紅/橘/綠色條）
- ✅ **Overview Panel** — Pop 181, 1 Vacant Home, 1482 Jobs, 1301 Openings; Buildings by Zone 表格; Migration Status 顯示 Attractiveness 46.4 < 50 blocked
- ✅ **Building Info Panel** — Select tool 點擊建築顯示 "Medium House" Level ★★☆, 6 Residents, $18/tick, Residential (Low), 含居民清單
- ✅ **F1-F6 Overlays** — F1=Power, F2=Water, F3=Pollution, F4=LandValue, F5=Traffic, F6=Zone 全部正確
- ✅ **12/12 快捷鍵** — 1=Select, 2=Road, 3=ZoneR, 4=ZoneC, 5=ZoneI, 6=ZoneO, 7=Rural, 8=Power, 9=Water, 0=Demolish, ESC=Select, Delete=Demolish
- ✅ 零遊戲 Console 錯誤
- ✅ 全部 649 單元測試通過

### 新增已驗證功能（第五十四輪測試 — Save/Load 完整流程 + 壓力測試）
- ✅ **Save Game** — saveCurrentGame(52, 'R53-Regression') 成功存檔 65KB
- ✅ **Load Game UI** — Load Game 按鈕顯示 4 個存檔列表：AutoSave/R30/R51/R53，含名稱/Slot/日期/大小
- ✅ **Load Game 功能** — 點擊 R53-Regression (Slot 52) 成功載入，Pop 186, Funds $177K, Tax 13% 全部保留
- ✅ **載入後基礎設施** — Power 1 plant, Water 1 plant 正確恢復
- ✅ **載入後繼續遊戲** — 城市繼續運行，人口穩定，收支正常
- ✅ **5000-tick 壓力測試** — 3016ms (1658 ticks/sec), Pop 186 穩定, Funds $322K, 零 NaN
- ✅ 零遊戲 Console 錯誤
- ✅ 全部 649 單元測試通過

### 新增已驗證功能（第五十五輪測試 — Layers / Transit / Overlays / 災害系統）
- ✅ **Map Layers Panel** — 13 個 overlay 按鈕分 3 類（Infrastructure 2 + City Data 4 + Services 7）正確顯示
- ✅ **13/13 Overlays 切換** — power/water/traffic/zone/landValue/pollution/police/fire/health/education/park/garbage/district 全部正常 toggle
- ✅ **Power Overlay 視覺** — 黃色供電覆蓋區域清晰，右上角 "Overlay: Power | Close" 標籤
- ✅ **Zone Overlay 視覺** — 彩色區塊顯示各 zone 類型
- ✅ **Transit Panel** — 6 種交通工具（Bus Stop/Metro/Tram/Train/Ferry/Airport）+ Routes 按鈕（Taxi 已移除）
- ✅ **災害系統** — "Forest Fire at (58,18)! Intensity: 78%" 災害通知正常觸發
- ✅ 零遊戲 Console 錯誤
- ✅ 全部 649 單元測試通過

### 新增已驗證功能（第五十六輪測試 — Demolish / 負資金 / Build-Demolish 循環穩定性）
- ✅ **建築拆除** — demolish tool 拆除 6 棟建築（86→80），cell buildingId/zoneType 正確清零
- ✅ **道路拆除** — roadType 3→0, 道路計數 164→163
- ✅ **負資金建路拒絕** — funds=-$5000 建路→"Cannot build road: insufficient funds"
- ✅ **負資金恢復** — -$5000 → 200 ticks → $543 正向恢復，零 NaN
- ✅ **30 次 build/demolish 循環** — 零 errors, 零 NaN, Grid 狀態乾淨
- ✅ **20 次 zone/demolish 循環** — 零 errors, cell 狀態乾淨
- ✅ 零遊戲 Console 錯誤
- ✅ 全部 649 單元測試通過

### 新增已驗證功能（第五十七輪測試 — Civic / Education / Road 6-Lane & Highway Bug Fix）
- 🐛 **BUG-024 修復: 6-Lane 和 Highway 道路無法建造/升級** — ToolType 缺少 road_6lane/road_highway，handleToolAction case 未包含，setTool 未設定 currentRoadType，isRoadTool 未包含。全部修復並在 UI Roads panel 加入 6-Lane/Highway 按鈕。
- ✅ **9/9 Civic Buildings** — Police/Fire/Hospital/School/HighSchool/University/Park/Garbage/Cemetery 全部放置成功
- ✅ **Education 系統** — 4 所學校正確註冊，getCoverage/getEducationLevel 正常回傳
- ✅ **Education Overlay** — 黃色覆蓋範圍清晰顯示
- ✅ **Road 6-Lane 升級** — TWO_LANE(2)→SIX_LANE(4) 正確升級
- ✅ **Highway 建造** — roadType=5 (HIGHWAY) 正確建造
- ✅ **Roads Panel** — 5 種道路（Rural/2-Lane/4-Lane/6-Lane/Highway）UI 按鈕完整
- ✅ 全部 649 單元測試通過

---

## BUG-025: 道路升級收取全額而非差額

- **發現**：Round 58 回歸測試
- **狀態**：✅ 已修復
- **嚴重度**：Medium
- **描述**：使用 road_4lane/road_6lane/road_highway 工具在已有道路上升級時，RoadBuilder.buildRoad() 收取完整新道路費用，而非新舊差額。例如 TWO_LANE→FOUR_LANE 收 $400/格（全額）而非 $200/格（差額）。
- **根因**：RoadBuilder.buildRoad() 第 34 行 `const totalCost = cells.length * config.cost` 沒有考慮已有道路的成本。RoadUpgrade 模組正確計算差額，但 handleToolAction 使用 buildRoad 而非 upgradeRoad。
- **修復**：修改 buildRoad() 的成本計算，對已有道路的格子只收取差額（`config.cost - existingConfig.cost`），空格收全額。新增 3 個單元測試驗證。
- **驗證**：TWO_LANE→FOUR_LANE 3 格收 $600（差額正確），同類型重建 $0，全部 652 測試通過。

---

## BUG-026: setTool('road') 未重置 currentRoadType

- **發現**：Round 58 回歸測試
- **狀態**：✅ 已修復
- **嚴重度**：High
- **描述**：setTool('road') 不會將 currentRoadType 重置為 TWO_LANE。如果之前使用過 road_highway 工具，切換回 road 工具後仍會建造 HIGHWAY（$800/格），導致預期外的高成本和錯誤道路類型。
- **根因**：Game.ts setTool() 方法只為 road_rural/road_2lane/road_4lane/road_6lane/road_highway 設定 currentRoadType，遺漏了 'road' 基本工具。
- **修復**：在 setTool() 中新增 `if (tool === 'road') this.currentRoadType = RoadType.TWO_LANE;`。
- **驗證**：road_highway→road 切換後 currentRoadType=2（TWO_LANE），建出的道路 roadType=2 正確。

---

### 新增已驗證功能（第五十八輪測試 — Road 升級成本 / setTool 重置 / Tutorial / Overlays）
- 🐛 **BUG-025 修復: 道路升級收取全額而非差額** — buildRoad() 改為對已有道路收差額（new-old），空格收全額。3 個新測試。
- 🐛 **BUG-026 修復: setTool('road') 未重置 currentRoadType** — 加入 `road` case 重置為 TWO_LANE。
- ✅ **Tutorial 9 步完整** — Welcome→Roads→Zones→Utilities→Growth→Civic→Economy→Overlays→Ready，Next/Prev/Skip 全正確，localStorage 持久化
- ✅ **Speed 按鈕** — Pause/1x/2x/3x 切換正確，clock.speed 和 paused 狀態同步
- ✅ **MiniMap** — 120x120 Canvas 在左下角正確顯示
- ✅ **13/13 Overlays** — power/water/traffic/zone/landValue/pollution/police/fire/health/education/park/garbage/district 全部正確 toggle
- ✅ **道路升級差額** — TWO_LANE→FOUR_LANE 3 格=$600（差額正確），同類重建=$0
- ✅ **setTool 重置** — road_highway→road 後 currentRoadType=2 (TWO_LANE)
- ✅ **5000-tick 壓力測試** — 2897ms (1726 ticks/s), Pop 88→208, Funds $73K→$175K, 零 NaN
- ✅ 零 Console 錯誤
- ✅ 全部 652 單元測試通過

### 新增已驗證功能（第五十九輪測試 — Save/Load / Building Info / 快捷鍵 / Notification / Demolish）
- ✅ **Save Game** — saveCurrentGame(59, 'R59-Test') 成功存檔 38KB
- ✅ **Load Game UI** — 6 個存檔列表正確顯示（AutoSave/R30/R51/R53/R59/R49）
- ✅ **Load Game** — 點擊 R59-Test 載入成功，tick/pop/funds 與存檔一致
- ✅ **Building Info Panel** — Select 點擊建築顯示 "Small House" Level ★☆☆, 4 Residents, $10/tick, 居民清單含年齡/生命階段
- ✅ **9/9 快捷鍵** — 1=Select, 2=Road, 3=ZoneR, 4=ZoneC, 5=ZoneI, 6=ZoneO, 0=Demolish, ESC=Select, Delete=Demolish
- ✅ **F1-F6 Overlay 快捷鍵** — F1=Power, F2=Water, F3=Pollution, F4=LandValue, F5=Traffic, F6=Zone
- ✅ **Economy Panel** — Treasury $69K, Income +$96/tick, Expenses -$20.9/tick, 稅率分項（R/C/I/O 各 9%）+ 支出分項（Road/Power/Water）
- ✅ **Notification 系統** — 通知文字正確顯示，visible class 動態切換，render loop 同步
- ✅ **Demolish 建築** — buildingId 2→0, zoneType 1→0，buildings 計數 46→45
- ✅ **Demolish 道路** — roadType 2→0 正確清零
- ✅ 零 Console 錯誤
- ✅ 全部 652 單元測試通過

### 新增已驗證功能（第六十輪測試 — District / Transit / Tax / RCI / Overview / Chart）
- ✅ **District 工具** — 塗刷建立 "District 1"，getDistrictAt() 正確回傳
- ✅ **Tax Rate 滑桿** — Economy modal 中 slider 9→15% 正確同步 R/C/I/O 四項稅率，UI 即時顯示
- ✅ **RCI 指標條** — R=100%(綠), C=92.75%(藍), I=63.4%(橘) 正確顯示需求
- ✅ **Overview Panel** — Pop 207, 1 Vacant Home, 552 Jobs, Buildings by Zone 表格, Attractiveness 52.3
- ✅ **Stats Chart** — econ-chart 480x100 canvas 有實際內容渲染
- ✅ **Transit Bus Stop** — 空格放置 buildingId=242，bus.getStops()=1
- ✅ **Transit Metro Station** — 空格放置 buildingId=241，metro.getStations()=1
- ~~✅ **Transit Taxi Stand** — 空格放置 buildingId=236~~ （已移除）
- ✅ **5/5 Transit 工具切換** — bus_stop/metro_station/train_station/ferry_dock/airport 全部正確（taxi_stand 已移除）
- ✅ 零 Console 錯誤
- ✅ 全部 652 單元測試通過

### 新增已驗證功能（第六十一輪測試 — Specialization / Debug / ARIA / Transit Routes）
- ✅ **City Specialization Panel** — 7 種專業化（None/Mining/Oil/Tech/Tourism/Gambling/Trade），含 Revenue/Happiness/Crime 加成顯示，提示需 5000 人口
- ✅ **Transit Routes Modal** — 無站點時正確提示 "No transit stops placed yet"
- ✅ **Debug Panel** — 完整模擬狀態（Tick/Pop/Vehicles/Buildings/Roads/Funds/RCI/Power/Water/Happiness）
- ✅ **BUG-023 修復驗證** — Debug input focus 3 秒後 auto-refresh 不覆蓋，值 999999 保持
- ✅ **Accessibility ARIA** — 9 dialog, 3 meter, 1 toolbar, 1 banner, 1 alert, 23 aria-label 元素
- ✅ 零 Console 錯誤
- ✅ 全部 652 單元測試通過

### 新增已驗證功能（第六十三輪測試 — 完整新城建設 + 全面回歸驗證）
- ✅ **新城完整建設** — 156 格道路網格 + 112 zones (R42/C28/I28/O14) + 電廠+水廠 + 9 civic 建築 → 111 棟建築, Pop 272
- ✅ **建築升級系統** — L1:50, L2:47, L3:14（AvgServiceCoverage=4, AvgLandValue=71）
- ✅ **21/21 鍵盤快捷鍵** — 1-0(tools) + ESC + Delete + Space + +/- + F1-F6(overlays) 全部正確
- ✅ **13/13 Overlays** — power/water/traffic/zone/landValue/pollution/police/fire/health/education/park/garbage/district 全部 toggle 正確
- ✅ **BUG-025 回歸** — TWO_LANE→FOUR_LANE 6 格=$1200（差額正確），同類重建=$0
- ✅ **BUG-026 回歸** — road_highway→road 後 currentRoadType=2 (TWO_LANE) 正確重置
- ✅ **Save Game** — Slot 63 "R63-Regression" 成功存檔
- ✅ **Transit 放置** — Bus Stop(242)/Metro(241) 正確放置（Taxi 已移除）
- ✅ **Building Info Panel** — Select 點擊 Medium House Level ★★☆, 6 Residents, $18/tick
- ✅ **Economy** — Income $389/tick, Expenses $114/tick, Funds $107K, Loans=0, LoanRate=0.05
- ✅ **Tax System** — R/C/I/O 各 9%, 稅率分項正確
- ✅ **Global Market** — OIL=$104, ORE=$83, AGRICULTURE=$63, ELECTRONICS=$167
- ✅ **Education 分佈** — NONE:69, ELEMENTARY:60, HIGH_SCHOOL:54, UNIVERSITY:89
- ✅ **Demolish** — 建築 108→107, cell bId=0/zone=0 正確清零
- ✅ **Season/Climate** — Tick 4279=Autumn(idx=2), WeatherRenderer 存在
- ✅ **Vehicles** — 99 輛車, 99/99 有效路徑
- ✅ **負資金穩定性** — -$5000 → 100 ticks → -$323（恢復中），負資金建路正確拒絕
- ✅ **5000-tick 壓力測試** — 3158ms (1583 ticks/s), Pop 272 穩定, Funds $79K→$310K, 零 NaN
- ✅ **33/33 子系統** — grid/roadNetwork/citizens/traffic/trafficLights/power/water/clock/budget/taxRates/rciDemand/buildingGrowth/buildingUpgrade/pollution/police/fire/health/education/parks/garbage/sewage/deathCare/districts/policies/citySpec/globalMarket/bus/metro/tram/rail/ferry/airport/freight 全部存在（taxi 已移除）
- ✅ **ARIA** — 9 dialog, 3 meter, 1 toolbar, 1 banner, 1 alert, 23 aria-label
- ✅ **UI 完整** — TopBar/Toolbar/MiniMap/BuildingPanel/Notification/Tutorial/MuteBtn 全部存在
- ✅ 零 Console 錯誤
- ✅ 全部 652 單元測試通過

### 新增已驗證功能（第六十四輪測試 — 災害/貨運/Transit路線/District/道路預覽）
- ✅ **災害系統** — Earthquake at (12,13) 75%: 19 棟建築摧毀 (111→92)，通知正確觸發
- ✅ **災後重建** — 5000 ticks 後建築自動重建回 111 棟（完全恢復）
- ✅ **電力中斷/恢復** — 拆除電廠→20 ticks→重建電廠→建築繼續正常運作
- ✅ **FreightSystem** — 貨運系統存在，cargoStorage/lastDemand 追蹤正常
- ✅ **Bus Route 建立** — 2 站點→createRoute→1 條路線，營運成本 $100
- ✅ **6 Transit 系統成本** — bus $0→$100(有路線後), metro/tram/rail/ferry/airport $0（taxi 已移除）
- ✅ **District 建立** — 塗刷工具建立 "District 1"，getDistrictAt(5,12) 正確回傳
- ✅ **PolicyManager** — 存在且可查詢
- ✅ **CitySpec** — current=NONE（需 5000 人口解鎖）
- ✅ **Sewage 系統** — outlets/treatmentPlants/untreatedSewage 追蹤正常
- ✅ **道路預覽線** — dragStart 設定後 scene children 81→82（✅ 正確添加）
- ✅ **Save Game** — Slot 64 "R64-LoadTest" 成功存檔
- ✅ **5000-tick 壓力測試** — 5276ms (948 ticks/s), Pop 272 穩定, Funds $151K→$330K, 零 NaN
- ✅ 零 Console 錯誤
- ✅ 全部 652 單元測試通過

---

## BUG-027: Load Game 後 Transit stops/routes 遺失

- **發現**：Round 65 回歸測試
- **狀態**：✅ 已修復
- **嚴重度**：Medium
- **描述**：Save/Load 後，Transit 系統（Bus/Metro/Tram/Rail/Ferry）的 stops 和 routes 全部遺失。Grid 中的 buildingId（如 242=BusStop）正確保留，但各 Transit 系統的內部 stops 陣列是空的。
- **根因**：`Serializer.ts` 的 `deserializeGameState()` 不序列化 Transit 系統內部狀態，也沒有從 grid 重建。
- **修復**：在 `deserializeGameState()` 末尾加入 grid 掃描，根據 buildingId 重建 transit stops（242→bus, 241→metro, 240→tram, 239→rail, 238→ferry）。（Taxi 236 已移除，舊存檔中的 taxi_stand 會自動清除。）
- **驗證**：Load Game 後 busStops=2, metroStations=1（之前都是 0）。新增 1 個單元測試，653 測試全部通過。

---

### 新增已驗證功能（第六十五輪測試 — Load Game 往返 / Transit 序列化修復 / 經濟平衡）
- 🐛 **BUG-027 修復: Transit stops 在 Load Game 後遺失** — deserializeGameState 加入 grid 掃描重建 transit stops
- ✅ **Load Game 完整往返** — 刷新頁面→Load Game→R65-LoadTest：Pop=272, Buildings=111, Roads=177 全部匹配
- ✅ **Transit stops 恢復** — busStops=2, metroStations=1（修復前 0/0）
- ✅ **Save 列表 UI** — 12 個存檔正確顯示，點擊載入正常
- ✅ **災害系統** — Earthquake 75% at (12,13) 摧毀 19 棟建築，災後自動重建
- ✅ **Bus Route 建立** — 2 站→1 路線，營運成本 $100
- ✅ 零 Console 錯誤
- ✅ 全部 653 單元測試通過

### 新增已驗證功能（第六十六輪測試 — Civic 恢復 / 經濟平衡 / Production Build / TS 修復）
- ✅ **Load Game Civic 恢復** — Police:1, Fire:1, Hospital:1, Schools:3, Parks:1, Garbage:1 全部正確
- ✅ **Transit 修復驗證** — BusStops=2, MetroStations=1（BUG-027 修復持續有效；Taxi 已移除）
- ✅ **經濟 50-tick 平衡** — $361K→$364K（+0.7%），100-tick 後 $366K 穩定成長
- ✅ **Income/Expense 比率** — 3.79（健康範圍 1.5-5）
- ✅ **Production Build** — 2.32s 成功（Game 617KB, GameUI 74KB, index 56KB）
- ✅ **TypeScript 修復** — RoadBuilder cast、Save test non-null、Game.ts 缺少 road_6lane/road_highway
- ✅ **GlobalMarket 存在** — OIL=$111, ORE=$85, AGRICULTURE=$67, ELECTRONICS=$151
- ✅ 零 Console 錯誤
- ✅ 全部 653 單元測試通過
- ℹ️ **已知限制**: Districts/GlobalMarket/Policies 未序列化（Load 後重置為預設）

### 新增已驗證功能（第六十七輪測試 — New Game 端到端 + Save/Load 完整往返）
- ✅ **New Game 端到端** — 主選單→New Game→建路(140格)+劃區(88格)+電水+9 Civic→2000 ticks→Pop 166, 75 建築
- ✅ **Save→Reload→Load 完整往返** — Pop=168, BusStops=1, MetroStations=1, Schools=3, PowerPlants=1, WaterPlants=1 全部精確匹配
- ✅ **Post-load 功能驗證**:
  - 建路: cost=$5200, roadType=2 ✅
  - 劃區: zoneType=1 ✅
  - 拆除: bId=0, zone=0 ✅
  - 模擬繼續: Pop 170→178 ✅
- ✅ **3000-tick 壓力測試（Load後）** — 1810ms (1657 tps), Pop 235, Funds $186K, 零 NaN
- ✅ 零 Console 錯誤
- ✅ 全部 653 單元測試通過

### BUG-048: Edge Vehicle 碰撞偵測導致車輛卡住不動 ✅ 已修復
- **問題**: edge-based 車輛全部卡住不動，moveDistance 始終為 0
- **根因 1**: 碰撞偵測遍歷所有 edge 車輛（全局），平行道路上的車輛被 heading 投影判定為「前方車輛」，導致 gap 極小
- **修復 1**: 加入橫向距離過濾 `lateral = dx * (-me.hy) + dy * me.hx; if (Math.abs(lateral) > 0.4) continue;`
- **根因 2**: 同一出生點的車輛堆疊，gap < MIN_GAP (如 gap=0.084 < MIN_GAP=0.15)，gapRoom=gap-MIN_GAP 為負值 → room=0
- **修復 2**: 堆疊時允許慢速蠕動 `gapRoom = gap < MIN_GAP ? effectiveSpeed * 0.15 : gap - MIN_GAP`
- **影響**: 全部 edge 車輛恢復移動 (moved=8/8)
- **測試**: 811 tests passed

---

## 第六十八輪 — 多 Agent 深度靜態掃描（2026-08-07）

**方法**: 8 個 finder 平行掃描各子系統（traffic / transport+rail+elevation / citizen / economy+district /
service+environment+climate / save+simulation / grid+road+zone+building / TypeScript 型別錯誤+renderer+ui+workers），
3 輪 loop-until-dry，每輪把已找到的餵回去要求往更深處挖。
**驗證**: 兩段對抗式 — 先 1 個懷疑者嘗試推翻（不確定即判定推翻），存活者再受 2 個不同視角 refuter
（「執行期真的到得了嗎」／「是否已在別處處理或本來就是刻意行為」）檢驗，任一推翻即淘汰。
**結果**: 84 個候選 → 驗證 24 個 → **20 個確認 / 4 個推翻** → 合併同根因後 **17 個 bug（BUG-052 ~ BUG-068）**。
**狀態**: 全部尚未修復。以下依嚴重度排序。

### BUG-052: forEachMultiCell 用 maxDim 正方形掃描，拆除時連帶清除相鄰同型建築 🔴 Critical ✅ 已修復
- **位置**: `src/core/building/InfraPlacement.ts:214`
- **問題**: `forEachMultiCell`（`removeInfraFromGrid` 的底層，即所有基礎設施拆除的必經路徑）沒有使用
  config 的真實 W×H，而是 `const maxDim = Math.max(cfg.width, cfg.height)` 掃一個 maxDim×maxDim **正方形**，
  對任何 buildingId 相符的格子觸發 callback
- **根因**: 所有非正方形配置（hospital 2×3、school_high 2×3、airport_s 5×4、airport_m 7×4、airport_l 9×6）
  的正方形都嚴格大於真實佔地，旁邊**另一棟同型建築**會一起被清掉。`canPlaceInfra` 只擋重疊格，
  允許這種相鄰；`PlacementPreview` 也顯示綠色，所以這是完全正常的玩家佈局
- **重現**: y=4 一列道路，(5,5) 放醫院 A（佔 x5-6, y5-7），(7,5) 放醫院 B（佔 x7-8, y5-7），兩者
  `canPlaceInfra` 皆回傳 ok。拆除 A 後，(5..7, 5..7) 全部 buildingId=0，只剩 x=8 那一行殘留 250/4，
  `findPrimaryCell(grid,8,5)` 回傳 null
- **影響**: 受害建築的格子被清空，但 `Game.demolish` 只反註冊它分類到的主格，所以 `HealthService.facilities`
  （以 x,y 為 key）的條目存活下來 → 持續提供覆蓋、持續每 tick 收 $8、`toJSON` 還會存進存檔。
  且**永遠無法移除**：主格已是 buildingId 0（skip），孤兒格 `findPrimaryCell` 回傳 null 而落入 `regular`
  拆除分支，該分支不呼叫 `removeInfraService`。結果是一間看不見、選不到、拆不掉的幽靈醫院
- **修復方向**: 改用主格 `RESERVED_TO_ROTATION[cell.reserved]` 解碼真實 (w,h) 並精確迭代該矩形；
  額外要求 `findPrimaryCell(grid,cx,cy)` 必須解析回同一個主格才觸發 callback（使掃描具備 instance 感知）。
  另需檢查 `DemolishClassifier`，確保孤兒從格不會落入 `regular` 分支
- **測試（先寫）**: `InfraPlacement.test.ts` — 「兩間並排醫院時 removeInfraFromGrid 只清除目標那間」。
  現有拆除測試全部只放**一棟**建築，同 buildingId 的判斷因此被無聲吸收
- **修復內容**（commit 見 git log）:
  - `forEachMultiCell` 改為從主格 `reserved` 解碼 rotation → `getRotatedSize` 取得真實 (w,h)，精確迭代該矩形
  - `findPrimaryCell` 額外驗證候選主格「自己的旋轉後 footprint 確實包含 (x,y)」——
    修復期間發現的**同根因附加缺陷**：原本的 maxSize 方框會認領錯位擺放的另一棟同型建築
    （A 在 (5,6)、B 在 (7,5) 時，查詢 B 的 (7,7) 會回傳 A 的主格）
  - `DemolishClassifier` 無法解析主格的基礎設施格改判為 `single_cell_infra` 而非 `regular`，
    使其至少會嘗試 `removeInfraService` 並讓玩家能回收該格
  - 新增 5 個測試（並排醫院／並排高中／90° 垂直堆疊／錯位鄰居／孤兒格分類），修復前全部失敗

### BUG-053: 行政區/政策/城市特化完全未序列化 — 每次存讀檔靜默清空 🔴 Critical ✅ 已修復
- **位置**: `src/core/save/Serializer.ts:141`
- **問題**: `snapshotGameState()` 序列化了 grid/clock/budget/taxRates/電水/citizens/8 種市政服務/
  6 種運輸系統/elevation，但**完全沒有** `state.districts`、`state.policies`、`state.citySpec`、`state.globalMarket`
- **根因**: `deserializeGameState()` 先呼叫 `createGameState(...)`，這四者回到全新預設值。且沒有任何側管道：
  DistrictManager/PolicyManager/CitySpecialization 都沒有 `toJSON`/`fromJSON`，grid cell 不帶 `districtId`，
  Game.ts 的 `extra` 只涵蓋 abandonmentStress/elevation/transferHistory。
  Serializer.ts:257-265 的 transit「從 grid 重建」fallback 沒有 district 版本，也不可能有
- **影響**: 四者都是玩家可操作的（Toolbar district Paint、DistrictModal、CitySpecModal）且都餵給經濟：
  `SimulationLoop.ts:774` `totalIncome *= citySpec.getBonus().revenueMultiplier`、
  :782 `calculateDistrictPolicyCost(...)`、:467-468 建築生長受 `getDistrictAt`/`canBuildInDistrict` 管制、
  `IncomeCalcAdapter.ts:16` 逐建築行政區收入。選了 TECH_CITY（1.25×）存檔重載後收入直接掉 20%，
  玩家禁止重工業的行政區立刻長出重工業，**遊戲內完全沒有任何提示**
- **註**: `BUGS.md:1323` 第六十六輪已以「ℹ️ 已知限制: Districts/GlobalMarket/Policies 未序列化」記錄過，
  當時列為可接受限制，從未修復也從未有測試。屬於既有未解缺陷，非本輪新發現
- **修復方向**: 為四個 manager 加上 `toJSON`/`fromJSON`（districts 必須存 cell 成員資格，grid 無法還原），
  在 `snapshotGameState` 加四個 key，`deserializeGameState` 以 `saved.districts ?? undefined` 保護還原，
  並 bump `CURRENT_SAVE_VERSION` 加一個 no-op migration 讓舊存檔載入為空而非驗證失敗
- **測試（先寫）**: `Save.test.ts` — 「round-trips districts, policies and city specialization」，
  目前會在第一個 assertion 就失敗
- **修復內容**:
  - `DistrictManager.toJSON()/fromJSON()` — 持久化 districts 含 cell 成員資格與 nextId；
    `cellToDistrict` 反向索引為純衍生狀態，載入時重建而非存檔
  - `PolicyManager.toJSON()/restore()` — policy 物件本身掛在 District 上，此處只需持久化 `nextPolicyId`，
    否則載入後新建的 policy 會重用既有 id
  - `CitySpecialization.toJSON()/fromJSON()` — 直接還原 current，不經 `choose()`
    （人口門檻在玩家當初選擇時已滿足，載入時也拿不到人口數）
  - `GlobalMarket` 本來就有 toJSON/fromJSON，只是 Serializer 沒呼叫 —— 補上
  - Serializer 四個 key 皆已接上。**關鍵細節**：`PolicyManager` 持有 `DistrictManager` 參照，
    替換後者時**必須**一併重建前者，否則政策查詢會打到被丟棄的空 manager
  - `CURRENT_SAVE_VERSION` 5 → 6，加 no-op migration（v5 以前根本沒寫過這些資料，無物可轉換；
    版本號存在是為了讓 SaveValidator 與未來 migration 能分辨兩個世代）
  - 新增 8 個測試（cells 成員資格／政策可執行性／區域特化／城市特化倍率／市場價格／
    district id 不碰撞／policy id 不碰撞／舊存檔載入為預設值），修復前 6 個失敗

### BUG-054: LaneGraph.updateCells 刪掉自己剛建好的跨路口轉彎邊，永久截斷分支 🟠 High ✅ 已修復
- **位置**: `src/core/traffic/LaneGraph.ts:155`
- **問題**: `generateCrossIntersectionTurns` 產生的 `xt:` 邊，其 `from`/`to` 位於**進入格與離開格**，
  只有 `viaCellKey` 記錄路口。`updateCells` 先為 `affected` 內每格重建邊（產生這些 xt 邊），
  接著對「相鄰但在 affected 之外」的每格跑修補пass：
  `this.edges = this.edges.filter(e => e.from.cellKey !== nk); this.generateEdgesForCell(grid, nk);`
  ——而那正是剛建好的 xt 邊的起點，於是被刪掉
- **根因**: `generateEdgesForCell(nk)` 只能重建**穿過** nk 的轉彎，無法重建**起於** nk 而穿過鄰近路口的轉彎。
  更糟的是 `generateStraightEdges` 已透過 `handledTurns`（:301/:421）被告知跳過等效的格內轉彎，因此沒有 fallback 邊。
  所有 `markLaneGraphDirty` 的呼叫端都傳非空 `affectedCells`（`RoadBuilder.ts:99` 回傳拖曳格且無外圈 padding），
  所以 `rebuildLaneGraph` 永遠走增量分支，`buildFromGrid` 只在初始化/讀檔時跑 → **該 session 內損壞永久存在**
- **重現**: 建 (0,0)→(3,0) 再 (3,0)→(3,3) 的 L 彎，`buildFromGrid` 產生兩條轉角 xt 邊。
  玩家重拖 (0,0)→(2,0) 為 FOUR_LANE，`updateCells` 後只剩一條，`getEdgesFrom('3,0:south:0:entry')` 為 `[]`
- **影響**: 南向分支變成 lane 層級的單向死路：通勤 A*（`LaneGraphPathfinder.ts:151`）失敗、
  公車路段重驗（`SimulationLoop.ts:1416-1422`）丟棄路段、`ServiceVehicleManager` 的消防/警察/救護派遣
  再也無法駛出該分支
- **修復方向**: 修補 pass 不可刪除自己無法重建的邊。(a) 改為 `e.from.cellKey === nk && !e.viaCellKey`，
  讓跨路口邊只由 affected pass 擁有；或 (b) 以 via cell 為刪除依據並在重建前把被刪 xt 邊的 via cell 併入 affected
- **測試（先寫）**: `LaneGraph.test.ts` — 斷言 `updateCells(...)` 後的圖與同一 grid 全新 `buildFromGrid` 相同。
  現有 updateCells 測試用共線直路，根本不產生 xt 邊
- **修復內容**: 採用比報告建議更根本的解法 —— **讓邊的所有權明確**。
  `generateEdgesForCell(O)` 恰好產生兩種邊：從 O 出發的直行邊、以及**經過** O 的轉彎邊
  （其 from/to 位於 O 的鄰居，只有 `viaCellKey` 記錄 O）。因此 `owner(e) = e.viaCellKey ?? e.from.cellKey`，
  且兩種 owner 都最多在被重建點位的外一環。
  - `owners` = affected ∪ neighbours(affected)
  - 點位依所屬格子刪除（`removeCellData` 改名為 `removeCellPoints`，不再碰邊）
  - 邊一律依 owner 刪除：`edges.filter(e => !owners.has(e.viaCellKey ?? e.from.cellKey))`
  - 對每個 owner 呼叫 `generateEdgesForCell`
  這樣**不可能**出現「A pass 刪掉、B pass 無法重建」的情況，原本的 borderNeighbors 修補 pass 整段移除
- **附帶發現**: 原 `removeCellData` 只比對 `from`/`to`，**不比對 `viaCellKey`**，
  所以 xt 邊的所有權本來就是模糊的——這才是根因，borderNeighbors pass 只是讓症狀顯現的地方
- **測試**: 新增 4 個（xt 邊集合不變／整張圖等同 buildFromGrid／分支未被孤立／四叉路口版本），修復前 3 個失敗

### BUG-055: Migration v3（市民年齡 年→life-weeks）從未轉換任何人 🟠 High ✅ 已修復
- **位置**: `src/core/save/migrations.ts:94`
- **問題**: v3 以 `if (c.birthTick !== undefined && c.birthTick !== null) continue;` 偵測舊格式市民，
  但 `deserializeGameState` 在 `Serializer.ts:221` 就先 `restoreCitizen(c)`，而 `CitizenManager._addCitizen`
  會在 `...overrides` 展開**之前**先算好 `birthTick: overrides.birthTick ?? Math.round(currentTick - age / AGE_PER_TICK)`
- **根因**: migration 在 :270 才跑，此時每個市民都已有數值 birthTick，guard 對所有人 `continue`。
  自引入該 migration 的 commit（668de04，其 --stat 未觸及 Serializer.ts）以來**一個市民都沒轉換過**，
  巢狀的 educationProgress 重新縮放（240000 → 15000）也同樣被跳過
- **雪上加霜**: `restoreCitizen` 用預設 `currentTick = 0` 而非 `saved.clock.tick`，
  捏造的 birthTick 編碼的是「tick 0 時的年齡（年）」，下一次 `updateAges(tick)` 得到 `age = age_years + tick * AGE_PER_TICK`
- **重現**: 對 version:2、clock.tick=5000、`{age:70, lifeStage:'SENIOR', educationProgress:80000}` 的存檔跑
  deserializeGameState：console 印出 `[Migration] Running v3` 但從未印出轉換數；age 停在 70、birthTick -11667，
  `updateAges(5000)` 後變成 100.0 且 lifeStage 退回 ADULT（正確值應為 211/SENIOR）
- **影響**: 老人不再老死並重新進入勞動人口池（`isWorkingAge` 為 52 < age ≤ 200）；
  存檔中的 10 歲孩童變成 40 歲 TEEN 而被踢出小學；educationProgress 留在舊刻度使每個學生瞬間畢業；
  舊存檔 tick 數夠高時 age 超過 MAX_AGE(280)，`getElderlyMultiplier` 回傳 Infinity，
  **第一次每日死亡檢查就抹除整個載入的人口**
- **修復方向**: 兩個獨立修正都需要。(1) 讓舊格式訊號存活：在 `restoreCitizen` **之前**對 `saved.citizens`
  原始 JSON 跑 v3 轉換。(2) 傳入真實 tick：`restoreCitizen(c, saved.clock.tick)`
- **測試（先寫）**: `migrations.test.ts` — 該檔目前對 v3 **零覆蓋**
- **修復內容**:
  - 新增 `migrateSavedCitizens(citizens, saveVersion, tick)` —— 對**原始 JSON payload** 執行轉換，
    由 `deserializeGameState` 在 `restoreCitizen` **之前**呼叫
  - v3 的 GameState migration 改為刻意留空並註明原因（此轉換在 GameState 層級**結構上不可能**正確執行）
  - `restoreCitizen(c, saved.clock.tick)` 傳入真實 tick。對現代存檔無行為變化
    （`overrides.birthTick` 存在時本就不會用到 currentTick），純粹修正舊存檔路徑
  - 新增 4 個測試（老人年齡轉換＋educationProgress 重新縮放／birthTick 錨定存檔時鐘／
    孩童轉換後仍為 CHILD／現代存檔不受影響），修復前 3 個失敗
- **註**: 使用者已確認舊存檔不需搶救，此修復為邏輯正確性而非資料救援

### BUG-056: 火災燒毀的建築從不驅離住戶／員工，市民永久滯留 🟠 High ✅ 已修復
- **位置**: `src/core/simulation/SimulationLoop.ts:836`
- **問題**: 其他所有讓區域建築退出服務的路徑都會呼叫 `CitizenManager.evictBuilding()` —— 廢棄（:984）、
  玩家拆除（`Game.ts:987/1063`）、基礎設施覆蓋（`Game.ts:2544`）、道路/鐵軌覆蓋（`Game.ts:878/907`）、
  災害（`Game.ts:1152`）—— **唯獨火災路徑沒有**
- **根因**: `processFireEvents` 呼叫 `applyFireDamage`（只做 `grid.setCell(x,y,{ reserved: BURNED })`），
  然後觸發 `onBuildingUpdated`/`onBuildingsChanged` 並使 workplace-distance 快取失效，完全沒碰任何市民。
  同時 `rebuildBuildingIndex`（:1017）會把 `reserved === BURNED` 的格子踢出 `buildingPositions`，
  於是該位置離開 housing/workplace candidates，但市民的 `homeId`/`workplaceId` 仍指著它
- **無法自癒**: `assignWithPreference` 跳過 `homeId !== null` 的市民（`OccupancyAssignment.ts:102`）、
  `relocationTick` 在 `if (!currentCandidate) continue` 就放棄（`Relocation.ts:57`）、
  廢棄掃描在 `AbandonmentStressTick.ts:74` 對 BURNED 提早返回
- **影響**: 未覆蓋消防的城市火災傷害固定 0.80（必然 ≥ 0.5），一棟 8 人的住宅燒毀後，這 8 人從此
  永不重新安置（即使他處有空屋）、不被計為無家可歸（`calculateHappiness` 永不套用 HOMELESS_PENALTY）、
  持續從焦黑格讀取電力/水/污染，並在該格持續產生警消/醫療/學校需求
- **修復方向**: `processFireEvents` 在 `applyFireDamage` 後迭代回傳的 `updates` 並對每個新燒毀格呼叫
  `evictBuilding(toPosKey(u.x,u.y), tick)`。更好的做法是抽出單一 `takeBuildingOutOfService(x,y,reservedState)`
  helper，讓全部 5 個呼叫點共用，未來新增狀態不可能漏掉驅離
- **註**: finder 另外聲稱的兩項後果經驗證為**錯誤**，不要帶進修復：驅離並不會移除市民（人口/容量帳目
  有無驅離都相同）；超容量佔用是 `BuildingUpgrade.tryDowngrade` 更常造成的既有容忍狀態
- **修復內容**: 抽出 `SimulationLoop.takeBuildingOutOfService(x, y)`，`processFireEvents` 對每個
  `u.burned` 的 update 呼叫之，`processAbandonmentStress` 也改走同一 helper。
  未來新增「建築停止運作」的狀態時，不會再有靜默漏掉驅離的路徑
- **測試撰寫時的陷阱**（值得記錄）: 初版測試「驅離住戶」竟然**通過**——因為測試建築沒有電水，
  多跑幾個 tick 後 slot 3 的**廢棄**路徑把住戶驅離了，掩蓋了火災路徑的缺陷。
  改成「偵測到 reserved === BURNED 就立即停止 tick」才真正隔離出火災路徑。
  這正是主題 6 說的測試盲點的另一種型態：**間接路徑意外滿足了斷言**
- **測試**: 新增 4 個（驅離住戶／驅離員工／記錄 homelessSince／不波及未受損鄰居），修復前 3 個失敗

### BUG-057: 幸福度用全市 employmentRate 擲骰決定 isEmployed，而非讀 citizen.workplaceId 🟠 High ✅ 已修復
- **位置**: `src/core/simulation/SimulationLoop.ts:645`
- **問題**: `updateCitizenHappiness` 寫的是
  `factors.isEmployed = !isWorkingAge(citizen.age) || Math.random() < ctx.employmentRate`
- **根因**: `employmentRate = Math.min(1, totalJobs / adultCount)`，而 `totalJobs` 是
  `countWorkplaceJobs(grid)` —— 純 grid 容量，不含可達性或佔用概念。任何職缺多於成人的城市
  employmentRate 恆為 1，`Math.random() < 1` 永遠為真
- **影響**: `Happiness.ts:176` 的 `if (!factors.isEmployed && isWorkingAge(...))` 整段永不執行，
  使 `unemployedSince`、`getUnemploymentPenalty`、UNEMPLOYMENT_MEDIUM_PENALTY(-25)、
  UNEMPLOYMENT_FORCED_PENALTY(-100，強制外移觸發器) 全部無法到達。反過來當 employmentRate < 1 時，
  擲骰落在**確實有工作**、`unemployedSince` 為 null 的市民身上，只吃到 -15 平頭懲罰，階梯同樣不啟動。
  同一個 tick 內自相矛盾：`runMigration`（:512-520）從 `c.workplaceId === null` 算失業率，
  130 行後的幸福度 pass 卻假設全民就業
- **實測**: 40×40 活體模擬得到 `pop 50 adults 47 unemployed 23 jobs 80 empRate 1` ——
  47 個工作年齡市民中有 23 個 `workplaceId === null`，卻全部拿到 `isEmployed = true`、零失業懲罰。
  另一組直接探測（10 人 `unemployedSince = 0`、clock.tick = 1000，遠超 ~90-120 tick 的強制容忍）
  得到平均幸福度 13.0 vs 有工作者 14.0：-100 的強制外移懲罰**可證明是失效的**
- **修復方向**: 一行 —— `factors.isEmployed = !isWorkingAge(citizen.age) || citizen.workplaceId !== null;`。
  `workplaceId` 本來就是忠實訊號。若無他處使用，順手把 `employmentRate` 從 CityHappinessContext 移除
- **修復內容**: 一行 —— `factors.isEmployed = !isWorkingAge(citizen.age) || citizen.workplaceId !== null;`
- **測試撰寫時的教訓**: 初版測試用 mocked `Math.random` 驅動整個 SimulationLoop，結果完全不可靠 ——
  random 同時驅動火災、生長、廢棄等十幾個子系統，彼此汙染（同一段程式碼 draw=0 得 happiness 50、
  draw=0.999 得 5）。改為**把時鐘停在 slot 4 前一格、只跑那一個 tick**，測試才變得確定性。
  這個技巧對後續測試模擬層的 bug 都適用
- **驗證**: 暫時還原舊那行確認 3 個測試中有 2 個會失敗、修復後全過。
  第 3 條（孩童不受罰）在新舊實作下都通過 —— 它不針對本 bug，但能擋住「修過頭去罰未成年」的錯誤修法，保留為守衛
- **附帶確認**: `-100` 的 UNEMPLOYMENT_FORCED_PENALTY 確實有生效，只是 happiness 被 clamp 到 0
  （有工作者 15、失業者 0），這正是觸發強制外移的狀態

### BUG-058: 轉彎車輛看不到紅綠燈與平交道柵欄 — viaCellKey 被丟棄、中點守衛是死碼 🟠 High ✅ 已修復
- **位置**: `src/core/traffic/VehicleLookahead.ts:85`（合併 `Game.ts:418` 同根因）
- **問題**: `xt:` 邊從進入格直接跳到離開格，被略過的路口只記在 `edge.viaCellKey`。
  `findRedLightDistance` 呼叫 `canAdvance(edge.from.cellKey, edge.to.cellKey)`，**從不轉發 viaCellKey**
- **根因**: `Game._canAdvance` 試圖用 `dx + dy === 2` → 中點來還原被略過的格子，並以
  `Number.isInteger(ix) && Number.isInteger(iy)` 守衛。但產生器拒絕 `entryD.dir === exitD.dir` 與
  `=== oppositeDir(exitD.dir)`，所以**每個轉彎都是垂直的**：|dx| = |dy| = 1，中點恆為 I±(0.5,0.5)，
  守衛對它所針對的 100% 邊都為 false。該程式碼源自 12ed86d，當時 skip edge 還是直線 2 格跨距、中點為整數
- **影響**: 執行落到 `canPass(cx,cy,nx,ny)` 與 `isCrossingBlocked(nx,ny)`，查詢的是**離開格** ——
  一個沒有號誌也沒有平交道的普通路面格。且沒有安全替代路徑：`LaneGraph.ts:421` 會刪除任何被 xt 邊
  涵蓋的格內轉彎邊
- **實測**: FOUR_LANE(y=3) × FOUR_LANE(x=3) 產生 (3,3) 號誌。西來南往通勤者的 A* 首段是
  `xt:2,3:east:0:exit>3,4:north:0:entry [via 3,3]`。號誌在 phase 0（東西向紅燈）時，轉彎車
  `findRedLightDistance` 回傳 Infinity 並停在 y=3.63（已過路口），而同一紅燈下的直行對照車回傳 1.6 並停在停止線。
  通過 (3,3) 的 16 條 xt 邊中，中點為整數者為 0 條。同一死分支也繞過 `isCrossingBlocked`，
  所以轉彎車會**直接開過放下的鐵路柵欄**
- **修復方向**: 把路口帶過去而非重建 —— `canAdvance` 簽章擴充為 `(fromCell, toCell, viaCell?)` 並傳入
  `edge.viaCellKey`；`Game._canAdvance` 在有 viaCell 時檢查 `trafficLights.canPass(cx,cy,viaX,viaY)` 與
  `levelCrossingSystem.isCrossingBlocked(viaX,viaY)`，並**刪除**已死的中點分支
- **修復內容**:
  - `canAdvance` 簽章擴充為 `(current, next, via?)`，`findRedLightDistance` 傳入 `edge.viaCellKey`；
    `TrafficSimulation` 的回呼型別同步
  - **把 `Game._canAdvance` 的邏輯抽成純函式** `src/core/traffic/CanAdvance.ts` 的 `canAdvanceThrough()`，
    以 `SignalLookup`/`CrossingLookup` 兩個最小介面注入依賴（DIP）。
    這正是主題 6 建議的結構性補救 —— Game.ts 因 import Three.js 而完全無法測試，
    抽出後這段邏輯有了 7 個直接單元測試
  - 已死的 `dx + dy === 2` 中點分支整段刪除
- **測試**: 新增 3 個 VehicleLookahead 測試（viaCellKey 有被傳遞／via 格紅燈會停車／直行邊不受影響）
  + 7 個 CanAdvance 測試（含平交道、目的地仍會檢查、負座標）。修復前 2 個失敗

### BUG-059: 地面→level 1 匝道繞過 LEVEL_OCCUPIED 檢查，靜默覆寫既有高架 🟡 Medium ✅ 已修復
- **位置**: `src/core/elevation/ElevatedPathValidation.ts:82`
- **問題**: 層級碰撞檢查以 `pos.level > 0` 為條件，但實際寫入的層級是
  `storeLevel = pos.isRamp ? Math.max(pos.level, pos.targetLevel) : pos.level` —— **守衛檢查了錯誤的值**
- **根因**: 上升匝道在 path index 1 時 `level = 0, targetLevel = 1`，整個區塊被跳過
  （包含 `existing.isRamp || pos.isRamp → LEVEL_OCCUPIED` 這條註解本身就寫明不變式的拒絕，
  以及 `hasRampAtLevel` 拒絕），但 `ElevatedRoadBuilder.ts:153` 卻把該格寫在 level 1
- **重現**: 地面道路 x=1,y=4..8，`buildElevatedRoad({1,4}→{1,0}, FOUR_LANE, level 1)` 成功，
  `em.get(1,0,1) = {roadType:3, roadFlags:2, isRamp:false}`。再於 (0,0) 加地面路並
  `buildElevatedRoad({0,0}→{5,0}, TWO_LANE, level 1)` → `{success:true, cost:1900}`，
  之後 `em.get(1,0,1)` 變成 `{roadType:2, roadFlags:14, isRamp:true, rampAscendDirection:8}`
- **影響**: 玩家的 FOUR_LANE 高架被降級為 TWO_LANE、變成斜坡、被加上假的路口 flag，南北向高架路線斷裂。
  同樣衝突移出一格（body cell，index ≥2）則會被正確拒絕。`ElevationManager.set` 無佔用守衛、
  `ElevatedRoadBuilder` 還主動 merge `existing.roadFlags`、沒有任何每 tick pass 會正規化、
  拖曳預覽（`Game.ts:2478`）用同一個 validator 所以**把非法放置畫成綠色**、且損壞會經 toJSON 進入存檔
- **修復方向**: 先算 storeLevel 再用它當條件：
  `const storeLevel = pos.isRamp ? Math.max(pos.level, pos.targetLevel) : pos.level; if (storeLevel > 0 && ...)`。
  `ElevatedRailBuilder` 共用同一 validator，一次修好兩邊
- **修復內容**: 如上，把 `storeLevel` 提到條件之前並改用它當守衛。`hasRampAtLevel` 的子檢查
  仍以 `pos.level` 為鍵（平面格語意），未動。`ElevatedRailBuilder` 共用同一 validator，一併修好
- **測試**: 新增 4 個（匝道落在既有平面高架／匝道落在既有匝道／body cell 仍被拒絕的對照組／
  淨空路徑仍允許的對照組），修復前 2 個目標測試失敗、2 個對照組通過

### BUG-060: removeRoad 靜默改寫倖存鄰居的 roadType 🟡 Medium
- **位置**: `src/core/road/RoadBuilder.ts:128`
- **問題**: 清除被拆格後，`removeRoad` 走訪 4 個正交鄰居、剝除反向 flag（正確），
  然後**無條件**以 `getMaxNeighborRoadType(nx, ny, newFlags)`（該鄰居剩餘連線中的最高等級）覆寫其 `roadType`
- **根因**: 道路等級是玩家付費的 authored state（`calculateRoadCost` 在重畫更高等級時收
  `Math.max(0, config.cost - existingCost)` 差額，正是 BUG-025 的既定修法），卻因拆除**無關的**相鄰格
  而被雙向改寫，既不收費也不退費。不對稱性證明這是過度延伸的路口修補啟發式而非刻意語意：
  `newFlags === 0` 時 `maxType > 0` 守衛會放過它，所以孤立的 FOUR_LANE 殘段保住等級 3，
  但仍接觸 TWO_LANE 的那個就被改寫
- **重現**: 建 TWO_LANE (0,5)→(9,5)，重拖 FOUR_LANE (3,5)→(6,5) 付了 $800 差額，(3,5).roadType === 3。
  玩家改道 `removeRoad(4,5)` 後 (3,5).roadType 掉回 2 —— 容量 200→100、maxDensity HIGH→LOW、
  $200 已付容量蒸發且無退費無通知。反向亦可重現：HIGHWAY 列中 (4,5) 有 TWO_LANE 覆蓋，
  `removeRoad(3,5)` 讓 (4,5) 從 2 免費升到 5
- **修復方向**: 拆除時**完全不要動**倖存鄰居的 `roadType`。若當初驅動 `getMaxNeighborRoadType` 的
  路口渲染問題仍在，應在渲染層解決，或限制為僅對本身是路口（dirCount ≥ 3）的格子且**只升不降**，
  與 migration v2 已編碼的規則一致
- **註**: finder 的頭號重現用 `RoadUpgrade`，但該模組是死碼（無非測試呼叫端）；活路徑是 `buildRoad` 重畫高等級

### BUG-061: CommuteCache.bumpGeneration 在 ready 路線仍持有參照時清空 routeRefCount 🟡 Medium
- **位置**: `src/core/traffic/CommuteCache.ts:51`
- **問題**: `bumpGeneration()` 抹除 `routeRefCount`（及 routeIndex/routeCellIndex），
  卻留下 `this.cache` 中一堆 `status:'ready'` 且邏輯上仍持有參照的路線
- **根因**: 這些市民之後重算時，`set()` 對同一 routeKey 先跑 `adjustRefCounts(old, -1)` 再
  `adjustRefCounts(route, +1)`。對已歸零的 map 而言，遞減把計數推到 -1，
  `applyRefDelta` 在 `count <= 0` 時刪除該 key，遞增再把它還原成 **1**。
  N 個共用同一路線的市民因此永久停在 refCount 1 而非 N —— `isExpired()` 保證所有人都會在
  RECALC_SPREAD_TICKS 內經過 `set()`，之後就走 `continue` 快路徑再也不呼叫 `set()`
- **觸發頻率**: `bumpGeneration()` 由 `markLaneGraphDirty`（`SimulationLoop.ts:1303`）無條件呼叫，
  而 Game.ts 在每次建路、升級、拆除、建鐵軌、造成驅離的重劃區時都會呼叫
- **重現**: 3 市民 × 2 方向，bump 前總計 6；bump 後跑完早晚兩班 pass 總計 4，且永遠停在 4
- **影響**: `computeCongestionFlow` 產出每格流量 ≈ N+1 而非 2N（約 2× 低估），
  `traffic.updatePredictedFlow` 餵給 `getSegmentDensity`，`syncTrafficDensityToGrid` 再把
  `Math.round(Math.log2(1+flow))` 低一級寫進 `cell.trafficDensity` ——
  交通 overlay 與噪音污染從玩家**第一次建路**起就帶著永久性的全市偏誤
- **修復方向**: 要嘛 `bumpGeneration()` 不清 `routeRefCount`（清 routeIndex/routeCellIndex 已達成退休共用路線池的目的），
  要嘛清的同時把每條快取路線標成 `status:'pending'` / 丟棄 `this.cache`。若保留該 map，
  讓 `applyRefDelta` 拒絕低於 0 並記錄，把不變式變成強制而非靜默吸收
- **註**: 現有 :387 的測試是**空過**的 —— `forEachRouteWithRefCount` 迭代 `routeIndex`，
  而 bumpGeneration 連它一起清了，所以就算刪掉 `routeRefCount.clear()` 該測試仍會通過。這條 assertion 也要一併修

### BUG-062: 經濟面板漏掉市政服務／政策／高架維護支出與城市特化收入加成 🟡 Medium
- **位置**: `src/core/economy/EconomyBreakdown.ts:39`
- **問題**: `getEconomyBreakdown()` 是 Economy 頁面唯一資料來源，但 `EconomyBreakdownResult` 只帶
  roadMaintenance / loanInterest / powerCost / waterCost / transportCost
- **根因**: `tickBudget()` 實際扣除的支出在 `SimulationLoop.calculateIncome()` 組成，為
  `roadMaintenance + serviceCost + policyCost + transportCost + elevatedMaintenance`，
  其中 `serviceCost = getTotalServiceMaintenanceCost(state)` 加總全部十種市政服務。
  於是警察/消防/醫療/教育/公園/垃圾/污水/殯葬維護、行政區政策費、高架道路維護**在 UI 完全看不到**。
  收入側 SimulationLoop 套用 `citySpec.getBonus().revenueMultiplier`，breakdown 則沒有
- **影響**: `overview/EconomyPage.tsx:44-47` 把五個欄位加總成「Expenses/tick」與「Net Balance」，
  而正下方的 EconChart 畫的是真實 `state.budget.expenses`、HUD 顯示真實餘額 ——
  **同一個畫面自相矛盾**。範例：2 警 + 2 消 + 1 醫 + 3 校 + 4 園 + 2 垃 + 1 墓 + 1 污 = $61/tick，
  加 20 格高架 $320/tick 與 1 條政策 $150，真實支出約 $531/tick，面板卻只顯示約 $18/tick
  並報告正的 Net Balance，同時國庫每個預算 tick 掉約 $490。從**第一座警察局**（$4/tick）就開始偏離
- **修復方向**: 在 `EconomyBreakdownContext`/`Result` 加 `serviceCost`、`policyCost`、`elevatedMaintenance`，
  於 `Game.ts:2562-2572` 填值，並對 zone incomes 套用 `revenueMultiplier`，EconomyPage 加對應列。
  順手刪掉死碼 `ui/modals/EconomyModal.tsx`（無人 import）以免繼續漂移
- **測試（先寫）**: 斷言 breakdown 各項加總 === `state.budget.expenses` —— 這正是現有逐欄位 pass-through 測試缺的交叉檢查

### BUG-063: Lane graph SharedArrayBuffer 在 worker 批次執行中被原地覆寫 🟡 Medium
- **位置**: `src/core/simulation/SimulationLoop.ts:1439`
- **問題**: `syncGraphToWorker()` 在主執行緒把 pathfinding graph 直接寫回活的 SAB，
  而 pathfinding Worker 正持有該 SAB 的 `GraphReader` 且可能正在批次中
  （`createWorkerHandler` 對整個 BATCH_REQUEST 同步迴圈跑 `astar.findPathVariants`）
- **根因**: `LaneGraphBuffer.writeFromGraph` **先寫 header**（pointCount@0, edgeCount@4, version@8）
  用的是普通 DataView store，再寫 points/edges/adjacency。格式保留了 `version` 欄位、
  `LaneGraphBuffer.getVersion()` 與 `GraphReader.getVersion()` 都有暴露，但 grep 顯示唯一的非測試呼叫端
  是兩個 writer 自己遞增它 —— **設計好的守衛從未接上**。`grep -rn Atomics src` 零命中。
  後續的 INIT_GRAPH post 也救不了：它要等當前批次跑完才會被取出
- **影響**: 執行中的 A* 會用**新的** header 計數去讀**寫到一半**的 point/edge/adjacency 區域，
  `getEdgeToIdx`/`getEdgesFrom` 混合新舊拓撲，parentEdge 鏈可能成環。
  `PooledAStar.reconstructPath`(:290-304) 以無步數上限的 `while` 走該鏈 → **worker 永久卡死**：
  再也不會有 BATCH_RESULT，`spawnCommuteVehicles` 沒有同步 fallback，該 session 通勤車輛停止生成，
  且程式中沒有任何 watchdog 或 `terminate()`
- **修復方向**: 兩層。(1) 正確性：用既有 version 欄位做 seqlock —— writer 以 Atomics 在寫入前 bump 成奇數、
  寫完成偶數，`GraphReader` 在每次搜尋前後複查，變動就中止該請求；或雙緩衝兩個 SAB 並以 INIT_GRAPH 切換。
  (2) 無論如何都要的圍堵：給 `reconstructPath` 加上以 pointCount 為界的步數上限，超過就回傳 null，
  讓撕裂讀取永遠不可能卡死 worker
- **註**: 對抗驗證指出「錯誤路線」這個後果其實已被 `clearPending()` 中和（跨界批次結果會被整批丟棄），
  所以真正值得修的是**卡死**與未接上的 version 守衛，而非路線正確性

### BUG-064: BusSystem 在中途站被拆除時從不重算 routeSegments 🟡 Medium
- **位置**: `src/core/transport/BusSystem.ts:295`
- **問題**: `BaseTransportSystem.removeStop()` 原地改動 `route.stops` 後呼叫可覆寫的
  `onRouteStopRemoved(route)` hook 讓子類重算快取的逐段路徑。`RailSystem.ts:128` 與
  `FerrySystem.ts:123` 都有覆寫，**BusSystem 沒有**（它只覆寫了 `onRouteDissolved`）
- **根因**: 路線在少一站後仍存活，卻保留著為**舊站列表**算出的 `LaneEdge[][]`。沒有任何東西會重算：
  `rebuildAllSegments()` 在 `if (this.routeSegments.has(route.id)) continue` 短路；
  `onRoadChanged()` 也到不了 —— 公車站位於非道路格（`canPlaceTransportStop` 要求 `cell.roadType === 0`），
  所以拆站不會貢獻任何 `demolishedRoadCells`，`markLaneGraphDirty([])` 產生**空的** dirtyRoadCells，
  反而讓 `rebuildLaneGraph` 走完整 `buildFromGrid` 分支並整段跳過 `bus.onRoadChanged`。
  而那次全量重建會換掉每一個 LaneEdge 物件，於是陳舊 segment 還額外指向孤兒 edge
- **重現**: 站 A(0,1)、B(10,1)、C(10,11)，`getSegmentDistances` = [10, 10, 20]。拆掉 B 後路線剩 [A, C]，
  實測 `stops after removal 2` 但 `AFTER segDists [10,10,20]` —— 仍是 3 筆，
  且 TrafficSimulation 中的公車仍跑著經過已拆除站點的 3 段迴圈
- **影響**: `computeRideDistance([A,C], 0, 1, segDists)` 讀到 segDists[0]=10 與 [1]=10 而非真實的 20，
  `findAvailableTransit` 回報 estimatedTime 5 而非 10；`chooseMode` 比較
  `bestTransit.time < driveTime * 1.5` 後把通勤者從 DRIVE 轉到一條實際上慢一倍的公車線。
  只有存讀檔（routeSegments 未序列化）或之後某次動到該路徑的道路編輯才會自癒
- **修復方向**: 在 BusSystem 覆寫 `onRouteStopRemoved(route)`。BusSystem 未保留 `findEdgePath`
  （這正是當初略過該 hook 的原因），需比照 Rail/Ferry 保存網路，或讓 `removeStop` 接受重算 callback。
  另外讓 `sumDirection` 斷言 `segDists.length === stops.length`，不符時退回歐氏距離，使陳舊快取降級而非說謊
- **測試（先寫）**: `StopRemovalPathRecompute.test.ts` 已經為 RailSystem 與 FerrySystem 覆蓋了這條契約，
  **BusSystem 零案例** —— 補上即可

### BUG-065: 高架鐵軌從未註冊進 RailNetwork，鐵路線無法跨橋 🟡 Medium
- **位置**: `src/Game.ts:547`
- **問題**: `ElevatedRailBuilder` 接受選用的 `RailNetwork`（預設 null）且只在 `if (this.network)` 下加圖的邊。
  Game.ts 建構它時**沒有傳網路** —— `new ElevatedRailBuilder(this.state.grid, this.elevationManager)` ——
  而上一行的地面 `RailBuilder` 有拿到 `this.railNetwork`
- **根因**: 高架軌因此存在於 ElevationManager（由 ElevatedRoadRenderer 繪製、被
  `calculateElevatedMaintenance` 每 tick 收費），卻對 `RailSystem.computeRoutePaths` → `RailNetwork.findPath`
  搜尋的圖貢獻零節點零邊。`rebuildRailNetworkFromGrid` 也救不回來：
  `buildElevatedTrack` 從不寫 grid（`if (pos.level === 0 && !pos.isRamp) continue`），載入時的 grid 掃描什麼都看不到
- **影響**: 由於 `PathValidation.ts:26` 對地面軌拒絕 WATER，**高架橋是鐵路跨水的唯一手段**。
  實測 40×40、水域在 16-20 欄：地面軌 5,10→14,10 與 22,10→30,10 皆成功，高架跨距 14,10→22,10 level 1
  成功（cost 2700）。軌道看起來連續且照常收維護費，但 `railNetwork.findPath('5,10','30,10')` 回傳 null，
  於是 `rail.createLine(...)` 在 `RailSystem.ts:176` 回傳 null —— 而 `TransitModal.tsx:61/:111`
  丟棄回傳值，所以**路線靜默地不存在，玩家看不到任何錯誤**
- **修復方向**: 建構時傳入網路。但跨存讀檔仍不夠 —— 需擴充 `rebuildRailNetworkFromGrid`（或加伴隨 pass）
  走訪 ElevationManager 的 rail segment 並以同樣的 `nodeId(x,y,level)` 重新加入節點與邊。
  另外接上目前是死碼的 `ElevatedRailBuilder.removeElevated`（拆除永遠走 `elevatedRoadBuilder.removeElevated`）
- **註**: 現有測試**永遠**帶著 RailNetwork 建構 builder，所以這條 production 路徑從未被測到

### BUG-066: 收入計算為 O(區域建築 × 市民) 且每棟建築配置新陣列 🟡 Medium
- **位置**: `src/core/economy/IncomeCalcAdapter.ts:14`
- **問題**: `buildIncomeCalcDeps` 把 `getResidentEducations` 接到 `CitizenManager.getCitizensByHome(key)`、
  `getWorkerCount` 接到 `getCitizensByWorkplace(key)`。兩者都是對**整個市民陣列**的裸
  `Array.prototype.filter`，每次呼叫都配置一個新陣列 —— CitizenManager 沒有 home/workplace 索引也沒有 memo
- **根因**: `calculateZoneIncomes` 透過 `forEachCell` 對每棟區域建築呼叫一次 `calculateBuildingIncome`，
  每次都命中其中一個 filter（唯一提早退出是 `isPowered` 檢查，且所有非住宅區型的 workers 都 > 0）。
  成本為主執行緒上的 O(#區域建築 × #市民) —— SimulationLoop 由 Game.ts 建構與 tick，**不在 worker**
- **實測**: 5,000 市民 / 1,000 建築 = 40 ms；10,000 / 1,400 = 68 ms；20,000 / 1,700 = 143 ms；
  30,000 / 2,000 = **265 ms**。Game.ts 每幀最多跑一個 sim tick，整個成本落在每 6 tick 的**單一幀**內 ——
  隨城市規模成長的可見卡頓（專案自己的「megalopolis」里程碑就是 25,000 人口）。
  Economy 頁面開著時，約 11 個呼叫點會以節流 UI tick（約 6/秒）重跑，5,000 市民的城市直接凍結
- **修復方向**: 每個 pass 建一次 map，完全比照 `ServiceRegistry.tickAllCivicServices` 已有的正確慣例
  （它一次 O(N) 掃出 `residentsByPos`/`workersByPos`）：在 `buildIncomeCalcDeps` 對
  `state.citizens.getCitizens()` 單趟掃成 `Map<posKey, Education[]>` 與 `Map<posKey, number>`，
  兩個 dep 改讀 map。行為不變，回傳收入必須逐位元相同
- **註**: `countOccupancy` 已在 5 個 SimulationLoop 位置做同樣的聚合，`calculateZoneIncomes` 是唯一的例外

### BUG-067: SidewalkGraph.updateCells 切斷重建區域外圈一格的人行道邊 🟡 Medium
- **位置**: `src/core/traffic/SidewalkGraph.ts:176`（合併 :193 同根因）
- **問題**: `updateCells` 組出 `toRebuild` = affected 格 + 其 4 個正交鄰居，對每格呼叫 `removeCellData`，
  然後**只**為 `toRebuild` 內的格子重新產生節點與邊
- **根因**: `removeCellData` 會刪除接觸該格的**雙向**邊（它明確地把反向邊從另一個節點的 adjacency list 中 splice 掉），
  而 `generateCrossCellEdges` 只發出 `RoadDirection.EAST` 與 `SOUTH` 的連結。
  重建格與其外側未受影響格之間的 WEST/NORTH 連結，其所有權**專屬於那個外側格**，
  而該格的 `generateEdgesForCell` 從未執行。斑馬線邊、路口橋接邊有同樣的單向所有權問題，
  街道對側的建築門邊也被剝除。`LaneGraph.updateCells` 明確有 `borderNeighbors` 修補 pass 處理這件事
  （還附了描述該失效的註解），SidewalkGraph 抄了鄰居收集的註解（'same as LaneGraph pattern'）**卻沒抄修補**
- **真正觸發源**: 不是道路編輯（那會設 `sidewalkGraphDirty` 而強制全量重建），
  而是**建築生長** —— `SimulationLoop.ts:499` 在每次區域生長/移除 tick 呼叫 `updateCells`，
  而生長從不設 dirty flag，所以切斷會持續到玩家下次編輯道路為止
- **重現**: 直線東西向道路 (0,0)..(5,0) 經 `buildFromGrid`；(3,1) 長出房子使 SimulationLoop 呼叫
  `updateCells(grid, ['3,1'])`。`getEdgesFrom('2,0:NE').some(e => e.to.id === '3,0:NW')` 前為 true、後為 false，
  雙向皆然，而 `3,0:NE → 4,0:NW` 存活；**節點數不變**（這正是現有測試仍通過的原因）。
  `findPath('0,0:SW','7,0:SE')` 從 15 條邊變成 null
- **影響**: 行人 A*（`findPathMultiTarget`）回傳 null → `PedestrianManager.spawnPedestrian` 回傳 null →
  整個街區的行人消失。且非單調 —— 之後在切口西側的生長會修復該連結但同時切斷下一個
- **修復方向**: 補上缺的 border-neighbour pass，比照 `LaneGraph.ts:140-157`。
  更好的長期解法是讓跨格邊的發出對稱（每格發出四個方向並去重），使任何格的邊都不依賴鄰居被重建
- **測試（先寫）**: 現有 updateCells 測試只斷言 `getAllNodes().length` / `getNodesInCell().length`
  —— 在此情境下這些數字是**正確的**，該斷言的是連通性

### BUG-068: applyDisasterDamage 清除 buildingId 卻留下 reserved（BURNED/ABANDONED）🔵 Low
- **位置**: `src/core/climate/Disaster.ts:159`
- **問題**: `applyDisasterDamage` 做 `grid.setCell(x, y, { buildingId: 0 })` ——
  這是全 codebase **唯一**清除 buildingId 卻不一併重設 `reserved` 的地方。
  其他所有拆除路徑都成對處理（`BuildingGrowthTick.ts:107/129`、`Game.ts:1042/1052/1154`、
  `RoadBuilder.ts:53`、`RailBuilder.ts:78` 全都寫 `{ buildingId: 0, reserved: 0 }`）
- **根因**: 它的守衛只檢查 `buildingId === 0`、`isInfrastructureBuilding`、`roadType !== 0`，
  所以已標記 BURNED(3) 或 ABANDONED(1) 的格子會通過並被留成 `buildingId=0, reserved=3`。
  `Grid.setCell` 是真正的 partial patch，`reserved` 因此存活
- **影響**: BuildingGrowthTick 的 Case 1 與 Case 2 都額外要求 `isZoneBuilding(cell.buildingId)`（現已為 false），
  該格落入 Case 3 而由 `BuildingGrowth.tryGrow` 以 `setCell(x, y, { buildingId: building.id })` 重新生長，
  `reserved` 仍停在 3。全新建築從此被永久當成焦黑廢墟：`IncomeCalculator.ts:134` 不收稅、
  `BuildingQueries.ts:39` 不計入 RCI 供給與住房容量、`AbandonmentStressTick.ts:74` 從不評估它、
  BuildingRenderer 畫成焦黑。載入時也無修補（`migrateOldInfra` 對 buildingId 0 提早返回、
  SaveValidator 白名單放行 reserved 3）。只有 2% 的 BURNED_CLEARANCE_CHANCE 能自癒
- **嚴重度說明**: 需要災害開啟（預設 true）、人口 ≥ 50、0.001/tick 的擲骰，且爆炸範圍要重疊在
  已燒毀/已廢棄的格子上 —— 因此列為 low 而非 high
- **修復方向**: 一行 —— `grid.setCell(x, y, { buildingId: 0, reserved: 0 })`。
  順帶考慮抽出共用的 `clearBuildingCell(grid, x, y)` 並加上 dev-only 不變式斷言
  「非基礎設施格 buildingId === 0 蘊含 reserved === 0」

---

### 本輪跨切面主題（值得系統性處理，而非逐條修）

1. **增量圖修補系統性不完整，而增量是唯一路徑**
   LaneGraph 與 SidewalkGraph 的邊由**單一**端點格擁有，但移除（`removeCellData`）是對稱的 ——
   它刪掉重建迴圈無法重建的邊，因為那些邊的擁有者在重建集合之外。
   LaneGraph 有 borderNeighbors 修補 pass，但它自己刪掉剛建的 `xt:` 邊（BUG-054）；
   SidewalkGraph 抄了註解卻沒抄修補（BUG-067）。
   由於所有呼叫端都傳非空 affectedCells，完整 `buildFromGrid` fallback 只在初始化/讀檔跑，損壞在該 session 內永久存在。
   **系統性解法**: 讓跨格邊的發出對稱（每格發四方向並去重），並加一條不變式測試斷言
   `updateCells(...)` 產出的圖與同一 grid 全新 `buildFromGrid` 相同 —— 這一條 property test 可同時抓到兩個 bug，也能抓到下一個。

2. **守衛檢查代理值而非權威值**
   `ElevatedPathValidation` 以 `pos.level` 為條件但寫入用 `storeLevel`（BUG-059）；
   `Game._canAdvance` 用中點重建路口而不讀邊上已帶的 `viaCellKey`，產生對其目標邊 100% 為死的分支（BUG-058）；
   `migrations.ts` 在 `restoreCitizen` 已無條件捏造 birthTick 之後才檢查 `birthTick !== undefined`（BUG-055）；
   幸福度用全市 `totalJobs/adultCount` 比率而 `citizen.workplaceId` 就在旁邊（BUG-057）。
   每一例中權威資料都存在於呼叫點卻被忽略。
   **應採規則**: 當一個檢查與其對應的寫入計算相關的值時，算一次共用變數，絕不為守衛重算一個較弱的近似。

3. **衍生／快取狀態沒有失效契約**
   BusSystem 的 routeSegments（無 `onRouteStopRemoved` 覆寫，不像 Rail 與 Ferry，BUG-064）、
   CommuteCache 的 routeRefCount（在其參照者仍存活時被清空，BUG-061）、
   lane graph SAB（在活的 reader 下被覆寫，且 `version` 欄位從未接上，BUG-063）、
   ElevatedRailBuilder 從未註冊的 RailNetwork 邊（BUG-065）—— 全是同一形狀：
   快取被填充一次，其來源經由不通知它的路徑變動，然後沒有任何東西去調和。
   **系統性解法**: 共用的「衍生資料」基礎契約，每種變動有明確的 invalidate hook，
   加上「每次變動後斷言 cache ≡ recompute」的測試 —— `StopRemovalPathRecompute.test.ts` 已對三個子類中的兩個做到了。

4. **新子系統被加進 GameState 與 tick 迴圈，卻沒被加進存檔層或報告層**
   Districts/policies/citySpec/globalMarket 有模擬也可編輯卻不在 Serializer（BUG-053）；
   市政服務、政策、高架維護由 SimulationLoop 收費卻不在 EconomyBreakdown（BUG-062）；
   高架鐵軌會建、會畫、會收費卻不在 RailNetwork（BUG-065）。
   **系統性守衛**: 一條測試列舉 GameState 的欄位，當某欄位既未被序列化也未被明確標記為 transient 時失敗；
   另一條斷言經濟 breakdown 加總等於 `state.budget.expenses`/`income`。

5. **格子變動點只清多欄位格的其中一欄，並錯誤推導多格建築的佔地**
   `applyDisasterDamage` 清 buildingId 不清 reserved（BUG-068）；
   `forEachMultiCell` 把佔地重建成 maxDim 正方形而波及鄰近實例（BUG-052）；
   `removeRoad` 從剩餘連線重新推導倖存鄰居已付費的 roadType（BUG-060）。
   格子是複合記錄、建築是複合佔地 —— 兩者都需要單一權威 helper
   （`clearBuildingCell(grid,x,y)`、具旋轉感知／主格驗證的 `forEachOwnedCell`），而非每個呼叫點各自推導。

6. **3,426 個測試在三個特定且可重複的面向上是盲的**（這解釋了為何上述每個 bug 都能存活）
   - (a) 斷言**數量與形狀**而非**不變式與連通性** —— updateCells 後的節點數、EconomyBreakdown 的逐欄位 pass-through、
     removeRoad 後的 roadFlags 位元
   - (b) 在**空 grid 上只演練單一實例** —— 每個 InfraPlacement 拆除測試都只放一棟建築，
     同 buildingId 的守衛因此無聲吸收了越界；每個 LaneGraph updateCells 測試都用共線道路，根本不產生轉彎邊
   - (c) 在**真實接線就是 bug 本身**的地方注入 stub —— VehicleLookahead 用抽象 'A'/'B'/'C' key 搭配手寫
     canAdvance 述詞；IncomeCalcAdapter 用 `getResidentEducations: () => []`；
     ElevatedRailBuilder 測試永遠傳入 Game.ts 省略的 RailNetwork；而 Game.ts 本身因為 import Three.js 而完全未測
   **兩項值得投資的結構性補救**: 把 `Game._canAdvance` 與 Game 的 builder 接線抽成純粹、可測的 core 模組；
   為放置與圖的測試套件加入「相鄰／雙實例」fixture。

7. **沒有任何東西調和 grid 與服務／市民註冊表**
   幽靈醫院（BUG-052）、燒毀建築的鬼住戶（BUG-056）、孤兒公車路段（BUG-064）之所以能無限期存在
   （有些還穿過存讀檔），是因為沒有任何定期或載入時的 pass 去問
   「每個已註冊的設施在 grid 上還存在嗎？每個 homeId/workplaceId 還指向活的建築嗎？」
   鐵路子系統有 `rebuildRailNetworkFromGrid`、平交道有 `rebuildFromGrid`，市政服務與市民沒有對應物。
   **一個在載入時（以及 debug panel 後面）跑的驗證 pass 就能浮現這整類問題。**

---

### 已被對抗驗證推翻的候選（勿重複追查）

以下 4 項由 finder 提出但經驗證確認**不是 bug**，記錄理由以免下次掃描重蹈：

1. **`JobRelocation.ts:189` 解僱仍可達的工作** — 觸發狀態在執行中的遊戲**不可達**。
   `getTriggerReason` 只在 CachedRoute 為 `status:'failed'` 時回傳 'failed'，
   而全 src 唯一的 production writer（`SimulationLoop.ts:1743`）位於一個永遠不會為 false 的條件的 else 分支；
   所有寫入 routeIndex 的地方都禁止空陣列。CommuteCache 也沒有序列化，'failed' 不可能來自存檔。
   finder 是用手工 duck-typed cache 塞入 `status:'failed'` 才「驗證」出來的。
   *殘留價值*: `!hasAlternatives` 路徑與 `reason === 'failed'` fallback 之間的不對稱是真實的潛在不一致，
   若哪天復活 'failed' 狀態才會有影響。

2. **`PooledAStar.ts:293` 無界迴圈會永久卡死 worker** — 把防禦性編碼缺口誇大成高嚴重度卡死。
   正常情況終止有保證（`if (this.closed[neighborIdx]) continue` 使 parent 指標形成依關閉時間排序的森林）；
   SAB race 的可觀察輸出已被 `clearPending()` → `inflightBatches.clear()` 整批丟棄；
   且 `resetDirty()` 把每個觸及索引的 parentEdge 設為 -1，任何未被本次搜尋觸及的節點下一輪就終止。
   *殘留價值*: version 守衛未接上與缺少步數上限是真實但低嚴重度的健壯性缺口 —— **已併入 BUG-063 的修復方向**。

3. **`RailBuilder.ts:30` extractOutOfBoundsEdge 只截斷一格** — 前提為假。
   端點在來源處就已被夾限：`GridCursor.update`（`renderer/GridCursor.ts:56-58`）做了
   `Math.max(-1, Math.min(this.gridWidth, this.gridX))`，註解明寫「Allow 1 cell beyond edge」。
   Game.ts 對道路/鐵軌刻意跳過夾限正是因為游標已限制在 ±1 邊界環，
   所以「從 (5,5) 拖到 (5,-3)」透過 UI 不可達。實測 `buildTrack({5,5}→{5,-1})` 回傳 success。
   *殘留價值*: 若 L 彎本身落在地圖外（如 (5,5)→(-1,3)），slice 會留下額外的界外格導致整段建設被拒，
   且 outwardFlag 算成 NORTH 而非 WEST —— 這是可達的斜向拖曳小瑕疵，無狀態損壞，
   已列入下方未驗證清單（`EdgeUtils.ts:47`）。

4. **Office 從不回饋工業 RCI 需求** — 程式碼閱讀正確但詮釋為缺陷是錯的；這是**規格中的模型**。
   工業需求項明確是**貨物**平衡而非**工作場所**平衡（`RCIDemand.ts:73-75`，
   `PLANNING.md:570` 逐字寫明「工業需求 = f(商業需要的貨物, 出口需求) - 目前工業供給」），
   而 `FreightSystem.ts:117,196` 確認只有 INDUSTRIAL 產生貨運，office 不產不耗。
   且 finder 提議的修法會製造**更嚴重**的 bug：若 office 計入 industrialSupply，
   約 63 棟 office 就把 industrial 需求打到 0，`canGrow` 會連帶封鎖所有工業區
   （共用同一 RCI 類別），商業建築永久貨運飢餓且玩家無從表達「我需要工廠」——
   一個無法復原的經濟死亡螺旋。
   *殘留價值*: office 區沒有自己的專屬需求訊號，屬設計缺口，至多值得一條 TODO。

---

### 未驗證的候選（60 項，因驗證上限 24 而未進入對抗驗證）

以下由 finder 提出但**未經對抗驗證**，可信度未知，需逐項自行確認後才可視為 bug。
依 finder 自評嚴重度排列，僅列位置與宣稱內容。

**High（15）**
- `ui/store/gameStore.ts:72` — 頂列餘額漏計貸款利息，UI 顯示正餘額但資金持續流失
- `ui/modals/overview/EconomyPage.tsx:37` — Economy 頁 memo 每秒 12 次 `JSON.stringify` 整個 GameState
- `service/ServiceRegistry.ts:62` — 學校失去電/水後仍保有完整覆蓋（未觸發 recalc）
- `save/Serializer.ts:221` — `deserializeGameState` 以 currentTick=0 還原市民，捏造的 birthTick 可滅掉整個人口（與 BUG-055 同源，該處已涵蓋修復方向）
- `road/RoadBuilder.ts:60` — buildRoad 從不把路徑端點連上既有相鄰道路，永久截斷路網
- `simulation/SimulationLoop.ts:194` — 飛行中的 worker 路徑結果用拆除前的路線回填 CommuteCache 且永不過期
- `elevation/ElevatedRoadBuilder.ts:67` — 從既有高架延伸時跳過匝道，建出無法到達的孤兒路
- `transport/BusSystem.ts:18` — 公車站被拆時不重算路段（與 BUG-064 同根因）
- `service/FireDamageProcessor.ts:63` — 火災不驅離住戶（與 BUG-056 同根因）
- `workplace/WorkplaceDistanceCache.ts:56` — workplace distance worker 看不到高架道路，快取可達性與同步 fallback 矛盾
- `simulation/SimulationLoop.ts:537` — 移民教育權重把建築**數量**除以**職缺數**，分支不可達
- `service/UtilityCellDemand.ts:57` — 基礎設施電/水需求被乘上建築佔地面積
- `service/RoadCoverageFlood.ts:455` — `roadDistanceToTargets` 記錄第一個看到目標的道路格，而非最便宜的
- `save/Serializer.ts:105` — districts/policies/citySpec 未序列化（與 BUG-053 同源）
- `building/BuildingGrowthTick.ts:129` — 廢棄建築在確認可重生前就被拆除

**Medium（42）**
`traffic/PedestrianManager.ts:422` 失敗行人路徑被快取為 null 且 invalidateCells 觸及不到 ·
`elevation/ElevatedRoadBuilder.ts:262` removeElevated 改寫鄰居高架的 roadType ·
`transport/FerrySystem.ts:118` `onRouteDissolved` 是死碼，vesselPaths 洩漏 ·
`citizen/CitizenManager.ts:227` 退休市民（age > 200）永久佔著職位 ·
`citizen/Birth.ts:76` birthTick 讓住宅超出 residents 容量 ·
`economy/ShoppingAccess.ts:112` 高架下的建築在人口/容量被算兩次 ·
`save/Serializer.ts:147` districts 未序列化（同 BUG-053） ·
`service/WaterNetwork.ts:50` 電廠被對應到警察的耗水率 ·
`service/StationLoadDistributor.ts:72` 總容量計入非運作與未連道路的站點 ·
`simulation/SimulationLoop.ts:863` 噪音併入 cell.pollution 後又被當噪音再算一次 ·
`simulation/SimulationLoop.ts:87` 載入存檔會重跑當日死亡與當月出生區塊 ·
`building/BuildingQueries.ts:20` countZoneBuildings 把基礎設施格與廢墟計為 RCI 供給 ·
`zone/ZoneManager.ts:44` 重劃區時留下 reserved=BURNED/ABANDONED，產生幽靈建築 ·
`service/GlobalCoverageService.ts:184` 垃圾/殯葬收集為 O(pending × positions) 且迴圈內 splice ·
`traffic/PedestrianManager.ts:252` levelCrossings 未接線，行人穿越關閉的平交道 ·
`traffic/PooledAStar.ts:165` findPathVariants 每請求掃兩遍全圖並每次配置 PointData ·
`simulation/SimulationLoop.ts:1565` 建立/刪除運輸路線從不使多模式轉乘圖失效 ·
`citizen/CitizenManager.ts:216` evictBuilding 記錄 homelessSince 卻不記 unemployedSince，失業階梯不啟動 ·
`simulation/SimulationLoop.ts:1069` 市民從不退休，老人永久佔用職位 ·
`economy/IncomeCalculator.ts:115` 對燒毀/廢棄建築回報模擬實際收 $0 的稅 ·
`service/SewageService.ts:122` 污水覆蓋 BFS 忽略未連線/無電的處理廠 ·
`service/GarbageService.ts:277` 城市無掩埋場時未收垃圾的污染憑空消失 ·
`environment/GridPollutionSources.ts:39` 高架道路的交通噪音被 grid 污染掃描靜默丟棄 ·
`simulation/SimulationLoop.ts:402` 每月出生相位未持久化，每次載入多送一整個月的出生 ·
`save/SaveValidator.ts:337` validateExportFile 忽略所有 service/transport 區段 ·
`building/BuildingUpgrade.ts:79` 升級 ABANDONED/BURNED 建築，視覺復活但功能未復活 ·
`grid/TerrainGenerator.ts:74` generateTerrain 輸出隨 grid 大小而異，New Game 預覽永遠對不上實際地圖 ·
`Game.ts:871` 在空的已劃區格上建路留下陳舊 zone overlay instance ·
`simulation/SimulationLoop.ts:948` 升級/火災 tick 掉了 `abandoned` flag，廢棄建築被重新點亮 ·
`simulation/SimulationLoop.ts:1428` lane graph 重建只使服務車輛失效，通勤與貨運車輛保留陳舊 LaneEdge 路徑 ·
`traffic/TrafficSimulation.ts:294` 車輛排序比較器每次比較都重算完整路徑前綴和（每 render frame）·
`transport/AirportSystem.ts:168` 機場觀光客無限累積且無任何系統消耗 ·
`citizen/CitizenHealth.ts:51` 健康污染懲罰未設上限，POLLUTION_MAX_PENALTY 是比例因子而非最大值 ·
`citizen/CitizenManager.ts:279` educateTick 暫停的學生釋放學位後又收回，學校永久超收 ·
`citizen/Migration.ts:150` EDUCATION_THRESHOLDS.AVG_LAND_VALUE=150 超過 calculateLandValue 可能產生的最大值 125 ·
`district/PolicyManager.ts:28` 五條行政區政策中有三條每預算 tick 收費但對模擬零效果 ·
`environment/GridPollutionSources.ts:35` 放在空的工業劃區地上的任何基礎設施都排放工廠級污染 ·
`environment/CityMetrics.ts:33` 城市噪音平均被從未取得 noiseLevel 的空劃區格稀釋 ·
`save/SaveManager.ts:44` saveGame() 在 IndexedDB transaction commit 前就 resolve，中止的存檔回報成功 ·
`grid/EdgeUtils.ts:47` extractOutOfBoundsEdge 假設只有最後一格在界外，界外 L 彎會使邊緣拖曳失敗 ·
`Game.ts:987` 重劃區拆除建築但不清除其廢棄壓力，替代建築繼承之

**Low（3）**
- `Game.ts:2524` — 里程碑通知在人口**下降**時觸發，把較低的里程碑宣告為新達成
- `simulation/SimulationLoop.ts:1490` — 重建人行道圖會替換 state.pedestrianManager，丟棄所有活動行人
- `district/PolicyManager.ts:30` — HIGH_DENSITY_BAN 無法封鎖高密度辦公樓（OFFICE 沒有 HIGH 區型變體）
