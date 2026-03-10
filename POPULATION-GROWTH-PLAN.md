# Population Growth 改善計畫

## 現狀問題

### 移民硬上限不縮放
`Migration.ts` 中移民上限為 `Math.min(3, vacantHomes, Math.ceil((attractiveness - 50) / 20))`，
無論城市人口 100 或 50,000，每次 migration tick 最多搬入 3 人。

| 人口 | 年成長率上限 | 體感 |
|------|-------------|------|
| 100 | 4320% | 被空房/職缺自然限制，實際 OK |
| 5,000 | 86% | 尚可 |
| 20,000 | 21% | 偏慢 |
| 50,000 | 8.6% | 非常慢 |

> Migration 每 6 tick 執行一次，24 tick/天，4 次/天 × 3 人 × 360 天 = 4,320 人/年上限。

### 無自然出生
人口唯一來源是移民（20~49 歲成年人）。有死亡機制（`ageTick` 年增 1 歲，>90 歲 10% 死亡，>100 必死）但無出生。
`LifeStage.BABY` / `CHILD` 在正常遊玩中永遠不會出現。

---

## 方案一：移民上限動態縮放

### 目標
讓移民速率隨城市規模自然成長，小城市維持緩慢有機成長，大城市能快速填滿新開發區。

### 設計

#### 公式
```ts
// Migration.ts — 替換原本的 Math.min(3, ...)
function getImmigrationCap(population: number, vacantHomes: number, attractiveness: number): number {
  const popCap = Math.max(3, Math.floor(population * 0.01));  // 人口 1% 為基底
  const demandCap = Math.ceil((attractiveness - 50) / 10);     // 吸引力越高越多（除 10 比原本除 20 更積極）
  return Math.min(popCap, vacantHomes, demandCap);
}
```

#### 縮放表

| 人口 | popCap | 最大年移入量 | 年成長率上限 |
|------|--------|-------------|-------------|
| 100 | 3 | 4,320 | 4320%（被空房限制） |
| 1,000 | 10 | 14,400 | 1440%（被空房限制） |
| 5,000 | 50 | 72,000 | 1440%（被空房限制） |
| 10,000 | 100 | 144,000 | 1440%（被空房/吸引力限制） |
| 50,000 | 500 | 720,000 | 1440%（被空房/吸引力限制） |

> 實際上 vacantHomes 和 demandCap 才是真正的瓶頸，popCap 只是防止小城市爆衝。

#### 修改檔案
- `src/core/citizen/Migration.ts`
  - 新增 `getImmigrationCap(population, vacantHomes, attractiveness)` 函式
  - `migrationTick` 簽名新增 `population: number` 參數（或從 manager 取得）
  - 替換第 35 行的 `Math.min(3, ...)` 為新公式
- `src/core/simulation/SimulationLoop.ts`
  - `runMigration()` 傳入 population（已有 `pop` 變數，無需額外計算）

#### 測試計畫（TDD）
檔案：`src/core/citizen/__tests__/Migration.test.ts`

1. **小城市上限測試**：population=100 → cap=3（保持不變）
2. **中城市縮放測試**：population=5000, vacantHomes=100, attractiveness=80 → 預期移入 ~3 人（demandCap=3 為瓶頸）
3. **高吸引力大城市測試**：population=10000, vacantHomes=200, attractiveness=95 → 預期移入 ~5 人（demandCap=5 為瓶頸）
4. **空房瓶頸測試**：population=50000, vacantHomes=2 → 最多移入 2 人
5. **向下相容**：attractiveness ≤ 50 → 移入 0 人（不變）
6. **emigration 不受影響**：happiness < 20 仍然觸發遷出（不變）

---

## 方案二：自然出生機制

### 目標
讓城市產生自然人口成長，降低對移民的依賴。BABY/CHILD 生命階段正式進入遊戲循環，
搭配教育系統形成完整的 市民生命週期：出生 → 成長 → 就學 → 工作 → 老化 → 死亡。

### 設計

