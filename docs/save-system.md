# 存檔系統 (Save System)

WebCity 使用 IndexedDB 進行本地存檔。

---

## 存檔結構

### SaveSlot

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | number | 存檔欄位 ID |
| `name` | string | 存檔名稱 |
| `date` | string | 儲存時間 (ISO 8601) |
| `data` | string | JSON 序列化的遊戲狀態 |
| `population` | number? | 人口數（用於存檔列表顯示） |

### IndexedDB 設定

- **資料庫名稱**: `webcity-saves`
- **物件儲存**: `saves`
- **版本**: 1
- **主鍵**: `id`

---

## 存檔操作

| 操作 | 函式 | 說明 |
|------|------|------|
| 儲存 | `saveGame(slotId, name, data, population?)` | 寫入或覆蓋存檔欄位 |
| 讀取 | `loadGame(slotId)` | 讀取存檔欄位 |
| 列表 | `listSaves()` | 列出所有存檔 |
| 刪除 | `deleteSave(slotId)` | 刪除存檔欄位 |

---

## 自動存檔 (AutoSave)

自動存檔每 100 ticks 觸發一次（預設間隔）。第 0 tick 不存檔。

---

## 序列化 (Serializer)

`Serializer` 負責將 GameState 轉換為 JSON 字串，以及從 JSON 恢復 GameState。

### 序列化格式

```typescript
SerializedState {
  version: number;       // 存檔版本號
  grid: {
    width, height,
    cells: SerializedCell[]  // 只儲存與預設值不同的格子
  };
  clock: { tick, speed, paused };
  budget: { funds, income, expenses, loans, loanInterestRate };
  taxRates: { residential, commercial, industrial, office, business? };
  powerPlants?: PowerPlant[];
  waterPlants?: WaterPlant[];
  citizens?: Citizen[];
  // + 各服務系統的 toJSON() 資料
  // + 交通系統的 toJSON() 資料
  // + 區域和政策資料
  // + 全球市場資料
}
```

### 差分壓縮

Grid 序列化只儲存與 `DEFAULT_CELL` 不同的格子。空格子不佔空間。

```
getCellDiff(cell) → 只包含與預設不同的屬性
isCellDefault(cell) → 全部屬性與預設相同則跳過
```

### 序列化項目

所有子系統都支援 `toJSON()` / `fromJSON()` 介面：
- Grid（格子資料，差分壓縮）
- 市民列表（完整屬性）
- 預算狀態
- 稅率
- 電力/供水（電廠/水廠列表）
- 警察/消防/醫療/教育/公園/垃圾/污水/殯葬（設施列表 + 狀態）
- 公車/地鐵/鐵路/渡輪/機場（站點 + 路線 + 車輛）
- 區域和政策
- 全球市場（價格 + 供給壓力）

### 存檔遷移 (migrations)

`migrations.ts` 處理舊版存檔的格式升級，確保向後相容。

**目前版本**: `CURRENT_SAVE_VERSION = 4`

**遷移機制**:
1. 載入存檔時檢查 `version` 欄位
2. 依序執行所有 `version > 存檔版本` 的遷移
3. 每個遷移直接修改 GameState（in-place mutation）
4. 完成後更新版本號

**已有遷移**:
- Version 2: `fix_intersection_roadtype` — 修正路口處低階道路覆蓋高階道路的問題
- Version 3: `convert_citizen_age_to_life_weeks` — 市民年齡系統從 float 改為 birthTick-based，分段線性映射保留生命階段邊界
- Version 4: `update_facility_balance_constants` — 將所有設施（醫院、警局、消防局、學校、垃圾場、墓園、公園）的容量和半徑更新為程式碼中的最新常數值

### 轉乘使用歷史持久化

TransferTracker 的 7 天環形緩衝區和每日滾動狀態（`lastTransferDay`）會隨存檔持久化，載入時恢復完整的轉乘統計歷史。

**新增遷移步驟**:
1. 遞增 `CURRENT_SAVE_VERSION`
2. 在 `MIGRATIONS` 陣列新增 `{ version, name, migrate }` 項目

---

## Web Worker 整合

### 通勤路徑 Worker (PathWorkerClient)

批次尋路請求發送到 Web Worker，避免阻塞主執行緒：
- 批次提交多個起訖點
- Worker 計算 LaneEdge 路徑
- Promise-based 非同步回傳

### 工作場所距離 Worker (WorkplaceDistanceClient)

預計算從所有工作場所到可達格子的道路距離：
- 使用 SharedArrayBuffer 傳遞網格資料
- 計算結果為 `workplace → (cell → cost)` 映射表
- 結果快取在 `WorkplaceDistanceCache` 中
- 道路或建築變更時標記失效，下次 tick 重新計算

---

## 存檔匯出入（Import/Export）

`ImportExport.ts` 提供存檔的檔案匯出與匯入功能，讓玩家可以在不同裝置間分享存檔。

### 匯出檔案格式（ExportFile）

匯出檔案為 JSON 格式，副檔名為 `.webcity.json`，結構如下：

