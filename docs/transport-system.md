# 大眾運輸系統 (Transport System)

WebCity 提供五種大眾運輸系統，市民會根據通勤條件自動選擇交通方式。

---

## 運輸類型

| 類型 | 站點造價 | 容量 | 速度 | 停靠時間 | 營運費/車 | 受壅塞影響 |
|------|---------|------|------|---------|---------|-----------|
| BUS (公車) | $100 | 50 | 2 格/tick | 2 ticks | $100 | 是 |
| METRO (地鐵) | $3000 | 200 | 3 格/tick | 2 ticks | $300 | 否 |
| RAIL (鐵路) | $2000 | 300 (客)/500 (貨) | 4 格/tick | 3 ticks | $400 | 否 |
| FERRY (渡輪) | $1500 | 100 | 0.375 格/tick | 6 ticks | $200 | 否 |
| AIRPORT (機場) | 見下方 | - | - | - | 見下方 | 否 |

---

## 交通模式選擇 (Mode Choice)

市民通勤時自動選擇最佳交通方式：

### 決策邏輯

```
1. 曼哈頓距離 ≤ 3 → 步行 (WALK)
2. 計算開車時間 = 距離 × (1 + 壅塞率)
3. 找到最快的大眾運輸選項
4. 如果大眾運輸時間 < 開車時間 × 1.5 → 搭乘大眾運輸
5. 否則 → 開車 (DRIVE)
```

### 交通模式

```
WALK  步行
DRIVE 開車
BUS   公車
METRO 地鐵
RAIL  鐵路
FERRY 渡輪
```

---

## 公車系統 (BusSystem)

### 特點

- 使用 LaneGraph 進行車道級路徑規劃
- 公車是交通模擬中的實際車輛，會受到壅塞影響
- 到站停靠 2 秒

### 路線規劃

1. 設定站點
2. 計算站到站之間的 LaneEdge 路徑
3. 產生公車車輛到交通模擬中

### 路線中斷

路線站點間道路中斷時，路線被暫停 (`suspended = true`)。

---

## 地鐵系統 (MetroSystem)

### 特點

- 地下運行，不受路面壅塞影響
- 容量最大 (200 乘客)
- 建設成本高 ($5000/站)

### 路線頻率

```
frequency = 站點數 × 3
```

---

## 鐵路系統 (RailSystem)

### 服務類型

| 類型 | 容量 | 用途 |
|------|------|------|
| PASSENGER (客運) | 300 | 載客 |
| FREIGHT (貨運) | 500 | 運貨，每列火車增加 10 貨物/tick |

### 外部連接

鐵路連接到地圖邊緣時可形成外部連接：
- 人口流入
- 貨物流入
- 貨物流出

### 路徑

火車沿軌道圖 (RailNetwork) 的 A* 路徑移動。

---

## 渡輪系統 (FerrySystem)

### 特點

- 只能在水域行駛
- 碼頭必須建在水域旁
- 使用 A* 水路尋路演算法

### 路徑快取

路線建立時預先計算水路路徑並快取，避免每 tick 重新尋路。

---

## 機場系統 (AirportSystem)

### 規模

三種獨立 InfraType（`airport_s` / `airport_m` / `airport_l`），各有獨立 buildingId。

| 規模 | InfraType | buildingId | 佔地 | 噪音 | 旅客/tick | 貨物/tick | 造價 | 營運費 |
|------|-----------|-----------|------|------|---------|---------|------|--------|
| SMALL | `airport_s` | 237 | 3×2 | 10 | 50 | 20 | $5,000 | $500 |
| MEDIUM | `airport_m` | 236 | 5×4 | 25 | 200 | 100 | $15,000 | $1,500 |
| LARGE | `airport_l` | 235 | 7×6 | 50 | 500 | 300 | $40,000 | $4,000 |

### 機場配置

- 左右雙 taxiway：左側=起飛入口（near threshold），右側=降落出口（near runway end）
- 跑道顏色與道路一致（`0x3a3a3a`），分隔線使用 `MeshBasicMaterial`（恆亮）
- L 機場為雙跑道配置，最多同時 2 架飛機
- 放置需鄰接道路，支援 R 鍵旋轉（0°/90°/180°/270°）
- 拆除使用標準 `multi_cell_infra` 路徑

### 效果

- 旅客帶來商業需求
- 貨物增加 FreightSystem 的外部貨物
- 產生噪音污染

### 飛機動畫 (AirplaneAnimator)

渲染端動畫，與 TrainAnimator / FerryAnimator 相同模式（逐幀 LERP，不靠 tick）。

#### 動畫階段（9 Phase）

```
approach → roll → roll_wait → taxi_in → dwell → pushback → taxi_out → takeoff_roll → climb
```

| Phase | 說明 | 速度 |
|-------|------|------|
| approach | 從高空下降，Hermite flare 著地 | 3.0 u/s |
| roll | 跑道全長減速（線性煞車至零） | 3.0 → 0 |
| roll_wait | 在 taxiway 入口暫停 1s | - |
| taxi_in | 右 taxiway 上行 → apron → gate（弧線轉彎） | 1.5 u/s |
| dwell | 停在 gate 等待 | 5s |
| pushback | 向右弧形倒車，機頭轉向 taxiway 方向 | 0.8 u/s |
| taxi_out | 正向穿過 apron → 左 taxiway 下行 → 入跑道（弧線轉彎） | 1.5 u/s |
| takeoff_roll | 跑道全長加速（ease-in），後段漸進抬頭 | 5.0 u/s |
| climb | cubic Bezier 弧線離地 → 恆定爬升率 | 3.0 u/s |

