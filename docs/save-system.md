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

`migrations.ts` 處理舊版存檔的格式升級，確保向後相容。版本號遞增，每個遷移函式處理一個版本的升級。
