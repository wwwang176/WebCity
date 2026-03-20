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

**目前版本**: `CURRENT_SAVE_VERSION = 3`

**遷移機制**:
1. 載入存檔時檢查 `version` 欄位
2. 依序執行所有 `version > 存檔版本` 的遷移
3. 每個遷移直接修改 GameState（in-place mutation）
4. 完成後更新版本號

**已有遷移**:
- Version 2: `fix_intersection_roadtype` — 修正路口處低階道路覆蓋高階道路的問題
- Version 3: 市民年齡系統從 float 改為 birthTick-based

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
