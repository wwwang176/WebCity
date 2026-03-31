# 貨運系統 (FreightSystem)

工業區生產貨物，透過道路網路供應商業區消費。不足的部分可經由鐵路車站、機場、高速公路邊緣進口；過剩的部分則可出口。

---

## 架構概覽

貨運系統由三個模組協作：

| 模組 | 檔案 | 職責 |
|------|------|------|
| `FreightSystem` | `src/core/traffic/FreightSystem.ts` | 兩階段 BFS 供貨計算、SupplyStatus 管理、過剩/缺貨指標 |
| `FreightTradeCollector` | `src/core/traffic/FreightTradeCollector.ts` | 收集貿易基礎設施位置與吞吐量（SRP 拆分自 SimulationLoop） |
| `FreightPage` | `src/ui/modals/overview/FreightPage.tsx` | City Overview 貨運分頁 UI |

SimulationLoop 每 6 ticks（Slot 5）調用 `collectTradePositions()` 收集貿易設施，再呼叫 `FreightSystem.calculateSupply()` 執行 BFS。

---

## 生產與消耗速率

### 工業生產量（`INDUSTRIAL_PRODUCTION`）

| 建築 | Building ID | 等級 | 產量/tick |
|------|-------------|------|----------|
| Small Factory | 13 | Lv1 | 3 |
| Medium Factory | 14 | Lv2 | 5 |
| Large Factory | 15 | Lv3 | 8 |

### 商業消耗量（`COMMERCIAL_CONSUMPTION`）

| 建築 | Building ID | 密度 | 等級 | 消耗/tick |
|------|-------------|------|------|----------|
| Small Shop | 7 | 低密度 | Lv1 | 1 |
| Medium Shop | 8 | 低密度 | Lv2 | 2 |
| Large Shop | 9 | 低密度 | Lv3 | 3 |
| Small Mall | 10 | 高密度 | Lv1 | 8 |
| Medium Mall | 11 | 高密度 | Lv2 | 14 |
| Department Store | 12 | 高密度 | Lv3 | 20 |

可透過 `getProductionRate(buildingId)` / `getConsumptionRate(buildingId)` 查詢。

---

## 兩階段 BFS 供貨（`calculateSupply()`）

### Phase 1：本地供應（Local BFS）

從所有工廠同時出發的 BFS，共享總產量作為 `localBudget`：

1. 掃描 Grid 收集所有工廠（`ZoneType.INDUSTRIAL` + `buildingId > 0`）為種子點
2. 彙總 `totalProduction`（全部工廠產量之和）與 `totalConsumption`（全部商業消耗之和）
3. BFS 沿道路與建築格擴散，遇到商業建築（`isCommercialZone`）時：
   - 計算 `supplied = min(demand, localBudget)`
   - 扣減 `localBudget -= supplied`
   - 寫入 `SupplyStatus { source: 'local', ratio: supplied / demand }`
4. **按比例供應**：budget 不足時給予部分 ratio（例如 budget=3, demand=8 → ratio=3/8=0.375）
5. BFS 不因供應不足而停止：遇到無法完全供應的建築會設定部分 ratio 後繼續擴散

### Phase 2：貿易供應（Trade BFS）

從外部貿易設施出發的第二輪 BFS，處理進口與出口：

1. 種子點由 `FreightTradeCollector.collectTradePositions()` 提供（見下節）
2. BFS 使用 `importBudget`（= 總貿易吞吐量）沿道路擴散：
   - **進口**：遇到未滿供應或無供應的商業建築 → 計算 `remaining = demand - alreadySupplied`，用 `importBudget` 補足 → 標記 `source: 'imported'`
   - **出口標記**：遇到工廠（`ZoneType.INDUSTRIAL`）→ 加入 `exportableFactorySet`