#### 核心規則
- **誰能生育**：ADULT 階段（19~65 歲）且 age ≤ 45 的市民，有 homeId
- **生育機率**：每年（ageTick 時）符合條件的成年人有基礎 3% 機率生育
- **幸福度加成**：happiness > 70 → 機率 +2%（共 5%）
- **每戶上限**：同一 homeId 下的 BABY+CHILD 數量 ≤ 2，防止爆炸成長
- **新生兒屬性**：age=0, LifeStage=BABY, education=NONE, incomeLevel 繼承父母, homeId=父母 homeId, workplaceId=null

#### 成長率估算
以 10,000 人口為例：
- 假設 60% 為 ADULT 且 age ≤ 45 → 6,000 人符合條件
- 假設 80% 有 homeId → 4,800 人
- 假設 50% 未達戶內上限 → 2,400 人可生育
- 每年 3~5% 機率 → 72~120 新生兒/年
- 出生率 ≈ 0.7%~1.2%/年，合理且溫和

#### 新增檔案
- `src/core/citizen/Birth.ts`

```ts
export interface BirthContext {
  maxChildrenPerHome: number;  // 預設 2
  baseFertilityRate: number;   // 預設 0.03
  happinessBonus: number;      // 預設 0.02（happiness > 70 時加成）
}

export function birthTick(
  manager: CitizenManager,
  context?: Partial<BirthContext>,
): number;  // 回傳新生兒數量
```

#### 整合邏輯
```
// SimulationLoop.ts — 在 ageTick 同一區塊（每年執行一次）
if (currentYear !== this.lastAgeYear) {
  this.lastAgeYear = currentYear;
  const deaths = this.state.citizens.ageTick();
  const births = birthTick(this.state.citizens);
  // DeathCare 處理死亡...
}
```

#### 修改檔案
- **新增** `src/core/citizen/Birth.ts` — birthTick 邏輯
- `src/core/simulation/SimulationLoop.ts` — 在年度 tick 中呼叫 birthTick
- `src/core/save/Serializer.ts` — 無需修改（Citizen 結構不變，age=0 的 citizen 自然序列化）

#### 測試計畫（TDD）
檔案：`src/core/citizen/__tests__/Birth.test.ts`

1. **基本出生**：有符合條件的 ADULT → 呼叫多次後應產生新生兒（統計測試，跑 100 次取平均）
2. **年齡限制**：age > 45 的 ADULT 不生育
3. **SENIOR 不生育**：LifeStage=SENIOR 不生育
4. **無家者不生育**：homeId=null 的市民不生育
5. **戶內上限**：同一 homeId 已有 2 個 BABY/CHILD → 不再生育
6. **幸福度加成**：happiness > 70 的群體生育率高於 happiness ≤ 70
7. **新生兒屬性**：age=0, lifeStage=BABY, education=NONE, homeId=父母 homeId, workplaceId=null
8. **空城市不生育**：無市民 → births=0

---

## 實作順序

### Phase A：移民動態縮放（獨立，可先做）
1. 寫測試 `Migration.test.ts` 新增 case
2. 修改 `Migration.ts` — 新增 `getImmigrationCap`，改 `migrationTick`
3. 修改 `SimulationLoop.ts` — 傳入 population
4. 跑測試確認通過

### Phase B：自然出生（依賴 Phase A 完成後的平衡調整）
1. 寫測試 `Birth.test.ts`
2. 實作 `Birth.ts`
3. 整合 `SimulationLoop.ts` — 年度 tick 呼叫 birthTick
4. 跑全部測試確認無 regression

### Phase C：平衡調整（兩個機制都上線後）
- 觀察人口成長曲線是否合理
- 調整參數：`popCap 係數`、`baseFertilityRate`、`maxChildrenPerHome`
- 確認 emigration 能在城市變差時有效控制人口
- 確認教育系統能接住 BABY→CHILD→TEEN 的學生

---

## 不在此計畫範圍
- 家庭系統（夫妻配對、家庭單位）— 過於複雜，暫不實作
- 移民家庭（一家多口同時搬入）— 可作為後續優化
- 生育政策/獎勵 UI — 可作為後續功能
- 人口老化結構統計面板 — 可作為後續 UI 功能
