# 條例目錄（第一批 + 第二批）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把條例從 6 條擴充到 16 條，並讓 `crime` / `landValue` / `garbage` 這三個既有槓桿也能在全城範圍生效。

**Architecture:** 機制已經在 `docs/superpowers/plans/2026-08-17-district-ordinances.md` 做完了 —— 分級、雙向效果、依規模計費、分區/全城範圍、UI、預算明細都在。這份計畫只做兩件事:(1) 補三個槓桿的全城接線與三個新槓桿(用水、汙水、工業排放);(2) 往 `POLICY_EFFECTS` / `POLICY_BILLING` / `POLICY_SCOPE` / `EFFECT_SUMMARY` 四張表加列。

**Tech Stack:** TypeScript、Vitest、Solid.js(UI)。`src/core/` 禁止 import Three.js。

## Global Constraints

- **TDD 強制**:每個 task 先寫失敗測試，再寫實作。實作完成後做 revert-verify —— 暫時把守衛拿掉，確認測試轉紅;沒轉紅表示測試無效，要修測試或刪掉沒有理由存在的程式碼。
- **每個 task 結束時 `npx tsc --noEmit` 與 `npx vitest run` 都必須是綠的。**
- **測試指令**:`npx vitest run <path>`;全套 `npx vitest run`。基準是 **409 檔 / 5898 測試**全過。
- **Lint**:`npx eslint <changed files>` 不得增加錯誤。既有錯誤:`Game.ts` 9、`Toolbar.tsx` 2、`DistrictModal` 週邊 6。
- **介面文字一律英文。** 遊戲 UI 是英文的;註解維持中文，跟專案慣例一致。
- **註解寫設計事實，不記錄對話。**
- **發現 bug 必須寫入 `BUGS.md` 與 `TODO.md`。**
- **提交訊息結尾**必須有:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PUNdiSMJZXNukDkSyfcUqX
  ```
- **不要用 PowerShell here-string 寫提交訊息**，寫進暫存檔再 `git commit -F`。

---

## 既有的不變量（每加一條條例都要滿足）

這些已經有測試守著，加列時會被抓到:

1. **每一級都要有非金錢的代價**（`PolicyTradeoff.test.ts`）。「花錢」不算 —— 付得起
   就一定開，那是價目表不是決策。
2. **計費基數必須跟範圍一致**（`PolicyBilling.test.ts`）。全城條例沒有分區格數可言
   （呼叫端固定傳 0），用格數計費就等於免費;分區條例用人口計費的話，畫一格跟畫
   一百格收一樣多。
3. **`perUnit` 的長度必須等於 `maxLevel`**（由 `POLICY_EFFECTS` 的陣列長度推導）。
4. **每個 `PolicyType` 都要有 `POLICY_SCOPE` 條目**（完整 `Record`，漏了編不過）。
5. **每個 `PolicyType` 都要有名字，而且名字各不相同**（`District.test.ts`）。
6. **每一級都要有效果說明，逐條逐級不重複，而且說明必須提到效果表真正動到的量**
   （`PolicyPresentation.test.ts`）。
7. **收費的條例必須是 `isPolicyImplemented`**（`PolicyBilling.test.ts`）。

---

## 目錄

### 已有的 6 條

| 條例 | 範圍 | 級數 |
|---|---|---|
| No Heavy Industry | 分區 | 1（限制型，不收費） |
| High Density Ban | 分區 | 1（限制型，不收費） |
| Encourage Recycling | 分區 | 3 |
| Organic Food | 分區 | 1 |
| Tourism Promotion | 分區 | 1 |
| Energy Regulation | 全城 | 3 |

### 這份計畫新增的 10 條

| 條例 | 範圍 | 級數 | 給你什麼 | 代價 | 用到的槓桿 |
|---|---|---|---|---|---|
| Legalize Gambling | 分區 | 1 | 商業收入 +35% | 犯罪 +12 | 既有 |
| Night Economy | 分區 | 2 | 商業收入 +12/+25% | 犯罪 +4/+10 | 既有 |
| Curfew | 分區 | 2 | 犯罪 −5/−10 | 商業收入 −10/−22% | 既有 |
| Heritage Preservation | 分區 | 1 | 地價 +12 | 商業 −8%、住宅 −6% | 既有 |
| Industry Subsidy | 分區 | 2 | 工業收入 +12/+25% | 地價 −4/−9 | 既有 |
| Surveillance Network | 全城 | 2 | 犯罪 −6/−13 | 地價 −2/−5 | **crime / landValue 要接全城** |
| Pay As You Throw | 全城 | 2 | 垃圾 −22/−42% | 地價 −3/−7 | **garbage 要接全城** |
| Water Conservation | 全城 | 3 | 用水需求 −8/−18/−30% | 商業 −1/3/6%、工業 −2/6/12% | **新槓桿 `waterDemand`** |
| Sewage Standards | 全城 | 2 | 汙水量 −15/−30% | 工業收入 −4/−10% | **新槓桿 `sewageLoad`** |
| Industrial Emission Control | 全城 | 3 | 工業汙染 −20/−40/−60% | 工業收入 −5/−12/−22% | **新槓桿 `industrialPollution`** |

賭場與宵禁刻意是一對相反的條例:同一塊地你只能選一邊。夜間經濟是賭場的溫和版，
分兩級。

---

## 檔案結構

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src/core/district/types.ts` | `PolicyType` | 修改:加 10 個成員 |
| `src/core/district/PolicyManager.ts` | 效果表、槓桿 getter | 修改:加 3 個效果欄位、10 條效果、名稱 |
| `src/core/district/PolicyScope.ts` | 範圍表 | 修改:加 10 列 |
| `src/core/district/PolicyBilling.ts` | 計費表 | 修改:加 10 列 |
| `src/core/district/CityOrdinances.ts` | 全城條例的效果合成 | 修改:加 5 個 getter |
| `src/core/district/PolicyPresentation.ts` | 效果說明 | 修改:加 10 條說明 |
| `src/core/service/ServiceRegistry.ts` | 垃圾產生的乘數來源 | 修改:併入全城乘數 |
| `src/core/service/WaterNetwork.ts` | 用水需求 | 修改:`calculateDemand` 收乘數 |
| `src/core/service/GarbageSewageProduction.ts` | 汙水產生 | 修改:收汙水乘數 |
| `src/core/environment/GridPollutionSources.ts` | 逐格汙染源 | 修改:工業源收乘數 |
| `src/core/simulation/SimulationLoop.ts` | 模擬迴圈 | 修改:接上 5 條線 |
| `src/Game.ts` | 放置後的立即重算 | 修改:用水需求同步 |

