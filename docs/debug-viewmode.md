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
| TRANSFER_FOCUS | 轉乘聚焦 | 選定轉乘路線的建築與站點 |

### 透明度設定

| 元素 | NORMAL | UNDERGROUND | RAIL_FOCUS | FERRY_FOCUS | BUS_FOCUS | TRANSFER_FOCUS |
|------|--------|-------------|------------|-------------|-----------|----------------|
| 建築 | 1.0 | 0.125 | 0.125 | 0.125 | 0.125 | 0.15 |
| 道路 | 1.0 | 0.15 | 0.15 | 0.15 | 1.0 | 0.6 |
| 地形 | 1.0 | 0.2 | 0.2 | 1.0 | 0.2 | 0.25 |
| 地面車輛 | 1.0 | 0.08 | 0 | 0 | 0 | 0.1 |
| 地鐵隧道 | 0 | 1.0 | 0 | 0 | 0 | 0 |
| 地鐵列車 | 0 | 1.0 | 0 | 0 | 0 | 0 |
| 軌道 | 1.0 | 0.15 | 1.0 | 0.15 | 0.15 | 0.15 |
| 平交道 | 1.0 | 0 | 1.0 | 0 | 0.15 | 0.15 |

高架道路、路口號誌、路燈與人行道跟著「道路」那一欄走 —— 玩家看到的是同一條路，
只是高度不同。半透明時材質暫時蓋成中性灰，原色記在 `userData.baseColor`。

### 建築的白模

聚焦模式下所有建築烘成一份合併的白模網格。烘之前每份幾何先去索引、只留
`position` 與 `normal`：`mergeGeometries` 要求屬性集合完全一致，而城裡的模型
有的帶 uv、有的不帶。

**聚焦中的那一種站點不白模化**，保持原色 —— 點進「公車」就是要看公車站在哪。
隱藏與烘白模用的是同一個判斷，否則站點會有原色與白模兩份幾何疊著閃。

### 車輛可見性

| 模式 | 可見車輛類型 |
|------|------------|
| NORMAL | 全部 |
| UNDERGROUND | 無（地面車輛不可見） |
| RAIL_FOCUS | rail_train, rail_carriage |
| FERRY_FOCUS | ferry |
| BUS_FOCUS | bus, transport_bus |
| TRANSFER_FOCUS | 無 |

### 路線連線

站與站之間的連線只在聚焦模式出現，且只畫聚焦中那一種交通工具自己的路線。

| 模式 | 地面連線 |
|------|---------|
| NORMAL | 無 |
| BUS_FOCUS | 公車路線 |
| RAIL_FOCUS | 鐵路停靠連線 |
| FERRY_FOCUS | 渡輪路線 |
| UNDERGROUND | 無 —— 地下有 `MetroTunnelRenderer` 畫出的真正隧道 |
| TRANSFER_FOCUS | 無 —— 另有選定路線的疊圖線 |

連線每一跳拱成拋物線（`core/transport/RouteArc`）：水平投影是直線，端點落在站上，
拱高為跳距的 `0.48` 倍、上限 `6.0` 格。暫停營運的路線畫成灰色虛線。

### 交通站點對應的聚焦模式

| 站點類型 | 對應模式 |
|---------|---------|
| 地鐵站 | UNDERGROUND |
| 火車站 | RAIL_FOCUS |
| 碼頭 | FERRY_FOCUS |
| 公車站 | BUS_FOCUS |

點選站牌會進入對應的聚焦模式；點選其他建築或空地回到 NORMAL。

### 地下隧道位置

地鐵隧道的 Y 座標: `-0.15`（地面以下）
