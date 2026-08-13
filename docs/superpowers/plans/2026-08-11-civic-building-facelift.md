# 公共建築美化 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 19 種公共建築改走 `BUILDING_FRAG`，取得程序化窗格、夜間亮燈、貼片與矮物件，第一個交付目標是 `showcase.html`。

**Architecture:** 新增 `src/renderer/geometry/civic/`，用既有的 `Volume` + `shapeOf` 圖元描述每棟公共建築，四層（量體／貼片／矮物件／懸挑）與分區建築逐項對應。`ZONE_CAT` 擴充四個公共立面類別，shader 的立面 if 鏈改由 `ZONE_CAT` 生成。

**Tech Stack:** TypeScript、Three.js（僅 renderer 層）、Vitest、GLSL ES 1.00

**Spec:** `docs/superpowers/specs/2026-08-11-civic-building-facelift-design.md`

## Global Constraints

- **TDD 強制。** 先寫失敗的測試、跑紅、實作、跑綠、**回退驗證**（暫時撤掉修正，確認測試轉紅）。回退不轉紅是測試有缺口，不是可以跳過的步驟。
- **`src/core/` 禁止 import Three.js。** 本計畫的所有新檔案都在 `src/renderer/` 與 `src/showcase/` 之下，不碰 core。
- **發現 Bug 必須寫入 `BUGS.md` 與 `TODO.md`。**
- 測試指令：`npx vitest run <path>`；全部：`npm test`；型別：`npx tsc --noEmit`。
- 單位：座標一律用**格**，1 格 = 12 m（`METRES_PER_CELL`）。寫尺寸時用 `M(公尺)` 轉換，不要寫死格值。
- 提交訊息結尾固定兩行：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013CaAT8jcajKrRTLsVvFoop
  ```
- **不要在 Bash 工具裡用 PowerShell here-string（`@'...'@`）** —— 把訊息寫成檔案再 `git commit -F`。
- 分支：`feat/civic-building-facelift`（已建立）。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/renderer/BuildingMaterial.ts` | **修改。** 立面 if 鏈改由 `ZONE_CAT` 生成；新增四個公共類別的立面分支 |
| `src/renderer/geometry/buildings/parts.ts` | **修改。** 新增 `FACADE_*` 常數與 `ZONE_CAT` 條目 |
| `src/renderer/ColorPalettes.ts` | **修改。** 四個公共類別的屋頂色票 |
| `src/renderer/geometry/buildings/massing/assemble.ts` | **修改。** 匯出 `shapeOf`。既有 `assemble()` 簽章與行為不變 |
| `src/renderer/geometry/civic/types.ts` | **新增。** `CivicPlan` / `CivicDecal` / `CIVIC_INSET` / 三角形預算 |
| `src/renderer/geometry/civic/assemble.ts` | **新增。** `assembleCivic()` / `assembleDecals()`，護欄在這裡 |
| `src/renderer/geometry/civic/registry.ts` | **新增。** `InfraType → CivicPlan` 查表 |
| `src/renderer/geometry/civic/models/*.ts` | **新增。** 一個檔案一棟建築 |
| `src/showcase/civic.ts` | **新增。** showcase 的 civic 檢視 |
| `src/showcase/main.ts` / `controls.ts` / `views.ts` | **修改。** 接上 civic 模式 |

---

## Task 0：立面 if 鏈改由 `ZONE_CAT` 生成

**為什麼先做這個：** `BUILDING_FRAG` 的立面 if 鏈是 `ZONE_CAT` 的第二份資料，
而最後那個 `else` 現在接的是辦公。直接加 cat > 1.0 的公共類別，公共建築會
**靜靜地**掉進辦公的窗格分支 —— 不會有任何東西報錯。

這一輪**不改變任何行為**。它的驗收標準是「產生出來的 shader 原始碼一個 byte
都不變」，那是這個重構能拿到的最強護欄。

**Files:**
- Create: `src/renderer/__tests__/fixtures/building-frag-baseline.glsl`
- Create: `src/renderer/__tests__/FacadeChain.test.ts`
- Modify: `src/renderer/BuildingMaterial.ts`

**Interfaces:**
- Produces：
  ```ts
  /** ZONE_CAT 依 cat 遞增排序後的 key。門檻與分支順序都由它推導。 */
  export function sortedFacadeKeys(): number[];
  /** 第 i 個分支的上界。相鄰兩個 cat 的中點；最後一個是 Infinity。 */
  export function facadeThresholds(): number[];
  /** 給定 cat，這條 if 鏈會走進哪一個 key 的分支。 */
  export function facadeKeyOf(cat: number): number;
  /** 由 ZONE_CAT 產生一條 if 鏈。`bodyOf` 回傳該分支的 GLSL 函式體。 */
  export function catChainGlsl(bodyOf: (facadeKey: number) => string): string;
  ```

- [ ] **Step 1：先把現在的 shader 存成基準**

在動任何程式碼之前，把目前的 `BUILDING_FRAG` 寫成 fixture。順序很重要 ——
重構之後才存的基準等於沒有基準。

```bash
node --input-type=module -e "
import { BUILDING_FRAG } from './src/renderer/BuildingMaterial.ts';
" 2>/dev/null || true
```

Node 直接 import TS 不會成功。改用 vitest 產生：暫時寫一個一次性測試
`src/renderer/__tests__/_dump.test.ts`：

```ts
import { it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { BUILDING_FRAG } from '../BuildingMaterial';

it('dump', () => {
  mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./fixtures/building-frag-baseline.glsl', import.meta.url), BUILDING_FRAG);
});
```

執行 `npx vitest run src/renderer/__tests__/_dump.test.ts`，然後**刪掉 `_dump.test.ts`**。

- [ ] **Step 2：寫失敗的測試**

