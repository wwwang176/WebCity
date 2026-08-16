# 條例系統核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把現有的分區政策從「五條純好處的價目表」改造成有強度、有取捨、費用隨規模走的條例系統,並讓條例可以是全城的。

**Architecture:** 不新增系統,擴充既有的 `PolicyManager`。四件事:(1) 收入乘數認得分區類型,代價才能只落在特定產業上;(2) `Policy.active: boolean` 換成 `level: 0..3`,`POLICY_EFFECTS` 從單一物件變成每級一格的陣列;(3) 費用從存在 `Policy.cost` 的常數,改成由 `POLICY_BILLING` 的計費基數 × 規模算出來;(4) 加一張 `POLICY_SCOPE` 表區分分區條例與全城條例,全城的存在新的 `CityOrdinances`。條例目錄本身(賭場、壅塞費、育兒補貼等)**不在這份計畫裡** —— 機制做好之後那些只是往表格加列。唯一的例外是節能法規,它是唯一一條全城條例,不加它的話全城那條路徑沒有東西可測。

**Tech Stack:** TypeScript、Vitest、Solid.js(UI)。`src/core/` 禁止 import Three.js。

## Global Constraints

- **TDD 強制**:每個 task 先寫失敗測試,再寫實作。實作完成後做 revert-verify —— 暫時把守衛拿掉,確認測試轉紅;沒轉紅表示測試無效,要修測試或刪掉沒有理由存在的程式碼。
- **每個 task 結束時 `npx tsc --noEmit` 與 `npx vitest run` 都必須是綠的。** 這份計畫的任務順序就是為了這件事排的 —— 不允許出現「等後面某個 task 才會編得過」的中間狀態。
- **測試指令**:`npx vitest run <path>`;全套 `npx vitest run`。基準是 **400 檔 / 5817 測試**全過。
- **型別檢查**:`npx tsc --noEmit` 必須乾淨。
- **Lint**:`npx eslint <changed files>` 對新改的檔案必須乾淨。`SimulationLoop.ts` 與 `Game.ts` 有 29 個既有錯誤,不得增加。
- **註解寫設計事實,不記錄對話**。不要在註解裡引用使用者說過的話。
- **發現 bug 必須寫入 `BUGS.md` 與 `TODO.md`**。
- **提交訊息結尾**必須有:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PUNdiSMJZXNukDkSyfcUqX
  ```
- **不要用 PowerShell here-string 寫提交訊息**,寫進暫存檔再 `git commit -F`。

---

## 檔案結構

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src/core/district/types.ts` | `Policy` / `District` / `PolicyType` 的型別 | 修改:`active` → `level`,新增 `ENERGY_REGULATION` |
| `src/core/district/PolicyManager.ts` | 分區條例的套用、查詢、效果合成 | 修改:分級、`crime` 槓桿、`revenueByZone`、scope 檢查 |
| `src/core/district/PolicyBilling.ts` | **新增** 計費基數表與費用計算 | 建立 |
| `src/core/district/PolicyScope.ts` | **新增** 分區 / 全城的分類表 | 建立 |
| `src/core/district/CityOrdinances.ts` | **新增** 全城條例的狀態、查詢與費用 | 建立 |
| `src/core/district/PolicyPresentation.ts` | **新增** UI 用的純函式(下一級、按鈕標籤) | 建立 |
| `src/core/district/DistrictManager.ts` | 分區存檔序列化 | 修改:存檔遷移 |
| `src/core/economy/ExpenseCalculator.ts` | 政策支出加總與逐條明細 | 修改:改用計費表、新增 `listPolicyExpenses` |
| `src/core/economy/IncomeCalcAdapter.ts` | 收入乘數的組裝 | 修改:帶 zoneType |
| `src/core/economy/IncomeCalculator.ts` | 逐格收入計算 | 修改:`getRevenueMultiplier` 簽章 |
| `src/core/economy/EconomyBreakdownContext.ts` | 預算面板的資料來源 | 修改:計費簽章、全城條例 |
| `src/core/service/PowerGrid.ts` | 電力需求 | 修改:`calculateDemand` 收需求乘數 |
| `src/core/simulation/SimulationLoop.ts` | 模擬迴圈 | 修改:犯罪進地價、全城條例進預算與電力 |
| `src/core/simulation/GameState.ts` | 遊戲狀態容器 | 修改:新增 `ordinances` |
| `src/core/save/Serializer.ts` | 存檔 | 修改:序列化全城條例 |
| `src/ui/modals/DistrictModal.tsx` | 分區條例 UI | 修改:分級按鈕 |
| `src/ui/modals/CityOrdinanceModal.tsx` | **新增** 全城條例 UI | 建立 |

新增檔案刻意拆開:計費、範圍分類、全城狀態、UI 純邏輯是四件會各自長大的事,塞進已經 214 行的 `PolicyManager.ts` 只會讓它變得難改。

## 測試夾具的兩個陷阱

這兩件事讓一整批「看起來合理」的接線測試其實從來沒有跑到要驗的那條路:

**一、地價與電力需求都跳過沒有建築的格子。** `updateLandValue`
(`SimulationLoop.ts:1122`)與 `PowerGrid.calculateDemand`(`PowerGrid.ts:141`)開頭
都是 `if (cell.buildingId === 0) return;`。只畫道路與 zoning 是長不出建築的 ——
`BuildingGrowth.ts:36-46` 要求該格有電有水,而測試城市沒有電廠水廠。所以要
**直接種建築**:`state.grid.setCell(x, y, { zoneType, buildingId })`,住宅用 1、商業
用 7、工業用 13(見 `Simulation.test.ts:292` 的既有用法)。這樣做同時避開了成長路徑
的隨機性。

**二、`getPopulation()` 是市民陣列的長度,新遊戲是 0。** 以人口計費的條例在人口 0
時費用是 0,任何「費用有沒有進帳」的斷言都會變成空測試。要造人口就呼叫
`state.citizens.restoreCitizen({}, 0)`,`CitizenManager.setPopulationForTest` **不存在**。

排程:`clock.advance()` 先進位,所以第一次 `loop.tick()` 拿到的是 tick 1。
`updateLandValue` 在 tick 2 跑(之後每 60),`calculateIncome` 在 `slowSlot === 5`
跑(tick 5、11、…)。**跑六次 `tick()` 就同時涵蓋這兩者**,而且短到不會被成長與
遷居的隨機性汙染。

## 任務順序為什麼是這樣

Task 1 先做收入乘數的分區類型,是因為分級的效果表從第一天就要用 `revenueByZone`
——「只扣商業收入」是多數條例代價的形狀。如果先做分級再改簽章,分級那一版的效果表
與它的測試會在改簽章時整批作廢。

`Policy.cost` 撐到 Task 5 才刪。`ExpenseCalculator` 現在讀的就是它,提早刪掉會讓
Task 2~4 中間的每一步都編不過。

`POLICY_SCOPE` 與 `CityOrdinances` 一起做(Task 6),而且**當場就接進模擬與預算**。
只接狀態不接效果的話,Task 8 的明細會跟實際帳本對不起來,而那正是 Task 8 要保證的事。

---

### Task 1: 收入乘數認得分區類型

「只扣商業收入」目前做不到 —— `getRevenueMultiplier(x, y)` 只有座標,所以任何收入
代價都會平均落在住宅、商業、工業、辦公上。分級的效果表要從第一天就用得到這個。

**Files:**
- Modify: `src/core/district/PolicyManager.ts:46-57`(`POLICY_EFFECTS` 抽出具名型別)、`:179-181`(`getRevenueMultiplier`)
- Modify: `src/core/economy/IncomeCalculator.ts:43`(`BuildingIncomeDeps.getRevenueMultiplier`)、`:85`、`:90`(兩個呼叫處)
- Modify: `src/core/economy/IncomeCalcAdapter.ts:41-49`
- Test: `src/core/economy/__tests__/RevenueByZone.test.ts`(新增)

**Interfaces:**
- Produces:
  - `export interface PolicyEffect { garbage?: number; revenue?: number; landValue?: number; revenueByZone?: Partial<Record<ZoneType, number>> }`
  - `PolicyManager.getRevenueMultiplier(districtId: string | null, zoneType: ZoneType): number`
  - `BuildingIncomeDeps.getRevenueMultiplier?: (x: number, y: number, zoneType: ZoneType) => number`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/economy/__tests__/RevenueByZone.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ZoneType } from '../../grid/types';
import { DistrictManager } from '../../district/DistrictManager';
import { PolicyManager, POLICY_EFFECTS } from '../../district/PolicyManager';
import { PolicyType } from '../../district/types';
import { calculateBuildingIncome } from '../IncomeCalculator';
import { getBuildingType } from '../../building/types';

/**
 * 暫時把某一條政策的效果換掉。測的是機制，不是某一條政策現在剛好長什麼樣 ——
 * 綁死在真實條目上的話，之後調整那條政策的數字就會誤傷這支測試。
 *
 * `POLICY_EFFECTS` 的值在 Task 3 會從單一物件變成陣列。這個 helper 是屆時唯一
 * 要改的地方。
 */
function withEffect(type: PolicyType, effect: unknown, body: () => void) {
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = effect;
  try { body(); } finally { (POLICY_EFFECTS as Record<string, unknown>)[type] = saved; }
}

