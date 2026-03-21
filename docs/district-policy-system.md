# 區域與政策系統 (District & Policy System)

玩家可以將城市劃分為多個區域，並對每個區域設定特化方向和限制政策。

---

## 區域 (District)

### 區域屬性

| 屬性 | 型別 | 說明 |
|------|------|------|
| `id` | string | 唯一識別碼（如 `district_1`） |
| `name` | string | 區域名稱 |
| `cells` | Set<string> | 包含的格子集合 (`"x,y"` 格式) |
| `policies` | Policy[] | 啟用的政策列表 |
| `specialization` | Specialization | 特化方向 |
| `taxRateOverride` | TaxRates? | 區域專屬稅率（可選） |

### 區域操作

| 操作 | 說明 |
|------|------|
| `createDistrict(name)` | 建立新區域 |
| `addCellToDistrict(id, x, y)` | 加入格子（自動從其他區域移除） |
| `removeCellFromDistrict(id, x, y)` | 移除格子 |
| `getDistrictAt(x, y)` | 查詢格子所屬區域（O(1)） |
| `mergeDistricts(id1, id2)` | 合併兩個區域 |
| `splitDistrict(id, cells)` | 分割區域 |

---

## 政策 (Policy)

### 政策類型

| 政策 | 費用 | 效果 |
|------|------|------|
| `NO_HEAVY_INDUSTRY` (禁止重工業) | $150 | 區域內不允許工業區規劃 |
| `ENCOURAGE_RECYCLING` (鼓勵回收) | $100 | 減少垃圾產生 |
| `HIGH_DENSITY_BAN` (高密度禁令) | $120 | 禁止高密度住宅和商業 |
| `ORGANIC_FOOD` (有機食品) | $80 | 提升農業效率 |
| `TOURISM` (觀光推廣) | $200 | 吸引觀光客 |

### 政策限制效果

- **NO_HEAVY_INDUSTRY**: `canBuildInDistrict()` 阻擋 `ZoneType.INDUSTRIAL`
- **HIGH_DENSITY_BAN**: `canBuildInDistrict()` 阻擋 `RESIDENTIAL_HIGH` 和 `COMMERCIAL_HIGH`

### 政策成本

所有啟用的政策費用會計入每 tick 的支出。

---

## 特化 (Specialization)

區域可以設定一種產業特化，獲得效率和收入加成：

| 特化 | 效率倍率 | 收入倍率 |
|------|---------|---------|
| NONE (無) | 1.0× | 1.0× |
| FARMING (農業) | 1.3× | 1.1× |
| FORESTRY (林業) | 1.25× | 1.15× |
| MINING (礦業) | 1.4× | 1.2× |
| OIL (石油業) | 1.5× | 1.3× |
| TOURISM (觀光業) | 1.2× | 1.5× |
| HIGH_TECH (高科技) | 1.35× | 1.4× |

### 收入倍率效果

設有特化的區域內建築的稅收會乘以 `revenueMultiplier`。例如 OIL 特化的區域，收入增加 30%。

---

## 城市特化 (CitySpecialization)

城市層級的特化系統，影響全城市的經濟。獨立於區域特化之上。所有城市特化需要 5000 人口解鎖。

### 城市特化列表

| 特化 | 收入倍率 | 幸福度 | 犯罪率 | 所需人口 |
|------|---------|--------|--------|---------|
| NONE (無) | 1.0× | 0 | 0 | 0 |
| MINING_CITY (礦業城市) | 1.15× | -5 | +5 | 5000 |
| OIL_CITY (石油城市) | 1.2× | -5 | +3 | 5000 |
| TECH_CITY (科技城市) | 1.25× | +5 | -5 | 5000 |
| TOURISM_CITY (觀光城市) | 1.2× | +3 | +5 | 5000 |
| GAMBLING_CITY (賭博城市) | 1.4× | -10 | +15 | 5000 |
| TRADE_CITY (貿易城市) | 1.15× | +2 | 0 | 5000 |

### 效果

- `revenueMultiplier` — 全城市收入倍率
- `happinessModifier` — 全城市幸福度加減
- `crimeModifier` — 全城市犯罪率加減

最高收入的 GAMBLING_CITY (+40%) 代價是高犯罪 (+15) 和低幸福度 (-10)。TECH_CITY 是最平衡的選擇，提供收入加成同時降低犯罪和提升幸福。