`src/renderer/__tests__/FacadeChain.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BUILDING_FRAG, sortedFacadeKeys, facadeThresholds, facadeKeyOf,
} from '../BuildingMaterial';
import { ZONE_CAT } from '../geometry/buildings/parts';
import { ZoneType } from '../../core/grid/types';

const BASELINE = readFileSync(
  new URL('./fixtures/building-frag-baseline.glsl', import.meta.url), 'utf8',
);

/**
 * 立面 if 鏈原本是手寫的六個門檻，而屋頂色票是由 ZONE_CAT 生成的。
 * 同一張表兩份資料 —— 改了一邊不會有任何東西報錯，而錯的表現是
 * 「某個分區默默拿到別人的立面」。
 *
 * 這一輪只把生成方式統一，**不改變任何行為**。所以驗收標準是最嚴格的
 * 那一種：產生出來的原始碼一個 byte 都不變。
 */
describe('生成的 shader 與手寫版逐字元相同', () => {
  it('should emit a byte-identical fragment shader', () => {
    expect(BUILDING_FRAG).toBe(BASELINE);
  });
});

describe('門檻由 ZONE_CAT 推導', () => {
  it('should order the branches by ascending category', () => {
    const keys = sortedFacadeKeys();
    const cats = keys.map(k => ZONE_CAT[k]!);
    expect(cats).toEqual([...cats].sort((a, b) => a - b));
    expect(keys.length).toBe(Object.keys(ZONE_CAT).length);
  });

  it('should put each threshold at the midpoint of two neighbouring categories', () => {
    const keys = sortedFacadeKeys();
    const th = facadeThresholds();
    expect(th.length).toBe(keys.length);
    for (let i = 0; i < keys.length - 1; i++) {
      expect(th[i]).toBeCloseTo((ZONE_CAT[keys[i]!]! + ZONE_CAT[keys[i + 1]!]!) / 2, 10);
    }
    expect(th[th.length - 1]).toBe(Infinity);   // 最後一個是 else
  });

  it('should route every category to its own branch', () => {
    for (const key of sortedFacadeKeys()) {
      expect(facadeKeyOf(ZONE_CAT[key]!), `cat ${ZONE_CAT[key]} 沒有走進自己的分支`)
        .toBe(key);
    }
  });

  /**
   * 這一條是把「JS 的門檻」與「GLSL 的門檻」綁在一起。
   *
   * `facadeKeyOf` 是 GLSL if 鏈的 JS 分身 —— 它本身就是第二份資料。
   * 從產生出來的原始碼把數字挖回來比對，這個迴圈才閉合。
   */
  it('should emit exactly the thresholds it computed', () => {
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const emitted = [...wall.matchAll(/vZoneCat < ([0-9.]+)/g)].map(m => Number(m[1]));
    const expected = facadeThresholds().filter(t => Number.isFinite(t));
    expect(emitted, 'GLSL 裡的門檻與 JS 算出來的不一致').toEqual(expected);
  });
});

describe('六個分區的立面沒有被搬錯', () => {
  /** 每個分支獨有的標記。搬錯位置的話它會出現在別人的分支裡。 */
  const SIGNATURE: Array<[number, string]> = [
    [ZoneType.RESIDENTIAL_LOW,  'RESIDENTIAL LOW'],
    [ZoneType.RESIDENTIAL_HIGH, 'RESIDENTIAL HIGH'],
    [ZoneType.COMMERCIAL_LOW,   'COMMERCIAL LOW'],
    [ZoneType.COMMERCIAL_HIGH,  'COMMERCIAL HIGH'],
    [ZoneType.INDUSTRIAL,       'INDUSTRIAL'],
    [ZoneType.OFFICE,           'OFFICE'],
  ];

  it('should keep the branches in ascending category order', () => {
    const positions = SIGNATURE.map(([, marker]) => BUILDING_FRAG.indexOf(marker));
    for (const [i, p] of positions.entries()) {
      expect(p, `找不到分支標記 ${SIGNATURE[i]![1]}`).toBeGreaterThan(-1);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 3：跑測試確認它失敗**

```bash
npx vitest run src/renderer/__tests__/FacadeChain.test.ts
```
預期：`sortedFacadeKeys is not a function`（三條門檻測試失敗）。
逐字元那一條**會通過** —— 因為還沒重構。那是正確的：它是護欄，不是驅動力。

- [ ] **Step 4：重構 `BuildingMaterial.ts`**

把 `roofColorGlsl()` 裡的排序與門檻邏輯抽成三個匯出函式，再用它們產生
**兩條**鏈。關鍵是產生出來的字串要與手寫版逐字元相同 —— 現有的六個門檻
（0.1 / 0.3 / 0.5 / 0.7 / 0.9）本來就是中點，所以做得到。

```ts
/** ZONE_CAT 依 cat 遞增排序後的 key。門檻與分支順序都由它推導。 */
export function sortedFacadeKeys(): number[] {
  return Object.entries(ZONE_CAT)
    .map(([k, cat]) => ({ key: Number(k), cat }))
    .sort((a, b) => a.cat - b.cat)
    .map(e => e.key);
}

/**
 * 每個分支的上界 —— 相鄰兩個 cat 的中點。最後一個是 Infinity（GLSL 的 else）。
 *
 * 取中點而不是取下一個 cat：頂點色是 Float32，插值與往返可能讓 1.2 變成
 * 1.1999999。門檻壓在兩個分區正中間，誤差要大到 0.1 才會走錯分支。
 */
export function facadeThresholds(): number[] {
  const cats = sortedFacadeKeys().map(k => ZONE_CAT[k]!);
  return cats.map((c, i) => (i === cats.length - 1 ? Infinity : (c + cats[i + 1]!) / 2));
}

/** 給定 cat，這條 if 鏈會走進哪一個 key 的分支。GLSL 與它由同一張門檻表產生。 */
export function facadeKeyOf(cat: number): number {
  const keys = sortedFacadeKeys();
  const th = facadeThresholds();
  for (let i = 0; i < keys.length; i++) if (cat < th[i]!) return keys[i]!;
  return keys[keys.length - 1]!;
}

