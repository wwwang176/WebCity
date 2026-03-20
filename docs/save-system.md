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

系統定期自動存檔到指定欄位。

---

## 序列化 (Serializer)

`Serializer` 負責將 GameState 轉換為 JSON 字串，以及從 JSON 恢復 GameState。

### 序列化項目

所有子系統都支援 `toJSON()` / `fromJSON()` 介面：
- Grid（格子資料，使用差分壓縮——只儲存與預設值不同的格子）
- 市民列表
- 預算狀態
- 稅率
- 各服務狀態
- 交通路線和站點
- 區域和政策
- 全球市場

### 存檔遷移 (migrations)

`migrations.ts` 處理舊版存檔的格式升級，確保向後相容。