describe('收入乘數認得分區類型', () => {
  it('should apply a zone-scoped multiplier only to that zone', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    withEffect(PolicyType.TOURISM, { revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.5 } }, () => {
      pm.applyPolicy(d.id, PolicyType.TOURISM);
      expect(pm.getRevenueMultiplier(d.id, ZoneType.COMMERCIAL_LOW), '商業沒有被扣').toBe(0.5);
      expect(pm.getRevenueMultiplier(d.id, ZoneType.RESIDENTIAL_LOW), '住宅也被扣了').toBe(1);
    });
  });

  it('should hand the building zone type to the multiplier', () => {
    // 這條抓的是接線:簽章改了但呼叫端沒傳，PolicyManager 的單元測試照樣會過。
    // buildingId 1 是 Small House（RESIDENTIAL_LOW），見 building/types.ts:24。
    const HOUSE = 1;
    const expected = getBuildingType(HOUSE)!.zoneType;

    const seen: number[] = [];
    calculateBuildingIncome({
      taxRates: { residential: 10, business: 10 },
      getResidentEducations: () => [],
      getRevenueMultiplier: (_x, _y, zoneType) => { seen.push(zoneType); return 1; },
    }, 3, 4, HOUSE);

    expect(seen, 'getRevenueMultiplier 沒有收到分區類型').toEqual([expected]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/economy/__tests__/RevenueByZone.test.ts`
Expected: FAIL — `getRevenueMultiplier` 多了一個參數 / `seen` 是 `[undefined]`

- [ ] **Step 3: 把 `POLICY_EFFECTS` 的行內型別抽成 `PolicyEffect`**

`PolicyManager.ts`,把第 46–57 行改成:

```ts
export interface PolicyEffect {
  /** Multiplier on garbage produced in the district. */
  garbage?: number;
  /** Multiplier on tax revenue from every building in the district. */
  revenue?: number;
  /** Flat addition to land value before the usual clamp. */
  landValue?: number;
  /**
   * 只作用在特定分區類型的收入乘數。
   *
   * `revenue` 是全分區一視同仁,做不出「只扣商業」—— 而多數條例的代價本來就
   * 落在特定產業上(回收增加商家的處理成本,跟住戶無關)。
   */
  revenueByZone?: Partial<Record<ZoneType, number>>;
}

export const POLICY_EFFECTS: Partial<Record<PolicyType, PolicyEffect>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: { garbage: 0.65 },
  [PolicyType.TOURISM]: { revenue: 1.2 },
  [PolicyType.ORGANIC_FOOD]: { landValue: 6 },
};
```

同時把 `effect()` 的 `pick` 型別從
`(e: NonNullable<(typeof POLICY_EFFECTS)[PolicyType]>) => number | undefined`
改成 `(e: PolicyEffect) => number | undefined` —— 原本那個型別在 Task 3 把表改成
陣列之後會變成 `PolicyEffect[]`,`e.garbage` 會對陣列取不存在的欄位。

- [ ] **Step 4: 改 `getRevenueMultiplier`**

```ts
  /** Multiplier on tax revenue from buildings of this zone type in this district. */
  getRevenueMultiplier(districtId: string | null, zoneType: ZoneType): number {
    const flat = this.effect(districtId, e => e.revenue, 1, (a, b) => a * b);
    return flat * this.effect(districtId, e => e.revenueByZone?.[zoneType], 1, (a, b) => a * b);
  }
```

- [ ] **Step 5: 一路改到 `IncomeCalculator` 與 `IncomeCalcAdapter`**

`IncomeCalculator.ts` 第 43 行:

```ts
  /** Optional per-building revenue multiplier (e.g. district specialization). */
  getRevenueMultiplier?: (x: number, y: number, zoneType: ZoneType) => number;
```

第 85、90 行的兩個呼叫都在 `calculateBuildingIncome()` 裡,**作用域內沒有 `cell`**
—— 可用的是第 74 行取得的 `btype`:

```ts
    if (deps.getRevenueMultiplier) income *= deps.getRevenueMultiplier(x, y, btype.zoneType);
```

`IncomeCalcAdapter.ts`:

```ts
    getRevenueMultiplier: (x, y, zoneType) => {
      const district = state.districts.getDistrictAt(x, y);
      if (!district) return 1;
      return getSpecializationBonus(district.specialization).revenueMultiplier
        * state.policies.getRevenueMultiplier(district.id, zoneType);
    },
```

- [ ] **Step 6: 修既有呼叫端**

Run: `npx tsc --noEmit`
已知會打到 `src/core/district/__tests__/PolicyEffects.test.ts` 的 6 個單參數呼叫
(第 76、80、82、127、128、136 行)。全部補上第二個參數,並 import `ZoneType`。
`tsc` 會列出其他漏網的。

- [ ] **Step 7: 跑測試**

Run: `npx vitest run src/core/economy/__tests__/RevenueByZone.test.ts`
Expected: PASS(2 條)

Run: `npx vitest run && npx tsc --noEmit`
Expected: 401 檔全過、型別乾淨

- [ ] **Step 8: revert-verify**

把 Step 5 的 `btype.zoneType` 改回不傳(`deps.getRevenueMultiplier(x, y)`,並把型別
改成第三參數可選),`should hand the building zone type to the multiplier` 必須轉紅。
確認後改回來。

- [ ] **Step 9: 提交**

訊息主旨:`feat(economy): 收入乘數認得分區類型`

---

### Task 2: `Policy.level` 取代 `active`

分級的前置。`active: boolean` 表達不了「輕度/中度/重度」,而且三個 enum 成員
(`ENERGY_LIGHT` 等)會讓互斥檢查變成另一份要手動同步的東西 —— 一個欄位只能是一個值,
互斥自動成立。

**`Policy.cost` 這一步先留著。** `ExpenseCalculator` 現在讀的就是它,Task 5 才有替代品;
提早刪掉會讓 Task 2~4 每一步都編不過。

**Files:**
- Modify: `src/core/district/types.ts:21-27`
- Modify: `src/core/district/PolicyManager.ts:100-141`、`:165-166`
- Modify: `src/core/district/DistrictManager.ts:145-158`(`fromJSON` 遷移)
- Modify: `src/core/economy/ExpenseCalculator.ts:12-22`(`active` → `level > 0`)
- Modify: `src/ui/modals/DistrictModal.tsx:54-57,84`
- Test: `src/core/district/__tests__/PolicyLevel.test.ts`(新增)

**Interfaces:**
- Produces:
  - `Policy.level: 0 | 1 | 2 | 3`(0 = 關閉,取代 `active: false`);`cost` 保留不動
  - `PolicyManager.setPolicyLevel(districtId: string, type: PolicyType, level: number): void`
  - `PolicyManager.getPolicyLevel(districtId: string | null, type: PolicyType): number`
  - `PolicyManager.isPolicyActive(districtId: string, type: PolicyType): boolean`(保留,等價於 `level > 0`)
  - `PolicyManager.applyPolicy` **刪除**(等價於 `setPolicyLevel(id, type, 1)`);`removePolicy` 保留

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/PolicyLevel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager } from '../PolicyManager';
import { PolicyType } from '../types';

function fresh() {
  const dm = new DistrictManager();
  const d = dm.createDistrict('D');
  return { dm, pm: new PolicyManager(dm), id: d.id };
}

describe('條例的強度', () => {
  it('should store the level it was set to', () => {
    const { pm, id } = fresh();
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 2);
    expect(pm.getPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING)).toBe(2);
  });

  it('should treat level 0 as off', () => {
    const { pm, id } = fresh();
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 3);
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 0);
    expect(pm.isPolicyActive(id, PolicyType.ENCOURAGE_RECYCLING)).toBe(false);
  });

  it('should hold only one level per type', () => {
    // 互斥要由「一個欄位只能是一個值」保證，不是由另外寫的檢查保證。
    const { pm, id, dm } = fresh();
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 1);
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 3);
    const entries = dm.getDistrict(id)!.policies
      .filter(p => p.type === PolicyType.ENCOURAGE_RECYCLING);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe(3);
  });
});

describe('舊存檔的遷移', () => {
  function load(policy: Record<string, unknown>) {
    const dm = DistrictManager.fromJSON({
      nextId: 2,
      districts: [{
        id: 'district_1', name: 'D', cells: ['1,1'],
        policies: [policy], specialization: 'NONE',
      }],
    } as never);
    return new PolicyManager(dm).getPolicyLevel('district_1', PolicyType.ENCOURAGE_RECYCLING);
  }
  const base = { id: 'p1', name: 'R', type: PolicyType.ENCOURAGE_RECYCLING, cost: 100 };

  it('should turn an old active:true into level 1', () => {
    // 掉成 0 的話，玩家讀檔會發現政策全被關掉了，而畫面上沒有任何東西說明為什麼。
    expect(load({ ...base, active: true })).toBe(1);
  });

  it('should turn an old active:false into level 0', () => {
    expect(load({ ...base, active: false })).toBe(0);
  });

  it('should clamp a corrupt level from a tampered save', () => {
    // `level` 宣告成 0|1|2|3。存檔是使用者能編輯的檔案，讀進來不夾住就會破壞不變量。
    expect(load({ ...base, level: 99 })).toBe(3);
    expect(load({ ...base, level: -1 })).toBe(0);
    expect(load({ ...base, level: 2.7 })).toBe(2);
    expect(load({ ...base, level: NaN })).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyLevel.test.ts`
Expected: FAIL — `pm.setPolicyLevel is not a function`

- [ ] **Step 3: 改型別**

`src/core/district/types.ts`:

```ts
export interface Policy {
  id: string;
  name: string;
  type: PolicyType;
  /** 每期費用。Task 5 會改成由 `POLICY_BILLING` 依規模算，屆時這一欄刪除。 */
  cost: number;
  /**
   * 強度。0 = 關閉。
   *
   * 用一個等級欄位而不是三個 enum 成員（LIGHT / MEDIUM / HEAVY），是因為互斥
   * 必須自動成立 —— 分成三個成員的話，「不能同時開輕度和重度」會變成另一份要
   * 手動維護的檢查，而漏掉的那一條不會有任何徵兆。
   */
  level: 0 | 1 | 2 | 3;
}
```

- [ ] **Step 4: 改 `PolicyManager`**

刪掉 `applyPolicy`,換成:

```ts
  setPolicyLevel(districtId: string, policyType: PolicyType, level: number): void {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return;
    const clamped = clampLevel(level, maxLevel(policyType));

    const existing = district.policies.find((p) => p.type === policyType);
    if (existing) {
      existing.level = clamped;
      return;
    }
    if (clamped === 0) return;

    const cfg = POLICY_CONFIG[policyType];
    district.policies.push({
      id: `policy_${this.nextPolicyId++}`,
      name: cfg.name,
      type: policyType,
      cost: cfg.cost,
      level: clamped,
    });
  }

  getPolicyLevel(districtId: string | null, policyType: PolicyType): number {
    if (!districtId) return 0;
    return this.districtLookup.getDistrict(districtId)
      ?.policies.find((p) => p.type === policyType)?.level ?? 0;
  }

  isPolicyActive(districtId: string, policyType: PolicyType): boolean {
    return this.getPolicyLevel(districtId, policyType) > 0;
  }
```

`effect()` 裡的 `if (!policy.active) continue;` 改成 `if (policy.level === 0) continue;`。

模組層級加兩個函式(`maxLevel` 在 Task 3 才會有真正的實作):

```ts
/**
 * 把任意數字夾成合法的等級。
 *
 * 存檔是使用者能編輯的檔案，而 `Policy.level` 宣告成 `0 | 1 | 2 | 3` —— 沒有夾住
 * 的話，`-1` / `4` / 小數 / `NaN` 會直接破壞那個不變量，而 TypeScript 只在編譯期
 * 看得到它。`NaN` 走 `Math.max(0, NaN)` 仍是 `NaN`，所以要先擋。
 */
export function clampLevel(level: number, max: number): Policy['level'] {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(max, Math.floor(level))) as Policy['level'];
}

/** 這個條例最高幾級。Task 3 改成從 POLICY_EFFECTS 的長度推導。 */
export function maxLevel(_type: PolicyType): number {
  return 3;
}
```

- [ ] **Step 5: 加存檔遷移**

`DistrictManager.ts`。先把 `SerializedDistrict.policies` 的型別放寬成同時容納兩種形狀:

```ts
/** 舊存檔的政策沒有 `level`，只有 `active`。 */
export type SerializedPolicy =
  Omit<Policy, 'level'> & { level?: number; active?: boolean };

export interface SerializedDistrict {
  id: string;
  name: string;
  cells: string[];
  taxRateOverride?: TaxRates;
  policies: SerializedPolicy[];
  specialization: Specialization;
}
```

`fromJSON` 的 policies 那一行:

```ts
        policies: (sd.policies ?? []).map((p) => ({
          id: p.id, name: p.name, type: p.type, cost: p.cost,
          // 舊存檔只有 active。掉成 0 的話玩家讀檔會發現政策全被關掉了，而畫面上
          // 沒有任何東西說明為什麼。新格式的 level 也要夾 —— 存檔是能被編輯的。
          level: clampLevel(p.level ?? (p.active ? 1 : 0), maxLevel(p.type)),
        })),
```

`import { clampLevel, maxLevel } from './PolicyManager';`

- [ ] **Step 6: 改所有呼叫端**

`ExpenseCalculator.ts` 的參數型別與判斷:

```ts
export function calculateDistrictPolicyCost(
  districts: readonly { policies: readonly { level: number; cost: number; type: PolicyType }[] }[],
): number {
  let total = 0;
  for (const district of districts) {
    for (const policy of district.policies) {
      if (policy.level > 0 && isPolicyImplemented(policy.type)) total += policy.cost;
    }
  }
  return total;
}
```

`DistrictModal.tsx` 第 57 行 `applyPolicy(...)` → `setPolicyLevel(districtId, policyType, 1)`;
第 84 行 `p.active` → `p.level > 0`。

Run: `npx tsc --noEmit`
已知會打到的測試檔(每一支都要改):

| 檔案 | 內容 |
|---|---|
| `src/core/economy/__tests__/RevenueByZone.test.ts` | **Task 1 自己剛寫的那支**,裡面有 `pm.applyPolicy(...)`。漏掉它 Task 2 就編不過 |
| `src/core/district/__tests__/District.test.ts` | `applyPolicy` 呼叫 |
| `src/core/district/__tests__/PolicyEffects.test.ts` | 9 個 `applyPolicy`,外加直接寫 `d.policies[0].active = false` 的休眠測試 → 改成 `.level = 0` |
| `src/core/district/__tests__/PolicyEffectiveness.test.ts` | 2 個 `applyPolicy`,多個 mock policy 用 `{ active, cost }` → 改 `{ level, cost }` |
| `src/core/economy/__tests__/EconomyPanelMatchesBudget.test.ts` | 1 個 |
| `src/core/economy/__tests__/ExpenseCalculator.test.ts` | mock policy 的 `active` |
| `src/core/save/__tests__/Save.test.ts` | 3 個 |
| `src/core/simulation/__tests__/Simulation.test.ts` | 4 個 |

- [ ] **Step 7: 跑測試**

Run: `npx vitest run src/core/district/__tests__/PolicyLevel.test.ts`
Expected: PASS(6 條)

Run: `npx vitest run && npx tsc --noEmit`
Expected: 402 檔全過

- [ ] **Step 8: revert-verify**

三次,每次只改一處:
1. 遷移的 `p.active ? 1 : 0` 改成 `0` → `should turn an old active:true into level 1` 轉紅
2. 遷移拿掉 `clampLevel(...)` 直接用 `p.level ?? ...` → `should clamp a corrupt level` 轉紅
3. `setPolicyLevel` 的 `existing.level = clamped` 改成 `district.policies.push(...)` → `should hold only one level per type` 轉紅

- [ ] **Step 9: 提交**

訊息主旨:`refactor(district): 政策用強度取代開關`

---

### Task 3: `POLICY_EFFECTS` 分級

**Files:**
- Modify: `src/core/district/PolicyManager.ts`(`POLICY_EFFECTS` 改陣列、`maxLevel` 改推導、`effect()` 讀對應等級)
- Test: `src/core/district/__tests__/PolicyLevel.test.ts`(追加)

**Interfaces:**
- Consumes: Task 1 的 `PolicyEffect`、Task 2 的 `Policy.level`
- Produces:
  - `POLICY_EFFECTS: Partial<Record<PolicyType, readonly PolicyEffect[]>>`(索引 0 = level 1)
  - `maxLevel(type: PolicyType): number` — 由陣列長度推導

- [ ] **Step 1: 寫失敗測試**

追加到 `PolicyLevel.test.ts`:

```ts
import { POLICY_EFFECTS, maxLevel } from '../PolicyManager';
import { ZoneType } from '../../grid/types';

/** 這一級一共扣了多少收入（跨所有分區類型取最重的那一個）。 */
function revenueCost(e: import('../PolicyManager').PolicyEffect): number {
  let worst = 1 - (e.revenue ?? 1);
  for (const m of Object.values(e.revenueByZone ?? {})) worst = Math.max(worst, 1 - m);
  return worst;
}

describe('分級的效果', () => {
  it('should get stronger with level', () => {
    const { pm, id } = fresh();
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 1);
    const light = pm.getGarbageMultiplier(id);
    pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, 3);
    const heavy = pm.getGarbageMultiplier(id);
    expect(heavy, '重度沒有比輕度更能減垃圾').toBeLessThan(light);
  });

  it('should charge an accelerating price for each step', () => {
    // 代價加速上升才有「找得到的最佳點」。線性的話分級只是一根沒有決策的滑桿。
    // 用 revenueCost 而不是直接讀 `revenue`，因為代價可能只落在特定分區類型上。
    const tiers = POLICY_EFFECTS[PolicyType.ENCOURAGE_RECYCLING]!;
    expect(tiers.length, '回收只有一級，這條測試等於空轉').toBeGreaterThan(1);
    const ratios = tiers.map(t => revenueCost(t) / (1 - (t.garbage ?? 1)));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]!, `第 ${i + 1} 級的單位代價沒有比前一級高`)
        .toBeGreaterThan(ratios[i - 1]!);
    }
  });

  it('should derive maxLevel from the table, not a hand-kept number', () => {
    expect(maxLevel(PolicyType.ENCOURAGE_RECYCLING))
      .toBe(POLICY_EFFECTS[PolicyType.ENCOURAGE_RECYCLING]!.length);
    expect(maxLevel(PolicyType.TOURISM)).toBe(1);
  });

  it('should clamp a level above what the table offers', () => {
    const { pm, id } = fresh();
    pm.setPolicyLevel(id, PolicyType.TOURISM, 3);
    expect(pm.getPolicyLevel(id, PolicyType.TOURISM)).toBe(1);
  });

  it('should read the tier matching the level, not always the first', () => {
    const { pm, id } = fresh();
    const tiers = POLICY_EFFECTS[PolicyType.ENCOURAGE_RECYCLING]!;
    for (const [i, tier] of tiers.entries()) {
      pm.setPolicyLevel(id, PolicyType.ENCOURAGE_RECYCLING, i + 1);
      expect(pm.getGarbageMultiplier(id), `第 ${i + 1} 級讀到的不是第 ${i + 1} 格`)
        .toBeCloseTo(tier.garbage ?? 1, 6);
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyLevel.test.ts`
Expected: FAIL — `tiers.length` 是 `undefined` / `POLICY_EFFECTS[...]` 不是陣列

- [ ] **Step 3: 改表**

```ts
/**
 * 每個條例每一級做什麼。索引 0 是第 1 級;二元條例只放一格。
 *
 * 現有三條原本都是純好處 —— 付得起就一定開,那不是決策,是價目表。回收現在每一級
 * 都同時扣商業收入,而且**單位代價逐級上升**:第三級每減 1% 垃圾要付的收入代價比
 * 第一級高,所以最強的那一級不會自動是最好的選擇。
 *
 * 代價落在 `revenueByZone` 而不是 `revenue`:回收增加的是商家的處理成本,跟住戶
 * 無關。
 */
export const POLICY_EFFECTS: Partial<Record<PolicyType, readonly PolicyEffect[]>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: [
    // 減 15% 垃圾，代價 2% 商業收入 → 單位代價 0.133
    { garbage: 0.85, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.98, [ZoneType.COMMERCIAL_HIGH]: 0.98 } },
    // 減 35%，代價 8% → 0.229
    { garbage: 0.65, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.92, [ZoneType.COMMERCIAL_HIGH]: 0.92 } },
    // 減 55%，代價 18% → 0.327
    { garbage: 0.45, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.82, [ZoneType.COMMERCIAL_HIGH]: 0.82 } },
  ],
  [PolicyType.TOURISM]: [{ revenue: 1.2 }],
  [PolicyType.ORGANIC_FOOD]: [{ landValue: 6 }],
};

/** 這個條例最高幾級。由表推導,不手寫 —— 手寫的那份一定會跟表走散。 */
export function maxLevel(type: PolicyType): number {
  return POLICY_EFFECTS[type]?.length ?? 1;
}
```

`NON_ZONE_IMPLEMENTED_POLICY_TYPES` 不必改 —— 它讀的是 `Object.keys(POLICY_EFFECTS)`。

- [ ] **Step 4: 改 `effect()` 讀對應等級**

```ts
    for (const policy of district.policies) {
      if (policy.level === 0) continue;
      const tier = POLICY_EFFECTS[policy.type]?.[policy.level - 1];
      const value = tier && pick(tier);
      if (value !== undefined) out = combine(out, value);
    }
```

- [ ] **Step 5: 跑測試**

Run: `npx vitest run src/core/district/__tests__/PolicyLevel.test.ts`
Expected: PASS(11 條)

Run: `npx vitest run && npx tsc --noEmit`
兩處會壞,都要改:

1. `PolicyEffects.test.ts` 會因為回收第 1 級變成 `garbage: 0.85`(原本單一值 `0.65`)
   而失敗。把它們改成明確設 level 2,或把期望值改成第一級的數字;**擇一,不要兩者
   都做**。
2. **Task 1 寫的 `RevenueByZone.test.ts` 的 `withEffect` 塞的是單一物件**。`effect()`
   現在讀 `[level - 1]`,物件的 `[0]` 是 `undefined`,乘數會變成 1 而不是 0.5 ——
   這是執行期失敗,`tsc` 抓不到(那裡有強制 cast)。把塞進去的值改成陣列:
   ```ts
   withEffect(PolicyType.TOURISM, [{ revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.5 } }], () => {
   ```

- [ ] **Step 6: revert-verify**

三次:
1. 回收第三級的 `revenueByZone` 全改成 `0.98` → `should charge an accelerating price` 轉紅
2. `maxLevel` 改回 `return 3` → `should derive maxLevel from the table` 與 `should clamp a level above what the table offers` 轉紅
3. `effect()` 的 `?.[policy.level - 1]` 改成 `?.[0]` → `should read the tier matching the level` 轉紅

- [ ] **Step 7: 提交**

訊息主旨:`feat(district): 條例分三級，代價逐級加速`

---

### Task 4: 雙向效果 —— 犯罪槓桿

沒有這一步就做不出「+收入 +犯罪」這種取捨,而取捨正是整個改造的目的。現在只有
`PoliceService.getCrimeReduction(x,y)`,沒有任何東西能**增加**犯罪。

**Files:**
- Modify: `src/core/district/PolicyManager.ts`(`PolicyEffect.crime` 與 getter)
- Modify: `src/core/simulation/SimulationLoop.ts:1149`(地價的 `crimeRate` 來源)
- Test: `src/core/district/__tests__/PolicyTradeoff.test.ts`(新增)

**Interfaces:**
- Consumes: Task 3 的分級效果表
- Produces:
  - `PolicyEffect.crime?: number`(加法,單位同 `calculateLandValue` 的 `crimeRate`)
  - `PolicyManager.getCrimeBonus(districtId: string | null): number`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/PolicyTradeoff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager, POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';

describe('條例的取捨', () => {
  it('should let one policy move two numbers in opposite directions', () => {
    // 這條是整個改造的目的：沒有反向效果，條例就只是價目表。
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    pm.setPolicyLevel(d.id, PolicyType.TOURISM, 1);
    expect(pm.getRevenueMultiplier(d.id, ZoneType.COMMERCIAL_LOW), '觀光沒有加收入')
      .toBeGreaterThan(1);
    expect(pm.getCrimeBonus(d.id), '觀光沒有帶來任何代價').toBeGreaterThan(0);
  });

  it('should give no crime bonus outside any district', () => {
    expect(new PolicyManager(new DistrictManager()).getCrimeBonus(null)).toBe(0);
  });

  it('should have at least one downside on every tier of every policy', () => {
    // 純好處的條例不該存在。限制型（沒有 POLICY_EFFECTS 條目）不在此列 —— 它們的
    // 代價是機會成本。
    const isDownside = (t: PolicyEffect) =>
      (t.revenue !== undefined && t.revenue < 1)
      || Object.values(t.revenueByZone ?? {}).some(m => m < 1)
      || (t.crime !== undefined && t.crime > 0)
      || (t.landValue !== undefined && t.landValue < 0)
      || (t.garbage !== undefined && t.garbage > 1);

    for (const [type, tiers] of Object.entries(POLICY_EFFECTS)) {
      for (const [i, t] of tiers!.entries()) {
        expect(isDownside(t), `${type} 第 ${i + 1} 級是純好處，付得起就一定開`).toBe(true);
      }
    }
  });
});
```

再建立一支接線測試 `src/core/simulation/__tests__/PolicyCrimeReachesLandValue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';

/**
 * 表格改了不等於模擬會讀。這條走完整條路:設政策 → 跑地價 → 讀回格子。
 * 只測 PolicyManager 的話，SimulationLoop 完全沒接也會全綠。
 *
 * 建築是**直接種進格子**的。`updateLandValue` 開頭就 `if (cell.buildingId === 0)
 * return`，而成長路徑要求該格有電有水（`BuildingGrowth.ts:36-46`）—— 只畫道路與
 * zoning 的話那一格永遠沒有建築，兩組都拿到初始值，測試會變成「相等」而不是
 * 「更低」。
 *
 * 只跑六個 tick:`updateLandValue` 在 tick 2 跑，六個 tick 夠了，而且短到不會被
 * 成長與遷居的隨機性汙染。
 */
describe('條例的犯罪代價真的進到地價', () => {
  const SHOP = 7;   // Small Shop（COMMERCIAL_LOW），見 building/types.ts

  const landValueAt = (withPolicy: boolean) => {
    const state = createGameState(30, 30);
    const loop = new SimulationLoop(state);
    for (let x = 5; x < 15; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
    for (let x = 6; x < 14; x++) {
      state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    }
    const d = state.districts.createDistrict('D');
    for (let x = 6; x < 14; x++) state.districts.addCellToDistrict(d.id, x, 11);
    if (withPolicy) state.policies.setPolicyLevel(d.id, PolicyType.TOURISM, 1);

    for (let i = 0; i < 6; i++) loop.tick();
    return state.grid.getCell(10, 11)!.landValue;
  };

  it('should lower land value inside the district that took the policy', () => {
    const plain = landValueAt(false);
    // 正向控制：地價根本沒算的話，兩組都是 0，`toBeLessThan` 也會是 false ——
    // 但錯的理由完全不同，分開講才看得出來是哪一種壞。
    expect(plain, '地價沒有被算過，這條測試等於空轉').toBeGreaterThan(0);
    expect(landValueAt(true), '開了帶犯罪代價的政策，地價卻沒有變差').toBeLessThan(plain);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyTradeoff.test.ts src/core/simulation/__tests__/PolicyCrimeReachesLandValue.test.ts`
Expected: FAIL — `pm.getCrimeBonus is not a function`

- [ ] **Step 3: 加 `crime` 到效果表與 getter**

`PolicyEffect` 加一欄:

```ts
  /**
   * 加到該區犯罪率上的量。正值是代價。
   *
   * `PoliceService` 只提供 `getCrimeReduction` —— 整個模擬沒有任何東西能讓犯罪
   * 上升,所以「+收入 +犯罪」這類取捨做不出來。這一欄是那個缺口。
   */
  crime?: number;
```

觀光改成有代價,有機食品也是:

```ts
  [PolicyType.TOURISM]: [{ revenue: 1.2, crime: 4 }],
  [PolicyType.ORGANIC_FOOD]: [{ landValue: 6, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.95 } }],
```

getter:

```ts
  /** 該區因條例而增加的犯罪率。沒有分區就是 0。 */
  getCrimeBonus(districtId: string | null): number {
    return this.effect(districtId, e => e.crime, 0, (a, b) => a + b);
  }
```

- [ ] **Step 4: 接進地價**

`SimulationLoop.ts` 第 1149 行。**注意那一段的 `policyBonus` 已經查過一次分區**,
不要查兩次:

```ts
      const districtId = this.state.districts.getDistrictAt(x, y)?.id ?? null;
      const value = calculateLandValue({
        serviceCoverage,
        parkProximity,
        waterfront,
        pollution: (pollution.ground + pollution.water) * pollutionFactor,
        noise: pollution.noise * pollutionFactor,
        crimeRate: this.getAvgCrime() + this.state.policies.getCrimeBonus(districtId),
        policyBonus: this.state.policies.getLandValueBonus(districtId),
      });
```

- [ ] **Step 5: 跑測試**

Run: `npx vitest run src/core/district/__tests__/PolicyTradeoff.test.ts src/core/simulation/__tests__/PolicyCrimeReachesLandValue.test.ts`
Expected: PASS(4 條)

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 6: revert-verify**

兩次:
1. `TOURISM` 的 `crime: 4` 拿掉 → `should have at least one downside`、
   `should let one policy move two numbers`、`should lower land value inside the district` 三條都轉紅
2. Step 4 的 `+ getCrimeBonus(districtId)` 拿掉 → **只有** `should lower land value inside the district` 轉紅
   (這一條證明接線測試不是空的)

- [ ] **Step 7: 提交**

訊息主旨:`feat(district): 條例可以有代價，新增犯罪槓桿`

---

### Task 5: 依規模計費

固定費用在大城市等於免費 —— 早期是限制,後期是無感。改成跟著它服務的規模走,費用才
有來由,而且「政策越成功越貴」本身就是一個要玩家自己決定何時收手的張力。

這一步把 `Policy.cost`、`POLICY_CONFIG.cost`、`PolicyManager.getPolicyCost` 一起刪掉
—— 留著就是留一份沒有人讀、卻看起來像真的價錢在那裡。

**Files:**
- Create: `src/core/district/PolicyBilling.ts`
- Modify: `src/core/district/types.ts`(刪 `Policy.cost`)
- Modify: `src/core/district/PolicyManager.ts`(`PolicyTypeConfig` 刪 `cost`、刪 `getPolicyCost`)
- Modify: `src/core/district/DistrictManager.ts`(遷移不再抄 `cost`)
- Modify: `src/core/economy/ExpenseCalculator.ts`
- Modify: `src/core/economy/EconomyBreakdownContext.ts:36`
- Modify: `src/core/simulation/SimulationLoop.ts:996`
- Modify: `src/ui/modals/DistrictModal.tsx:24-30`(`policyLabel` 不再讀 `cfg.cost`)
- Test: `src/core/district/__tests__/PolicyBilling.test.ts`(新增)

**Interfaces:**
- Consumes: Task 3 的 `maxLevel`
- Produces:
  - `type BillingBasis = 'flat' | 'population' | 'districtCells'`
  - `interface PolicyScale { population: number; districtCells: number }`
  - `POLICY_BILLING: Partial<Record<PolicyType, { basis: BillingBasis; perUnit: readonly number[] }>>`
  - `policyCost(type: PolicyType, level: number, scale: PolicyScale): number`
  - `calculateDistrictPolicyCost(districts, population)` — 多一個參數

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/PolicyBilling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { policyCost, POLICY_BILLING } from '../PolicyBilling';
import { POLICY_ZONE_RESTRICTIONS, maxLevel } from '../PolicyManager';
import { calculateDistrictPolicyCost } from '../../economy/ExpenseCalculator';
import { PolicyType } from '../types';

const SMALL = { population: 100, districtCells: 20 };
const BIG = { population: 10_000, districtCells: 400 };

describe('條例的計費', () => {
  it('should cost nothing at level 0', () => {
    expect(policyCost(PolicyType.ENCOURAGE_RECYCLING, 0, BIG)).toBe(0);
  });

  it('should scale with the thing it serves', () => {
    // 固定費用在大城市等於免費。
    const small = policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, SMALL);
    const big = policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, BIG);
    expect(big, '大城市付得跟小城市一樣多').toBeGreaterThan(small * 5);
  });

  it('should cost more at a higher level', () => {
    expect(policyCost(PolicyType.ENCOURAGE_RECYCLING, 3, BIG))
      .toBeGreaterThan(policyCost(PolicyType.ENCOURAGE_RECYCLING, 1, BIG));
  });

  it('should not bill restriction policies', () => {
    // 限制型的代價是機會成本（該區長不出高稅收的建築），不是市府掏錢。再收一次是
    // 雙重懲罰，而且那個數字沒有來由。
    for (const type of Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[]) {
      expect(POLICY_BILLING[type], `${type} 是限制型卻列了計費基數`).toBeUndefined();
      expect(policyCost(type, 1, BIG)).toBe(0);
    }
  });

  it('should have one perUnit entry per level the effect table offers', () => {
    // 兩張表走散的話，第三級會靜靜地用第二級的價錢。
    for (const [type, billing] of Object.entries(POLICY_BILLING)) {
      expect(billing!.perUnit.length, `${type} 的計費級數與效果級數對不上`)
        .toBe(maxLevel(type as PolicyType));
    }
  });
});

describe('預算真的照這張表收錢', () => {
  // 只測 policyCost 的話，ExpenseCalculator 完全沒改也會全綠。
  const districts = [{
    cells: { size: 400 },
    policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 }],
  }];

  it('should bill exactly what policyCost says', () => {
    expect(calculateDistrictPolicyCost(districts as never, 10_000))
      .toBeCloseTo(policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, BIG), 6);
  });

  it('should charge nothing for a district with no cells', () => {
    // 分區格數是計費基數 —— 沒有格子就沒有東西要服務。
    const empty = [{ cells: { size: 0 }, policies: districts[0]!.policies }];
    expect(calculateDistrictPolicyCost(empty as never, 10_000)).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyBilling.test.ts`
Expected: FAIL — 找不到模組 `../PolicyBilling`

- [ ] **Step 3: 建立 `PolicyBilling.ts`**

```ts
import { PolicyType } from './types';
import { maxLevel } from './PolicyManager';

/** 費用跟著哪一個規模走。 */
export type BillingBasis = 'flat' | 'population' | 'districtCells';

/** 算費用要知道的規模。呼叫端負責填。 */
export interface PolicyScale {
  /** 全城人口。 */
  population: number;
  /** 這個條例所在分區的格數。全城條例填 0。 */
  districtCells: number;
}

/**
 * 每個條例怎麼收錢。
 *
 * 沒有條目 = 不收費。限制型條例（禁重工業、禁高密度）就屬於這一類:它們的代價是
 * 機會成本 —— 該區長不出高稅收的建築 —— 而不是市府掏錢。再收一次是雙重懲罰,而且
 * 那個數字沒有來由。
 *
 * `perUnit` 每一級一格,索引 0 是第 1 級,長度必須等於 `maxLevel(type)`。兩張表走散
 * 的話,第三級會靜靜地用第二級的價錢。
 */
export const POLICY_BILLING: Partial<Record<PolicyType, {
  basis: BillingBasis;
  perUnit: readonly number[];
}>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: { basis: 'districtCells', perUnit: [1.5, 4, 9] },
  [PolicyType.TOURISM]: { basis: 'districtCells', perUnit: [3] },
  [PolicyType.ORGANIC_FOOD]: { basis: 'districtCells', perUnit: [2] },
};

function unitsOf(basis: BillingBasis, scale: PolicyScale): number {
  switch (basis) {
    case 'flat': return 1;
    case 'population': return scale.population;
    case 'districtCells': return scale.districtCells;
  }
}

/** 這個條例在這個等級、這個規模下,每個預算週期要花多少。 */
export function policyCost(type: PolicyType, level: number, scale: PolicyScale): number {
  if (level <= 0) return 0;
  const billing = POLICY_BILLING[type];
  if (!billing) return 0;
  const perUnit = billing.perUnit[Math.min(level, maxLevel(type)) - 1];
  if (perUnit === undefined) return 0;
  return perUnit * unitsOf(billing.basis, scale);
}
```

- [ ] **Step 4: 改 `ExpenseCalculator`**

```ts
export function calculateDistrictPolicyCost(
  districts: readonly {
    cells: { size: number };
    policies: readonly { level: number; type: PolicyType }[];
  }[],
  population: number,
): number {
  let total = 0;
  for (const district of districts) {
    for (const policy of district.policies) {
      if (!isPolicyImplemented(policy.type)) continue;
      total += policyCost(policy.type, policy.level, {
        population,
        districtCells: district.cells.size,
      });
    }
  }
  return total;
}
```

- [ ] **Step 5: 刪掉 `cost`,改所有呼叫端**

1. `types.ts`:`Policy` 刪 `cost`
2. `PolicyManager.ts`:`PolicyTypeConfig` 刪 `cost`;`POLICY_CONFIG` 五條只留 `name`;
   刪 `getPolicyCost`;`setPolicyLevel` 建立 policy 時不再寫 `cost`
3. `DistrictManager.ts`:遷移的 map 不再抄 `cost`;`SerializedPolicy` 對應調整
4. `SimulationLoop.ts:996`:
   `calculateDistrictPolicyCost(this.state.districts.getAllDistricts(), this.state.citizens.getPopulation())`
5. `EconomyBreakdownContext.ts:36`:同樣補第二參數(人口從 `state.citizens.getPopulation()` 取)
6. `DistrictModal.tsx` 的 `policyLabel`:去掉 `($${cfg.cost})`,只回名稱

Run: `npx tsc --noEmit`
已知會打到的測試(每一支都要處理,且**有行為衝突**,不是單純改簽章):

| 檔案 | 衝突 | 怎麼改 |
|---|---|---|
| `District.test.ts:169` | 讀 `pm.getPolicyCost(...)` | getter 已刪,改讀 `policyCost(type, 1, scale)` |
| `District.test.ts:202-207` | 另一個 `getPolicyCost` 迴圈 | 同上 |
| `District.test.ts:210-215` | 斷言每個 `POLICY_CONFIG[t].cost > 0` | 那張表不再有價格。改成驗 `POLICY_BILLING` 每個 `perUnit` 全部 > 0 |
| `PolicyEffectiveness.test.ts:44-75` | 三個 `calculateDistrictPolicyCost` 少人口參數,而且 fixture 沒有 `cells` | 補人口、給每個 fixture 加 `cells: { size: N }` |
| `PolicyEffectiveness.test.ts:51,56,62,63,101` | 讀 `POLICY_CONFIG[...].cost` | 改讀 `policyCost(...)` |
| `PolicyEffectiveness.test.ts:67` | 要求限制型政策仍收 150 + 120 | 限制型現在免費,期望值改 0,並在測試裡寫明為什麼 |
| `src/Game.ts:105` | 死 import(整個檔案沒有用到 `calculateDistrictPolicyCost`) | 直接刪掉這一行 |
| `EconomyPanelMatchesBudget.test.ts` | 用 `NO_HEAVY_INDUSTRY` 保證 `policyCost` 非零 | 換成 `ENCOURAGE_RECYCLING`,並確保該分區有格子 |
| `Simulation.test.ts` | 計費分區沒有任何 cells,總政策費會是 0 | 給那個分區加格子 |
| `ExpenseCalculator.test.ts` | 4 個呼叫少第二參數,mock policy 有 `cost` | 補人口、mock 改成 `{ type, level }` 且外層有 `cells` |

- [ ] **Step 6: 跑測試**

Run: `npx vitest run src/core/district/__tests__/PolicyBilling.test.ts`
Expected: PASS(7 條)

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 7: revert-verify**

三次:
1. 回收的 `perUnit` 改成 `[9, 9, 9]` → `should cost more at a higher level` 轉紅
2. `basis` 改成 `'flat'` → `should scale with the thing it serves` 與
   `should charge nothing for a district with no cells` 轉紅
3. `ExpenseCalculator` 改回加總一個寫死的常數 → `should bill exactly what policyCost says` 轉紅

- [ ] **Step 8: 提交**

訊息主旨:`feat(district): 條例費用跟著規模走，限制型不收費`

---

### Task 6: 全城條例

有些條例的效果作用在城市級的池子上(電網總需求、教育晉級、貿易價格),沒有位置可言。
判斷法:**如果「整張地圖都套用」永遠不會比「只套一部分」差,那它就該是全城的** ——
那時候「在哪裡」不是決策,逼玩家先畫分區只是多按幾下。

這一步同時加**一條**全城條例(節能法規)。不加的話,`POLICY_BILLING` 全部是
`districtCells`、全城呼叫固定傳 0,整條全城路徑的費用恆為 0 —— 測試會全綠,但什麼都
沒保證。條例目錄的其餘部分仍不在這份計畫裡。

**Files:**
- Create: `src/core/district/PolicyScope.ts`
- Create: `src/core/district/CityOrdinances.ts`
- Modify: `src/core/district/types.ts`(`PolicyType` 加 `ENERGY_REGULATION`)
- Modify: `src/core/district/PolicyManager.ts`(`POLICY_CONFIG` / `POLICY_EFFECTS` 加節能;`setPolicyLevel` 擋非分區條例)
- Modify: `src/core/district/PolicyBilling.ts`(節能用 `population` 基數)
- Modify: `src/core/service/PowerGrid.ts:141`(`calculateDemand` 收需求乘數)
- Modify: `src/core/simulation/GameState.ts`(新增 `ordinances`)
- Modify: `src/core/simulation/SimulationLoop.ts:996,1899`(預算加全城條例費、電力需求乘數)
- Modify: `src/core/economy/EconomyBreakdownContext.ts`(同上)
- Modify: `src/core/save/Serializer.ts:80,159,283-287`
- Test: `src/core/district/__tests__/CityOrdinances.test.ts`(新增)

**Interfaces:**
- Consumes: Task 3 的 `maxLevel` / `clampLevel`、Task 5 的 `policyCost`
- Produces:
  - `POLICY_SCOPE: Record<PolicyType, 'district' | 'city'>`
  - `class CityOrdinances { setLevel(type, level): void; getLevel(type): number; totalCost(population): number; getPowerDemandMultiplier(): number; getRevenueMultiplier(zoneType): number; toJSON(); restore(data) }`
  - `GameState.ordinances: CityOrdinances`
  - `PowerGrid.calculateDemand(grid: Grid, demandMultiplier?: number): void`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/CityOrdinances.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { POLICY_SCOPE } from '../PolicyScope';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager } from '../PolicyManager';
import { policyCost } from '../PolicyBilling';
import { PolicyType } from '../types';
import { createGameState } from '../../simulation/GameState';
import { serializeGameState, deserializeGameState } from '../../save/Serializer';

describe('全城條例', () => {
  it('should remember the level it was set to', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 2);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(2);
  });

  it('should give every policy exactly one scope', () => {
    for (const type of Object.values(PolicyType)) {
      expect(['district', 'city'], `${type} 沒有指定範圍`).toContain(POLICY_SCOPE[type]);
    }
  });

  it('should refuse a district policy', () => {
    // 一個條例同時是分區又是全城的話，兩邊會各自生效，效果無聲地加倍。
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENCOURAGE_RECYCLING, 3);
    expect(o.getLevel(PolicyType.ENCOURAGE_RECYCLING), '分區條例被設進了全城').toBe(0);
  });

  it('should refuse a city ordinance on a district', () => {
    // 反向也要擋，否則玩家可以在分區裡開節能法規，效果加倍而且只收一次錢。
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    pm.setPolicyLevel(d.id, PolicyType.ENERGY_REGULATION, 2);
    expect(pm.getPolicyLevel(d.id, PolicyType.ENERGY_REGULATION), '全城條例被設進了分區').toBe(0);
  });

  it('should cost real money at the city scale', () => {
    // 全城條例的 districtCells 恆為 0。如果每一條都用 districtCells 計費，
    // 這條路徑的費用永遠是 0，所有相關測試都會變成空測試。
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 2);
    expect(o.totalCost(10_000), '全城條例不收錢').toBeGreaterThan(0);
    expect(o.totalCost(10_000)).toBeCloseTo(
      policyCost(PolicyType.ENERGY_REGULATION, 2, { population: 10_000, districtCells: 0 }), 6);
  });

  it('should scale with population', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENERGY_REGULATION, 2);
    expect(o.totalCost(10_000)).toBeGreaterThan(o.totalCost(1_000) * 5);
  });

  it('should round-trip through a real save', () => {
    // 直接呼叫 toJSON/restore 的話，GameState 與 Serializer 漏接不會被抓到。
    const state = createGameState(20, 20);
    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.ordinances.getLevel(PolicyType.ENERGY_REGULATION)).toBe(3);
  });

  it('should survive a save that predates ordinances', () => {
    const o = new CityOrdinances();
    o.restore(undefined);
    expect(o.getLevel(PolicyType.ENERGY_REGULATION)).toBe(0);
  });
});
```

再建立接線測試 `src/core/simulation/__tests__/OrdinanceReachesSimulation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { buildEconomyBreakdownContext } from '../../economy/EconomyBreakdownContext';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';