---

### Task 1: 讓 crime / landValue / garbage 也能在全城生效

現在全城條例只碰得到 `powerDemand` 與 `revenue` —— 另外三個槓桿的消費端只問分區。
不補這一步，全城範圍就只能做「省電」和「加減收入」兩種條例。

**Files:**
- Modify: `src/core/district/CityOrdinances.ts`（3 個 getter）
- Modify: `src/core/simulation/SimulationLoop.ts:1156-1157`（crime / landValue）
- Modify: `src/core/service/ServiceRegistry.ts:120`（garbage）
- Test: `src/core/district/__tests__/CityLevers.test.ts`（新增）

**Interfaces:**
- Produces:
  - `CityOrdinances.getCrimeBonus(): number`
  - `CityOrdinances.getLandValueBonus(): number`
  - `CityOrdinances.getGarbageMultiplier(): number`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/CityLevers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ZoneType } from '../../grid/types';

/**
 * 全城條例原本只碰得到 powerDemand 與 revenue —— crime / landValue / garbage 的
 * 消費端只問分區。這三條線補上之後，全城範圍才做得出「監視器網路」「垃圾隨袋徵收」
 * 這類條例。
 */

/** 暫時給某個全城條例塞一組效果。測的是接線，不是某一條條例現在的數字。 */
function withCityEffect(tiers: PolicyEffect[], body: (o: CityOrdinances) => void) {
  const type = PolicyType.ENERGY_REGULATION;   // 目前唯一的全城條例
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = tiers;
  try {
    const o = new CityOrdinances();
    o.setLevel(type, 1);
    body(o);
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
}

describe('全城條例的三個新槓桿', () => {
  it('should expose a city crime bonus', () => {
    withCityEffect([{ crime: 7 }], o => expect(o.getCrimeBonus()).toBe(7));
  });

  it('should expose a city land value bonus', () => {
    withCityEffect([{ landValue: -4 }], o => expect(o.getLandValueBonus()).toBe(-4));
  });

  it('should expose a city garbage multiplier', () => {
    withCityEffect([{ garbage: 0.6 }], o => expect(o.getGarbageMultiplier()).toBeCloseTo(0.6, 6));
  });

  it('should be the identity when nothing is switched on', () => {
    const o = new CityOrdinances();
    expect(o.getCrimeBonus()).toBe(0);
    expect(o.getLandValueBonus()).toBe(0);
    expect(o.getGarbageMultiplier()).toBe(1);
  });
});

/** Small Shop（COMMERCIAL_LOW）。 */
const SHOP = 7;

function cityWithShops() {
  const state = createGameState(30, 30);
  const loop = new SimulationLoop(state);
  for (let x = 5; x < 15; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 14; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
  }
  return { state, loop };
}

describe('三個槓桿真的接進模擬', () => {
  // 建築直接種進格子:updateLandValue 與垃圾產生都跳過 buildingId === 0，而建築
  // 成長要求該格有電有水。

  it('should let a city ordinance move land value', () => {
    const valueWith = (tiers: PolicyEffect[] | null) => {
      const { state, loop } = cityWithShops();
      if (tiers) {
        const saved = POLICY_EFFECTS[PolicyType.ENERGY_REGULATION];
        (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = tiers;
        state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 1);
        for (let i = 0; i < 6; i++) loop.tick();
        (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = saved;
      } else {
        for (let i = 0; i < 6; i++) loop.tick();
      }
      return state.grid.getCell(10, 11)!.landValue;
    };
    const plain = valueWith(null);
    expect(plain, '地價沒有被算過，這條測試等於空轉').toBeGreaterThan(0);
    expect(valueWith([{ landValue: -20 }]), '全城條例的地價效果沒有進到格子')
      .toBeLessThan(plain);
  });

  it('should let a city ordinance move crime', () => {
    // 犯罪只透過地價看得見（crimeRate 是 calculateLandValue 的輸入），所以量的
    // 是同一個出口 —— 但走的是不同的欄位。
    const valueWith = (crime: number) => {
      const { state, loop } = cityWithShops();
      const saved = POLICY_EFFECTS[PolicyType.ENERGY_REGULATION];
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = [{ crime }];
      state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 1);
      for (let i = 0; i < 6; i++) loop.tick();
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = saved;
      return state.grid.getCell(10, 11)!.landValue;
    };
    expect(valueWith(20), '全城條例的犯罪效果沒有進到地價').toBeLessThan(valueWith(0));
  });

  it('should let a city ordinance move garbage production', () => {
    const garbageWith = (mult: number) => {
      const { state, loop } = cityWithShops();
      const saved = POLICY_EFFECTS[PolicyType.ENERGY_REGULATION];
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = [{ garbage: mult }];
      if (mult !== 1) state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 1);
      for (let i = 0; i < 12; i++) loop.tick();
      (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.ENERGY_REGULATION] = saved;
      return state.garbage.getTotalGarbage();
    };
    const plain = garbageWith(1);
    expect(plain, '沒有垃圾可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(garbageWith(0.3), '全城條例沒有減少垃圾').toBeLessThan(plain);
  });
});
```

> `state.garbage` 取得總垃圾量的方法名稱先確認 —— `GarbageService` 上找
> `getTotalGarbage` 或等價的 getter。沒有的話改成把該格的垃圾量讀出來，
> **不要**改成直接呼叫 `getGarbageMultiplier`，那樣就繞過了要驗的那條線。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/CityLevers.test.ts`
Expected: FAIL — `o.getCrimeBonus is not a function`

- [ ] **Step 3: 加三個 getter**

`CityOrdinances.ts`:

```ts
  /** 全城條例加到犯罪率上的量。 */
  getCrimeBonus(): number {
    return this.effect(e => e.crime, 0, (a, b) => a + b);
  }

  /** 全城條例加到地價上的量。 */
  getLandValueBonus(): number {
    return this.effect(e => e.landValue, 0, (a, b) => a + b);
  }

  /** 全城條例對垃圾產生量的乘數。 */
  getGarbageMultiplier(): number {
    return this.effect(e => e.garbage, 1, (a, b) => a * b);
  }
```

- [ ] **Step 4: 接三條線**

`SimulationLoop.ts` 第 1156–1157 行:

```ts
        // 分區與全城的效果相加 —— 兩個範圍是獨立的決策，不是二選一。
        crimeRate: this.getAvgCrime()
          + this.state.policies.getCrimeBonus(districtId)
          + this.state.ordinances.getCrimeBonus(),
        policyBonus: this.state.policies.getLandValueBonus(districtId)
          + this.state.ordinances.getLandValueBonus(),
```

`ServiceRegistry.ts` 第 120 行:

```ts
    // 分區與全城的乘數相乘。全城的對每一格都生效，包含不屬於任何分區的格子。
    (x, y) => state.policies.getGarbageMultiplier(state.districts.getDistrictAt(x, y)?.id ?? null)
      * state.ordinances.getGarbageMultiplier(),
```

> `ServiceRegistry` 拿不拿得到 `state.ordinances` 要先確認 —— 它收的參數是不是完整
> 的 `GameState`。不是的話把 `ordinances` 一起傳進去。

- [ ] **Step 5: 跑測試**

Run: `npx vitest run src/core/district/__tests__/CityLevers.test.ts`
Expected: PASS(7 條)

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 6: revert-verify**

三次，每次只拆一條線:
1. `SimulationLoop` 的 `+ ordinances.getCrimeBonus()` 拿掉 → `should let a city ordinance move crime` 轉紅
2. `SimulationLoop` 的 `+ ordinances.getLandValueBonus()` 拿掉 → `should let a city ordinance move land value` 轉紅
3. `ServiceRegistry` 的 `* ordinances.getGarbageMultiplier()` 拿掉 → `should let a city ordinance move garbage production` 轉紅

每一次都必須**只有**對應那一條轉紅 —— 單元測試（getter 那四條）不該受影響。

- [ ] **Step 7: 提交**

訊息主旨:`feat(district): crime / landValue / garbage 也能在全城生效`

---

### Task 2: 第一批的分區條例（5 條）

只加表格列。這一步驗證的是「機制做好之後加一條條例真的只是加列」。

**Files:**
- Modify: `src/core/district/types.ts`（5 個 enum 成員）
- Modify: `src/core/district/PolicyManager.ts`（`POLICY_CONFIG` + `POLICY_EFFECTS`）
- Modify: `src/core/district/PolicyScope.ts`
- Modify: `src/core/district/PolicyBilling.ts`
- Modify: `src/core/district/PolicyPresentation.ts`（`EFFECT_SUMMARY`）
- Test: `src/core/district/__tests__/PolicyCatalogue.test.ts`（新增）

**Interfaces:**
- Produces:`PolicyType.LEGALIZE_GAMBLING` / `NIGHT_ECONOMY` / `CURFEW` /
  `HERITAGE_PRESERVATION` / `INDUSTRY_SUBSIDY`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/PolicyCatalogue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { POLICY_EFFECTS, POLICY_CONFIG, maxLevel } from '../PolicyManager';
import { POLICY_BILLING } from '../PolicyBilling';
import { POLICY_SCOPE } from '../PolicyScope';
import { policyEffectSummary } from '../PolicyPresentation';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';

/**
 * 目錄的形狀。個別條例的數字會被平衡調動，所以這裡守的是「加一條條例不能漏掉哪
 * 一張表」與「多級條例的價錢必須逐級變貴」，不是某一個數字。
 */

describe('目錄的完整性', () => {
  it('should give every policy a name, a scope and a summary', () => {
    for (const type of Object.values(PolicyType)) {
      expect(POLICY_CONFIG[type]?.name, `${type} 沒有名字`).toBeTruthy();
      expect(POLICY_SCOPE[type], `${type} 沒有範圍`).toBeTruthy();
      for (let lv = 1; lv <= maxLevel(type); lv++) {
        expect(policyEffectSummary(type, lv).length, `${type} 第 ${lv} 級沒有說明`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('should charge more for every step up', () => {
    // 多級條例的單價必須嚴格遞增。持平或倒退的話，高等級會變成「白拿」——
    // 那就不是取捨了。
    for (const [type, billing] of Object.entries(POLICY_BILLING)) {
      for (let i = 1; i < billing!.perUnit.length; i++) {
        expect(billing!.perUnit[i]!, `${type} 第 ${i + 1} 級沒有比前一級貴`)
          .toBeGreaterThan(billing!.perUnit[i - 1]!);
      }
    }
  });

  it('should offer a meaningful number of policies', () => {
    // 條例數量少的話，這整套機制跟原本的價目表沒有差別。
    expect(Object.values(PolicyType).length, '目錄太小').toBeGreaterThanOrEqual(11);
  });
});

describe('賭場與宵禁是一對相反的條例', () => {
  it('should move crime in opposite directions', () => {
    const gambling = POLICY_EFFECTS[PolicyType.LEGALIZE_GAMBLING]![0]!;
    const curfew = POLICY_EFFECTS[PolicyType.CURFEW]![0]!;
    expect(gambling.crime!, '賭場沒有增加犯罪').toBeGreaterThan(0);
    expect(curfew.crime!, '宵禁沒有減少犯罪').toBeLessThan(0);
    // 而且商業收入的方向也相反 —— 一個把夜生活放出來，一個把它關掉。
    expect(gambling.revenueByZone![ZoneType.COMMERCIAL_LOW]!, '賭場沒有加商業收入')
      .toBeGreaterThan(1);
    expect(curfew.revenueByZone![ZoneType.COMMERCIAL_LOW]!, '宵禁沒有扣商業收入')
      .toBeLessThan(1);
  });
});

describe('新條例的分區類型針對性', () => {
  it('should let industry subsidy hit industry only', () => {
    const tier = POLICY_EFFECTS[PolicyType.INDUSTRY_SUBSIDY]![0]!;
    expect(tier.revenueByZone![ZoneType.INDUSTRIAL]!, '產業補貼沒有加工業收入')
      .toBeGreaterThan(1);
    expect(tier.revenueByZone![ZoneType.RESIDENTIAL_LOW], '產業補貼也加到了住宅')
      .toBeUndefined();
    expect(tier.revenue, '產業補貼用了全分區乘數，那會連住宅一起加').toBeUndefined();
  });

  it('should let heritage preservation cost both commerce and housing', () => {
    // 歷史保存是全區都要付代價的 —— 限高與外觀規範對誰都一樣。
    const tier = POLICY_EFFECTS[PolicyType.HERITAGE_PRESERVATION]![0]!;
    expect(tier.landValue!, '歷史保存沒有加地價').toBeGreaterThan(0);
    for (const z of [ZoneType.COMMERCIAL_LOW, ZoneType.RESIDENTIAL_LOW]) {
      expect(tier.revenueByZone![z]!, `分區類型 ${z} 沒有付代價`).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyCatalogue.test.ts`
Expected: FAIL — `PolicyType.LEGALIZE_GAMBLING` 不存在（TypeScript 編譯錯誤）

- [ ] **Step 3: 加 enum 成員**

`types.ts` 的 `PolicyType` 追加:

```ts
  LEGALIZE_GAMBLING = 'LEGALIZE_GAMBLING',
  NIGHT_ECONOMY = 'NIGHT_ECONOMY',
  CURFEW = 'CURFEW',
  HERITAGE_PRESERVATION = 'HERITAGE_PRESERVATION',
  INDUSTRY_SUBSIDY = 'INDUSTRY_SUBSIDY',
```

- [ ] **Step 4: 加四張表**

`PolicyManager.ts` 的 `POLICY_CONFIG`:

```ts
  [PolicyType.LEGALIZE_GAMBLING]: { name: 'Legalize Gambling' },
  [PolicyType.NIGHT_ECONOMY]: { name: 'Night Economy' },
  [PolicyType.CURFEW]: { name: 'Curfew' },
  [PolicyType.HERITAGE_PRESERVATION]: { name: 'Heritage Preservation' },
  [PolicyType.INDUSTRY_SUBSIDY]: { name: 'Industry Subsidy' },
```

`POLICY_EFFECTS`:

```ts
  /**
   * 賭場與宵禁是刻意設計的一對:同一塊地只能選一邊。賭場把夜生活放出來換錢，
   * 宵禁把它關掉換治安。
   */
  [PolicyType.LEGALIZE_GAMBLING]: [
    { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 1.35, [ZoneType.COMMERCIAL_HIGH]: 1.35 }, crime: 12 },
  ],
  // 賭場的溫和版，分兩級。第二級的每 1% 收入要付的犯罪比第一級高。
  [PolicyType.NIGHT_ECONOMY]: [
    { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 1.12, [ZoneType.COMMERCIAL_HIGH]: 1.12 }, crime: 4 },
    { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 1.25, [ZoneType.COMMERCIAL_HIGH]: 1.25 }, crime: 10 },
  ],
  [PolicyType.CURFEW]: [
    { crime: -5, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.90, [ZoneType.COMMERCIAL_HIGH]: 0.90 } },
    { crime: -10, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.78, [ZoneType.COMMERCIAL_HIGH]: 0.78 } },
  ],
  // 限高與外觀規範對誰都一樣，所以住宅也付代價 —— 只是比商業輕。
  [PolicyType.HERITAGE_PRESERVATION]: [
    {
      landValue: 12,
      revenueByZone: {
        [ZoneType.COMMERCIAL_LOW]: 0.92, [ZoneType.COMMERCIAL_HIGH]: 0.92,
        [ZoneType.RESIDENTIAL_LOW]: 0.94, [ZoneType.RESIDENTIAL_HIGH]: 0.94,
      },
    },
  ],
  // 補貼換來的是工廠擴張，代價落在地價上 —— 沒有人想住在旁邊。
  [PolicyType.INDUSTRY_SUBSIDY]: [
    { revenueByZone: { [ZoneType.INDUSTRIAL]: 1.12 }, landValue: -4 },
    { revenueByZone: { [ZoneType.INDUSTRIAL]: 1.25 }, landValue: -9 },
  ],
```

`PolicyScope.ts` 五條都是 `'district'`。

`PolicyBilling.ts`:

```ts
  [PolicyType.LEGALIZE_GAMBLING]: { basis: 'districtCells', perUnit: [4] },
  [PolicyType.NIGHT_ECONOMY]: { basis: 'districtCells', perUnit: [2, 5] },
  [PolicyType.CURFEW]: { basis: 'districtCells', perUnit: [1.5, 4] },
  [PolicyType.HERITAGE_PRESERVATION]: { basis: 'districtCells', perUnit: [3] },
  [PolicyType.INDUSTRY_SUBSIDY]: { basis: 'districtCells', perUnit: [3, 7] },
```

`PolicyPresentation.ts` 的 `EFFECT_SUMMARY`:

```ts
  [PolicyType.LEGALIZE_GAMBLING]: ['Commercial revenue +35%  ·  Crime +12'],
  [PolicyType.NIGHT_ECONOMY]: [
    'Commercial revenue +12%  ·  Crime +4',
    'Commercial revenue +25%  ·  Crime +10',
  ],
  [PolicyType.CURFEW]: [
    'Crime −5  ·  Commercial revenue −10%',
    'Crime −10  ·  Commercial revenue −22%',
  ],
  [PolicyType.HERITAGE_PRESERVATION]: ['Land value +12  ·  Commercial revenue −8%, housing −6%'],
  [PolicyType.INDUSTRY_SUBSIDY]: [
    'Industrial revenue +12%  ·  Land value −4',
    'Industrial revenue +25%  ·  Land value −9',
  ],
```

- [ ] **Step 5: 跑測試**

Run: `npx vitest run src/core/district/__tests__/PolicyCatalogue.test.ts`
Expected: PASS(6 條)

Run: `npx vitest run && npx tsc --noEmit`
Expected:全過。既有的不變量測試（取捨、計費基數、說明）會一起驗這五條。

- [ ] **Step 6: revert-verify**

三次:
1. `CURFEW` 的 `crime: -5` 改成 `crime: 5` → `should move crime in opposite directions` 轉紅
2. `INDUSTRY_SUBSIDY` 第一級改用 `revenue: 1.12`（全分區）→
   `should let industry subsidy hit industry only` 轉紅
3. `NIGHT_ECONOMY` 的 `perUnit` 改成 `[5, 5]` → `should charge more for every step up` 轉紅

再加一次驗證既有的不變量真的接住新條例:
4. `LEGALIZE_GAMBLING` 的 `crime: 12` 拿掉（變成純好處）→
   `PolicyTradeoff.test.ts` 的 `should have at least one downside` 轉紅

- [ ] **Step 7: 提交**

訊息主旨:`feat(district): 五條分區條例 —— 賭場、夜間經濟、宵禁、歷史保存、產業補貼`

---

### Task 3: 第一批的全城條例（2 條）

**Files:**
- Modify: 同 Task 2 的五張表
- Test: `src/core/district/__tests__/PolicyCatalogue.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `getCrimeBonus` / `getLandValueBonus` / `getGarbageMultiplier`
- Produces:`PolicyType.SURVEILLANCE_NETWORK` / `PAY_AS_YOU_THROW`

- [ ] **Step 1: 寫失敗測試**

追加到 `PolicyCatalogue.test.ts`:

```ts
import { CityOrdinances } from '../CityOrdinances';

describe('全城條例', () => {
  it('should let the surveillance network trade privacy for safety', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.SURVEILLANCE_NETWORK, 2);
    expect(o.getCrimeBonus(), '監視器沒有降低犯罪').toBeLessThan(0);
    expect(o.getLandValueBonus(), '監視器沒有代價 —— 被監視是有感覺的').toBeLessThan(0);
  });

  it('should let pay-as-you-throw trade convenience for less garbage', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.PAY_AS_YOU_THROW, 2);
    expect(o.getGarbageMultiplier(), '隨袋徵收沒有減少垃圾').toBeLessThan(1);
    expect(o.getLandValueBonus(), '隨袋徵收沒有代價').toBeLessThan(0);
  });

  it('should bill both of them per resident', () => {
    // 全城條例的 districtCells 恆為 0 —— 用格數計費就等於免費。這條由
    // PolicyBilling.test.ts 的範圍檢查守著，這裡只是把新條例納入它的迴圈。
    for (const t of [PolicyType.SURVEILLANCE_NETWORK, PolicyType.PAY_AS_YOU_THROW]) {
      expect(POLICY_BILLING[t]!.basis, `${t} 不是按人口計費`).toBe('population');
      expect(POLICY_SCOPE[t], `${t} 不是全城條例`).toBe('city');
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyCatalogue.test.ts`
Expected: FAIL — `PolicyType.SURVEILLANCE_NETWORK` 不存在

- [ ] **Step 3: 加兩條**

`types.ts`:

```ts
  SURVEILLANCE_NETWORK = 'SURVEILLANCE_NETWORK',
  PAY_AS_YOU_THROW = 'PAY_AS_YOU_THROW',
```

`POLICY_CONFIG`:`{ name: 'Surveillance Network' }` / `{ name: 'Pay As You Throw' }`

`POLICY_EFFECTS`:

```ts
  // 治安換隱私。地價的代價是刻意的 —— 少了它這條就變成「花錢買治安」的價目表。
  [PolicyType.SURVEILLANCE_NETWORK]: [
    { crime: -6, landValue: -2 },
    { crime: -13, landValue: -5 },
  ],
  // 垃圾費隨袋徵收。少了垃圾，多了居民的不滿。
  [PolicyType.PAY_AS_YOU_THROW]: [
    { garbage: 0.78, landValue: -3 },
    { garbage: 0.58, landValue: -7 },
  ],
```

`PolicyScope.ts` 兩條都是 `'city'`。

`PolicyBilling.ts`:

```ts
  [PolicyType.SURVEILLANCE_NETWORK]: { basis: 'population', perUnit: [0.06, 0.15] },
  [PolicyType.PAY_AS_YOU_THROW]: { basis: 'population', perUnit: [0.05, 0.12] },
```

`EFFECT_SUMMARY`:

```ts
  [PolicyType.SURVEILLANCE_NETWORK]: [
    'Crime −6  ·  Land value −2',
    'Crime −13  ·  Land value −5',
  ],
  [PolicyType.PAY_AS_YOU_THROW]: [
    'Garbage −22%  ·  Land value −3',
    'Garbage −42%  ·  Land value −7',
  ],
```

- [ ] **Step 4: 跑測試**

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 5: revert-verify**

兩次:
1. `SURVEILLANCE_NETWORK` 的 `landValue: -2 / -5` 拿掉 →
   `should let the surveillance network trade privacy for safety` 與
   `PolicyTradeoff` 的 downside 不變量都轉紅
2. `PAY_AS_YOU_THROW` 的 `basis` 改成 `'districtCells'` →
   `PolicyBilling.test.ts` 的 `should bill on the scale that matches its scope` 轉紅

- [ ] **Step 6: 提交**

訊息主旨:`feat(district): 兩條全城條例 —— 監視器網路、垃圾隨袋徵收`

---

### Task 4: `waterDemand` 槓桿 + 節水法規

`WaterNetwork.calculateDemand(grid)` 現在的簽章跟我改之前的 `PowerGrid` 一模一樣 ——
加一個預設 1 的參數，現有呼叫端不必動。

**Files:**
- Modify: `src/core/service/WaterNetwork.ts:124`
- Modify: `src/core/district/PolicyManager.ts`（`PolicyEffect.waterDemand`）
- Modify: `src/core/district/CityOrdinances.ts`（getter）
- Modify: `src/core/simulation/SimulationLoop.ts`（`water.calculateDemand` 呼叫處）
- Modify: `src/Game.ts`（同上）
- Modify: 五張表
- Test: `src/core/simulation/__tests__/UtilityOrdinances.test.ts`（新增）

**Interfaces:**
- Produces:
  - `PolicyEffect.waterDemand?: number`
  - `CityOrdinances.getWaterDemandMultiplier(): number`
  - `WaterNetwork.calculateDemand(grid: Grid, demandMultiplier?: number): void`
  - `PolicyType.WATER_CONSERVATION`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/simulation/__tests__/UtilityOrdinances.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';

/** Small House（RESIDENTIAL_LOW）。 */
const HOUSE = 1;

function city() {
  const state = createGameState(30, 30);
  for (let x = 5; x < 20; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 19; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
  }
  for (let i = 0; i < 200; i++) state.citizens.restoreCitizen({}, 0);
  return { state, loop: new SimulationLoop(state) };
}

describe('節水法規', () => {
  it('should lower total water demand', () => {
    const demandOf = (level: number) => {
      const { state, loop } = city();
      state.ordinances.setLevel(PolicyType.WATER_CONSERVATION, level);
      for (let i = 0; i < 6; i++) loop.tick();
      return state.water.getDemand();
    };
    const plain = demandOf(0);
    expect(plain, '沒有用水需求可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(demandOf(3), '節水法規沒有降低用水需求').toBeLessThan(plain);
  });

  it('should get stronger with level', () => {
    const { state } = city();
    state.ordinances.setLevel(PolicyType.WATER_CONSERVATION, 1);
    const light = state.ordinances.getWaterDemandMultiplier();
    state.ordinances.setLevel(PolicyType.WATER_CONSERVATION, 3);
    expect(state.ordinances.getWaterDemandMultiplier(), '重度沒有比輕度更省水')
      .toBeLessThan(light);
    expect(light, '輕度完全沒有省到水').toBeLessThan(1);
  });
});
```

> `state.water.getDemand()` 的名稱先確認 —— `PowerGrid` 上叫 `getDemand()`，
> `WaterNetwork` 應該一致。

- [ ] **Step 2: 跑測試確認失敗**

Expected: FAIL — `PolicyType.WATER_CONSERVATION` 不存在

- [ ] **Step 3: 加槓桿**

`PolicyEffect` 加:

```ts
  /**
   * 全城用水總需求的乘數。
   *
   * 跟 `powerDemand` 一樣是城市級的池子 —— 只在半個城市要求節水，省下來的水照樣
   * 進同一套管網。帶這個欄位的條例必然是全城範圍。
   */
  waterDemand?: number;
```

`CityOrdinances`:

```ts
  /** 全城用水總需求的乘數。 */
  getWaterDemandMultiplier(): number {
    return this.effect(e => e.waterDemand, 1, (a, b) => a * b);
  }
```

`WaterNetwork.calculateDemand`:

```ts
  /**
   * 重算全城用水總需求。
   *
   * `demandMultiplier` 是全城條例（節水法規）的省水幅度。預設 1，所以沒有帶條例的
   * 呼叫端不必改。
   */
  calculateDemand(grid: Grid, demandMultiplier = 1): void {
    // ... 不變 ...
    this.totalDemand = demand * demandMultiplier;
  }
```

- [ ] **Step 4: 接線**

`SimulationLoop` 與 `Game.ts` 的 `water.calculateDemand(this.state.grid)` 都補上
`, this.state.ordinances.getWaterDemandMultiplier()`。

> 用 `grep -rn "water.calculateDemand" src/` 找出所有正式呼叫端，測試檔不必改
> （預設參數）。

- [ ] **Step 5: 加條例**

`types.ts`:`WATER_CONSERVATION = 'WATER_CONSERVATION',`

`POLICY_CONFIG`:`{ name: 'Water Conservation' }`

`POLICY_EFFECTS`:

```ts
  // 代價落在業者身上:管線與設備更新。工業扣得比商業重 —— 製程用水改造比換一批
  // 水龍頭貴得多。
  [PolicyType.WATER_CONSERVATION]: [
    { waterDemand: 0.92, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.99, [ZoneType.COMMERCIAL_HIGH]: 0.99, [ZoneType.INDUSTRIAL]: 0.98 } },
    { waterDemand: 0.82, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.97, [ZoneType.COMMERCIAL_HIGH]: 0.97, [ZoneType.INDUSTRIAL]: 0.94 } },
    { waterDemand: 0.70, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.94, [ZoneType.COMMERCIAL_HIGH]: 0.94, [ZoneType.INDUSTRIAL]: 0.88 } },
  ],
```

`PolicyScope`:`'city'`。`PolicyBilling`:`{ basis: 'population', perUnit: [0.06, 0.16, 0.36] }`

`EFFECT_SUMMARY`:

```ts
  [PolicyType.WATER_CONSERVATION]: [
    'Water demand −8%  ·  Commercial revenue −1%, industrial −2%',
    'Water demand −18%  ·  Commercial revenue −3%, industrial −6%',
    'Water demand −30%  ·  Commercial revenue −6%, industrial −12%',
  ],
```

> `EFFECT_SUMMARY` 必須含「Water demand」—— `PolicyPresentation.test.ts` 的
> `should describe the quantity each policy actually moves` 要加一條對應
> `waterDemand` 的檢查，不然新欄位不會被那條測試蓋到。

- [ ] **Step 6: 跑測試**

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 7: revert-verify**

兩次:
1. `WaterNetwork` 的 `* demandMultiplier` 拿掉 → `should lower total water demand` 轉紅
2. `EFFECT_SUMMARY` 的第 2 級改成不提 Water →
   `should describe the quantity each policy actually moves` 轉紅

- [ ] **Step 8: 提交**

訊息主旨:`feat(district): 節水法規，用水需求成為全城槓桿`

---

### Task 5: `sewageLoad` 槓桿 + 汙水處理標準

汙水量在 `GarbageSewageProduction.ts` 裡跟垃圾一起算 —— 那裡已經有一個
`getGarbageMultiplier(x, y)` 的逐格 lookup，汙水照同一個形狀加一個。

**Files:**
- Modify: `src/core/service/GarbageSewageProduction.ts:45-90`
- Modify: `src/core/service/ServiceRegistry.ts`（提供乘數）
- Modify: `src/core/district/PolicyManager.ts` / `CityOrdinances.ts` / 五張表
- Test: `src/core/simulation/__tests__/UtilityOrdinances.test.ts`（追加）

**Interfaces:**
- Produces:
  - `PolicyEffect.sewageLoad?: number`
  - `CityOrdinances.getSewageMultiplier(): number`
  - `PolicyType.SEWAGE_STANDARDS`

- [ ] **Step 1: 寫失敗測試**

追加到 `UtilityOrdinances.test.ts`:

```ts
describe('汙水處理標準', () => {
  it('should lower total sewage produced', () => {
    const sewageOf = (level: number) => {
      const { state, loop } = city();
      state.ordinances.setLevel(PolicyType.SEWAGE_STANDARDS, level);
      for (let i = 0; i < 12; i++) loop.tick();
      return state.sewage.getTotalSewage();
    };
    const plain = sewageOf(0);
    expect(plain, '沒有汙水可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(sewageOf(2), '汙水處理標準沒有降低汙水量').toBeLessThan(plain);
  });
});
```

> `state.sewage` 取得總汙水量的方法名稱先確認。沒有現成 getter 的話，改成讀
> `calculateGarbageAndSewage` 的回傳值 `{ sewage }` —— **不要**改成直接呼叫
> `getSewageMultiplier`。

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: 加槓桿與參數**

`PolicyEffect` 加 `sewageLoad?: number;`（註解說明它是城市級的池子）。

`CityOrdinances` 加 `getSewageMultiplier()`。

`calculateGarbageAndSewage` 的參數列加一個:

```ts
  /**
   * Multiplier on sewage produced at this cell — the Sewage Standards city
   * ordinance. Defaults to 1 so callers with no ordinances are unaffected.
   */
  getSewageMultiplier: OccupancyLookup = () => 1,
```

並在汙水那一行乘上去。

- [ ] **Step 4: 接線**

`ServiceRegistry` 傳入 `() => state.ordinances.getSewageMultiplier()`。

- [ ] **Step 5: 加條例**

`SEWAGE_STANDARDS`,`'city'`,`{ basis: 'population', perUnit: [0.08, 0.2] }`:

```ts
  // 汙水處理標準。代價幾乎全落在工業 —— 家庭汙水本來就沒什麼可處理的。
  [PolicyType.SEWAGE_STANDARDS]: [
    { sewageLoad: 0.85, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.96 } },
    { sewageLoad: 0.70, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.90 } },
  ],
```

`EFFECT_SUMMARY`:

```ts
  [PolicyType.SEWAGE_STANDARDS]: [
    'Sewage −15%  ·  Industrial revenue −4%',
    'Sewage −30%  ·  Industrial revenue −10%',
  ],
```

`PolicyPresentation.test.ts` 的量詞檢查加一條 `sewageLoad → 'Sewage'`。

- [ ] **Step 6: 跑測試 + revert-verify**

Run: `npx vitest run && npx tsc --noEmit`

revert-verify:把 `getSewageMultiplier` 的乘法拿掉 →
`should lower total sewage produced` 轉紅。

- [ ] **Step 7: 提交**

訊息主旨:`feat(district): 汙水處理標準，汙水量成為全城槓桿`

---

### Task 6: `industrialPollution` 槓桿 + 工業排放管制

工業汙染源在 `GridPollutionSources.ts:74-76` 發出，條件是
`cell.zoneType === ZoneType.INDUSTRIAL`。那裡是唯一的發射點。

**Files:**
- Modify: `src/core/environment/GridPollutionSources.ts`
- Modify: `src/core/simulation/SimulationLoop.ts:1088`（`forEachGridPollutionSource` 呼叫處）
- Modify: `src/core/district/PolicyManager.ts` / `CityOrdinances.ts` / 五張表
- Test: `src/core/simulation/__tests__/UtilityOrdinances.test.ts`（追加）

**Interfaces:**
- Produces:
  - `PolicyEffect.industrialPollution?: number`
  - `CityOrdinances.getIndustrialPollutionMultiplier(): number`
  - `forEachGridPollutionSource(grid, emit, elevatedRoadType, industrialMultiplier?)`
  - `PolicyType.INDUSTRIAL_EMISSION_CONTROL`

- [ ] **Step 1: 寫失敗測試**

追加到 `UtilityOrdinances.test.ts`:

```ts
describe('工業排放管制', () => {
  it('should lower pollution around industry', () => {
    const pollutionAt = (level: number) => {
      const state = createGameState(30, 30);
      const loop = new SimulationLoop(state);
      for (let x = 5; x < 15; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
      // 工業建築直接種進格子 —— 成長路徑要水電。
      for (let x = 6; x < 14; x++) {
        state.grid.setCell(x, 11, { zoneType: ZoneType.INDUSTRIAL, buildingId: 13 });
      }
      state.ordinances.setLevel(PolicyType.INDUSTRIAL_EMISSION_CONTROL, level);
      // updatePollution 在 tick 2 跑。
      for (let i = 0; i < 6; i++) loop.tick();
      return state.grid.getCell(10, 11)!.pollution;
    };
    const plain = pollutionAt(0);
    expect(plain, '沒有汙染可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(pollutionAt(3), '排放管制沒有降低工業汙染').toBeLessThan(plain);
  });

  it('should leave road noise alone', () => {
    // 管制的是工廠不是馬路。連道路噪音一起降的話，玩家會以為蓋高速公路變便宜了。
    const noiseAt = (level: number) => {
      const state = createGameState(30, 30);
      const loop = new SimulationLoop(state);
      for (let x = 5; x < 25; x++) {
        state.grid.setCell(x, 10, { roadType: 4, roadFlags: 0b1111, trafficDensity: 200 });
      }
      state.ordinances.setLevel(PolicyType.INDUSTRIAL_EMISSION_CONTROL, level);
      for (let i = 0; i < 6; i++) loop.tick();
      return state.grid.getCell(15, 10)!.pollution;
    };
    const plain = noiseAt(0);
    expect(plain, '沒有道路汙染可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(noiseAt(3), '排放管制連道路噪音也一起降了').toBe(plain);
  });
});
```

> `roadType: 4` 是不是高速公路要先確認;沒有噪音的話換一個會產生噪音的 roadType。

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: 加參數**

`forEachGridPollutionSource` 加第四個參數:

```ts
  /**
   * 工業汙染源的乘數 —— 工業排放管制條例。預設 1。
   *
   * 只作用在工業源:管制的是工廠不是馬路，連道路噪音一起降的話玩家會以為蓋高速
   * 公路變便宜了。
   */
  industrialMultiplier = 1,
```

第 75–76 行的兩個 `emit` 把 `amount` 乘上去。

- [ ] **Step 4: 接線**

`SimulationLoop.updatePollution` 的呼叫補上
`this.state.ordinances.getIndustrialPollutionMultiplier()`。

- [ ] **Step 5: 加條例**

`INDUSTRIAL_EMISSION_CONTROL`,`'city'`,
`{ basis: 'population', perUnit: [0.07, 0.18, 0.4] }`:

```ts
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: [
    { industrialPollution: 0.80, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.95 } },
    { industrialPollution: 0.60, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.88 } },
    { industrialPollution: 0.40, revenueByZone: { [ZoneType.INDUSTRIAL]: 0.78 } },
  ],
```

`EFFECT_SUMMARY`:

```ts
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: [
    'Industrial pollution −20%  ·  Industrial revenue −5%',
    'Industrial pollution −40%  ·  Industrial revenue −12%',
    'Industrial pollution −60%  ·  Industrial revenue −22%',
  ],
```

量詞檢查加一條 `industrialPollution → 'Industrial pollution'`。

- [ ] **Step 6: 跑測試 + revert-verify**

兩次:
1. `emit` 的乘法拿掉 → `should lower pollution around industry` 轉紅
2. 把乘數也套到道路噪音上 → `should leave road noise alone` 轉紅

- [ ] **Step 7: 提交**

訊息主旨:`feat(district): 工業排放管制，工業汙染成為全城槓桿`

---

### Task 7: UI 承載 16 條條例

分區面板現在是一排會換行的按鈕，5 條剛好;變成 10 條會擠成一團。全城條例從 1 條
變成 5 條，需要分組。

**Files:**
- Modify: `src/ui/modals/DistrictModal.tsx`
- Modify: `src/ui/modals/CityOrdinanceModal.tsx`
- Modify: `src/core/district/PolicyPresentation.ts`（分組）
- Test: `src/core/district/__tests__/PolicyPresentation.test.ts`（追加）

**Interfaces:**
- Produces:
  - `POLICY_CATEGORY: Record<PolicyType, 'land' | 'economy' | 'safety' | 'environment'>`
  - `policiesByCategory(scope: PolicyScopeKind): { category: string; types: PolicyType[] }[]`

- [ ] **Step 1: 寫失敗測試**

```ts
describe('條例分組', () => {
  it('should put every policy in exactly one category', () => {
    for (const type of Object.values(PolicyType)) {
      expect(POLICY_CATEGORY[type], `${type} 沒有分類`).toBeTruthy();
    }
  });

  it('should list every district policy exactly once', () => {
    const flat = policiesByCategory('district').flatMap(g => g.types);
    expect(new Set(flat).size, '有條例被列了兩次').toBe(flat.length);
    expect([...flat].sort()).toEqual([...districtOfferedPolicies()].sort());
  });

  it('should list every city ordinance exactly once', () => {
    const flat = policiesByCategory('city').flatMap(g => g.types);
    const cityTypes = (Object.values(PolicyType) as PolicyType[])
      .filter(t => POLICY_SCOPE[t] === 'city');
    expect([...flat].sort()).toEqual([...cityTypes].sort());
  });

  it('should not produce an empty group', () => {
    // 空的分組在畫面上是一個沒有內容的標題。
    for (const scope of ['district', 'city'] as const) {
      for (const g of policiesByCategory(scope)) {
        expect(g.types.length, `${scope} 的 ${g.category} 是空的`).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: 加分類表與分組函式**

```ts
/**
 * 條例的分類。純粹是 UI 的分組 —— 16 條排成一排的話，玩家找不到自己要的那條。
 *
 * 完整的 `Record` 不是 `Partial`:加了新條例卻忘了分類，型別檢查會擋下來。
 */
export const POLICY_CATEGORY: Record<PolicyType, PolicyCategory> = { /* ... */ };

/** 某個範圍的條例，依分類分組。空的分組不會出現。 */
export function policiesByCategory(scope: PolicyScopeKind): PolicyGroup[] { /* ... */ }
```

- [ ] **Step 4: 兩個面板改用分組**

分區面板:每個分類一個小標題 + 一排按鈕。
全城面板:每個分類一個小標題 + 若干列。

- [ ] **Step 5: 手動驗收**

```bash
pnpm dev
```
1. 開新遊戲 → 畫一塊分區 → 開 District 面板 → 確認 10 條分區條例都在、分組清楚、
   金額正確
2. 開 City Ordinances → 確認 5 條全城條例都在、四個分類都有內容
3. 造人口後開 Overview → Economy → 展開 Policies，確認逐條加總等於總額
4. 全部英文，沒有中文字串

- [ ] **Step 6: 全套驗證與提交**

Run: `npx vitest run && npx tsc --noEmit`
Run: `npx eslint src/core/district src/ui/modals`

訊息主旨:`feat(ui): 條例面板依分類分組`

---

### Task 8: 文件與收尾

- [ ] **Step 1: 更新 `docs/district-policy-system.md`**

把 16 條全部列進表格（範圍、級數、計費、效果與代價），並補一節說明「加一條條例要
動哪五張表」。

- [ ] **Step 2: 更新 `TODO.md`**

勾掉第一批與第二批，把第三批（育兒補貼、義務教育、免費診所、禁菸令、壅塞費）列成
待辦，並寫明各自缺哪一個槓桿的接點。

- [ ] **Step 3: 提交**

訊息主旨:`docs(district): 條例目錄擴充到 16 條`

---

## 這份計畫**不含**的

- **第三批條例**:育兒補貼（`Birth.ts` 的 `baseRate`）、義務教育
  （`CitizenManager.educateTick`）、免費診所與禁菸令（`Happiness` 的 factors）、
  壅塞費（交通）。每一條都要先決定槓桿接在哪一行，那是設計問題不是實作問題，
  另開一份計畫。
- **數值平衡**。16 條的數字全是設計時估的，沒有實機平衡過。加完之後應該要有一輪
  實測，那是獨立的工作。