/**
 * 由 ZONE_CAT 產生一條 if 鏈。
 *
 * `bodyOf` 回傳該分支的 GLSL 函式體（含前後的空白），`commentOf` 回傳
 * 掛在 `if` 之前的註解。兩者都原樣輸出 —— 這個函式不排版，因為它要能
 * 產生與手寫版逐字元相同的結果。
 */
export function catChainGlsl(
  bodyOf: (facadeKey: number) => string,
  commentOf: (facadeKey: number) => string = () => '',
): string {
  const keys = sortedFacadeKeys();
  const th = facadeThresholds();
  return keys.map((key, i) => {
    const head = i === 0 ? 'if' : 'else if';
    const guard = Number.isFinite(th[i]!)
      ? `${head} (zoneCat < ${glslFloat(th[i]!)}) `
      : 'else ';
    return `${commentOf(key)}${guard}{${bodyOf(key)}} `;
  }).join('');
}
```

`roofColorGlsl()` 改成一行：

```ts
function roofColorGlsl(): string {
  return catChainGlsl(zone => `\n    c = ${pickChain(roofPaletteFor(zone))};\n  `);
}
```

立面那條鏈：把六個分支的函式體原樣搬進 `FACADE_BODIES: Record<number, string>`，
再用 `catChainGlsl` 串起來。**變數名要換 —— 立面鏈用的是 `vZoneCat`，屋頂用的
是 `zoneCat`**（後者是 `getRoofColor` 的參數）。所以 `catChainGlsl` 要多一個
變數名參數，或立面鏈自己包一層。取後者：

```ts
/** 立面鏈用 `vZoneCat`（varying），屋頂鏈用 `zoneCat`（函式參數）。 */
const facadeChainGlsl = () =>
  catChainGlsl(FACADE_BODY, FACADE_COMMENT).replaceAll('zoneCat <', 'vZoneCat <');
```

- [ ] **Step 5：跑測試確認全部通過**

```bash
npx vitest run src/renderer/__tests__/FacadeChain.test.ts src/renderer/__tests__/NightLighting.test.ts src/renderer/__tests__/BuildingParts.test.ts
```
預期：全綠。逐字元那一條是重點 —— 它不綠就表示重構改了行為。

- [ ] **Step 6：回退驗證**

把 `facadeThresholds()` 的中點改成 `cats[i + 1]`（取下一個 cat 而不是中點）。
預期：「should put each threshold at the midpoint」與「should emit exactly the
thresholds」與逐字元三條同時轉紅。改回來。

第二次回退：把 `sortedFacadeKeys()` 的 `.sort()` 拿掉。
預期：逐字元與順序兩條轉紅。改回來。

- [ ] **Step 7：型別與全測**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 8：提交**

```bash
git add src/renderer/BuildingMaterial.ts src/renderer/__tests__/FacadeChain.test.ts src/renderer/__tests__/fixtures/building-frag-baseline.glsl
git commit -F <訊息檔>
```

訊息主旨：`refactor(shader): 立面 if 鏈改由 ZONE_CAT 生成`

---

## Task 1：四個公共立面類別

**Files:**
- Modify: `src/renderer/geometry/buildings/parts.ts`
- Modify: `src/renderer/ColorPalettes.ts`
- Modify: `src/renderer/BuildingMaterial.ts`
- Modify: `src/renderer/__tests__/FacadeChain.test.ts`
- Modify: `src/renderer/__tests__/fixtures/building-frag-baseline.glsl`（刻意更新）

**Interfaces:**
- Consumes：Task 0 的 `sortedFacadeKeys` / `facadeThresholds` / `facadeKeyOf` / `catChainGlsl`
- Produces：
  ```ts
  export const FACADE_CIVIC = 101;
  export const FACADE_UTILITY = 102;
  export const FACADE_TRANSIT = 103;
  export const FACADE_GREEN = 104;
  ```

- [ ] **Step 1：寫失敗的測試**

加進 `FacadeChain.test.ts`：

```ts
import {
  FACADE_CIVIC, FACADE_UTILITY, FACADE_TRANSIT, FACADE_GREEN,
} from '../geometry/buildings/parts';