const HOUSE = 1;   // Small House（RESIDENTIAL_LOW）

/**
 * 建築直接種進格子、人口直接造。
 *
 * `PowerGrid.calculateDemand` 只算 `buildingId > 0` 的格子，而建築成長要求該格
 * 有電有水 —— 沒有電廠水廠的測試城市長不出任何東西，需求會是 0，正向控制就先掛了。
 * 人口同理:`getPopulation()` 是市民陣列的長度，新遊戲是 0，而節能法規是按人口
 * 計費的，人口 0 時費用恆為 0。
 */
function city(): { state: GameState; loop: SimulationLoop } {
  const state = createGameState(30, 30);
  for (let x = 5; x < 20; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 19; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
  }
  for (let i = 0; i < 200; i++) state.citizens.restoreCitizen({}, 0);
  return { state, loop: new SimulationLoop(state) };
}

const policyExpense = (state: GameState) =>
  buildEconomyBreakdownContext(state, null).policyCost;

describe('全城條例真的接進模擬', () => {
  it('should lower total power demand', () => {
    const demandOf = (level: number) => {
      const { state, loop } = city();
      state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, level);
      for (let i = 0; i < 6; i++) loop.tick();
      return state.power.getDemand();
    };
    const plain = demandOf(0);
    expect(plain, '沒有電力需求可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(demandOf(3), '節能法規沒有降低電力需求').toBeLessThan(plain);
  });

  it('should show up as an expense in the budget', () => {
    const { state } = city();
    const plain = policyExpense(state);
    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    const withOrdinance = policyExpense(state);
    expect(withOrdinance, '全城條例沒有進預算').toBeGreaterThan(plain);
    expect(withOrdinance - plain)
      .toBeCloseTo(state.ordinances.totalCost(state.citizens.getPopulation()), 6);
  });
});
```

> `SimulationLoop.getExpenseBreakdown()` **不存在** —— 支出是 `calculateIncome()`
> (private)寫進 `state.budget.expenses` 的。所以這裡走 `buildEconomyBreakdownContext`,
> 那是預算面板實際讀的同一條路。迴圈那一條由 Task 8 的測試守住。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/CityOrdinances.test.ts`
Expected: FAIL — 找不到模組

