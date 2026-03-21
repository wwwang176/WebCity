# 除錯工具與檢視模式

---

## 除錯工具 (DebugTools)

Developer Debug Panel 提供即時調整遊戲參數和檢視遊戲狀態的功能。

### 即時快照 (DebugSnapshot)

| 資訊 | 說明 |
|------|------|
| tick | 當前模擬 tick |
| funds | 現金 |
| income / expenses | 每 tick 收入/支出 |
| population | 人口 |
| vehicleCount | 道路上的車輛數 |
| buildingCount | 區域建築數 |
| infraCount | 基礎設施數 |
| roadCount | 道路格數 |
| rciDemand | RCI 需求值 |
| powerSupply / waterSupply | 電力/供水總供給 |
| avgHappiness | 平均幸福度 |
| avgLandValue | 平均地價 |
| avgPollution | 平均污染 |
| taxRate | 住宅稅率 |
| speed | 遊戲速度 |

### 可調整參數

| 參數 | 範圍 | 說明 |
|------|------|------|
| funds | 0 ~ 99,999,999 | 直接設定現金 |
| speed | 1 ~ 10 | 遊戲速度 |
| taxRate | 0 ~ 30 | 住宅稅率 |
| businessTaxRate | 0 ~ 30 | 營業稅率（同時設定商業/工業/辦公） |

---

## 檢視模式 (ViewMode)

控制 3D 場景中各物件的可見性和透明度。

### 可用模式

| 模式 | 說明 | 聚焦內容 |
|------|------|---------|
| NORMAL | 正常地面視角 | 全部可見 |
| UNDERGROUND | 地下模式 | 地鐵隧道和列車 |
| RAIL_FOCUS | 鐵路聚焦 | 軌道、火車、平交道 |
| FERRY_FOCUS | 渡輪聚焦 | 水面、渡輪 |
| BUS_FOCUS | 公車聚焦 | 道路、公車 |

### 透明度設定

| 元素 | NORMAL | UNDERGROUND | RAIL_FOCUS | FERRY_FOCUS | BUS_FOCUS |
|------|--------|-------------|------------|-------------|-----------|
| 建築 | 1.0 | 0.125 | 0.125 | 0.125 | 0.125 |
| 道路 | 1.0 | 0.15 | 0.15 | 0.15 | 1.0 |
| 地形 | 1.0 | 0.2 | 0.2 | 1.0 | 0.2 |
| 地面車輛 | 1.0 | 0.08 | 0 | 0 | 0 |
| 地鐵隧道 | 0 | 1.0 | 0 | 0 | 0 |
| 地鐵列車 | 0 | 1.0 | 0 | 0 | 0 |
| 軌道 | 1.0 | 0.15 | 1.0 | 0.15 | 0.15 |
| 平交道 | 1.0 | 0 | 1.0 | 0 | 0.15 |

### 車輛可見性

| 模式 | 可見車輛類型 |
|------|------------|
| NORMAL | 全部 |
| UNDERGROUND | 無（地面車輛不可見） |
| RAIL_FOCUS | rail_train, rail_carriage |
| FERRY_FOCUS | ferry |
| BUS_FOCUS | bus, transport_bus |

### 交通站點對應的聚焦模式

| 站點類型 | 對應模式 |
|---------|---------|
| 地鐵站 | UNDERGROUND |
| 火車站 | RAIL_FOCUS |
| 碼頭 | FERRY_FOCUS |
| 公車站 | BUS_FOCUS |

### 地下隧道位置

地鐵隧道的 Y 座標: `-0.15`（地面以下）