3. 進口也支援按比例供應：`importBudget` 不足時部分供應
4. 出口計算：`exported = min(surplus, exportableProduction, exportCapacity)`
   - `surplus = totalProduction - totalConsumption`
   - `exportableProduction` = 僅計算 BFS 可達的工廠產能

---

## FreightTradeCollector

`collectTradePositions()` 從三種貿易基礎設施收集 BFS 種子點：

```typescript
interface TradePosition {
  x: number; y: number;
  throughput: number;
  tradeKey: string;  // 同一建築的多個道路入口共用 tradeKey
}
```

### 收集來源

| 設施類型 | 來源 | 吞吐量欄位 |
|---------|------|-----------|
| 鐵路車站 | `RailNetwork` 提供有外部連接的車站 | `station.throughput` |
| 機場 | `AirportSystem.getAirports()` | `airport.cargoPerTick` |
| 高速公路邊緣格 | `HighwayConnection.getEdgeHighwayCells()` | `HighwayConnection.getThroughput()` 平分至各格 |

### 道路鄰接收集（`collectAdjacentRoadCells()`）

鐵路車站與機場是多格建築（2x2 或更大），`collectAdjacentRoadCells()` 會：
1. 查詢 `InfraConfig` 取得建築尺寸（`width × height`）
2. 遍歷建築所有格的四方向鄰居
3. 找出所有相鄰道路格作為 BFS 種子點
4. 同一建築的所有道路入口共用相同 `tradeKey`，避免重複計算吞吐量

若建築周圍無道路，退化為建築本身位置作為種子點。

---

## 供貨狀態（SupplyStatus）

每棟商業建築持有一個 `SupplyStatus`：

```typescript
interface SupplyStatus {
  source: 'local' | 'imported' | 'none';
  ratio: number;  // 0~1: 需求被滿足的比例
}
```

| source | ratio | 說明 |
|--------|-------|------|
| `local` | 0~1 | 完全由本地工廠 BFS 供應（Phase 1） |
| `imported` | 0~1 | 有進口貨物參與補足（Phase 2 介入） |
| `none` | 0 | 兩階段 BFS 皆未到達 |

查詢 API：
- `getSupplyStatus(x, y)` → `SupplyStatus`（未計算過則預設 `{ source: 'local', ratio: 1 }`）
- `isSupplied(x, y)` → `boolean`（ratio > 0 即為 true，向下相容）
- `getSuppliedCount()` / `getLocalSuppliedCount()` / `getImportedCount()` → 各狀態的商業建築數量

---

## 進出口貿易（Import / Export）

### 貿易設施前提條件

| 設施 | 連接條件 |
|------|---------|
| 鐵路車站 | 車站必須透過鐵軌 BFS 連通到地圖邊緣（閉環鐵路不算） |
| 機場 | 有機場建築即可（不需外部連接） |
| 高速公路 | 高速公路格位於地圖邊緣且方向朝內（`hasExternalConnection`） |

### 吞吐量

| 設施 | 吞吐量/tick | 常數 |
|------|-----------|------|
| 每座外部鐵路車站 | 50 | `TRADE.RAIL_THROUGHPUT_PER_STATION` |
| 機場 (SMALL) | 20 | `AIRPORT_SIZE_CONFIG.SMALL.cargo` |
| 機場 (MEDIUM) | 100 | `AIRPORT_SIZE_CONFIG.MEDIUM.cargo` |
| 機場 (LARGE) | 300 | `AIRPORT_SIZE_CONFIG.LARGE.cargo` |
| 每個高速公路邊緣格 | 30 | `HIGHWAY_EXTERNAL.THROUGHPUT_PER_CONNECTION` |

多設施吞吐量疊加。進出口共用吞吐量上限（`importCapacity = exportCapacity = totalThroughput`）。

### 收入倍率