- [ ] **Step 3: 新增 `ENERGY_REGULATION`**

`types.ts` 的 `PolicyType` 加 `ENERGY_REGULATION = 'ENERGY_REGULATION'`。

`PolicyManager.ts`:

```ts
  [PolicyType.ENERGY_REGULATION]: { name: 'Energy Regulation' },
```

```ts
  /**
   * 節能法規。作用在電網的**總需求**上 —— 那是一個城市級的池子,沒有位置可言:
   * 只在半個城市要求節能,省下來的電照樣進同一張電網。所以它是全城條例。
   *
   * 代價落在商業與工業:設備更新與製程改造的成本由業者吸收。
   */
  [PolicyType.ENERGY_REGULATION]: [
    { powerDemand: 0.92, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.99, [ZoneType.COMMERCIAL_HIGH]: 0.99, [ZoneType.INDUSTRIAL]: 0.98 } },
    { powerDemand: 0.82, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.97, [ZoneType.COMMERCIAL_HIGH]: 0.97, [ZoneType.INDUSTRIAL]: 0.94 } },
    { powerDemand: 0.70, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.94, [ZoneType.COMMERCIAL_HIGH]: 0.94, [ZoneType.INDUSTRIAL]: 0.88 } },
  ],
```

`PolicyEffect` 加 `/** Multiplier on the city's total power demand. */ powerDemand?: number;`

