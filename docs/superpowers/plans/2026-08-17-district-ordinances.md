# 條例系統核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把現有的分區政策從「五條純好處的價目表」改造成有強度、有取捨、費用隨規模走的條例系統,並讓條例可以是全城的。

**Architecture:** 不新增系統,擴充既有的 `PolicyManager`。三件事:(1) `Policy.active: boolean` 換成 `level: 0..3`,`POLICY_EFFECTS` 從單一物件變成每級一格的陣列;(2) 費用從 `POLICY_CONFIG.cost` 這個常數,改成由 `POLICY_BILLING` 的計費基數 × 規模算出來;(3) 加一張 `POLICY_SCOPE` 表區分分區條例與全城條例,全城的存在新的 `CityOrdinanceManager`。條例目錄本身(賭場、壅塞費、節能法規等)**不在這份計畫裡** —— 機制做好之後那些只是往表格加列。

**Tech Stack:** TypeScript、Vitest、Solid.js(UI)。`src/core/` 禁止 import Three.js。

## Global Constraints

- **TDD 強制**:每個 task 先寫失敗測試,再寫實作。實作完成後做 revert-verify —— 暫時把守衛拿掉,確認測試轉紅;沒轉紅表示測試無效,要修測試或刪掉沒有理由存在的程式碼。
- **測試指令**:`npx vitest run <path>`;全套 `npx vitest run`。基準是 399 檔 / 5809 測試全過。
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
| `src/core/district/types.ts` | `Policy` / `District` / `PolicyType` 的型別 | 修改:`active` → `level` |
| `src/core/district/PolicyManager.ts` | 分區條例的套用、查詢、效果合成 | 修改:分級、新增 crime 槓桿 |
| `src/core/district/PolicyBilling.ts` | **新增** 計費基數表與費用計算 | 建立 |
| `src/core/district/PolicyScope.ts` | **新增** 分區 / 全城的分類表 | 建立 |
| `src/core/district/CityOrdinances.ts` | **新增** 全城條例的狀態與查詢 | 建立 |
| `src/core/district/DistrictManager.ts` | 分區存檔序列化 | 修改:存檔遷移 |
| `src/core/economy/ExpenseCalculator.ts` | 政策支出加總 | 修改:改用計費表 |
| `src/core/economy/IncomeCalcAdapter.ts` | 收入乘數的組裝 | 修改:帶 zoneType |
| `src/core/economy/IncomeCalculator.ts` | 逐格收入計算 | 修改:`getRevenueMultiplier` 簽章 |
| `src/ui/modals/DistrictModal.tsx` | 分區條例 UI | 修改:分級按鈕 |

新增檔案刻意拆開:計費、範圍分類、全城狀態是三件會各自長大的事,塞進已經 200 行的 `PolicyManager.ts` 只會讓它變得難改。

---

### Task 1: `Policy.level` 取代 `active`

分級的前置。`active: boolean` 表達不了「輕度/中度/重度」,而且三個 enum 成員(`ENERGY_LIGHT` 等)會讓互斥檢查變成另一份要手動同步的東西 —— 一個欄位只能是一個值,互斥自動成立。

**Files:**
- Modify: `src/core/district/types.ts:22-28`
- Modify: `src/core/district/PolicyManager.ts:99-140`(`applyPolicy` / `isPolicyActive` / `effect`)
- Modify: `src/core/district/DistrictManager.ts:145-155`(`fromJSON` 遷移)
- Test: `src/core/district/__tests__/PolicyLevel.test.ts`(新增)