describe('公共建築的立面類別', () => {
  const CIVIC_KEYS = [FACADE_CIVIC, FACADE_UTILITY, FACADE_TRANSIT, FACADE_GREEN];

  it('should not collide with any ZoneType', () => {
    // ZoneType 是 0–6。撞號的話公共建築會拿到某個分區的屋頂色票，
    // 而 Record 的 key 相同只會靜靜地互相覆蓋。
    for (const k of CIVIC_KEYS) expect(k).toBeGreaterThan(100);
    expect(new Set(CIVIC_KEYS).size).toBe(CIVIC_KEYS.length);
  });

  it('should sit above every zone category', () => {
    const zoneCats = [1, 2, 3, 4, 5, 6].map(z => ZONE_CAT[z]!);
    for (const k of CIVIC_KEYS) {
      expect(ZONE_CAT[k], `公共類別 ${k} 沒有排在分區之後`)
        .toBeGreaterThan(Math.max(...zoneCats));
    }
  });

  /**
   * 這是整輪最重要的一條。
   *
   * 立面鏈原本的最後一個分支是 `else` —— 辦公。加了 cat > 1.0 的公共類別
   * 之後，若那個 `else` 沒有變成 `else if`，公共建築會**靜靜地**掉進辦公的
   * 窗格分支：一座警局長出玻璃帷幕的辦公窗格，而不會有任何東西報錯。
   */
  it('should NOT fall through to the office branch', () => {
    for (const k of CIVIC_KEYS) {
      expect(facadeKeyOf(ZONE_CAT[k]!), `${k} 掉進了辦公分支`).not.toBe(ZoneType.OFFICE);
      expect(facadeKeyOf(ZONE_CAT[k]!)).toBe(k);
    }
  });

  it('should give the office branch a guard instead of the bare else', () => {
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const officeAt = wall.indexOf('OFFICE');
    const civicAt = wall.indexOf('FACADE_CIVIC');
    expect(civicAt, '找不到公共立面分支').toBeGreaterThan(-1);
    expect(officeAt).toBeLessThan(civicAt);
    // 辦公之後還有分支 → 它不能再是無條件的 else
    expect(wall.slice(officeAt - 40, officeAt)).toContain('vZoneCat <');
  });

  it('should give every civic category its own roof palette', () => {
    // 沒有色票會落到 FALLBACK_ROOF，四種公共建築的屋頂會一模一樣。
    for (const k of CIVIC_KEYS) {
      expect(roofPaletteFor(k), `${k} 沒有自己的屋頂色票`).not.toBe(roofPaletteFor(-1));
    }
  });

  it('should light something at night in every civic branch', () => {
    // 這一條就是 BUG-238 本身 —— 做完了夜裡還是全黑的話它要轉紅。
    for (const marker of ['FACADE_CIVIC', 'FACADE_UTILITY', 'FACADE_TRANSIT']) {
      const at = BUILDING_FRAG.indexOf(marker);
      const branch = BUILDING_FRAG.slice(at, at + 3000);
      expect(branch, `${marker} 沒有設 windowMask —— 夜裡不會亮`).toContain('windowMask');
      expect(branch, `${marker} 沒有 isLitWindow`).toContain('isLitWindow');
    }
  });
});
```

- [ ] **Step 2：跑測試確認它失敗**

```bash
npx vitest run src/renderer/__tests__/FacadeChain.test.ts
```
預期：`FACADE_CIVIC is not exported`。

- [ ] **Step 3：實作**

`parts.ts` 加四個常數與 `ZONE_CAT` 條目（值見 spec §4.4）。
`ColorPalettes.ts` 的 `ROOF_PALETTE_TABLE` 加四組色票：

| 類別 | 屋頂語彙 |
|---|---|
| `FACADE_CIVIC` | 深灰瀝青、銅綠、板岩 —— 公家建築的屋頂偏沉穩 |
| `FACADE_UTILITY` | 鍍鋅浪板的冷灰、鏽紅 |
| `FACADE_TRANSIT` | 白色薄膜、淺灰金屬 —— 車站屋頂多是輕構造 |
| `FACADE_GREEN` | 綠化屋頂、木構深褐 |

`BuildingMaterial.ts` 的 `FACADE_BODIES` 加四個分支。每個分支的骨架與既有的
六個一致（算 `fy` / `fx` / `winMask`，設 `windowMask`，依 `occ` 決定
`isLitWindow`），差別在窗格尺寸與亮燈門檻：

```glsl
// ---- FACADE_CIVIC: 磚石立面，規律中型窗，一樓門廊 ----
float fy = y / floorHeight;
float fx = (wallU + phase) / (windowWidth * 0.9);
...
// 值班單位（警局、消防局、醫院）夜裡亮的比住宅少但比辦公多
float litThreshCV = mix(0.95, 0.45, occ);
```

四個分支的實際數字**先照這裡的初值寫**，開 showcase 看過夜景之後再校準
（spec §10）。

- [ ] **Step 4：更新基準 fixture**

Task 0 的逐字元測試現在**應該**失敗 —— 立面鏈確實多了四個分支。這是刻意的
改變，不是迴歸。重新產生 fixture（同 Task 0 Step 1 的做法），並在
`FacadeChain.test.ts` 的逐字元測試上加註解說明它守的是「後續改動不得意外
更動 shader」，而不是「shader 永遠不變」。

- [ ] **Step 5：跑測試確認全部通過**

```bash
npx vitest run src/renderer/__tests__/ && npx tsc --noEmit
```

- [ ] **Step 6：回退驗證**

把立面鏈的最後一個分支改回無條件 `else`（即讓辦公重新吞掉所有 cat > 0.9）。
預期：`should NOT fall through to the office branch` 與
`should give the office branch a guard` 轉紅。改回來。

第二次回退：拿掉 `FACADE_CIVIC` 分支裡的 `windowMask = winMask;`。
預期：`should light something at night` 轉紅。改回來。

- [ ] **Step 7：提交**

主旨：`feat(shader): 四個公共建築立面類別`

---

## Task 2：`civic/` 基礎建設

**Files:**
- Modify: `src/renderer/geometry/buildings/massing/assemble.ts`（匯出 `shapeOf`）
- Create: `src/renderer/geometry/civic/types.ts`
- Create: `src/renderer/geometry/civic/assemble.ts`
- Create: `src/renderer/geometry/civic/registry.ts`
- Create: `src/renderer/geometry/civic/__tests__/CivicAssemble.test.ts`

**Interfaces:**
- Consumes：`Volume` / `shapeOf` / `tagPart` / `setGroundShade` / `PART_*`
- Produces：
  ```ts
  export interface CivicPlan { footprint; facade; seed; massing; decals; props; overhead }
  export interface CivicDecal { x; z; w; d; shade; layer?; lawn? }
  export const CIVIC_INSET: number;
  export const CIVIC_TRIANGLE_BUDGET: { MASSING_PER_CELL; DECAL_PER_CELL; PROP_PER_CELL; OVERHEAD_PER_CELL };
  export function assembleCivic(volumes: readonly Volume[], footprint: Footprint): THREE.BufferGeometry;
  export function assembleDecals(decals: readonly CivicDecal[], footprint: Footprint): THREE.BufferGeometry;
  export function getCivicPlan(type: InfraType): CivicPlan | undefined;
  ```

- [ ] **Step 1：寫失敗的測試**

`src/renderer/geometry/civic/__tests__/CivicAssemble.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { assembleCivic, assembleDecals } from '../assemble';
import { CIVIC_INSET, type CivicDecal } from '../types';
import { PART_WALL, PART_GROUND, PART_FOLIAGE, triangleCount } from '../../buildings/parts';
import type { Volume } from '../../buildings/massing/volume';