`PolicyBilling.ts` 加 `[PolicyType.ENERGY_REGULATION]: { basis: 'population', perUnit: [0.08, 0.22, 0.5] }`。

- [ ] **Step 4: 建立 `PolicyScope.ts`**

```ts
import { PolicyType } from './types';

/**
 * 每個條例的作用範圍。
 *
 * 判斷法:如果「整張地圖都套用」永遠不會比「只套一部分」差,它就該是全城的 ——
 * 那時候「在哪裡」根本不是決策,逼玩家先畫分區只是多按幾下。反過來,只在市中心收的
 * 壅塞費如果全城都收,就等於全面加稅,失去它原本的意義。
 *
 * 一個條例只能有一個範圍,而且**兩邊都要擋**:只擋一邊的話,另一邊仍然設得進去,
 * 效果會無聲地加倍而費用只收一次。
 */
export const POLICY_SCOPE: Record<PolicyType, 'district' | 'city'> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: 'district',
  [PolicyType.HIGH_DENSITY_BAN]: 'district',
  [PolicyType.ENCOURAGE_RECYCLING]: 'district',
  [PolicyType.ORGANIC_FOOD]: 'district',
  [PolicyType.TOURISM]: 'district',
  [PolicyType.ENERGY_REGULATION]: 'city',
};
```