| 供貨來源 | 收入倍率 | 說明 |
|---------|---------|------|
| 本地供應 (`local`) | × 1.0 | 無懲罰 |
| 進口供應 (`imported`) | × 0.7 | `TRADE.IMPORT_INCOME_MULTIPLIER` |
| 出口收入 | × 0.5 | `TRADE.EXPORT_INCOME_MULTIPLIER` |
| 無供應 (`none`) | × 0.5 | 最低收入 |

實際收入計算結合 ratio：
- 本地：`× (0.5 + 0.5 × ratio)`
- 進口：`× 0.7 × ratio + 0.5 × (1 - ratio)`

### 進口流程（Supply Rate < 100%）

- Phase 2 BFS 從貿易設施出發，供應 Phase 1 未覆蓋或部分覆蓋的商業
- 離貿易設施遠的商業拿不到進口（BFS 可達性限制）
- 已有 local 部分供應的建築會被「補足」（ratio 提升），source 改為 `imported`

### 出口流程（Supply Rate > 100%）

- Phase 2 BFS 標記可達的工廠加入 `exportableFactorySet`
- 出口量 = `min(surplus, exportableProduction, exportCapacity)`
- 離貿易設施遠的工廠無法出口（`isFactoryExporting(x, y)` 判定）
- 出口降低有效 surplusRatio

### 貿易設施位置策略

- 蓋在商業區旁 → 有效進口
- 蓋在工業區旁 → 有效出口
- 蓋在中間 → 兩邊都能顧到

---

## 過剩計算（`getSurplusRatio()`）

```
surplus = production - consumption
effectiveSurplus = max(0, surplus - exported)
surplusRatio = min(1, effectiveSurplus / consumption)
```

出口會降低有效過剩。`consumption = 0` 或 `production <= consumption` 時 surplusRatio = 0。

---

## 供貨對廢棄壓力的影響

- 商業缺貨：`(1 - ratio) × 6`（完全供應 = 0 壓力，完全缺貨 = +6）
- 工業過剩：`surplusRatio × 6`

---

## RCI 需求回饋

- 缺貨 → 商業需求降低（`shortageRatio × 10`）
- 過剩 → 工業需求降低（`surplusRatio × 10`）
- 系統自動趨向供需平衡

---

## Supply Rate 計算

```
effectiveProduction = production - exported + imported
Supply Rate = effectiveProduction / consumption
```

| Supply Rate | 顏色 | 意義 |
|-------------|------|------|
| < 50% | 紅 | 嚴重缺貨 |
| 50~80% | 黃 | 輕微缺貨 |
| 80~120% | 綠 | 平衡 |
| 120~150% | 黃 | 輕微過剩 |
| > 150% | 紅 | 嚴重過剩 |

---

## FreightPage UI（City Overview 貨運分頁）

`FreightPage` 元件（`src/ui/modals/overview/FreightPage.tsx`）提供即時貨運監控儀表板，分為四個區塊：

### 1. Supply Overview

- Supply Rate 百分比進度條（含色彩指示：綠/黃/紅）
- Production/tick 與 Consumption/tick 數值卡片

### 2. Commercial Supply 表格

| 欄位 | 說明 |
|------|------|
| Local Supply | `getLocalSuppliedCount()` — Phase 1 BFS 覆蓋的商業數 |
| Imported | `getImportedCount()` — Phase 2 BFS 進口補足的商業數 |
| Unsupplied | `totalCommercial - suppliedCount` — 完全無供應的商業數 |
| Total | 所有商業建築總數（Grid 掃描） |

### 3. Trade 區塊

- Import/Export 即時流量（units/tick）
- Trade Facilities 表格：列出鐵路（外部連接車站數/總車站數）、高速公路（連接數）、機場（各機場大小與 cargo），以及 Total Capacity
- 無外部連接的設施顯示紅色警告「(no edge connection)」

### 4. Income Impact

顯示四種供貨狀態的收入倍率說明：
- Local supply: ×1.0
- Imported goods: ×0.7
- Exported goods: ×0.5
- Unsupplied: ×0.5 + abandonment stress