const FOOT = { w: 2, h: 2 };
const box = (o: Partial<Volume> = {}): Volume =>
  ({ x: 0, z: 0, w: 1, d: 1, y0: 0, y1: 0.5, ...o });

describe('assembleCivic 的護欄', () => {
  it('should accept volumes inside the footprint', () => {
    expect(() => assembleCivic([box({ w: 1.9, d: 1.9 })], FOOT)).not.toThrow();
  });

  it('should throw when a volume leaves the footprint', () => {
    // 越出佔地就是壓到鄰格的建築或馬路。靜靜地穿過去比當場炸掉難追一百倍。
    expect(() => assembleCivic([box({ w: 2.4, d: 1 })], FOOT))
      .toThrow(/超出佔地/);
  });

  it('should throw on an off-centre volume that pokes out one side', () => {
    // 包圍盒寬度看不出單邊外凸 —— 這正是 BUG-222 的形狀。
    expect(() => assembleCivic([box({ x: 0.8, w: 1, d: 1 })], FOOT))
      .toThrow(/超出佔地/);
  });

  it('should reserve the inset', () => {
    // 剛好貼齊佔地邊界會與鄰格共面 z-fighting。
    const flush = 2 - CIVIC_INSET * 2;
    expect(() => assembleCivic([box({ w: flush, d: flush })], FOOT)).not.toThrow();
    expect(() => assembleCivic([box({ w: flush + 0.01, d: flush })], FOOT)).toThrow();
  });

  it('should tag every vertex it emits', () => {
    const geo = assembleCivic([box({ part: PART_WALL })], FOOT);
    const col = geo.getAttribute('color');
    expect(col, '沒有頂點色 —— shader 會把整棟當成 partType 0').toBeTruthy();
    expect(col.count).toBe(geo.getAttribute('position').count);
  });
});

describe('assembleDecals', () => {
  const decal = (o: Partial<CivicDecal> = {}): CivicDecal =>
    ({ x: 0, z: 0, w: 1, d: 1, shade: 0.5, ...o });

  it('should emit flat quads with no sides', () => {
    // 有厚度的話側面會長出牆，而牆會長出窗戶（decals.ts 的教訓）。
    const geo = assembleDecals([decal()], FOOT);
    const pos = geo.getAttribute('position');
    const ys = new Set<number>();
    for (let i = 0; i < pos.count; i++) ys.add(Number(pos.getY(i).toFixed(6)));
    expect(ys.size, '貼片有兩個以上的高度 —— 它有厚度').toBe(1);
    expect(triangleCount(geo)).toBe(2);
  });

  it('should tag paving as ground and lawn as foliage', () => {
    const paved = assembleDecals([decal()], FOOT).getAttribute('color');
    expect(paved.getX(0)).toBeCloseTo(PART_GROUND, 6);
    const lawn = assembleDecals([decal({ lawn: true })], FOOT).getAttribute('color');
    expect(lawn.getX(0)).toBeCloseTo(PART_FOLIAGE, 6);
  });

  it('should write shade into the blue channel', () => {
    const geo = assembleDecals([decal({ shade: 0.85 })], FOOT);
    expect(geo.getAttribute('color').getZ(0)).toBeCloseTo(0.85, 6);
  });

  it('should stack marks above the base layer', () => {
    const base = assembleDecals([decal()], FOOT).getAttribute('position').getY(0);
    const mark = assembleDecals([decal({ layer: 'mark' })], FOOT).getAttribute('position').getY(0);
    expect(mark, '標線沒有疊在鋪面之上 —— 會 z-fighting').toBeGreaterThan(base);
  });

  it('should reject overlapping base decals', () => {
    // 兩塊同高同位的四邊形靜態截圖看不出來，一移動鏡頭就整片閃爍。
    expect(() => assembleDecals([decal(), decal({ x: 0.5 })], FOOT))
      .toThrow(/底層貼片重疊/);
  });

  it('should allow a mark to sit on top of a base decal', () => {
    expect(() => assembleDecals([decal(), decal({ layer: 'mark' })], FOOT)).not.toThrow();
  });
});
```

- [ ] **Step 2：跑測試確認它失敗**

```bash
npx vitest run src/renderer/geometry/civic/
```
預期：找不到模組。

- [ ] **Step 3：匯出 `shapeOf`**

`massing/assemble.ts`：把 `function shapeOf` 改成 `export function shapeOf`。
**`assemble()` 本身不動** —— 分區建築的八個變體都吃它。

- [ ] **Step 4：實作 `types.ts`**

型別定義照 spec §4.1 / §4.2 / §4.6。`CIVIC_INSET = 0.02`（24 cm），
註解要寫清楚它擋的是與鄰格共面的 z-fighting。

- [ ] **Step 5：實作 `assemble.ts`**

```ts
/**
 * 公共建築的量體轉幾何。越出佔地時**丟例外**。
 *
 * 與分區版 `assemble()` 只差護欄：那邊擋的是行人包絡線（格內，BUG-221），
 * 這邊擋的是佔地邊界 —— 公共建築佔好幾格，包絡線的概念不適用，越界的
 * 後果是壓到鄰格的建築或馬路。
 */
