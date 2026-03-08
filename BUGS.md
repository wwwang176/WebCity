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

### 未完成功能
- ⚠️ 部分進階子系統未整合（BUG-011：污染、地價、建築升級等）