`PolicyManager.setPolicyLevel` 開頭加:

```ts
    if (POLICY_SCOPE[policyType] !== 'district') return;
```

- [ ] **Step 5: 建立 `CityOrdinances.ts`**

```ts
import { ZoneType } from '../grid/types';
import { PolicyType } from './types';
import { POLICY_EFFECTS, clampLevel, maxLevel, type PolicyEffect } from './PolicyManager';
import { POLICY_SCOPE } from './PolicyScope';
import { policyCost } from './PolicyBilling';

/** 全城條例的強度。沒有分區,所以只有一份等級表。 */
export class CityOrdinances {
  private levels = new Map<PolicyType, number>();

  setLevel(type: PolicyType, level: number): void {
    if (POLICY_SCOPE[type] !== 'city') return;
    const clamped = clampLevel(level, maxLevel(type));
    if (clamped === 0) this.levels.delete(type);
    else this.levels.set(type, clamped);
  }

  getLevel(type: PolicyType): number {
    return this.levels.get(type) ?? 0;
  }

  /** 合成所有生效的全城條例對某一個量的影響。 */
  private effect(
    pick: (e: PolicyEffect) => number | undefined,
    identity: number,
    combine: (a: number, b: number) => number,
  ): number {
    let out = identity;
    for (const [type, level] of this.levels) {
      const tier = POLICY_EFFECTS[type]?.[level - 1];
      const value = tier && pick(tier);
      if (value !== undefined) out = combine(out, value);
    }
    return out;
  }

  /** 全城電力總需求的乘數。 */
  getPowerDemandMultiplier(): number {
    return this.effect(e => e.powerDemand, 1, (a, b) => a * b);
  }

  /** 全城條例對這個分區類型的收入乘數。 */
  getRevenueMultiplier(zoneType: ZoneType): number {
    return this.effect(e => e.revenue, 1, (a, b) => a * b)
      * this.effect(e => e.revenueByZone?.[zoneType], 1, (a, b) => a * b);
  }

  /** 全城條例本期的總支出。全城的沒有分區格數可言,所以 districtCells 是 0。 */
  totalCost(population: number): number {
    let total = 0;
    for (const [type, level] of this.levels) {
      total += policyCost(type, level, { population, districtCells: 0 });
    }
    return total;
  }

  toJSON(): { levels: [PolicyType, number][] } {
    return { levels: [...this.levels.entries()] };
  }

  restore(data: { levels?: [PolicyType, number][] } | undefined): void {
    this.levels = new Map();
    for (const [type, level] of data?.levels ?? []) this.setLevel(type, level);
  }
}
```

