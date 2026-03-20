# 模擬迴圈 (Simulation Loop)

SimulationLoop 是遊戲的心臟，驅動所有遊戲邏輯的更新。

---

## 遊戲時鐘 (GameClock)

### 時間單位

- **Tick**: 最小時間單位
- **Day**: 24 ticks
- **Week**: 7 days
- **Month**: 30 days
- **Year**: 12 months

### 遊戲速度

| 速度 | 每 tick 間隔 (ms) |
|------|-------------------|
| 0 (暫停) | Infinity |
| 1× | 250 |
| 3× | 83 |
| 5× | 50 |
| 10× | 25 |

### 時段 (Time of Day)

24 tick 循環中的四個時段：

| 時段 | 小時範圍 | 影響 |
|------|---------|------|
| `night` | 22:00~5:00 | 低交通 |
| `morning_rush` | 6:00~9:00 | 早高峰通勤 |
| `midday` | 10:00~16:00 | 正常交通 |
| `evening_rush` | 17:00~21:00 | 晚高峰通勤 |

### 季節

每 12 個月循環：春(0~2月)、夏(3~5月)、秋(6~8月)、冬(9~11月)

---

## 遊戲狀態 (GameState)

GameState 集中管理所有遊戲子系統的狀態：

| 屬性 | 類型 | 說明 |
|------|------|------|
| `grid` | Grid | 世界網格 |
| `roadNetwork` | RoadNetwork | 道路圖 |
| `citizens` | CitizenManager | 市民管理 |
| `traffic` | TrafficSimulation | 交通模擬 |
| `trafficLights` | TrafficLightSystem | 紅綠燈系統 |
| `power` | PowerGrid | 電力系統 |
| `water` | WaterNetwork | 供水系統 |
| `clock` | GameClock | 遊戲時鐘 |
| `budget` | BudgetState | 預算狀態 |
| `taxRates` | TaxRates | 稅率設定 |
| `rciDemand` | RCIDemandValues | RCI 需求值 |
| `buildingGrowth` | BuildingGrowth | 建築成長 |
| `buildingUpgrade` | BuildingUpgrade | 建築升級 |
| `pollution` | PollutionManager | 污染管理 |
| `police` | PoliceService | 警察服務 |
| `fire` | FireService | 消防服務 |
| `health` | HealthService | 醫療服務 |
| `education` | EducationService | 教育服務 |
| `parks` | ParkService | 公園服務 |
| `garbage` | GarbageService | 垃圾處理 |
| `sewage` | SewageService | 污水處理 |
| `deathCare` | DeathCareService | 殯葬服務 |
| `districts` | DistrictManager | 區域管理 |
| `policies` | PolicyManager | 政策管理 |
| `citySpec` | CitySpecialization | 城市特化 |
| `globalMarket` | GlobalMarket | 全球市場 |
| `bus` | BusSystem | 公車系統 |
| `metro` | MetroSystem | 地鐵系統 |
| `rail` | RailSystem | 鐵路系統 |
| `ferry` | FerrySystem | 渡輪系統 |
| `airport` | AirportSystem | 機場系統 |
| `freight` | FreightSystem | 貨運系統 |
| `sidewalkGraph` | SidewalkGraph | 人行道圖 |
| `pedestrianManager` | PedestrianManager | 行人管理 |

### 初始狀態

- 地圖: 200×200
- 初始資金: $50,000
- 貸款利率: 5%
- 稅率: 全部 9%
- 初始 RCI 需求: 各 50

---

## Tick 頻率分層

不同系統以不同頻率更新，以平衡效能和精度：

| 頻率 | 間隔 | 更新內容 |
|------|------|---------|
| 每 tick | 1 tick | 交通車輛移動、大眾運輸、貨運 |
| 慢速 (Slow) | 6 ticks | RCI 需求、預算、服務覆蓋、建築成長/升級/廢棄、教育、幸福度、移民、住房分配、服務車輛 |
| 中速 (Medium) | 60 ticks | 污染、地價、搬遷、擁塞流量、鐵路外部連接 |
| 每日 (Daily) | 24 ticks | 年齡更新、死亡判定、公共運輸乘客統計 |
| 每月 (Monthly) | ~720 ticks | 自然出生 |

---

## Tick 執行順序

每個 tick 依序執行以下步驟：

### 1. RCI 需求計算 (每 6 ticks)
計算住宅/商業/工業需求，套用商業稅懲罰。

### 2. 預算更新 (每 6 ticks)
根據收支更新現金。

### 3. 服務覆蓋 (每 6 ticks)
- 計算電力供需和覆蓋範圍
- 計算供水供需和覆蓋範圍
- 所有市政服務 tick（警察/消防/醫療/教育/垃圾/污水/殯葬/公園）
- 處理火災事件

### 3.5. 污染與地價 (每 60 ticks)
更新所有格子的污染和地價。

### 4. 建築系統 (每 6 ticks)
- **成長**: 每 tick 隨機取樣 20 格嘗試成長
- **升級/降級**: 根據地價或教育水平調整建築等級
- **廢棄壓力**: 計算和累積廢棄壓力
- **焦黑清除**: 2% 機率自動清除焦黑建築

### 4.5. 教育 (每 6 ticks)
推進學生學習進度，招收新學生。

### 5. 市民生命週期 (每日/每月)
- **每日**: 年齡更新 + 死亡判定
- **每月**: 自然出生
- 同步住宅容量上限

### 5.5. 幸福度與健康 (每 6 ticks)
更新所有市民的幸福度和健康值。

### 6. 移民 (每 6 ticks)
家庭移入和不滿市民移出。

### 6.5. 住房/就業分配 (每 6 ticks)
為無家可歸和失業的市民分配住所和工作。

### 6.6~6.7. 搬遷 (每 60~120 ticks)
不滿意住所的市民搬家，通勤路徑失敗的市民換工作。

### 7. 交通 (每 tick)
- 重建車道圖（若道路變更）
- 重建人行道圖（若道路變更）
- 產生通勤車輛
- 服務車輛巡邏

### 8. 大眾運輸 (每 tick)
- 公車、地鐵、鐵路、渡輪、機場系統 tick
- 貨運 tick
- 鐵路貨運加成
- 機場貨運加成
- 鐵路外部連接（每 60 ticks）

### 9. 收入計算 (每 6 ticks)
計算各區域稅收，全球市場 tick。

### 10. 擁塞流量預測 (每 60 ticks)
計算預測的交通流量分佈。

---

## 模擬常數

| 常數 | 值 | 說明 |
|------|-----|------|
| SLOW_TICK_INTERVAL | 6 | 慢速 tick 間隔 |
| MEDIUM_TICK_INTERVAL | 60 | 中速 tick 間隔 |
| GROWTH_ATTEMPTS | 20 | 每 tick 成長取樣數 |
| BURNED_CLEARANCE_CHANCE | 2% | 焦黑建築自動清除機率 |
| CRIME_BASE_MAX | 50 | 最大基礎犯罪率 |
| CRIME_POP_FACTOR | 0.02 | 人口犯罪因子 |
| CRIME_COVERAGE_PER_STATION | 0.15 | 每警局覆蓋減少犯罪 15% |
| CRIME_MAX_REDUCTION | 0.6 | 警察最大犯罪減少 60% |
| VEHICLE_CAP_MAX | 2000 | 道路車輛上限 |
| VEHICLE_CAP_BASE | 20 | 基礎車輛數 |
| VEHICLE_CAP_POP_RATIO | 0.3 | 人口車輛比 |