```typescript
interface ExportFile {
  format: 'webcity-save';      // 固定識別字串
  exportVersion: 1;            // 匯出格式版本
  exportedAt: string;          // 匯出時間 (ISO 8601)
  slot: {
    name: string;              // 存檔名稱
    date: string;              // 原始儲存時間
    data: string;              // JSON 序列化的遊戲狀態（與 SaveSlot.data 相同）
    population?: number;       // 人口數
  };
}
```

### 匯出流程

| 函式 | 說明 |
|------|------|
| `buildExportPayload(slot)` | 從 `SaveSlot` 建立 `ExportFile` JSON 物件，包含 `format`、`exportVersion`、`exportedAt`、`slot` 四個欄位 |
| `exportSaveToFile(slot)` | 完整匯出流程：呼叫 `buildExportPayload` 產生 JSON → 建立 `Blob` → 透過隱藏 `<a>` 元素觸發瀏覽器下載，檔名為 `{存檔名稱}.webcity.json`（特殊字元替換為底線） |

### 匯入流程

匯入分為兩層 API：

| 函式 | 說明 |
|------|------|
| `parseAndValidateImport(fileContent)` | **純驗證**（不涉及 IndexedDB）。依序執行：檔案大小檢查 → JSON 解析 → Prototype pollution 檢測 → `validateExportFile` 完整驗證。回傳 `{ ok, data, name, warnings }` 或 `{ ok: false, errors }` |
| `importSaveFromFile(fileContent, options?)` | **完整匯入管線**。呼叫 `parseAndValidateImport` 驗證後，自動尋找下一個可用的 slot ID，將存檔寫入 IndexedDB。支援 `options.customName` 自訂存檔名稱。回傳 `ImportResult { success, slotId, saveName, warnings, errors }` |

### 匯入結果（ImportResult）

```typescript
interface ImportResult {
  success: boolean;
  slotId?: number;       // 寫入的存檔欄位 ID
  saveName?: string;     // 最終使用的存檔名稱（經過 sanitize）
  errors?: string[];     // 驗證失敗的錯誤訊息
  warnings?: string[];   // 非致命警告
}
```

---

## 深度驗證（SaveValidator）

`SaveValidator.ts` 提供匯入存檔的多階段驗證，防止惡意檔案與資料損壞。

### 四階段驗證流程

`validateExportFile(raw)` 執行以下四個階段：

1. **外層結構檢查**（`validateExportWrapper`）— 驗證 `format` 為 `'webcity-save'`、`exportVersion` 為數字、`slot` 物件存在且包含 `name`（字串）與 `data`（字串）
2. **JSON 解析**— 將 `slot.data` 字串以 `JSON.parse` 解析，解析失敗直接拒絕
3. **Prototype Pollution 檢測**（`checkPrototypePollution`）— 遞迴掃描整個物件樹，偵測 `__proto__`、`constructor`、`prototype` 等危險屬性名稱。陣列元素也會被遞迴檢查。發現任一危險 key 即拒絕整份檔案
4. **逐區段驗證**— 依序驗證以下區段，任一區段失敗即回報錯誤：

| 驗證函式 | 檢查內容 |
|----------|----------|
| `validateVersion(version)` | 必須為正整數，且不超過 `CURRENT_SAVE_VERSION` |
| `validateGrid(grid)` | `width`/`height` 為正整數且 <= `MAX_GRID_DIMENSION`；每個 cell 的 `x`/`y` 在範圍內；cell 資料的 `terrainType`、`zoneType`、`roadType`、`railType`、`roadFlags`（0-15）、`railFlags`（0-15）、`buildingId`、`reserved` 均須為合法列舉值 |
| `validateClock(clock)` | `tick` 為非負整數；`speed` 必須為 0/1/3/5/10 之一；`paused` 為布林值 |
| `validateBudget(budget)` | `funds`/`income`/`expenses`/`loans`/`loanInterestRate` 皆為有限數字 |
| `validateTaxRates(rates)` | `residential`/`commercial`/`industrial`/`office` 為 0-100 的數字；`business` 為選填（向後相容） |
| `validateCitizens(citizens)` | 選填。陣列長度 <= `MAX_CITIZENS`；每位市民的 `age` 為 0 到 `MAX_AGE` 的數字；`lifeStage` 與 `education` 須為合法列舉值 |

### 匯入限制常數（IMPORT_LIMITS）

| 常數 | 值 | 說明 |
|------|-----|------|
| `MAX_FILE_SIZE` | 50 MB (50 * 1024 * 1024) | 檔案大小上限 |
| `MAX_GRID_DIMENSION` | 500 | 地圖寬/高上限 |
| `MAX_CITIZENS` | 500,000 | 市民數量上限 |
| `MAX_SAVE_NAME_LENGTH` | 100 | 存檔名稱字元數上限 |

### 安全防護

- **`checkPrototypePollution(obj)`**：遞迴檢查物件所有 key，偵測 `__proto__`、`constructor`、`prototype`。對陣列也會逐元素遞迴掃描
- **`sanitizeSaveName(name)`**：移除 HTML 特殊字元（`<`、`>`、`&`、`"`、`'`），並截斷至 `MAX_SAVE_NAME_LENGTH`（100 字元），防止 XSS 注入