`restore` 走 `setLevel` 而不是直接塞 Map —— 存檔是能被編輯的,範圍檢查與夾值必須在
讀進來時也成立。

- [ ] **Step 6: 接進 `GameState`、`Serializer`、模擬**

0. **先把政策總支出抽成一個函式**,`ExpenseCalculator.ts`:

```ts
/**
 * 本期政策總支出:分區條例加全城條例。
 *
 * 抽出來是因為它有兩個消費端 —— 模擬迴圈的預算與預算面板的明細。兩邊各寫一次
 * 加法的話,加了全城條例只改到一邊,面板與帳本就會靜靜地差一個數字。
 */
export function totalPolicyExpense(
  districts: readonly { cells: { size: number }; policies: readonly { level: number; type: PolicyType }[] }[],
  ordinances: { totalCost(population: number): number },
  population: number,
): number {
  return calculateDistrictPolicyCost(districts, population) + ordinances.totalCost(population);
}
```

1. `GameState.ts`:介面加 `ordinances: CityOrdinances;`,建立處加 `ordinances: new CityOrdinances(),`
2. `Serializer.ts`:`SerializedState`(第 37 行的那個型別,**不叫 `SaveData`**,而且
   **沒有 export** —— 要在同一個檔案裡改)加
   `ordinances?: ReturnType<CityOrdinances['toJSON']>;`;第 160 行附近加
   `ordinances: state.ordinances.toJSON(),`;第 287 行附近加
   `state.ordinances.restore(saved.ordinances);`
3. `PowerGrid.calculateDemand` 加第二參數(預設 1,現有四個呼叫端不必改):

```ts
  calculateDemand(grid: Grid, demandMultiplier = 1): void {
    let demand = 0;
    grid.forEachCell((cell) => { /* 不變 */ });
    this.totalDemand = demand * demandMultiplier;
  }
```

4. `SimulationLoop.ts:1899`:
   `this.state.power.calculateDemand(this.state.grid, this.state.ordinances.getPowerDemandMultiplier())`
   `Game.ts:675` 同樣處理
5. `SimulationLoop.ts:996` 與 `EconomyBreakdownContext.ts:36` 都改成呼叫
   `totalPolicyExpense(...)` —— 兩邊共用同一個函式,不各自寫一次加法
6. `IncomeCalcAdapter` 的 `getRevenueMultiplier` 乘上
   `state.ordinances.getRevenueMultiplier(zoneType)` —— 全城條例對每一格都生效,
   包含不屬於任何分區的格子,所以要在 `if (!district) return 1` **之前**乘

- [ ] **Step 7: 跑測試**

Run: `npx vitest run src/core/district/__tests__/CityOrdinances.test.ts src/core/simulation/__tests__/OrdinanceReachesSimulation.test.ts`
Expected: PASS(10 條)

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 8: revert-verify**

四次:
1. `CityOrdinances.setLevel` 的範圍檢查拿掉 → `should refuse a district policy` 轉紅
2. `PolicyManager.setPolicyLevel` 的範圍檢查拿掉 → `should refuse a city ordinance on a district` 轉紅
3. `Serializer` 的 `restore` 那一行拿掉 → `should round-trip through a real save` 轉紅
4. `calculateDemand` 的 `* demandMultiplier` 拿掉 → `should lower total power demand` 轉紅

- [ ] **Step 9: 提交**

訊息主旨:`feat(district): 條例可以是全城的，並加上節能法規`

---

### Task 7: 條例 UI

一顆按鈕循環走完全部等級,按鈕上直接顯示等級與**本期費用**。費用隨分區格數與人口
變動,所以玩家把分區畫大一倍,數字就會跳。

計畫的 TDD 約束對這個 task 一樣有效 —— 所以把「下一級是幾」「按鈕上要寫什麼」抽成
純函式放進 `src/core/district/PolicyPresentation.ts` 測,Solid 的接線只做手動驗收。

**Files:**
- Create: `src/core/district/PolicyPresentation.ts`
- Create: `src/ui/modals/CityOrdinanceModal.tsx`
- Modify: `src/ui/modals/DistrictModal.tsx:24-30,45-64,82-85,110-138`
- Modify: `src/ui/`(把 City Ordinances 掛進 Overview 或工具列,實作時先找出對應檔案)
- Test: `src/core/district/__tests__/PolicyPresentation.test.ts`(新增)

**Interfaces:**
- Consumes: Task 3 的 `maxLevel`、Task 5 的 `policyCost`
- Produces:
  - `nextPolicyLevel(current: number, type: PolicyType): number`
  - `policyButtonText(type: PolicyType, level: number, scale: PolicyScale): string`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/PolicyPresentation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextPolicyLevel, policyButtonText } from '../PolicyPresentation';
import { maxLevel } from '../PolicyManager';
import { PolicyType } from '../types';

const SCALE = { population: 1000, districtCells: 50 };

describe('等級循環', () => {
  it('should walk every level then return to off', () => {
    // 一顆按鈕就走得完，不必為三級各放一顆。
    const type = PolicyType.ENCOURAGE_RECYCLING;
    const seen: number[] = [];
    let level = 0;
    for (let i = 0; i <= maxLevel(type); i++) { level = nextPolicyLevel(level, type); seen.push(level); }
    expect(seen).toEqual([1, 2, 3, 0]);
  });

  it('should be a two-state toggle for a single-tier policy', () => {
    expect(nextPolicyLevel(0, PolicyType.TOURISM)).toBe(1);
    expect(nextPolicyLevel(1, PolicyType.TOURISM)).toBe(0);
  });
});

