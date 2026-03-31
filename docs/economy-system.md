# 經濟系統 (Economy System)

WebCity 的經濟由稅收、支出、預算和全球市場組成。

---

## 稅制

### 稅率類型

| 稅種 | 預設值 | 適用對象 |
|------|--------|---------|
| `residential` (住宅所得稅) | 9% | 住宅建築中的居民 |
| `business` (營業稅) | 9% | 商業/工業/辦公建築 |

### 住宅稅收計算

```
每棟建築稅收 = Σ(每位居民: 基礎收入 × 教育薪資倍率) × 建築等級倍率 × 稅率
```

**基礎收入**: $0.50 per tick

**教育薪資倍率**:

| 教育 | 倍率 |
|------|------|
| NONE | 1.0× |
| ELEMENTARY | 1.1× |
| HIGH_SCHOOL | 1.3× |
| UNIVERSITY | 1.5× |

**住宅建築等級倍率**:

| 等級 | 倍率 |
|------|------|
| Level 1 | 1.0× |
| Level 2 | 1.15× |
| Level 3 | 1.3× |

### 營業稅收計算

```
每棟建築稅收 = companyIncome × 建築等級倍率 × 稅率
```

**商業建築等級倍率**:

| 等級 | 倍率 |
|------|------|
| Level 1 | 1.0× |
| Level 2 | 1.5× |
| Level 3 | 2.0× |

### 無收入條件

- **焦黑建築** (BURNED): 不產生收入
- **廢棄建築** (ABANDONED): 不產生收入
- **多格建築次格** (MULTI_CELL_OCCUPIED): 不重複計算
- **無電力**: 不產生收入

### 區域特化加成