#### 高度曲線

- **降落 approach**：恆定下降率 + Hermite cubic flare（C1 連續，著地時斜率=0）
- **起飛 climb**：cubic Bezier 弧線（B(s) = h·s²(2-s)）+ 恆定爬升率，pitch 從 Bezier 切線取 atan2

#### 飛機模型

737 風格低多邊形客機，3 層 InstancedMesh：

| Mesh | Material | 用途 |
|------|----------|------|
| Body | MeshLambertMaterial | 機身+機翼+水平尾翼+引擎（隨機航空公司機身色） |
| VTail | MeshLambertMaterial | 垂直尾翼（獨立隨機尾翼色） |
| NavLights | MeshBasicMaterial | 導航燈紅/綠/白（閃爍：0.2s 亮 / 0.8s 暗） |

- 圓筒機身 + 蛋形機鼻（SphereGeometry scale 1.6x）+ upsweep 尾椎
- 後掠梯形機翼（root:tip = 7:1）
- S 機場飛機縮放 80%
- 每次 spawn 隨機配色（10 色機身 × 10 色尾翼）
- Gate 碰撞避免：同機場不選已佔用的 gate
- 夜間前照燈（隨 pitch 旋轉，2× 加長），無尾燈
- 支援機場旋轉（localToWorld 符合 Three.js Y 軸旋轉慣例）

#### 生成頻率

| 尺寸 | 間隔 | 最大同時 |
|------|------|---------|
| S | 35s | 1 架 |
| M | 25s | 1 架 |
| L | 18s | 2 架（雙跑道） |

---

## 站點統計

每個站點追蹤乘客數據：

| 欄位 | 說明 |
|------|------|
| `passengers` | 當前等候乘客數 |
| `dailyRiders` | 今日累計搭乘人次 |
| `lastDayRiders` | 昨日搭乘人次 |
| `smoothedDailyRiders` | EMA 平滑的每日搭乘人次 |

---

## 路線路徑動畫

### 地鐵路徑 (MetroLinePath)

地鐵列車沿站對站的直線路徑移動：
- 2 站: A→B→A 往返（totalLength = 距離×2）
- 3+ 站: 完整環形 A→B→C→...→A
- 列車動畫使用 `advanceTrain()` 推進距離，到站時停留 `waitTime` 秒

### 鐵路路徑 (RailLinePath)

火車沿實際軌道座標移動（非直線）：
- 使用 `RailNetwork.findPath()` 回傳的逐格路徑
- 支援距離插值和朝向角計算

### 渡輪路徑 (FerryLinePath)

渡輪沿 A* 水路路徑移動：
- 預計算段長度和累積長度
- 支援距離插值（位置 + 朝向角）

### 地鐵隧道 (MetroTunnelPath)

地鐵隧道的幾何路徑：
- 站間使用中點控制點的曲線
- 隧道在 Y = -0.15 地面以下

---

## 路線渲染資料

### 路線顏色

| 系統 | 顏色 | 中斷顏色 |
|------|------|---------|
| BUS | #ff9800 (橙) | #666666 (灰) |
| METRO | #00bcd4 (青) | #666666 |
| RAIL | #ff5722 (深橙) | #666666 |
| FERRY | #0097a7 (深青) | #666666 |

### 路線 ID 偏移

為避免跨系統 ID 衝突，各系統使用不同的 ID 偏移：

| 系統 | 路線 ID 偏移 | 車輛 ID 偏移 |
|------|------------|------------|
| BUS | +10,000 | +100,000 |
| METRO | +20,000 | - |
| RAIL | +40,000 | +400,000 |
| FERRY | +50,000 | +500,000 |
| AIRPLANE | - | +800,000 |

---

## 壅塞對公車的影響

公車實際速度：
```
速度 = max(0.1, 1 - 壅塞率 × 0.5) × 基礎速度
```

其他大眾運輸（地鐵/鐵路/渡輪）不受壅塞影響。

---

## 路線結構

```typescript
TransportRoute {
  id: number;
  type: TransportType;
  stops: TransportStop[];
  vehicles: number;        // 配置車輛數
  frequency: number;       // 發車頻率
  operatingCost: number;   // 營運成本
  suspended?: boolean;     // 路線中斷
}
```

---

## 站點放置規則

### 通用規則

- 站點格子不能有道路（`roadType = 0`）
- 站點格子不能有建築（`buildingId = 0`）

### 特殊規則

| 站點類型 | 額外規則 |
|---------|---------|
| 公車站 | 必須有至少一個鄰接道路格 |
| 火車站 | 必須有鐵軌（`railType != 0`），道路可共存 |
| 地鐵站 | 通用規則 |
| 碼頭 | 必須緊鄰水域 |

### 容量判定

大眾運輸路線在以下情況被視為滿載：
```
dailyRiders 總和 ≥ 車輛數 × 單車容量
```
滿載路線不再作為新市民的可用選項。

---

## 可用路線搜尋

`findAvailableTransit()` 搜尋起訖點附近（步行範圍內）的大眾運輸路線：

1. 遍歷所有運輸系統的路線
2. 檢查路線容量（未滿載）
3. 找起點附近的站點（曼哈頓距離 ≤ 步行範圍）
4. 找終點附近的站點
5. 計算環形路線上兩個方向的搭乘距離，取較短的
6. 估計時間 = 搭乘距離 / 系統速度
