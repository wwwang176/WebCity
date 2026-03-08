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

### BUG-018: VehicleRenderer 從未接收車輛資料 — 看不到車輛
- **位置**: `src/renderer/VehicleRenderer.ts`, `src/core/traffic/TrafficSimulation.ts`
- **問題**: VehicleRenderer.update() 在遊戲循環中從未被呼叫，TrafficSimulation.vehicles 永遠為空
- **嚴重性**: 中
- **狀態**: 待做

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

### 未完成功能
- ⚠️ 車輛渲染（BUG-018：VehicleRenderer 未接收資料）
- ⚠️ 部分進階子系統未整合（BUG-011：污染、地價、建築升級等）
- ⚠️ 道路預估成本顯示（BUG-022 部分未完成）