如果建築位於有特化加成的區域，收入會乘以區域特化的 `revenueMultiplier`（特化加成表見[區域與政策 — 特化](district-policy-system.md#特化-specialization)）。

### 城市特化加成

城市特化的 `revenueMultiplier` 對**全城市總收入**生效（城市特化列表見[區域與政策 — 城市特化](district-policy-system.md#城市特化-cityspecialization)）。

### 地價對工業區的減免

計算地價時，工業區的污染和噪音只計算 20%（`INDUSTRIAL_POLLUTION_FACTOR = 0.2`），使工業區在高污染環境下仍能維持合理地價。

---

## RCI 需求系統

RCI（住宅-商業-工業）需求決定城市的建築成長方向。

### 需求公式

```
住宅需求 = clamp(工作機會 × 2 + 30 - 住宅供給, -100, 100)
商業需求 = clamp(人口 × 0.5 + 10 - 商業供給, -100, 100)
工業需求 = clamp(商業供給 × 0.8 + 出口需求 + 5 - 工業供給, -100, 100)
```

### 商業稅懲罰

當營業稅率 > 9%（基準線）時：
```
懲罰 = (稅率 - 9) × 2
商業需求 -= 懲罰
工業需求 -= 懲罰
```

---

## 商業可及性 (ShoppingAccess)

ShoppingAccess 使用 BFS flood-fill 演算法計算住宅與商業建築之間的供需平衡，範圍為同一連通道路網路內的所有建築。

### 演算法概要

`calculate(grid)` 執行一次性 flood-fill，遍歷整個 Grid 識別所有連通區塊（connected components）。BFS 擴展時透過 `UnifiedRoadLookup.getCompatibleNeighborKeys()` 實現**等級感知（level-aware）**——高架道路僅透過匝道連接，不會直接與地面道路互通。

流程：
1. 從每個未訪問的道路/建築/區域格子開始 BFS
2. 收集該連通區塊中所有住宅建築的人口（`residents`）與商業建築的容量（`workers`）
3. 計算區塊層級的供需比率

### 每棟建築指標

| 介面 | 適用對象 | 欄位 |
|------|---------|------|
| `ResidentialShoppingStatus` | 住宅建築 | `ratio: number` (0\~1), `hasAccess: boolean` |
| `CommercialCustomerStatus` | 商業建築 | `ratio: number` (0\~1), `hasCustomers: boolean` |

### 比率計算

```
住宅購物比率 = min(1, 商業容量 / 住宅人口)
商業客源比率 = min(1, 住宅人口 / 商業容量)
```

- 住宅人口為 0 時，住宅購物比率為 0
- 商業容量為 0 時，商業客源比率為 0

### 查詢 API

| 方法 | 回傳值 | 說明 |
|------|--------|------|
| `getResidentialAccess(x, y)` | `ResidentialShoppingStatus` | 取得住宅建築的購物可及性 |
| `getCommercialCustomers(x, y)` | `CommercialCustomerStatus` | 取得商業建築的客源狀態 |

若尚未執行過 `calculate()`，兩者皆回傳預設值（`ratio: 1`, access/customers = `true`）。若座標不在任何連通區塊中，回傳 `ratio: 0`, access/customers = `false`。

### 高架道路支援

透過 `UnifiedRoadLookup` 整合，BFS 會同時追蹤地面與高架層級的道路格子。高架道路僅在有匝道（ramp）連接時才與地面道路網路互通，確保路網連通性的正確判定。

### 建築類型識別

使用 `getBuildingType()` 取得每棟建築的 `residents`（住宅人口）與 `workers`（商業容量），搭配 `isResidentialZone()` / `isCommercialZone()` 判斷建築所屬區域類型。

---

## 支出

### 支出項目

| 項目 | 計算方式 |
|------|---------|
| 道路維護 | 道路格數 × $0.10/格/tick |
| 服務維護 | 所有市政服務的維護成本總和 |
| 區域政策 | 各區啟用的政策成本總和 |
| 交通營運 | 所有大眾運輸系統的營運成本 |
| 貸款利息 | 貸款金額 × 利率 |

### 經濟細目 (Economy Breakdown)

遊戲提供完整的經濟收支細目：

**收入面**: 住宅稅、商業稅、工業稅、辦公稅
**支出面**: 道路維護、貸款利息、電力成本、供水成本、交通成本

---

## 預算 (Budget)

### 預算狀態

```typescript
{
  funds: number;           // 現金
  income: number;          // 每 tick 收入
  expenses: number;        // 每 tick 支出
  loans: number;           // 貸款總額
  loanInterestRate: number; // 貸款利率
}
```

### 每 Tick 更新

```
餘額 = 收入 - 支出 - (貸款 × 利率)
現金 += 餘額
```

### 貸款

```
貸款(金額):
  現金 += 金額
  貸款總額 += 金額
```

---

## 地價 (Land Value)

### 基礎值: 50

### 加成因素

| 因素 | 效果 |
|------|------|
| 服務覆蓋 | +4 per coverage point |
| 公園鄰近 | +15 |
| 濱水 | +20 |

### 減損因素

| 因素 | 效果 |
|------|------|
| 污染 | -0.5 per point |
| 噪音 | -0.3 per point |
| 犯罪 | -0.4 per point |

### 範圍

0 ~ 255

### 公園鄰近判定

以下任一條件滿足即為有公園鄰近（公園服務詳見[市政服務 — 公園服務](services-system.md#公園服務-parkservice)）：
1. 有公園服務覆蓋
2. 曼哈頓距離 2 格內有森林地形
3. 曼哈頓距離 2 格內有公園建築 (buildingId=248)

---

## 全球市場 (Global Market)

### 資源類型

| 資源 | 基礎價格 |
|------|---------|
| OIL (石油) | $100 |
| ORE (礦石) | $80 |
| AGRICULTURE (農業) | $60 |
| ELECTRONICS (電子) | $150 |

### 市場機制

- **進口加價**: 進口價格 = 市場價 × 1.1（10% 加價）
- **價格波動**: 每 tick ±2% 隨機波動
- **供需影響**: 出口增加供給壓力（降價），進口增加需求壓力（漲價）
- **均值回歸**: 價格趨向基礎價格（回歸因子 1%/tick）
- **供給壓力衰減**: 每 tick × 0.9

### 價格範圍

- 最低: 基礎價 × 20%
- 最高: 基礎價 × 300%
