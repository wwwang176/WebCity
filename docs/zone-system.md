# 區域規劃系統 (Zone System)

區域規劃是城市發展的核心機制。玩家透過在道路旁劃設不同類型的區域，引導住宅、商業和工業建築的自動成長。

---

## 區域類型

| 列舉值 | 名稱 | 說明 |
|--------|------|------|
| NONE (0) | 未規劃 | 空地 |
| RESIDENTIAL_LOW (1) | 低密度住宅 | 獨棟住宅、公寓 |
| RESIDENTIAL_HIGH (2) | 高密度住宅 | 大樓、高層住宅 |
| COMMERCIAL_LOW (3) | 低密度商業 | 小商店、便利商店 |
| COMMERCIAL_HIGH (4) | 高密度商業 | 百貨、大型商場 |
| INDUSTRIAL (5) | 工業 | 工廠、倉儲 |
| OFFICE (6) | 辦公 | 辦公大樓 |

> RCI 分類與輔助函式詳見[網格系統 — RCI 分類](grid-system.md#rci-分類)。

---

## 規劃規則

### 基本限制

1. **必須在道路的內圈範圍內**: 區域只能規劃在距離道路 Chebyshev 距離 ≤ `ZONE_ROAD_REACH`（=2）的格子上。這包含直接相鄰（1 格）和後退一格的「內圈」（2 格）。超過 2 格則拒絕並回傳 `NOT_ADJACENT_TO_ROAD`。
2. **不可建在水域或山地**: 地形限制
3. **不可建在道路上**: 道路格子不能被規劃
4. **不可建在基礎設施上**: 已有電廠、水廠、警局等設施的格子不能規劃

> `ZONE_ROAD_REACH` 定義於 `src/core/grid/constants.ts`，是全系統共用的「可容忍距離」。詳見 [grid-system.md — 共享常數](grid-system.md#共享常數-zone_road_reach)。

### 改變規劃

- 當一個已有區域建築的格子被重新規劃為不同類型時，原有建築會被拆除
- 規劃為相同類型時，建築保留不變

### 矩形規劃

`setZoneRect(from, to, zoneType)` 可以一次規劃一個矩形區域，逐格套用上述規則。

---

## 密度規則

區域的密度等級受到鄰接道路類型的限制：

| 道路類型 | 允許的密度等級 |
|---------|---------------|
| RURAL (鄉村道路) | LOW |
| TWO_LANE (雙車道) | LOW |
| FOUR_LANE (四車道) | HIGH |
| SIX_LANE (六車道) | HIGH |
| HIGHWAY (高速公路) | NONE（不允許規劃） |
| ONE_WAY (單行道) | LOW |

### 密度判定邏輯

`getMaxDensity(grid, x, y)` 掃描 Chebyshev `ZONE_ROAD_REACH`（5×5 方框）內所有道路 cell，取最高密度等級：

- 範圍內任一道路是 HIGH 級（四車道以上）→ 返回 `'HIGH'`
- 否則有 LOW 級道路 → 返回 `'LOW'`
- 範圍內沒有道路 → 返回 `'NONE'`

掃描範圍與 `ZoneManager.setZone` / `BuildingGrowth.canGrow` 的可劃設範圍一致，確保內圈的 zone 格子也能繼承鄰近道路的密度等級而順利成長。

### 對建築成長的影響

- `LOW` 密度區域：建築只能成長到低密度建築（較小的建築物）
- `HIGH` 密度區域：建築可以成長到高密度建築（高層大樓）
- 升級道路可以解鎖更高密度的建築成長
