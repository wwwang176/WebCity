# Districts 重新規劃 — 選項盤

**這份是提案,不是現況描述。** 現況的部分標了檔案行號,是查證過的;方向的部分還沒有決定。

---

## 一、現況盤點

### 活的(逐條追到消費端)

| 功能 | 消費端 |
|---|---|
| 畫分區、加格子 | `Game.paintDistrict` — 實測 49 格正確寫入 |
| 回收政策 ×0.65 垃圾 | `ServiceRegistry.ts:120` |
| 觀光政策 ×1.2 稅收 | `IncomeCalcAdapter.ts:46`(與專精相乘) |
| 有機食品 +6 地價 | `SimulationLoop.ts:1150` |
| 禁重工業 / 禁高密度 | `BuildingGrowthTick.ts:125` |
| 政策收費 | `ExpenseCalculator.ts:18`,只收有效果的 |

### 死的

**分區 overlay 畫不出來。** `OverlayRenderer.getColor()` 沒有 `DISTRICT` 分支,掉進
`default` 回傳固定灰 `(0.5,0.5,0.5)`。builder 特地為每個分區算了雜湊色值(20–99,
`OverlayBuilders.ts:81`),`getColor` 完全不看。實測:鏡頭正中央畫 169 格,overlay
資料 218 筆都有值,畫面零變化。

**`alphas` 是死碼。** `OverlayRenderer.ts:78` 配置、`:92` 填值,之後從來沒有接到
geometry 上。所以值為 0 的格子也照樣被塗 `getColor(type, 0)` @ opacity 0.5 ——
整張地圖蓋一層均勻的灰。**這條影響所有 overlay,不只分區。**

**分區專精沒有 UI。** `setSpecialization()` 存在、效果也接進收入了,但沒有任何介面
呼叫它。`CitySpecModal` 設的是全城專精,不是分區。

**`taxRateOverride` 完全沒接。** 型別有(`district/types.ts`)、存檔會 round-trip
(`DistrictManager.ts:134,150`),但沒有 setter、沒有 UI、沒有消費端。

**`efficiencyMultiplier` 只有測試在讀。** 生產程式碼零消費。

**自然資源整層沒接,而且有兩份實作。**

| | 位置 | 內容 | 消費端 |
|---|---|---|---|
| A | `environment/NaturalResourceManager.ts`(91 行) | 型別 + 蘊藏量 + `extract()` + `isExhausted()` | 0,從未被 `new` 過 |
| B | `Grid.naturalResources: Uint8Array` + `Terrain.getNaturalResource()` | 只有型別 | 0,`setNaturalResource` 零呼叫 |

B 每張地圖配置一條 `Uint8Array(totalCells)`,全零,地圖產生時不撒資源。

---

## 二、核心問題

**分區現在沒有在問玩家任何問題。**

畫一塊區域,然後呢?能開的政策有五個,其中三個是單一乘數;能選的專精有七種,但沒有
介面、也沒有前提 —— 補上介面就會變成「在草地上選石油,白拿 +50% 稅收」,最佳解是
每個分區都選同一個。

專精之所以像半成品,是因為它踩在一塊沒接上的地基上:農業/林業/礦業/石油本質上是
**資源產業**,而資源不在地圖上。`efficiencyMultiplier` 死著多半也是同一個原因 ——
它要乘的那個「產出效率」沒有東西可乘。

---

## 三、方向選項

### A · 土地使用管制

分區 = 「這裡不准蓋什麼」。現有的禁重工業/禁高密度就是這一類,往下長:限高、禁噪音
產業、純住宅區、歷史保存。

- **玩家的決策**:我要保護這一區的居住品質,代價是稅基
- **要新做的**:政策條目 + 每條的判定
- **能重用的**:`canBuildInDistrict` 已經在成長 tick 裡了,加一條政策幾乎是加一列表
- **成本**:小
- **風險**:全是「禁止」。玩家只能扣東西,沒有正向選擇,玩久了會膩

### B · 資源產業(C:S 的 specialization)

分區 = 「這裡有礦脈,圈起來開採」。

- **玩家的決策**:看地圖找資源 → 圈起來 → 專精 → 蘊藏量耗盡後轉型
- **要新做的**:資源生成(地圖產生時)、資源圖層、專精的前提判定、開採消耗蘊藏量
- **能重用的**:
  - `NaturalResourceManager` 已經有 `extract()` 與 `isExhausted()`,91 行寫完了
  - **下游整條都在**:`FreightSystem` 有生產→消費→短缺/盈餘→進出口
    (`getProductionRate` / `getConsumptionRate` / `getSupplyStatus`),資源產業
    只要提高該區工業的產出就自動接上貨運與出口收入
  - 專精的 `revenueMultiplier` 已經接進 `IncomeCalcAdapter`
- **成本**:中。比表面看起來小很多,因為缺的只有上游
- **風險**:要先決定兩份資源實作留哪一份

### C · 分區財政(SimCity 的條例)

分區 = 「這區減稅催生 / 加稅抽血」。

- **玩家的決策**:用稅率調節不同區域的成長速度
- **要新做的**:`taxRateOverride` 的 setter + UI,並把 `IncomeCalculator` 的稅率
  來源從「全城一份」改成「分區優先、否則全城」
- **能重用的**:欄位與存檔已經在了
- **成本**:中
- **風險**:純數字調整,沒有空間意義 —— 玩家不需要看地圖就能決定。而且分區稅率是
  SimCity 的設計,跟這款已經走的 C:S 方向不太合

### D · 分區儀表板

分區 = 一個統計鏡頭。命名區域,看該區的人口、犯罪、地價、通勤、稅收,沒有額外機制。

- **玩家的決策**:沒有直接決策,但讓其他決策看得見
- **要新做的**:每分區聚合 + 面板
- **能重用的**:所有數字都已經逐格算好了
- **成本**:小
- **風險**:沒有能動性。單獨做的話分區仍然「沒有用」,只是「看得到」

---

## 四、不管選哪個都該先做

1. **修 overlay** —— `getColor` 補 `DISTRICT` 分支 + `alphas` 接上 geometry。純 bug,
   跟規劃無關,而且它讓「畫了分區看不見」這件事無法驗收任何後續工作。
2. **解掉 TOURISM 的重疊** —— 它同時是政策(×1.2 稅收)又是專精(×1.5 稅收),兩套
   系統在做同一件事。先決定它屬於哪一邊。
3. **資源二選一** —— `NaturalResourceManager` 與 `Grid.naturalResources` 只能留一個。
   留哪個取決於要不要蘊藏量:要的話留 A,不要的話留 B 並刪掉 A。

## 五、建議刪掉的

- **`efficiencyMultiplier`** —— 在 B 做出來之前沒有意義,而現在有測試拿常數表驗自己
- **`taxRateOverride`** —— 除非選 C,否則刪掉,別留一個永遠設不了的欄位在存檔格式裡

---

## 六、待決

- 主方向要哪一個,或哪幾個的組合?
- 如果走 B:資源要影響**工業產量**(接貨運)還是只影響**稅收**(接收入)?前者才會
  讓資源區跟城市其他部分產生關係
- 蘊藏量會耗盡嗎?耗盡是「加成消失」還是「建築廢棄」?