**Interfaces:**
- Produces:
  - `Policy.level: 0 | 1 | 2 | 3`(0 = 關閉,取代 `active: false`)
  - `PolicyManager.setPolicyLevel(districtId: string, type: PolicyType, level: number): void`
  - `PolicyManager.getPolicyLevel(districtId: string, type: PolicyType): number`
  - `PolicyManager.isPolicyActive(districtId, type): boolean`(保留,等價於 `level > 0`)

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

  it('should migrate an old save that used active:true', () => {
    // 舊存檔沒有 level。掉成 0 的話，玩家讀檔會發現政策全被關掉了。
    const dm = DistrictManager.fromJSON({
      nextId: 2,
      districts: [{
        id: 'district_1', name: 'D', cells: ['1,1'],
        policies: [{ id: 'p1', name: 'R', type: PolicyType.ENCOURAGE_RECYCLING, cost: 100, active: true }],
        specialization: 'NONE',
      }],
    } as never);
    const pm = new PolicyManager(dm);
    expect(pm.getPolicyLevel('district_1', PolicyType.ENCOURAGE_RECYCLING)).toBe(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyLevel.test.ts`
Expected: FAIL — `pm.setPolicyLevel is not a function`

- [ ] **Step 3: 改型別**

`src/core/district/types.ts`,把 `Policy` 改成:

```ts
export interface Policy {
  id: string;
  name: string;
  type: PolicyType;
  /**
   * 強度。0 = 關閉。
   *
   * 用一個等級欄位而不是三個 enum 成員（LIGHT / MEDIUM / HEAVY），是因為
   * 互斥必須自動成立 —— 分成三個成員的話，「不能同時開輕度和重度」會變成
   * 另一份要手動維護的檢查，而漏掉的那一條不會有任何徵兆。
   */
  level: 0 | 1 | 2 | 3;
}
```

- [ ] **Step 4: 改 `PolicyManager`**

把 `applyPolicy` / `removePolicy` 換成 `setPolicyLevel`,並保留 `isPolicyActive`:

```ts
  setPolicyLevel(districtId: string, policyType: PolicyType, level: number): void {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return;
    const clamped = Math.max(0, Math.min(maxLevel(policyType), Math.floor(level))) as Policy['level'];

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

  removePolicy(districtId: string, policyType: PolicyType): void {
    const district = this.districtLookup.getDistrict(districtId);
    if (!district) return;
    district.policies = district.policies.filter((p) => p.type !== policyType);
  }
```

`effect()` 裡的 `if (!policy.active) continue;` 改成 `if (policy.level === 0) continue;`。
`maxLevel()` 在 Task 2 才會有真正的實作,這一步先加一個暫時版本在 `PolicyManager.ts`:

```ts
/** 這個條例最高幾級。Task 2 改成從 POLICY_EFFECTS 的長度推導。 */
export function maxLevel(_type: PolicyType): number {
  return 3;
}
```

- [ ] **Step 5: 加存檔遷移**

`DistrictManager.fromJSON` 的 policies 那一行改成:

```ts
        policies: (sd.policies ?? []).map((p) => ({
          id: p.id, name: p.name, type: p.type,
          // 舊存檔只有 active。掉成 0 的話玩家讀檔會發現政策全被關掉了，
          // 而畫面上沒有任何東西說明為什麼。
          level: (p as { level?: number }).level
            ?? ((p as { active?: boolean }).active ? 1 : 0),
        })),
```

同時把 `SerializedDistrict` 的 `policies` 型別放寬成同時容納兩種形狀。

- [ ] **Step 6: 跑測試確認通過**

Run: `npx vitest run src/core/district/__tests__/PolicyLevel.test.ts`
Expected: PASS(4 條)

- [ ] **Step 7: 修好被打到的既有測試與呼叫端**

Run: `npx tsc --noEmit`
把所有 `applyPolicy(...)` 改成 `setPolicyLevel(..., 1)`,`p.active` 改成 `p.level > 0`。
已知會打到:`src/core/district/__tests__/District.test.ts`、`src/ui/modals/DistrictModal.tsx`、
`src/core/economy/ExpenseCalculator.ts`。

Run: `npx vitest run`
Expected: 399 檔全過

- [ ] **Step 8: revert-verify**

把 Step 5 的遷移改回 `level: 0`,跑 `npx vitest run src/core/district/__tests__/PolicyLevel.test.ts` ——
`should migrate an old save` 必須轉紅。確認後改回來。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -F <暫存檔>
```
訊息主旨:`refactor(district): 政策用強度取代開關`

---

### Task 2: `POLICY_EFFECTS` 分級

**Files:**
- Modify: `src/core/district/PolicyManager.ts:46-90`
- Test: `src/core/district/__tests__/PolicyLevel.test.ts`(追加)

**Interfaces:**
- Consumes: Task 1 的 `Policy.level`、`getPolicyLevel`
- Produces:
  - `PolicyEffect` 介面
  - `POLICY_EFFECTS: Partial<Record<PolicyType, readonly PolicyEffect[]>>`(索引 0 = level 1)
  - `maxLevel(type: PolicyType): number` — 由陣列長度推導

- [ ] **Step 1: 寫失敗測試**

追加到 `PolicyLevel.test.ts`:

```ts
import { POLICY_EFFECTS, maxLevel } from '../PolicyManager';

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
    const tiers = POLICY_EFFECTS[PolicyType.ENCOURAGE_RECYCLING]!;
    const ratios = tiers.map(t => (1 - (t.revenue ?? 1)) / (1 - (t.garbage ?? 1)));
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
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyLevel.test.ts`
Expected: FAIL — `POLICY_EFFECTS[...]` 不是陣列

- [ ] **Step 3: 改表**

```ts
export interface PolicyEffect {
  /** Multiplier on garbage produced in the district. */
  garbage?: number;
  /** Multiplier on tax revenue from buildings in the district. */
  revenue?: number;
  /** Flat addition to land value before the usual clamp. */
  landValue?: number;
}

/**
 * 每個條例每一級做什麼。索引 0 是第 1 級;二元條例只放一格。
 *
 * 現有三條原本都是純好處 —— 付得起就一定開,那不是決策,是價目表。回收現在
 * 每一級都同時扣商業收入,而且**單位代價逐級上升**:第三級每減 1% 垃圾要付的
 * 收入代價比第一級高,所以最強的那一級不會自動是最好的選擇。
 */
export const POLICY_EFFECTS: Partial<Record<PolicyType, readonly PolicyEffect[]>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: [
    { garbage: 0.85, revenue: 0.98 },   // 減 15% 垃圾，代價 2% 收入 → 0.133
    { garbage: 0.65, revenue: 0.92 },   // 減 35%，代價 8%           → 0.229
    { garbage: 0.45, revenue: 0.82 },   // 減 55%，代價 18%          → 0.327
  ],
  [PolicyType.TOURISM]: [{ revenue: 1.2 }],
  [PolicyType.ORGANIC_FOOD]: [{ landValue: 6 }],
};

/** 這個條例最高幾級。由表推導,不手寫 —— 手寫的那份一定會跟表走散。 */
export function maxLevel(type: PolicyType): number {
  return POLICY_EFFECTS[type]?.length ?? 1;
}
```

- [ ] **Step 4: 改 `effect()` 讀對應等級**

```ts
    for (const policy of district.policies) {
      if (policy.level === 0) continue;
      const tiers = POLICY_EFFECTS[policy.type];
      const value = pick(tiers?.[policy.level - 1] ?? {});
      if (value !== undefined) out = combine(out, value);
    }
```

- [ ] **Step 5: 跑測試**

Run: `npx vitest run src/core/district/__tests__/PolicyLevel.test.ts`
Expected: PASS(8 條)

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全過、乾淨

- [ ] **Step 6: revert-verify**

把回收第三級的 `revenue` 從 `0.82` 改成 `0.98`(讓代價不再加速),
`should charge an accelerating price` 必須轉紅。確認後改回來。

- [ ] **Step 7: 提交**

訊息主旨:`feat(district): 條例分三級，代價逐級加速`

---

### Task 3: 雙向效果 —— 犯罪槓桿

沒有這一步就做不出「+收入 +犯罪」這種取捨,而取捨正是整個改造的目的。
現在只有 `PoliceService.getCrimeReduction(x,y)`,沒有任何東西能**增加**犯罪。

**Files:**
- Modify: `src/core/district/PolicyManager.ts`(新增 `crime` 效果與 getter)
- Modify: `src/core/simulation/SimulationLoop.ts:1149`(地價的 `crimeRate` 來源)
- Test: `src/core/district/__tests__/PolicyTradeoff.test.ts`(新增)

**Interfaces:**
- Consumes: Task 2 的 `PolicyEffect`
- Produces:
  - `PolicyEffect.crime?: number`(加法,單位同 `LandValue` 的 `crimeRate`)
  - `PolicyManager.getCrimeBonus(districtId: string | null): number`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/PolicyTradeoff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager, POLICY_EFFECTS } from '../PolicyManager';
import { PolicyType } from '../types';

describe('條例的取捨', () => {
  it('should let one policy move two numbers in opposite directions', () => {
    // 這條是整個改造的目的：沒有反向效果，條例就只是價目表。
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    pm.setPolicyLevel(d.id, PolicyType.TOURISM, 1);
    expect(pm.getRevenueMultiplier(d.id), '觀光沒有加收入').toBeGreaterThan(1);
    expect(pm.getCrimeBonus(d.id), '觀光沒有帶來任何代價').toBeGreaterThan(0);
  });

  it('should give no crime bonus outside any district', () => {
    const dm = new DistrictManager();
    expect(new PolicyManager(dm).getCrimeBonus(null)).toBe(0);
  });

  it('should have at least one downside on every non-restriction policy', () => {
    // 純好處的條例不該存在。限制型（沒有 POLICY_EFFECTS 條目）不在此列。
    for (const [type, tiers] of Object.entries(POLICY_EFFECTS)) {
      for (const [i, t] of tiers!.entries()) {
        const hasDownside = (t.revenue !== undefined && t.revenue < 1)
          || (t.crime !== undefined && t.crime > 0)
          || (t.landValue !== undefined && t.landValue < 0)
          || (t.garbage !== undefined && t.garbage > 1);
        expect(hasDownside, `${type} 第 ${i + 1} 級是純好處，付得起就一定開`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/PolicyTradeoff.test.ts`
Expected: FAIL — `pm.getCrimeBonus is not a function`

- [ ] **Step 3: 加 `crime` 到效果表與 getter**

`PolicyEffect` 加一欄:

```ts
  /**
   * 加到該區犯罪率上的量。正值是代價。
   *
   * `PoliceService` 只提供 `getCrimeReduction` —— 整個模擬沒有任何東西能讓
   * 犯罪上升,所以「+收入 +犯罪」這類取捨做不出來。這一欄是那個缺口。
   */
  crime?: number;
```

觀光改成有代價,有機食品也是:

```ts
  [PolicyType.TOURISM]: [{ revenue: 1.2, crime: 4 }],
  [PolicyType.ORGANIC_FOOD]: [{ landValue: 6, revenue: 0.95 }],
```

getter:

```ts
  /** 該區因條例而增加的犯罪率。沒有分區就是 0。 */
  getCrimeBonus(districtId: string | null): number {
    return this.effect(districtId, e => e.crime, 0, (a, b) => a + b);
  }
```

- [ ] **Step 4: 接進地價**

`SimulationLoop.ts` 地價那一段,`crimeRate` 改成:

```ts
        crimeRate: this.getAvgCrime()
          + this.state.policies.getCrimeBonus(
              this.state.districts.getDistrictAt(x, y)?.id ?? null,
            ),
```

- [ ] **Step 5: 跑測試**

Run: `npx vitest run src/core/district/__tests__/PolicyTradeoff.test.ts`
Expected: PASS(3 條)

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 6: revert-verify**

把 `TOURISM` 的 `crime: 4` 拿掉,
`should have at least one downside` 與 `should let one policy move two numbers` 必須轉紅。

- [ ] **Step 7: 提交**

訊息主旨:`feat(district): 條例可以有代價，新增犯罪槓桿`

---

### Task 4: 依規模計費

固定費用在大城市等於免費 —— 早期是限制,後期是無感。改成跟著它服務的規模走,
費用才有來由,而且「政策越成功越貴」本身就是一個要玩家自己決定何時收手的張力。

**Files:**
- Create: `src/core/district/PolicyBilling.ts`
- Modify: `src/core/economy/ExpenseCalculator.ts:12-22`
- Test: `src/core/district/__tests__/PolicyBilling.test.ts`(新增)

**Interfaces:**
- Consumes: Task 1 的 `getPolicyLevel`、Task 2 的 `maxLevel`
- Produces:
  - `type BillingBasis = 'flat' | 'population' | 'districtCells'`
  - `POLICY_BILLING: Partial<Record<PolicyType, { basis: BillingBasis; perUnit: readonly number[] }>>`
  - `policyCost(type: PolicyType, level: number, scale: PolicyScale): number`
  - `interface PolicyScale { population: number; districtCells: number }`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/PolicyBilling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { policyCost, POLICY_BILLING } from '../PolicyBilling';
import { POLICY_ZONE_RESTRICTIONS } from '../PolicyManager';
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
    const light = policyCost(PolicyType.ENCOURAGE_RECYCLING, 1, BIG);
    const heavy = policyCost(PolicyType.ENCOURAGE_RECYCLING, 3, BIG);
    expect(heavy).toBeGreaterThan(light);
  });

  it('should not bill restriction policies', () => {
    // 限制型的代價是機會成本（收入少了），不是市府掏錢。再收一次是雙重懲罰。
    for (const type of Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[]) {
      expect(POLICY_BILLING[type], `${type} 是限制型卻列了計費基數`).toBeUndefined();
      expect(policyCost(type, 1, BIG)).toBe(0);
    }
  });

  it('should have one perUnit entry per level the effect table offers', () => {
    // 兩張表走散的話，第三級會靜靜地用第二級的價錢。
    for (const [type, billing] of Object.entries(POLICY_BILLING)) {
      const { maxLevel } = require('../PolicyManager') as typeof import('../PolicyManager');
      expect(billing!.perUnit.length, `${type} 的計費級數與效果級數對不上`)
        .toBe(maxLevel(type as PolicyType));
    }
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
 * 機會成本 —— 該區長不出高稅收的建築 —— 而不是市府掏錢。再收一次是雙重懲罰,
 * 而且那個數字沒有來由。
 *
 * `perUnit` 每一級一格,索引 0 是第 1 級,長度必須等於 `maxLevel(type)`。兩張表
 * 走散的話,第三級會靜靜地用第二級的價錢。
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
  const capped = Math.min(level, maxLevel(type));
  const perUnit = billing.perUnit[capped - 1];
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

呼叫端(`SimulationLoop`)補上 `this.state.citizens.getPopulation()`。

- [ ] **Step 5: 跑測試**

Run: `npx vitest run src/core/district/__tests__/PolicyBilling.test.ts`
Expected: PASS(5 條)

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 6: revert-verify**

把回收的 `perUnit` 改成 `[9, 9, 9]`,`should cost more at a higher level` 必須轉紅。
再把 `basis` 改成 `'flat'`,`should scale with the thing it serves` 必須轉紅。

- [ ] **Step 7: 提交**

訊息主旨:`feat(district): 條例費用跟著規模走，限制型不收費`

---

### Task 5: 全城條例

有些條例的效果作用在城市級的池子上(電網總需求、教育晉級、貿易價格),沒有位置可言。
判斷法:**如果「整張地圖都套用」永遠不會比「只套一部分」差,那它就該是全城的** ——
那時候「在哪裡」不是決策,逼玩家先畫分區只是多按幾下。

**Files:**
- Create: `src/core/district/PolicyScope.ts`
- Create: `src/core/district/CityOrdinances.ts`
- Modify: `src/core/simulation/GameState.ts:61-62,134-135`
- Modify: `src/core/save/Serializer.ts:80-81,159-160,283-287`
- Test: `src/core/district/__tests__/CityOrdinances.test.ts`(新增)

**Interfaces:**
- Consumes: Task 1 的 `maxLevel`、Task 4 的 `policyCost`
- Produces:
  - `POLICY_SCOPE: Record<PolicyType, 'district' | 'city'>`
  - `class CityOrdinances { setLevel(type, level): void; getLevel(type): number; totalCost(population: number): number; toJSON(); restore(data) }`
  - `GameState.ordinances: CityOrdinances`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/district/__tests__/CityOrdinances.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { POLICY_SCOPE } from '../PolicyScope';
import { PolicyType } from '../types';

describe('全城條例', () => {
  it('should remember the level it was set to', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENCOURAGE_RECYCLING, 2);
    expect(o.getLevel(PolicyType.ENCOURAGE_RECYCLING)).toBe(2);
  });

  it('should give every policy exactly one scope', () => {
    // 一個條例同時是分區又是全城的話，兩邊會各自生效，效果無聲地加倍。
    for (const type of Object.values(PolicyType)) {
      expect(POLICY_SCOPE[type], `${type} 沒有指定範圍`).toBeDefined();
      expect(['district', 'city']).toContain(POLICY_SCOPE[type]);
    }
  });

  it('should round-trip through save', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.ENCOURAGE_RECYCLING, 3);
    const restored = new CityOrdinances();
    restored.restore(o.toJSON());
    expect(restored.getLevel(PolicyType.ENCOURAGE_RECYCLING)).toBe(3);
  });

  it('should survive a save that predates ordinances', () => {
    const o = new CityOrdinances();
    o.restore(undefined);
    expect(o.getLevel(PolicyType.ENCOURAGE_RECYCLING)).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/district/__tests__/CityOrdinances.test.ts`
Expected: FAIL — 找不到模組

- [ ] **Step 3: 建立 `PolicyScope.ts`**

```ts
import { PolicyType } from './types';

/**
 * 每個條例的作用範圍。
 *
 * 判斷法:如果「整張地圖都套用」永遠不會比「只套一部分」差,它就該是全城的 ——
 * 那時候「在哪裡」根本不是決策,逼玩家先畫分區只是多按幾下。反過來,只在市中心
 * 收的壅塞費如果全城都收,就等於全面加稅,失去它原本的意義。
 *
 * 一個條例只能有一個範圍。兩邊都算的話效果會無聲地加倍。
 */
export const POLICY_SCOPE: Record<PolicyType, 'district' | 'city'> = {
  [PolicyType.NO_HEAVY_INDUSTRY]: 'district',
  [PolicyType.HIGH_DENSITY_BAN]: 'district',
  [PolicyType.ENCOURAGE_RECYCLING]: 'district',
  [PolicyType.ORGANIC_FOOD]: 'district',
  [PolicyType.TOURISM]: 'district',
};
```

- [ ] **Step 4: 建立 `CityOrdinances.ts`**

```ts
import { PolicyType } from './types';
import { maxLevel } from './PolicyManager';
import { policyCost } from './PolicyBilling';

/** 全城條例的強度。沒有分區,所以只有一份等級表。 */
export class CityOrdinances {
  private levels = new Map<PolicyType, number>();

  setLevel(type: PolicyType, level: number): void {
    const clamped = Math.max(0, Math.min(maxLevel(type), Math.floor(level)));
    if (clamped === 0) this.levels.delete(type);
    else this.levels.set(type, clamped);
  }

  getLevel(type: PolicyType): number {
    return this.levels.get(type) ?? 0;
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
    this.levels = new Map(data?.levels ?? []);
  }
}
```

- [ ] **Step 5: 接進 `GameState` 與存檔**

`GameState.ts` 的介面加 `ordinances: CityOrdinances;`,建立處加 `ordinances: new CityOrdinances(),`。
`Serializer.ts`:`SaveData` 加 `ordinances?: ReturnType<CityOrdinances['toJSON']>;`,
序列化加 `ordinances: state.ordinances.toJSON(),`,還原加 `state.ordinances.restore(saved.ordinances);`。

- [ ] **Step 6: 跑測試**

Run: `npx vitest run src/core/district/__tests__/CityOrdinances.test.ts`
Expected: PASS(4 條)

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 7: revert-verify**

從 `POLICY_SCOPE` 拿掉 `TOURISM` 那一列(改成 `as never` 繞過型別),
`should give every policy exactly one scope` 必須轉紅。

- [ ] **Step 8: 提交**

訊息主旨:`feat(district): 條例可以是全城的`

---

### Task 6: 收入乘數帶 zoneType

「只扣商業收入」目前做不到 —— `getRevenueMultiplier(x, y)` 只有座標,
所以任何收入代價都會平均落在住宅、商業、工業、辦公上。

**Files:**
- Modify: `src/core/economy/IncomeCalculator.ts:43,85,90`
- Modify: `src/core/economy/IncomeCalcAdapter.ts:41-49`
- Test: `src/core/economy/__tests__/RevenueByZone.test.ts`(新增)

**Interfaces:**
- Consumes: Task 2 的 `PolicyEffect`
- Produces:
  - `IncomeCalculatorDeps.getRevenueMultiplier?: (x: number, y: number, zoneType: ZoneType) => number`
  - `PolicyEffect.revenueByZone?: Partial<Record<ZoneType, number>>`

- [ ] **Step 1: 寫失敗測試**

建立 `src/core/economy/__tests__/RevenueByZone.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ZoneType } from '../../grid/types';
import { DistrictManager } from '../../district/DistrictManager';
import { PolicyManager } from '../../district/PolicyManager';
import { PolicyType } from '../../district/types';

describe('分區條例只扣特定分區的收入', () => {
  it('should leave residential alone when the cost lands on commerce', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    const pm = new PolicyManager(dm);
    pm.setPolicyLevel(d.id, PolicyType.ENCOURAGE_RECYCLING, 3);

    const commercial = pm.getRevenueMultiplier(d.id, ZoneType.COMMERCIAL_LOW);
    const residential = pm.getRevenueMultiplier(d.id, ZoneType.RESIDENTIAL_LOW);

    expect(commercial, '商業沒有被扣').toBeLessThan(1);
    expect(residential, '住宅也被扣了 —— 代價該落在商業身上').toBe(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/economy/__tests__/RevenueByZone.test.ts`
Expected: FAIL — `getRevenueMultiplier` 收到多餘的參數 / 住宅也被扣

- [ ] **Step 3: 加 `revenueByZone` 並改 getter**

`PolicyEffect` 加:

```ts
  /**
   * 只作用在特定分區的收入乘數。
   *
   * `revenue` 是全分區一視同仁,做不出「只扣商業」—— 而多數條例的代價本來就
   * 落在特定產業上(回收增加商家的處理成本,跟住戶無關)。
   */
  revenueByZone?: Partial<Record<ZoneType, number>>;
```

回收改成:

```ts
  [PolicyType.ENCOURAGE_RECYCLING]: [
    { garbage: 0.85, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.98, [ZoneType.COMMERCIAL_HIGH]: 0.98 } },
    { garbage: 0.65, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.92, [ZoneType.COMMERCIAL_HIGH]: 0.92 } },
    { garbage: 0.45, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.82, [ZoneType.COMMERCIAL_HIGH]: 0.82 } },
  ],
```

`getRevenueMultiplier` 改簽章:

```ts
  getRevenueMultiplier(districtId: string | null, zoneType: ZoneType): number {
    const flat = this.effect(districtId, e => e.revenue, 1, (a, b) => a * b);
    const byZone = this.effect(districtId, e => e.revenueByZone?.[zoneType], 1, (a, b) => a * b);
    return flat * byZone;
  }
```

- [ ] **Step 4: 一路改到 `IncomeCalculator`**

`IncomeCalculatorDeps.getRevenueMultiplier` 改成三參數,兩個呼叫處(`:85`、`:90`)傳入該格的 `cell.zoneType`。
`IncomeCalcAdapter` 的 lambda 改成 `(x, y, zoneType) => ...`。

**同時要改 Task 3 留下的呼叫端**:`PolicyTradeoff.test.ts` 的
`pm.getRevenueMultiplier(d.id)` 是單參數,這一步之後會編譯失敗。改成
`pm.getRevenueMultiplier(d.id, ZoneType.COMMERCIAL_LOW)`,並 import `ZoneType`。
`tsc --noEmit` 會抓到所有其他漏網的呼叫端。

- [ ] **Step 5: 跑測試**

Run: `npx vitest run src/core/economy/__tests__/RevenueByZone.test.ts`
Expected: PASS

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 6: revert-verify**

把回收的 `revenueByZone` 改回 `revenue`,`should leave residential alone` 必須轉紅。

- [ ] **Step 7: 提交**

訊息主旨:`feat(economy): 收入乘數分辨分區類型`

---

### Task 7: DistrictModal 的分級 UI

**Files:**
- Modify: `src/ui/modals/DistrictModal.tsx:46-63,86-140`
- Test: 無自動化測試(這一層綁著 Solid + `getGame()`,專案既有慣例是不測 UI)

**Interfaces:**
- Consumes: Task 1 的 `setPolicyLevel` / `getPolicyLevel`、Task 2 的 `maxLevel`、Task 4 的 `policyCost`

- [ ] **Step 1: 把 toggle 換成循環等級**

```ts
  const cyclePolicy = (districtId: string, policyType: PolicyType) => {
    const state = getGame().getState();
    if (!isPolicyImplemented(policyType)) {
      state.policies.removePolicy(districtId, policyType);
    } else {
      // 按一次進一級，到頂再按回到 0 —— 一顆按鈕就走得完，不必為三級各放一顆。
      const next = (state.policies.getPolicyLevel(districtId, policyType) + 1)
        % (maxLevel(policyType) + 1);
      state.policies.setPolicyLevel(districtId, policyType, next);
    }
    getGame().notifyDistrictPolicyChanged();
    setVersion(v => v + 1);
  };
```

- [ ] **Step 2: 按鈕顯示等級與本期費用**

把 `activePolicies()` 換成讀等級,標籤改成:

```tsx
{level() > 0 ? `✓ ${'●'.repeat(level())} ` : ''}{policyLabel(pt)}
{level() > 0 ? ` ($${Math.round(policyCost(pt, level(), { population: pop(), districtCells: cellCount() }))})` : ''}
```

`policyLabel` 不再吃 `cfg.cost`(那個欄位已經沒有意義了),改成只回名稱。

- [ ] **Step 3: 手動驗收**

```bash
pnpm dev
```
開新遊戲 → District 工具畫一塊 → 開 District 面板 → 反覆點同一條政策,
確認:等級 0→1→2→3→0 循環、圓點數量跟著變、費用隨格數變化。

- [ ] **Step 4: 提交**

訊息主旨:`feat(ui): 分區條例可以調強度，按鈕顯示等級與本期費用`

---

### Task 8: 預算面板逐條列出政策支出

沒有這一步,「政策越成功越貴」會變成一個玩家事後才發現的坑。
看得見才做得了決定 —— 這也是不設預算上限的前提。

**Files:**
- Modify: `src/core/economy/ExpenseCalculator.ts`(新增逐條明細)
- Modify: `src/ui/modals/overview/`(預算分頁,實作時先找出對應檔案)
- Test: `src/core/economy/__tests__/PolicyExpenseBreakdown.test.ts`(新增)

**Interfaces:**
- Consumes: Task 4 的 `policyCost`
- Produces:
  - `interface PolicyExpenseLine { type: PolicyType; scope: 'district' | 'city'; districtName: string | null; level: number; cost: number }`
  - `listPolicyExpenses(districts, ordinances, population): PolicyExpenseLine[]`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { listPolicyExpenses } from '../ExpenseCalculator';
import { calculateDistrictPolicyCost } from '../ExpenseCalculator';
import { CityOrdinances } from '../../district/CityOrdinances';
import { PolicyType } from '../../district/types';

const districts = [{
  name: 'Downtown', cells: { size: 50 },
  policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 }],
}];

describe('政策支出明細', () => {
  it('should list one line per active policy', () => {
    const lines = listPolicyExpenses(districts, new CityOrdinances(), 1000);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.districtName).toBe('Downtown');
    expect(lines[0]!.level).toBe(2);
    expect(lines[0]!.cost).toBeGreaterThan(0);
  });

  it('should sum to the same total the budget charges', () => {
    // 明細跟帳對不起來的話，玩家看到的解釋是假的。
    const ord = new CityOrdinances();
    const lines = listPolicyExpenses(districts, ord, 1000);
    const sum = lines.reduce((a, l) => a + l.cost, 0);
    expect(sum).toBeCloseTo(
      calculateDistrictPolicyCost(districts as never, 1000) + ord.totalCost(1000), 6,
    );
  });

  it('should skip policies that are off', () => {
    const off = [{ name: 'D', cells: { size: 50 }, policies: [{ type: PolicyType.TOURISM, level: 0 }] }];
    expect(listPolicyExpenses(off, new CityOrdinances(), 1000)).toHaveLength(0);
  });
});
```

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
 * 預算面板只給一個總額的話,「育兒補貼從 $800 漲到 $4,200」會是一個玩家事後才
 * 發現的坑。看得見才做得了決定 —— 這也是這套設計不設預算上限的前提:上限會替
 * 玩家自動砍掉政策,而且砍得無聲無息。
 */
export function listPolicyExpenses(
  districts: readonly { name: string; cells: { size: number }; policies: readonly { type: PolicyType; level: number }[] }[],
  ordinances: { getLevel(t: PolicyType): number },
  population: number,
): PolicyExpenseLine[] {
  const out: PolicyExpenseLine[] = [];
  for (const d of districts) {
    for (const p of d.policies) {
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

先 `grep -rn "Expenses\|支出" src/ui/modals/overview/` 找出預算分頁,
在既有的支出列表下加一個可展開的「Policies」小節,逐行顯示
`{districtName ?? 'City'} · {policyLabel} ●×level — $cost`。

- [ ] **Step 6: 全套驗證**

Run: `npx vitest run && npx tsc --noEmit`
Run: `npx eslint src/core/district/ src/core/economy/ src/ui/modals/DistrictModal.tsx`
Expected: 全過、乾淨、lint 無新增錯誤

- [ ] **Step 7: revert-verify**

把 `listPolicyExpenses` 裡全城那一段的迴圈刪掉,
`should sum to the same total` 在有全城條例時必須轉紅(測試需先補一條設了等級的全城條例)。

- [ ] **Step 8: 更新文件與提交**

- `docs/districts-options.md` 標註哪些選項已落地
- `docs/` 新增或更新條例系統的說明(照既有 `*-system.md` 的體例)
- `TODO.md` 勾掉對應項目

訊息主旨:`feat(economy): 預算面板逐條列出政策支出`

---

## 這份計畫**不含**的

- **條例目錄**(賭場、壅塞費、節能法規、育兒補貼等 20 條)。機制做好之後那些是往
  `POLICY_EFFECTS` / `POLICY_BILLING` / `POLICY_SCOPE` 加列,另開一份計畫。
- **地形驅動的分區專精**(選項 B)。獨立子系統,另開一份計畫。
- **分區 overlay 畫不出來的 bug**。純前置,建議在動這份計畫之前先修掉,否則畫了分區
  看不見,這份計畫的每一步都無法目視驗收。
- **刪掉 `taxRateOverride` 與 `efficiencyMultiplier`**。獨立的清理工作。