export function assembleCivic(
  volumes: readonly Volume[], footprint: Footprint,
): THREE.BufferGeometry {
  const limX = footprint.w / 2 - CIVIC_INSET;
  const limZ = footprint.h / 2 - CIVIC_INSET;
  for (const v of volumes) {
    const overX = Math.max(Math.abs(v.x - v.w / 2), Math.abs(v.x + v.w / 2)) - limX;
    const overZ = Math.max(Math.abs(v.z - v.d / 2), Math.abs(v.z + v.d / 2)) - limZ;
    const over = Math.max(overX, overZ);
    if (over > 1e-6) {
      throw new Error(
        `量體超出佔地 ${(over * METRES_PER_CELL).toFixed(3)} m —— 會壓到鄰格`,
      );
    }
  }
  // 之後與 assemble() 相同：shapeOf → tagPart → mergeGeometries
}
```

`assembleDecals` 用 `PlaneGeometry` 並 `rotateX(-Math.PI / 2)`（照 `decals.ts`
的做法），高度取 `GROUND_LAYERS.DECAL` / `GROUND_LAYERS.MARKING`，
重疊檢查只在 `base` 層之間做。

- [ ] **Step 6：實作 `registry.ts`**

先只有空表與查詢函式 —— 建築在後面的 Task 才進來：

```ts
const PLANS: Partial<Record<InfraType, CivicPlan>> = {};
export function getCivicPlan(type: InfraType): CivicPlan | undefined { return PLANS[type]; }
/** 已經改造完成的種類。showcase 的下拉選單與資料表測試都吃它。 */
export function civicTypesDone(): InfraType[] { return Object.keys(PLANS) as InfraType[]; }
```

- [ ] **Step 7：跑測試確認通過**

```bash
npx vitest run src/renderer/geometry/civic/ && npx tsc --noEmit && npm test
```

- [ ] **Step 8：回退驗證**

把 `assembleCivic` 的護欄整段拿掉 → 三條護欄測試轉紅。
把 `assembleDecals` 的重疊檢查拿掉 → `should reject overlapping base decals` 轉紅。
把 `PlaneGeometry` 換成 `BoxGeometry(w, 0.01, d)` → `should emit flat quads` 轉紅。
逐項改回來。

- [ ] **Step 9：提交**

主旨：`feat(civic): CivicPlan 與多格量體組裝`

---

## Task 3：showcase 的 civic 模式

**Files:**
- Create: `src/showcase/civic.ts`
- Modify: `src/showcase/views.ts`（`ViewMode` 加 `'civic'`）
- Modify: `src/showcase/controls.ts`
- Modify: `src/showcase/main.ts`
- Create: `src/showcase/__tests__/CivicView.test.ts`

- [ ] **Step 1：寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest';
import { civicTriangleReport } from '../civic';
import { CIVIC_TRIANGLE_BUDGET } from '../../renderer/geometry/civic/types';
import { civicTypesDone } from '../../renderer/geometry/civic/registry';

describe('civic 檢視的統計', () => {
  it('should scale the budget by footprint, not per building', () => {
    // 2x2 的醫院不能套逐棟的 HOUSE: 400 —— 那條線是給一格的建築訂的。
    const r = civicTriangleReport({ w: 2, h: 2 }, { massing: 900, decal: 0, prop: 0, overhead: 0 });
    expect(r.budget.massing).toBe(CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * 4);
    expect(r.over.massing).toBe(false);
  });

  it('should flag a plan that blows the budget', () => {
    const r = civicTriangleReport({ w: 2, h: 2 }, { massing: 1300, decal: 0, prop: 0, overhead: 0 });
    expect(r.over.massing).toBe(true);
  });

  it('should list only the types that have a plan', () => {
    // 下拉選單列出還沒改造的種類，選了會是一片空白而不會報錯。
    for (const t of civicTypesDone()) expect(getCivicPlan(t)).toBeDefined();
  });
});
```

- [ ] **Step 2：跑測試確認失敗** → `npx vitest run src/showcase/`

- [ ] **Step 3：實作 `civic.ts`**

`civicTriangleReport(footprint, tris)` 是純函式（可測）；建 mesh 的部分放
`placeCivic(type, scene)`，走與 `main.ts` 的 `place()` 相同的流程：
`assembleCivic` → `stampZoneCategory(geo, ZONE_CAT[plan.facade])` →
`stampInstanceValues(geo, { occupancy, seed: plan.seed })` → `new THREE.Mesh(geo, material)`。

**四層都要餵 `stampInstanceValues`** —— 只餵量體層的話矮物件的燈永遠不亮
（BUG-230c 就是這個形狀）。

- [ ] **Step 4：接上控制面板**

`ViewMode` 加 `'civic'`；`controls.ts` 加 `InfraType` 下拉（從 `civicTypesDone()`
產生，名稱取 `INFRA_CONFIGS` 的 `name`）；分區／密度／等級／變體四個下拉在
civic 模式下 `style.display = 'none'` —— 它們對公共建築沒有意義，留著只會
讓人以為調了有用。

- [ ] **Step 5：跑測試 + 開起來看**

```bash
npx vitest run src/showcase/ && npx tsc --noEmit
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```
開 `http://127.0.0.1:5180/showcase.html`，切到 civic 模式。
此時還沒有任何建築 —— 下拉是空的、畫面是空地。**那是正確的**。

- [ ] **Step 6：回退驗證**

把 `civicTriangleReport` 的預算改成不乘格數 → 前兩條轉紅。改回來。

- [ ] **Step 7：提交**

主旨：`feat(showcase): civic 檢視模式`

---

## 批 1：民生服務 6 種

六棟建築共用同一個結構，所以先訂**共用的驗收**，再逐棟做。

### Task 4：資料表測試（先寫，後面每棟都吃它）

**Files:** Create `src/renderer/geometry/civic/__tests__/CivicPlans.test.ts`

- [ ] **Step 1：寫測試**