describe('按鈕上的字', () => {
  it('should show one dot per level', () => {
    expect(policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 2, SCALE)).toContain('●●');
  });

  it('should show the current cost, not a fixed price', () => {
    const small = policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 2, { population: 1000, districtCells: 10 });
    const big = policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 2, { population: 1000, districtCells: 400 });
    expect(small, '兩個規模顯示同一個價錢').not.toBe(big);
  });

  it('should show no price for a restriction policy', () => {
    // 限制型不收費 —— 標一個 $0 會讓玩家以為那是「免費的好處」。
    expect(policyButtonText(PolicyType.NO_HEAVY_INDUSTRY, 1, SCALE)).not.toContain('$');
  });

  it('should show no dots and no price when off', () => {
    const off = policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 0, SCALE);
    expect(off).not.toContain('●');
    expect(off).not.toContain('$');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyPresentation.test.ts`
Expected: FAIL — 找不到模組

- [ ] **Step 3: 建立 `PolicyPresentation.ts`**

```ts
import { PolicyType } from './types';
import { POLICY_CONFIG, maxLevel } from './PolicyManager';
import { policyCost, type PolicyScale } from './PolicyBilling';

/** 按一次進一級,到頂再按回到 0。 */
export function nextPolicyLevel(current: number, type: PolicyType): number {
  return (current + 1) % (maxLevel(type) + 1);
}

/**
 * 按鈕上的字:圓點是等級,金額是**本期**費用。
 *
 * 費用寫在按鈕上而不是說明頁,是因為它會隨規模變動 —— 把分區畫大一倍數字就跳一倍,
 * 那是「依規模計費」最直接的回饋。限制型條例不顯示金額:它們的代價是機會成本,
 * 標一個 $0 會讓玩家以為那是免費的好處。
 */
export function policyButtonText(type: PolicyType, level: number, scale: PolicyScale): string {
  const name = POLICY_CONFIG[type]?.name ?? type;
  if (level <= 0) return name;
  const dots = '●'.repeat(level);
  const cost = policyCost(type, level, scale);
  return cost > 0
    ? `✓${dots} ${name} ($${Math.round(cost)})`
    : `✓${dots} ${name}`;
}
```

- [ ] **Step 4: 接進 `DistrictModal`**

`policyLabel` 換成 `policyButtonText`;`togglePolicy` 換成:

```ts
  const cyclePolicy = (districtId: string, policyType: PolicyType) => {
    const game = getGame();
    const state = game.getState();
    if (!isPolicyImplemented(policyType)) {
      state.policies.removePolicy(districtId, policyType);
    } else {
      const next = nextPolicyLevel(state.policies.getPolicyLevel(districtId, policyType), policyType);
      state.policies.setPolicyLevel(districtId, policyType, next);
    }
    game.notifyDistrictPolicyChanged();
    setVersion(v => v + 1);
  };
```

`activePolicies()` 換成 `policyLevel(pt)`(一樣先讀 `version()`);按鈕的
`isActive()` 改成 `policyLevel(pt) > 0`。`listedPolicies()` 要**排除全城條例** ——
`POLICY_SCOPE[pt] === 'district'`,否則分區面板會列出設不進去的按鈕。

分區標題列加一行本區合計:所有政策的 `policyCost` 加總。

- [ ] **Step 5: 建立 `CityOrdinanceModal.tsx`**

照 `DistrictModal` 的體例,列出 `POLICY_SCOPE` 裡 `'city'` 的條例。每一條一列:名稱、
一排等級點、效果與代價寫在同一行、右邊是本期費用。頂端顯示合計。

**效果與代價要寫在同一行**,不是 tooltip —— 取捨是玩法,藏起來就沒有取捨。

- [ ] **Step 6: 跑測試**

Run: `npx vitest run src/core/district/__tests__/PolicyPresentation.test.ts`
Expected: PASS(6 條)

Run: `npx vitest run && npx tsc --noEmit`
Run: `npx eslint src/core/district/ src/ui/modals/DistrictModal.tsx src/ui/modals/CityOrdinanceModal.tsx`

- [ ] **Step 7: revert-verify**

兩次:
1. `nextPolicyLevel` 改成 `current > 0 ? 0 : 1` → `should walk every level then return to off` 轉紅
2. `policyButtonText` 的 `policyCost(...)` 換成 `POLICY_BILLING[type]?.perUnit[level-1] ?? 0`
   (不乘規模)→ `should show the current cost, not a fixed price` 轉紅

- [ ] **Step 8: 手動驗收**

```bash
pnpm dev
```
1. 開新遊戲 → District 工具畫一塊 → 開 District 面板 → 反覆點同一條政策,確認等級
   0→1→2→3→0 循環、圓點數量跟著變
2. 把分區畫大一倍,確認按鈕上的金額跟著變
3. 開 City Ordinances → 調節能法規 → 確認 Overview 的電力需求下降、預算的政策支出上升

- [ ] **Step 9: 提交**

訊息主旨:`feat(ui): 條例可以調強度，按鈕顯示等級與本期費用`

---

### Task 8: 預算面板逐條列出政策支出

沒有這一步,「政策越成功越貴」會變成一個玩家事後才發現的坑。看得見才做得了決定 ——
這也是不設預算上限的前提:上限會替玩家自動砍掉政策,而且砍得無聲無息。

**Files:**
- Modify: `src/core/economy/ExpenseCalculator.ts`(新增 `listPolicyExpenses`)
- Modify: `src/ui/modals/overview/`(預算分頁,實作時先 `grep -rn "policyCost" src/ui/` 找出來)
- Test: `src/core/economy/__tests__/PolicyExpenseBreakdown.test.ts`(新增)

**Interfaces:**
- Consumes: Task 5 的 `policyCost`、Task 6 的 `CityOrdinances`
- Produces:
  - `interface PolicyExpenseLine { type: PolicyType; scope: 'district' | 'city'; districtName: string | null; level: number; cost: number }`
  - `listPolicyExpenses(districts, ordinances, population): PolicyExpenseLine[]`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/economy/__tests__/PolicyExpenseBreakdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listPolicyExpenses } from '../ExpenseCalculator';
import { CityOrdinances } from '../../district/CityOrdinances';
import { PolicyType } from '../../district/types';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';

const districts = () => [{
  name: 'Downtown', cells: { size: 50 },
  policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 }],
}];

describe('政策支出明細', () => {
  it('should list one line per active policy, district and city alike', () => {
    const ord = new CityOrdinances();
    ord.setLevel(PolicyType.ENERGY_REGULATION, 2);
    // 人口不能是 0 —— 節能法規按人口計費，人口 0 的話那一行的 cost 是 0 而被跳過。
    const lines = listPolicyExpenses(districts() as never, ord, 1000);
    expect(lines).toHaveLength(2);
    expect(lines.find(l => l.scope === 'district')!.districtName).toBe('Downtown');
    expect(lines.find(l => l.scope === 'city')!.districtName).toBeNull();
    for (const l of lines) expect(l.cost, `${l.type} 列了一行卻是 0 元`).toBeGreaterThan(0);
  });

  it('should skip policies that are off', () => {
    const off = [{ name: 'D', cells: { size: 50 }, policies: [{ type: PolicyType.TOURISM, level: 0 }] }];
    expect(listPolicyExpenses(off as never, new CityOrdinances(), 1000)).toHaveLength(0);
  });

  it('should sum to exactly what the budget charges', () => {
    // 明細跟帳對不起來的話，玩家看到的解釋是假的。所以比的是**模擬迴圈實際寫進
    // 預算的那個數字**，不是把同一條公式再算一次。
    //
    // 人口必須造出來:節能法規按人口計費，人口 0 的話全城那一段恆為 0，刪掉
    // listPolicyExpenses 的全城迴圈也不會被抓到。
    const build = (on: boolean) => {
      const state = createGameState(30, 30);
      const loop = new SimulationLoop(state);
      for (let i = 0; i < 200; i++) state.citizens.restoreCitizen({}, 0);
      const d = state.districts.createDistrict('Downtown');
      for (let x = 5; x < 15; x++) state.districts.addCellToDistrict(d.id, x, 5);
      if (on) {
        state.policies.setPolicyLevel(d.id, PolicyType.ENCOURAGE_RECYCLING, 2);
        state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 2);
      }
      // calculateIncome 在 slowSlot 5 跑，六個 tick 剛好涵蓋一次。
      for (let i = 0; i < 6; i++) loop.tick();
      return { state, expenses: state.budget.expenses };
    };

    const off = build(false);
    const on = build(true);
    const charged = on.expenses - off.expenses;

    const lines = listPolicyExpenses(
      on.state.districts.getAllDistricts() as never,
      on.state.ordinances,
      on.state.citizens.getPopulation(),
    );
    const sum = lines.reduce((a, l) => a + l.cost, 0);

    expect(lines.filter(l => l.scope === 'city'), '沒有全城條例，全城那一段是空測試')
      .toHaveLength(1);
    expect(sum, '明細合計是 0，這條測試等於空轉').toBeGreaterThan(0);
    expect(sum, '明細合計跟預算實際多收的錢對不起來').toBeCloseTo(charged, 6);
  });
});
```

> 兩座城市除了政策以外完全一樣,而且沒有電廠水廠 —— 沒有電就長不出建築,所以
> 六個 tick 內成長與遷居不會動,差額只可能來自政策。`SimulationLoop.getExpenseBreakdown()`
> 不存在,支出是寫進 `state.budget.expenses` 的。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/economy/__tests__/PolicyExpenseBreakdown.test.ts`
Expected: FAIL — `listPolicyExpenses` is not exported

- [ ] **Step 3: 實作**

```ts
export interface PolicyExpenseLine {
  type: PolicyType;
  scope: 'district' | 'city';
  /** 全城條例是 null。 */
  districtName: string | null;
  level: number;
  cost: number;
}

/**
 * 逐條列出本期政策支出。
 *
 * 預算面板只給一個總額的話,「政策從 $800 漲到 $4,200」會是一個玩家事後才發現的坑。
 * 看得見才做得了決定 —— 這也是這套設計不設預算上限的前提:上限會替玩家自動砍掉
 * 政策,而且砍得無聲無息。
 *
 * 這裡的加總必須等於 `calculateDistrictPolicyCost` 加上 `CityOrdinances.totalCost`
 * —— 明細跟帳對不起來的話,玩家看到的解釋是假的。
 */
export function listPolicyExpenses(
  districts: readonly {
    name: string; cells: { size: number };
    policies: readonly { type: PolicyType; level: number }[];
  }[],
  ordinances: { getLevel(t: PolicyType): number },
  population: number,
): PolicyExpenseLine[] {
  const out: PolicyExpenseLine[] = [];
  for (const d of districts) {
    for (const p of d.policies) {
      if (!isPolicyImplemented(p.type)) continue;
      const cost = policyCost(p.type, p.level, { population, districtCells: d.cells.size });
      if (cost === 0) continue;
      out.push({ type: p.type, scope: 'district', districtName: d.name, level: p.level, cost });
    }
  }
  for (const type of Object.values(PolicyType)) {
    const level = ordinances.getLevel(type);
    const cost = policyCost(type, level, { population, districtCells: 0 });
    if (cost === 0) continue;
    out.push({ type, scope: 'city', districtName: null, level, cost });
  }
  return out;
}
```

- [ ] **Step 4: 跑測試**

Run: `npx vitest run src/core/economy/__tests__/PolicyExpenseBreakdown.test.ts`
Expected: PASS(3 條)

- [ ] **Step 5: 接進預算 UI**

`grep -rn "policyCost" src/ui/` 找出預算分頁,在既有的 Policies 那一列下加一個可展開的
小節,逐行顯示 `{districtName ?? 'City'} · {name} ●×level — $cost`。

- [ ] **Step 6: 全套驗證**

Run: `npx vitest run && npx tsc --noEmit`
Run: `npx eslint src/core/district/ src/core/economy/ src/ui/modals/`

- [ ] **Step 7: revert-verify**

兩次:
1. `listPolicyExpenses` 的全城迴圈刪掉 → `should sum to exactly what the budget charges`
   的「沒有全城條例，全城那一段是空測試」那條斷言與合計斷言都轉紅，
   `should list one line per active policy` 也轉紅
2. 分區那一段的 `districtCells: d.cells.size` 改成 `districtCells: 1` →
   `should sum to exactly what the budget charges` 轉紅

- [ ] **Step 8: 更新文件與提交**

- `docs/districts-options.md` 標註選項 E 已落地,以及它實際做成什麼樣子
- `docs/` 新增條例系統的說明(照既有 `*-system.md` 的體例):範圍怎麼判、分級怎麼定價、
  為什麼不設預算上限
- `TODO.md` 勾掉對應項目,並把「條例目錄」與「地形驅動的分區專精」列為後續

訊息主旨:`feat(economy): 預算面板逐條列出政策支出`

---

## 這份計畫**不含**的

- **條例目錄的其餘部分**(賭場、壅塞費、育兒補貼等)。機制做好之後那些是往
  `POLICY_EFFECTS` / `POLICY_BILLING` / `POLICY_SCOPE` 加列,另開一份計畫。節能法規是
  唯一的例外,因為不加它的話全城那條路徑沒有東西可測。
- **地形驅動的分區專精**(`docs/districts-options.md` 的選項 B)。獨立子系統,另開計畫。
- **刪掉 `taxRateOverride` 與 `efficiencyMultiplier`**。獨立的清理工作。