```ts
import { describe, it, expect } from 'vitest';
import { getCivicPlan, civicTypesDone } from '../registry';
import { getInfraConfig } from '../../../../core/building/InfraConfig';
import { assembleCivic, assembleDecals } from '../assemble';
import { CIVIC_TRIANGLE_BUDGET } from '../types';
import { PART_THRESHOLDS, triangleCount } from '../../buildings/parts';

const isLamp = (p: number) => p > PART_THRESHOLDS.LAMP_MIN && p < PART_THRESHOLDS.FOLIAGE_MIN;
const isDetail = (p: number) => p > PART_THRESHOLDS.ROOF_BY_NORMAL && p < PART_THRESHOLDS.LAMP_MIN;

describe.each(civicTypesDone())('%s 的 plan', (type) => {
  const plan = getCivicPlan(type)!;
  const cfg = getInfraConfig(type)!;
  const cells = cfg.width * cfg.height;

  it('should match the footprint declared in InfraConfig', () => {
    // 對不上就是幾何與遊戲規則各說各話 —— 建築會壓到鄰格或縮在角落。
    expect(plan.footprint).toEqual({ w: cfg.width, h: cfg.height });
  });

  it('should build without leaving the footprint', () => {
    expect(() => assembleCivic(plan.massing, plan.footprint)).not.toThrow();
    expect(() => assembleCivic(plan.props, plan.footprint)).not.toThrow();
    expect(() => assembleCivic(plan.overhead, plan.footprint)).not.toThrow();
    expect(() => assembleDecals(plan.decals, plan.footprint)).not.toThrow();
  });

  it('should light something at night', () => {
    // BUG-238 本身。做完了夜裡還是全黑的話這一條要轉紅。
    const lamps = [...plan.massing, ...plan.props, ...plan.overhead]
      .filter(v => isLamp(v.part ?? 0));
    expect(lamps.length, `${type} 一盞燈都沒有`).toBeGreaterThan(0);
  });

  it('should not tag a whole lamp post as glowing', () => {
    // 整支標成發光的話，夜裡會看到一根從地上亮到頂的柱子（BUG-230 的教訓）。
    for (const v of [...plan.props, ...plan.massing].filter(x => isLamp(x.part ?? 0))) {
      expect(v.y1 - v.y0, `${type} 有一個 ${((v.y1 - v.y0) * 12).toFixed(1)} m 高的發光體`)
        .toBeLessThan(0.1);   // 1.2 m
    }
  });

  it('should stay inside the per-cell triangle budget', () => {
    const m = triangleCount(assembleCivic(plan.massing, plan.footprint));
    expect(m, `${type} 量體超支`).toBeLessThanOrEqual(CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * cells);
  });

  it('should have a facade category', () => {
    expect(plan.facade).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2：跑測試** —— 此時 `civicTypesDone()` 是空的，`describe.each([])`
  會**整組跳過**。這是陷阱：空的資料表測試永遠是綠的。所以再加一條守門：

```ts
it('should have at least one plan registered', () => {
  expect(civicTypesDone().length, '沒有任何 plan —— 上面的資料表測試全部被跳過')
    .toBeGreaterThan(0);
});
```

- [ ] **Step 3：確認它現在是紅的**（因為還沒有任何 plan）

- [ ] **Step 4：提交**（測試先行，主旨 `test(civic): plan 的資料表驗收`）

### Task 5–10：逐棟建築

每一棟一個 Task，結構相同。以警局為例：

**Files:**
- Create: `src/renderer/geometry/civic/models/police.ts`
- Modify: `src/renderer/geometry/civic/registry.ts`（註冊）
- Create: `src/renderer/geometry/civic/models/__tests__/Police.test.ts`

- [ ] **Step 1：寫這一棟獨有的測試**

資料表測試（Task 4）已經涵蓋共通項，這裡只寫這一棟獨有的形狀約束：

```ts
describe('警局', () => {
  const plan = policePlan();

  it('should occupy 2x2', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 2 });
  });

  it('should keep the tower above the wings', () => {
    // 瞭望塔是警局的辨識特徵。被翼樓蓋過去就認不出來了。
    const tower = plan.massing.find(v => v.tag === 'tower')!;
    const wings = plan.massing.filter(v => v.tag === 'wing');
    for (const w of wings) expect(tower.y1).toBeGreaterThan(w.y1);
  });

  it('should put the parking bays on the decal layer, not the massing layer', () => {
    // 停車格是標線，放進量體層就會長出牆與窗。
    expect(plan.decals.some(d => d.layer === 'mark')).toBe(true);
  });

  it('should face the entrance with a canopy', () => {
    expect(plan.overhead.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2：跑測試確認失敗**
- [ ] **Step 3：寫 `police.ts`**

量體用公尺宣告、`M()` 轉格。警局 2×2 = 24 × 24 m，可用範圍扣掉 `CIVIC_INSET`
之後是 ±11.76 m。

| 零件 | 尺寸（m） | 標籤 | 說明 |
|---|---|---|---|
| 長翼 | 14 × 7 × 9 高 | `PART_WALL` | 主體，`FACADE_CIVIC` 立面 |
| 短翼 | 7 × 9 × 9 高 | `PART_WALL` | 與長翼組成 L 形 |
| 瞭望塔 | 4 × 4 × 14 高 | `PART_WALL` | 轉角，高過兩翼 |
| 塔冠 | 4.4 × 4.4 × 0.5 高 | `PART_ROOF` | |
| 屋頂 | 各翼 +0.5 m 外緣 | `PART_ROOF` | |
| 冷氣機組 | 2 × 1.5 × 0.8 高 ×2 | `PART_DETAIL` | 屋頂設備 |
| 門廊雨棚 | 5 × 2 × 0.3 厚 | `PART_WALL` | `overhead` 層 |
| 門廊燈 | 0.4 × 0.4 × 0.3 ×2 | `PART_LAMP` | 雨棚兩端 |
| 停車場路燈 | 桿 0.25 × 0.25 × 4.5 | `PART_DETAIL` | 燈桿不發光 |
| 路燈燈頭 | 0.7 × 0.5 × 0.5 | `PART_LAMP` | 只有燈頭發光 |
| 旗桿 | 0.2 × 0.2 × 8 | `PART_DETAIL` | |
| 前庭鋪面 | 24 × 8 | 貼片 `shade 0.58` | 混凝土 |
| 停車場柏油 | 14 × 7 | 貼片 `shade 0.0` | |
| 停車格線 | 2.5 × 5 ×6 | 貼片 `mark` `shade 1.0` | 真實停車格尺寸 |
| 草地 | 兩塊 5 × 6 | 貼片 `lawn` | |

- [ ] **Step 4：註冊進 `registry.ts`**
- [ ] **Step 5：跑測試（含 Task 4 的資料表）**
- [ ] **Step 6：開 showcase 看**

`npm run dev -- --port 5180`，切 civic → 警局。逐項確認：

1. 白天：窗格看得出來、比例正常、沒有浮空
2. 把時刻滑桿拖到 22:00：**窗戶要亮、門廊燈與路燈要亮**、燈桿不亮
3. 住戶比例拖到 0：窗戶全暗，但門廊燈與路燈仍亮（公家單位的外燈不看住戶）
4. 線框：沒有藏在牆裡的面
5. 三角形統計沒有標紅

- [ ] **Step 7：回退驗證**

把路燈燈頭的 `PART_LAMP` 改成 `PART_DETAIL` → Task 4 的
`should light something at night`（若這是唯一的燈）或這一棟的測試轉紅。改回來。

- [ ] **Step 8：提交** 主旨：`feat(civic): 警局`

**Task 6–10 依序：** 消防局（2×2）、醫院（2×3）、小學（2×2）、高中（2×3）、
大學（3×3）。每一棟重複 Step 1–8，各自的零件表在動工時依同樣格式訂出來 ——
**不要照抄警局的表**，六棟長一樣就失去意義了。各棟的辨識特徵：

| 建築 | 辨識特徵（必須在測試裡釘住） |
|---|---|
| 消防局 | 一整排捲門（面向道路那一側）、後方的訓練塔、紅色主體 |
| 醫院 | 主樓＋側翼＋連廊、頂樓直升機坪（含 H 標線與周邊燈）、急診雨棚 |
| 小學 | 低矮、兩排教室翼、操場（草地貼片）、遊具 |
| 高中 | 三層教室樓、跑道（橢圓標線貼片）、司令台 |
| 大學 | 圓頂主樓、方庭（四面圍合）、鐘塔 |

---

## Task 11：批 1 的預算校準

**Files:** Modify `src/renderer/geometry/civic/types.ts`、`BUGS.md`、`TODO.md`

- [ ] **Step 1：量六棟的實際三角形數**

在 showcase 逐一切過六種，記下四層各自的逐格數字。

- [ ] **Step 2：把 `CIVIC_TRIANGLE_BUDGET` 調到實測的 1.2 倍**

spec §4.6 的四個數字是**推的**，不是量的。校準之後在註解裡寫清楚它們現在
是量出來的，以及是照哪六棟量的。

- [ ] **Step 3：記錄**

批 1 過程中發現的任何 bug 寫進 `BUGS.md` 與 `TODO.md`。
在 `TODO.md` 的「公共建築的夜景（BUG-238）」段落把批 1 打勾，
並記下批 2–6 的狀態。

- [ ] **Step 4：全測 + 建置**

```bash
npx tsc --noEmit && npm test && npm run build
```

- [ ] **Step 5：提交** 主旨：`chore(civic): 批 1 三角形預算校準`

---

## 後續批次（各自另立計畫）

批 2–6 每一批是一個獨立的立面類別，視覺語彙差異大，**在批 1 進 showcase
看過之前寫不出有用的計畫**。批 1 完成後依序另立：

| 批 | 內容 | 為什麼要等 |
|---|---|---|
| 批 2 | 公園、墓園（`FACADE_GREEN`） | 綠地幾乎沒有牆，`PART_FOLIAGE` 的用法要先在批 1 的校園草地上驗證過 |
| 批 3 | 電廠、水廠、垃圾場、汙水廠（`FACADE_UTILITY`） | 高窗帶的參數要照批 1 的窗格觀感回頭調 |
| 批 4 | 公車站、捷運站、火車站、渡輪碼頭（`FACADE_TRANSIT`） | 全部 1×1，`CIVIC_INSET` 在最小佔地上的表現要先量過 |
| 批 5 | 機場 3 種（含 taxiway 夜間語彙，見 spec §7） | 9×6 是全專案最大單體，預算要用批 1–4 的實測基準 |
| 批 6 | 遊戲整合 + `HighlightManager` 屬性化（見 spec §6） | 需要至少一批建築在 showcase 裡確認無誤 |

**批 6 的已知迴歸不要忘記：** `HighlightManager.applyTintToGroup` 對
`ShaderMaterial` 兩個分支都不中 —— 高亮會靜默失效，而且 clone 出來的材質
收不到 `uTime`，被高亮過的建築窗戶會凍結在某個亮燈狀態。

---

## Self-Review 紀錄

- **Spec 覆蓋：** spec §4.1–4.6 → Task 0–2；§5 → Task 3；§7 → 批 5；§6 → 批 6；
  §9 的六條測試策略分別落在 Task 0（第 5 條）、Task 1（第 1 條）、
  Task 2（第 4 條）、Task 4（第 2、3、6 條）。
- **型別一致：** `CivicPlan` 的欄位名在 Task 2、3、4、5 之間逐字相同
  （`footprint` / `facade` / `seed` / `massing` / `decals` / `props` / `overhead`）。
- **已知的計畫弱點：** Task 5–10 的零件表只完整寫了警局一棟。其餘五棟給的是
  辨識特徵與必須釘住的約束，尺寸表在動工時訂 —— 照抄警局的表會讓六棟長一樣，
  那比沒有表更糟。
